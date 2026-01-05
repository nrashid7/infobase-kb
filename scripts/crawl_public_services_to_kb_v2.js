/**
 * Bangladesh Government Services KB v2 - Public Services Crawler
 * 
 * Crawls citizen-facing public service portals and builds an audit-grade KB.
 * 
 * SCOPE: Public Services Only (First Wave)
 * - Passport / ePassport / immigration
 * - NID / Election Commission identity
 * - Birth registration / civil registration
 * - Land services
 * - Tax / eTax / NBR
 * - BRTA / driving license / vehicle
 * - Police clearance / police services
 * 
 * HARD EXCLUSIONS:
 * - News, press, events, notices, circulars, tenders, jobs, galleries, blogs
 * 
 * OUTPUT:
 * - Snapshots: kb/snapshots/<source_page_id>/<date>/page.html, page.md, meta.json
 * - KB: kb/bangladesh_government_services_kb_v2.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Crawl settings
  maxPagesPerDomain: 60,
  maxDepth: 3,
  delayBetweenRequestsMs: 2000,  // Polite rate limiting
  requestTimeoutMs: 30000,
  maxRetries: 3,
  
  // Paths
  kbPath: path.join(__dirname, '..', 'kb', 'bangladesh_government_services_kb_v2.json'),
  snapshotsDir: path.join(__dirname, '..', 'kb', 'snapshots'),
  stateFile: path.join(__dirname, 'crawl_state.json'),
  
  // bdgovlinks.com URL
  bdgovlinksUrl: 'https://bdgovlinks.com/',
  
  // Public service target domains (prioritized)
  publicServiceDomains: [
    'epassport.gov.bd',
    'passport.gov.bd',
    'nidw.gov.bd',
    'services.nidw.gov.bd',
    'bdris.gov.bd',           // Birth registration
    'land.gov.bd',
    'landadministration.gov.bd',
    'etaxnbr.gov.bd',
    'nbr.gov.bd',
    'incometax.gov.bd',
    'brta.gov.bd',
    'bsp.brta.gov.bd',        // BRTA service portal
    'police.gov.bd',
  ],
  
  // Keywords to identify public service content
  allowKeywords: [
    'passport', 'epassport', 'e-passport', 'immigration',
    'nid', 'national id', 'voter', 'election',
    'birth', 'death', 'marriage', 'registration', 'certificate',
    'land', 'property', 'mutation', 'khatian',
    'tax', 'etax', 'e-tax', 'nbr', 'income tax', 'vat', 'tin',
    'brta', 'driving', 'license', 'vehicle', 'motor',
    'police', 'clearance', 'verification',
    'apply', 'application', 'service', 'e-service', 'online',
    'fee', 'requirement', 'document', 'process', 'step', 'how to',
    'eligibility', 'faq', 'instruction'
  ],
  
  // Hard exclusion patterns (paths and keywords)
  // MUST match: /news, /press, /notice, /notices, /circular, /gazette, /tender, /job, /vacancy
  excludePatterns: [
    /\/news\b/i, /\/press\b/i, /\/press-release/i, /\/pressrelease/i,
    /\/media\b/i, /\/event/i, /\/notice/i, /\/notices/i, /\/circular/i,
    /\/notification/i, /\/gazette/i, /\/tender/i, /\/procurement/i,
    /\/career/i, /\/job/i, /\/vacancy/i, /\/recruitment/i,
    /\/gallery/i, /\/photo/i, /\/video/i, /\/image/i,
    /\/blog/i, /\/article/i, /\/archive/i,
    /\/latest/i, /\/recent/i, /\/update/i,
    /\.pdf$/i, /\.doc$/i, /\.docx$/i, /\.xls$/i, /\.xlsx$/i,
    /\.zip$/i, /\.rar$/i, /\.exe$/i, /\.apk$/i,
    /\/(bn|en)\/news/i, /\/(bn|en)\/notice/i, /\/(bn|en)\/notices/i,
  ],
  
  // Include patterns (high priority service pages)
  includePatterns: [
    /apply/i, /application/i, /instruction/i, /how-to/i,
    /eligibility/i, /requirement/i, /document/i,
    /fee/i, /charge/i, /cost/i, /price/i,
    /process/i, /step/i, /procedure/i,
    /service/i, /e-service/i, /online/i,
    /faq/i, /help/i, /guide/i,
    /form/i, /download/i,
  ],
};

// ============================================================================
// AGENCY MAPPINGS
// ============================================================================

const AGENCY_MAP = {
  'epassport.gov.bd': { id: 'agency.dip', name: 'Department of Immigration and Passports' },
  'passport.gov.bd': { id: 'agency.dip', name: 'Department of Immigration and Passports' },
  'nidw.gov.bd': { id: 'agency.bec', name: 'Bangladesh Election Commission' },
  'services.nidw.gov.bd': { id: 'agency.bec', name: 'Bangladesh Election Commission' },
  'bdris.gov.bd': { id: 'agency.bdris', name: 'Office of Registrar General, Birth and Death Registration' },
  'land.gov.bd': { id: 'agency.mol', name: 'Ministry of Land' },
  'landadministration.gov.bd': { id: 'agency.mol', name: 'Ministry of Land' },
  'etaxnbr.gov.bd': { id: 'agency.nbr', name: 'National Board of Revenue' },
  'nbr.gov.bd': { id: 'agency.nbr', name: 'National Board of Revenue' },
  'incometax.gov.bd': { id: 'agency.nbr', name: 'National Board of Revenue' },
  'brta.gov.bd': { id: 'agency.brta', name: 'Bangladesh Road Transport Authority' },
  'bsp.brta.gov.bd': { id: 'agency.brta', name: 'Bangladesh Road Transport Authority' },
  'police.gov.bd': { id: 'agency.bp', name: 'Bangladesh Police' },
};

// ============================================================================
// UTILITIES
// ============================================================================

function generateSourcePageId(canonicalUrl) {
  const hash = crypto.createHash('sha1').update(canonicalUrl, 'utf8').digest('hex');
  return `source.${hash}`;
}

function generateContentHash(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function getDateString() {
  return new Date().toISOString().split('T')[0];
}

function normalizeUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    // Remove trailing slashes, normalize to lowercase host
    let normalized = `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname}`;
    // Remove trailing slash except for root
    if (normalized.endsWith('/') && url.pathname !== '/') {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch (e) {
    return null;
  }
}

function getDomain(urlStr) {
  try {
    return new URL(urlStr).hostname.toLowerCase();
  } catch (e) {
    return null;
  }
}

function shouldExcludeUrl(urlStr) {
  const lower = urlStr.toLowerCase();
  for (const pattern of CONFIG.excludePatterns) {
    if (pattern.test(lower)) {
      return true;
    }
  }
  return false;
}

function isServicePage(urlStr, pageContent = '') {
  const lower = urlStr.toLowerCase() + ' ' + pageContent.toLowerCase();
  for (const pattern of CONFIG.includePatterns) {
    if (pattern.test(lower)) {
      return true;
    }
  }
  // Also check keywords in URL
  for (const keyword of CONFIG.allowKeywords) {
    if (lower.includes(keyword)) {
      return true;
    }
  }
  return false;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// FIRECRAWL MCP INTEGRATION (via direct HTTP calls for Node.js)
// ============================================================================

/**
 * Call Firecrawl scrape via MCP (simulated - in actual execution this would be MCP)
 * For now, we'll use a simple fetch wrapper that can be replaced with actual MCP calls
 */
async function firecrawlScrape(url, options = {}) {
  // This would be the actual MCP call in the Cursor environment
  // For now, return a placeholder structure that will be filled by the actual MCP
  console.log(`  📄 Scraping: ${url}`);
  
  // Return placeholder - actual implementation uses MCP
  return {
    success: false,
    error: 'MCP call required - run in Cursor environment'
  };
}

async function firecrawlMap(url, options = {}) {
  console.log(`  🗺️  Mapping: ${url}`);
  return {
    success: false,
    error: 'MCP call required - run in Cursor environment'
  };
}

// ============================================================================
// CRAWL STATE MANAGEMENT
// ============================================================================

function loadCrawlState() {
  if (fs.existsSync(CONFIG.stateFile)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf-8'));
    } catch (e) {
      console.warn('Failed to load crawl state, starting fresh');
    }
  }
  return {
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    domainsCompleted: [],
    domainsInProgress: {},
    pagesProcessed: 0,
    pagesSaved: 0,
    claimsExtracted: 0,
    excludedUrls: [],
    errors: []
  };
}

function saveCrawlState(state) {
  state.lastUpdated = new Date().toISOString();
  fs.writeFileSync(CONFIG.stateFile, JSON.stringify(state, null, 2), 'utf-8');
}

// ============================================================================
// SNAPSHOT MANAGEMENT
// ============================================================================

function getSnapshotPath(sourcePageId, date) {
  return path.join(CONFIG.snapshotsDir, sourcePageId, date);
}

function snapshotExistsToday(sourcePageId) {
  const snapshotPath = getSnapshotPath(sourcePageId, getDateString());
  return fs.existsSync(path.join(snapshotPath, 'meta.json'));
}

function saveSnapshot(sourcePageId, url, html, markdown) {
  // HARD EXCLUDE GUARD: Never save snapshots for excluded URLs
  if (shouldExcludeUrl(url)) {
    throw new Error(`Cannot save snapshot for excluded URL: ${url}`);
  }
  
  const date = getDateString();
  const snapshotPath = getSnapshotPath(sourcePageId, date);
  
  // Create directory
  fs.mkdirSync(snapshotPath, { recursive: true });
  
  // Save HTML
  if (html) {
    fs.writeFileSync(path.join(snapshotPath, 'page.html'), html, 'utf-8');
  }
  
  // Save Markdown
  fs.writeFileSync(path.join(snapshotPath, 'page.md'), markdown, 'utf-8');
  
  // Compute content hash from markdown
  const contentHash = generateContentHash(markdown);
  
  // Save meta
  const meta = {
    canonical_url: url,
    source_page_id: sourcePageId,
    fetched_at: new Date().toISOString(),
    content_hash_sha256: contentHash,
    snapshot_date: date
  };
  fs.writeFileSync(path.join(snapshotPath, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
  
  return {
    snapshotRef: `snapshots/${sourcePageId}/${date}`,
    contentHash
  };
}

// ============================================================================
// KB MANAGEMENT
// ============================================================================

function loadOrCreateKB() {
  if (fs.existsSync(CONFIG.kbPath)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG.kbPath, 'utf-8'));
    } catch (e) {
      console.warn('Failed to load existing KB, creating new');
    }
  }
  
  // Create new KB with required structure
  return {
    "$schema_version": "2.0.0",
    "data_version": 1,
    "last_updated_at": new Date().toISOString(),
    "updated_by": "script:crawl_public_services_to_kb_v2.js",
    "change_log": [{
      "version": 1,
      "date": getDateString(),
      "changes": ["Initial crawl of public service portals"]
    }],
    "source_pages": [],
    "claims": [],
    "agencies": [],
    "documents": [],
    "services": []
  };
}

function saveKB(kb) {
  kb.last_updated_at = new Date().toISOString();
  kb.data_version = (kb.data_version || 0) + 1;
  
  // Ensure directory exists
  const kbDir = path.dirname(CONFIG.kbPath);
  if (!fs.existsSync(kbDir)) {
    fs.mkdirSync(kbDir, { recursive: true });
  }
  
  fs.writeFileSync(CONFIG.kbPath, JSON.stringify(kb, null, 2), 'utf-8');
  console.log(`\n✅ KB saved to: ${CONFIG.kbPath}`);
}

function ensureAgency(kb, domain) {
  const agencyInfo = AGENCY_MAP[domain] || AGENCY_MAP[domain.replace('www.', '')];
  if (!agencyInfo) {
    return 'agency.unknown';
  }
  
  // Check if agency exists
  const existing = kb.agencies.find(a => a.agency_id === agencyInfo.id);
  if (!existing) {
    kb.agencies.push({
      agency_id: agencyInfo.id,
      name: agencyInfo.name,
      domain_allowlist: [domain, `www.${domain}`],
      claims: []
    });
  } else {
    // Ensure domain is in allowlist
    if (!existing.domain_allowlist.includes(domain)) {
      existing.domain_allowlist.push(domain);
    }
  }
  
  return agencyInfo.id;
}

function addOrUpdateSourcePage(kb, url, domain, title, markdown, contentHash, snapshotRef) {
  // HARD EXCLUDE GUARD: Never add source pages for excluded URLs
  if (shouldExcludeUrl(url)) {
    throw new Error(`Cannot add source page for excluded URL: ${url}`);
  }
  
  const sourcePageId = generateSourcePageId(url);
  const agencyId = ensureAgency(kb, domain);
  
  // Detect page type
  let pageType = 'other';
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('fee') || lowerUrl.includes('charge')) {
    pageType = 'fee_schedule';
  } else if (lowerUrl.includes('instruction') || lowerUrl.includes('how-to') || lowerUrl.includes('step')) {
    pageType = 'instruction';
  } else if (lowerUrl.includes('form')) {
    pageType = 'form';
  } else if (lowerUrl === domain || lowerUrl.endsWith(domain + '/')) {
    pageType = 'main_portal';
  }
  
  // Detect languages
  const languages = [];
  if (/[a-z]/i.test(markdown)) languages.push('en');
  if (/[\u0980-\u09FF]/.test(markdown)) languages.push('bn');
  if (languages.length === 0) languages.push('en');
  
  const sourcePage = {
    source_page_id: sourcePageId,
    canonical_url: url,
    agency_id: agencyId,
    page_type: pageType,
    title: title || url,
    language: languages,
    crawl_method: 'html_static',
    last_crawled_at: new Date().toISOString(),
    content_hash: contentHash,
    snapshot_ref: snapshotRef,
    status: 'active',
    change_log: []
  };
  
  // Check if exists
  const existingIdx = kb.source_pages.findIndex(sp => sp.source_page_id === sourcePageId);
  if (existingIdx >= 0) {
    // Update
    const existing = kb.source_pages[existingIdx];
    if (existing.content_hash !== contentHash) {
      sourcePage.previous_hash = existing.content_hash;
      sourcePage.change_log = existing.change_log || [];
      sourcePage.change_log.push({
        detected_at: new Date().toISOString(),
        hash_before: existing.content_hash,
        hash_after: contentHash
      });
    }
    kb.source_pages[existingIdx] = sourcePage;
  } else {
    kb.source_pages.push(sourcePage);
  }
  
  return sourcePageId;
}

// ============================================================================
// CLAIM EXTRACTION
// ============================================================================

function extractClaimsFromMarkdown(markdown, sourcePageId, url) {
  const claims = [];
  const lines = markdown.split('\n');
  let currentHeadingPath = [];
  let claimCounter = 0;
  
  const domain = getDomain(url);
  const servicePrefix = domain.replace('.gov.bd', '').replace(/\./g, '_');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Track headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();
      currentHeadingPath = currentHeadingPath.slice(0, level - 1);
      currentHeadingPath.push(headingText);
      continue;
    }
    
    // Skip empty lines
    if (!line) continue;
    
    // Extract claims based on content patterns
    
    // Fee pattern: "X BDT" or "X Taka" or "৳X"
    const feeMatch = line.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(BDT|Taka|টাকা|৳)/i) ||
                     line.match(/(৳)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
    if (feeMatch) {
      claimCounter++;
      const amount = parseInt(feeMatch[1].replace(/,/g, ''), 10);
      if (!isNaN(amount) && amount > 0) {
        claims.push({
          claim_id: `claim.fee.${servicePrefix}.auto_${claimCounter}`,
          entity_ref: { type: 'service', id: `svc.${servicePrefix}` },
          claim_type: 'fee',
          text: line.slice(0, 200),  // Truncate long lines
          status: 'unverified',
          structured_data: { amount_bdt: amount },
          citations: [{
            source_page_id: sourcePageId,
            quoted_text: line.slice(0, 150),
            locator: {
              type: 'heading_path',
              heading_path: currentHeadingPath.length > 0 ? currentHeadingPath : ['Page Content']
            },
            retrieved_at: new Date().toISOString(),
            language: /[\u0980-\u09FF]/.test(line) ? 'bn' : 'en'
          }],
          last_verified_at: new Date().toISOString(),
          tags: ['fee', 'auto_extracted']
        });
      }
    }
    
    // Step pattern: "Step X:" or numbered list items about process
    const stepMatch = line.match(/^(?:step\s*)?(\d+)[.:]\s*(.+)/i);
    if (stepMatch && (
      line.toLowerCase().includes('apply') ||
      line.toLowerCase().includes('submit') ||
      line.toLowerCase().includes('visit') ||
      line.toLowerCase().includes('collect') ||
      line.toLowerCase().includes('pay') ||
      line.toLowerCase().includes('fill') ||
      line.toLowerCase().includes('upload')
    )) {
      claimCounter++;
      claims.push({
        claim_id: `claim.step.${servicePrefix}.auto_${claimCounter}`,
        entity_ref: { type: 'service', id: `svc.${servicePrefix}` },
        claim_type: 'step',
        text: stepMatch[2].slice(0, 200),
        status: 'unverified',
        structured_data: { order: parseInt(stepMatch[1], 10) },
        citations: [{
          source_page_id: sourcePageId,
          quoted_text: line.slice(0, 150),
          locator: {
            type: 'heading_path',
            heading_path: currentHeadingPath.length > 0 ? currentHeadingPath : ['Page Content']
          },
          retrieved_at: new Date().toISOString(),
          language: /[\u0980-\u09FF]/.test(line) ? 'bn' : 'en'
        }],
        last_verified_at: new Date().toISOString(),
        tags: ['step', 'auto_extracted']
      });
    }
    
    // Document requirement pattern: "required documents" sections
    if (line.startsWith('-') || line.startsWith('*') || line.startsWith('•')) {
      const listItem = line.replace(/^[-*•]\s*/, '').trim();
      if (listItem.length > 10 && listItem.length < 200) {
        const lower = listItem.toLowerCase();
        if (
          lower.includes('document') ||
          lower.includes('certificate') ||
          lower.includes('photo') ||
          lower.includes('id') ||
          lower.includes('nid') ||
          lower.includes('passport') ||
          lower.includes('copy') ||
          lower.includes('original')
        ) {
          claimCounter++;
          claims.push({
            claim_id: `claim.doc.${servicePrefix}.req_${claimCounter}`,
            entity_ref: { type: 'service', id: `svc.${servicePrefix}` },
            claim_type: 'document_requirement',
            text: listItem,
            status: 'unverified',
            citations: [{
              source_page_id: sourcePageId,
              quoted_text: listItem,
              locator: {
                type: 'heading_path',
                heading_path: currentHeadingPath.length > 0 ? currentHeadingPath : ['Page Content']
              },
              retrieved_at: new Date().toISOString(),
              language: /[\u0980-\u09FF]/.test(listItem) ? 'bn' : 'en'
            }],
            last_verified_at: new Date().toISOString(),
            tags: ['document', 'requirement', 'auto_extracted']
          });
        }
      }
    }
    
    // Processing time pattern: "X days" or "X working days"
    const timeMatch = line.match(/(\d+)\s*(working\s*)?(day|week|month|hour)/i);
    if (timeMatch && (
      line.toLowerCase().includes('process') ||
      line.toLowerCase().includes('delivery') ||
      line.toLowerCase().includes('time') ||
      line.toLowerCase().includes('duration')
    )) {
      claimCounter++;
      const amount = parseInt(timeMatch[1], 10);
      const unit = timeMatch[3].toLowerCase();
      const isWorking = !!timeMatch[2];
      claims.push({
        claim_id: `claim.processing_time.${servicePrefix}.auto_${claimCounter}`,
        entity_ref: { type: 'service', id: `svc.${servicePrefix}` },
        claim_type: 'processing_time',
        text: line.slice(0, 200),
        status: 'unverified',
        structured_data: {
          amount: amount,
          unit: unit + 's',
          working_days: isWorking
        },
        citations: [{
          source_page_id: sourcePageId,
          quoted_text: line.slice(0, 150),
          locator: {
            type: 'heading_path',
            heading_path: currentHeadingPath.length > 0 ? currentHeadingPath : ['Page Content']
          },
          retrieved_at: new Date().toISOString(),
          language: /[\u0980-\u09FF]/.test(line) ? 'bn' : 'en'
        }],
        last_verified_at: new Date().toISOString(),
        tags: ['processing_time', 'auto_extracted']
      });
    }
    
    // Eligibility pattern
    if (
      line.toLowerCase().includes('eligible') ||
      line.toLowerCase().includes('must be') ||
      line.toLowerCase().includes('required to') ||
      line.toLowerCase().includes('citizen') ||
      line.toLowerCase().includes('age') && line.match(/\d+/)
    ) {
      claimCounter++;
      claims.push({
        claim_id: `claim.eligibility.${servicePrefix}.auto_${claimCounter}`,
        entity_ref: { type: 'service', id: `svc.${servicePrefix}` },
        claim_type: 'eligibility_requirement',
        text: line.slice(0, 200),
        status: 'unverified',
        citations: [{
          source_page_id: sourcePageId,
          quoted_text: line.slice(0, 150),
          locator: {
            type: 'heading_path',
            heading_path: currentHeadingPath.length > 0 ? currentHeadingPath : ['Page Content']
          },
          retrieved_at: new Date().toISOString(),
          language: /[\u0980-\u09FF]/.test(line) ? 'bn' : 'en'
        }],
        last_verified_at: new Date().toISOString(),
        tags: ['eligibility', 'auto_extracted']
      });
    }
  }
  
  return claims;
}

function addClaimsToKB(kb, claims) {
  let added = 0;
  for (const claim of claims) {
    // Check for duplicate claim_id
    const existing = kb.claims.find(c => c.claim_id === claim.claim_id);
    if (!existing) {
      kb.claims.push(claim);
      added++;
    }
  }
  return added;
}

// ============================================================================
// REPORT GENERATION
// ============================================================================

function generateReport(state, kb) {
  console.log('\n' + '='.repeat(70));
  console.log('CRAWL REPORT');
  console.log('='.repeat(70));
  
  console.log('\n📊 SUMMARY');
  console.log(`  Started at: ${state.startedAt}`);
  console.log(`  Completed at: ${new Date().toISOString()}`);
  console.log('');
  
  console.log('📌 LINKS DISCOVERY');
  console.log(`  Total links on bdgovlinks: 110+ (as reported by site)`);
  console.log('');
  
  console.log('🎯 PUBLIC SERVICE DOMAINS');
  const selectedDomains = CONFIG.publicServiceDomains;
  console.log(`  Selected for crawl: ${selectedDomains.length}`);
  selectedDomains.forEach(d => console.log(`    - ${d}`));
  console.log('');
  
  console.log('✅ DOMAINS CRAWLED');
  console.log(`  Successfully completed: ${state.domainsCompleted.length}`);
  state.domainsCompleted.forEach(d => console.log(`    ✓ ${d}`));
  console.log('');
  
  console.log('📄 PAGES');
  console.log(`  Total pages processed: ${state.pagesProcessed}`);
  console.log(`  Pages saved to snapshots: ${state.pagesSaved}`);
  console.log('');
  
  console.log('💡 CLAIMS');
  console.log(`  Total claims extracted: ${state.claimsExtracted}`);
  console.log(`  All claims marked as: unverified (for manual review)`);
  console.log('');
  
  console.log('🚫 EXCLUSIONS');
  const exclusionCounts = {};
  for (const url of state.excludedUrls) {
    for (const pattern of CONFIG.excludePatterns) {
      if (pattern.test(url)) {
        const patternStr = pattern.toString();
        exclusionCounts[patternStr] = (exclusionCounts[patternStr] || 0) + 1;
        break;
      }
    }
  }
  console.log(`  Total URLs excluded: ${state.excludedUrls.length}`);
  console.log('  Top exclusion patterns:');
  Object.entries(exclusionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([pattern, count]) => {
      console.log(`    ${pattern}: ${count}`);
    });
  console.log('');
  
  if (state.errors.length > 0) {
    console.log('⚠️ ERRORS');
    console.log(`  Total errors: ${state.errors.length}`);
    state.errors.slice(0, 5).forEach(e => console.log(`    - ${e}`));
    if (state.errors.length > 5) {
      console.log(`    ... and ${state.errors.length - 5} more`);
    }
    console.log('');
  }
  
  console.log('📦 KB STATISTICS');
  console.log(`  Source pages: ${kb.source_pages.length}`);
  console.log(`  Claims: ${kb.claims.length}`);
  console.log(`  Agencies: ${kb.agencies.length}`);
  console.log(`  Documents: ${kb.documents.length}`);
  console.log(`  Services: ${kb.services.length}`);
  console.log('');
  
  console.log('='.repeat(70));
}

// ============================================================================
// MAIN CRAWLER LOGIC
// ============================================================================

/**
 * This is designed to be run in the Cursor environment with MCP Firecrawl available.
 * When run standalone, it will show the structure but not perform actual crawls.
 */
async function main() {
  console.log('🚀 Bangladesh Government Services KB v2 - Public Services Crawler');
  console.log('='.repeat(70));
  console.log('');
  
  // Check for --force flag
  const forceRecrawl = process.argv.includes('--force');
  if (forceRecrawl) {
    console.log('⚠️  Force mode enabled - will re-crawl all pages\n');
  }
  
  // Load or create state
  let state = loadCrawlState();
  console.log(`📁 State file: ${CONFIG.stateFile}`);
  console.log(`📁 KB path: ${CONFIG.kbPath}`);
  console.log(`📁 Snapshots: ${CONFIG.snapshotsDir}`);
  console.log('');
  
  // Load or create KB
  const kb = loadOrCreateKB();
  console.log(`📊 Loaded KB with ${kb.source_pages.length} existing source pages, ${kb.claims.length} claims\n`);
  
  // Ensure snapshots directory exists
  if (!fs.existsSync(CONFIG.snapshotsDir)) {
    fs.mkdirSync(CONFIG.snapshotsDir, { recursive: true });
  }
  
  console.log('🎯 Target Public Service Domains:');
  CONFIG.publicServiceDomains.forEach(d => console.log(`    - ${d}`));
  console.log('');
  
  console.log('⚠️  This script requires Firecrawl MCP to be available.');
  console.log('    When run in Cursor with MCP, it will perform the actual crawl.');
  console.log('    Running in standalone mode for structure verification...');
  console.log('');
  
  // The actual crawling would be done via MCP calls
  // For now, output the crawl plan
  console.log('📋 CRAWL PLAN:');
  console.log('');
  
  for (const domain of CONFIG.publicServiceDomains) {
    const alreadyCompleted = state.domainsCompleted.includes(domain);
    if (alreadyCompleted && !forceRecrawl) {
      console.log(`  ⏭️  ${domain} - already completed (skip)`);
      continue;
    }
    
    console.log(`  🔄 ${domain} - would crawl with:`);
    console.log(`      - Max depth: ${CONFIG.maxDepth}`);
    console.log(`      - Max pages: ${CONFIG.maxPagesPerDomain}`);
    console.log(`      - Delay: ${CONFIG.delayBetweenRequestsMs}ms`);
    console.log(`      - Agency: ${AGENCY_MAP[domain]?.name || 'Unknown'}`);
    console.log('');
  }
  
  // Save state and KB
  saveCrawlState(state);
  saveKB(kb);
  
  // Generate report
  generateReport(state, kb);
  
  console.log('\n✅ Crawl structure verified. Run with Firecrawl MCP for actual crawling.');
  console.log('   Use: --force to re-crawl already completed domains');
}

// Export for external use
module.exports = {
  CONFIG,
  AGENCY_MAP,
  generateSourcePageId,
  generateContentHash,
  normalizeUrl,
  getDomain,
  shouldExcludeUrl,
  isServicePage,
  loadCrawlState,
  saveCrawlState,
  loadOrCreateKB,
  saveKB,
  saveSnapshot,
  addOrUpdateSourcePage,
  extractClaimsFromMarkdown,
  addClaimsToKB,
  generateReport
};

// Run if executed directly
if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

