/**
 * Knowledge Base Writer Module
 * 
 * Handles KB file operations: loading, saving, and updating entities.
 * 
 * @module crawler/kb_writer
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================================
// AGENCY MAPPINGS
// ============================================================================

const AGENCY_MAP = {
  'passport.gov.bd': { id: 'agency.dip', name: 'Department of Immigration and Passports' },
  'www.epassport.gov.bd': { id: 'agency.dip', name: 'Department of Immigration and Passports' },
  'epassport.gov.bd': { id: 'agency.dip', name: 'Department of Immigration and Passports' },
  'dip.gov.bd': { id: 'agency.dip', name: 'Department of Immigration and Passports' },
  'visa.gov.bd': { id: 'agency.dip', name: 'Department of Immigration and Passports' },
  'nidw.gov.bd': { id: 'agency.bec', name: 'Bangladesh Election Commission' },
  'services.nidw.gov.bd': { id: 'agency.bec', name: 'Bangladesh Election Commission' },
  'etaxnbr.gov.bd': { id: 'agency.nbr', name: 'National Board of Revenue' },
  'nbr.gov.bd': { id: 'agency.nbr', name: 'National Board of Revenue' },
  'customs.gov.bd': { id: 'agency.nbr', name: 'National Board of Revenue' },
  'bsp.brta.gov.bd': { id: 'agency.brta', name: 'Bangladesh Road Transport Authority' },
  'brta.gov.bd': { id: 'agency.brta', name: 'Bangladesh Road Transport Authority' },
  'bdpost.gov.bd': { id: 'agency.bpo', name: 'Bangladesh Post Office' },
  'landadministration.gov.bd': { id: 'agency.mol', name: 'Ministry of Land' },
  'land.gov.bd': { id: 'agency.mol', name: 'Ministry of Land' },
  'teletalk.com.bd': { id: 'agency.tt', name: 'Teletalk Bangladesh Limited' },
  'bdris.gov.bd': { id: 'agency.bdris', name: 'Office of Registrar General, Birth and Death Registration' },
  'police.gov.bd': { id: 'agency.bp', name: 'Bangladesh Police' },
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function generateHash(content, algorithm = 'sha256') {
  return crypto.createHash(algorithm).update(content, 'utf8').digest('hex');
}

function generateSourcePageId(url) {
  return `source.${generateHash(url, 'sha1')}`;
}

function getDateString() {
  return new Date().toISOString().split('T')[0];
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ============================================================================
// KB LOADING/SAVING
// ============================================================================

/**
 * Load or create a knowledge base
 * @param {string} kbPath - Path to v3 KB file
 * @param {string} [kbPathV2] - Path to v2 KB file (fallback)
 * @returns {Object} - KB data structure
 */
function loadOrCreateKB(kbPath, kbPathV2) {
  // Try v3 first, then v2
  let loadPath = kbPath;
  if (!fs.existsSync(loadPath) && kbPathV2 && fs.existsSync(kbPathV2)) {
    loadPath = kbPathV2;
  }
  
  if (fs.existsSync(loadPath)) {
    try {
      const kb = JSON.parse(fs.readFileSync(loadPath, 'utf-8'));
      console.log(`📁 Loaded KB from: ${loadPath}`);
      return kb;
    } catch (e) {
      console.warn('⚠️  Failed to load KB, creating new');
    }
  }
  
  // Create new v3 KB
  return {
    "$schema_version": "3.0.0",
    "data_version": 1,
    "last_updated_at": new Date().toISOString(),
    "updated_by": "script:crawl.js",
    "change_log": [{
      "version": 1,
      "date": getDateString(),
      "changes": ["Initial crawl"]
    }],
    "source_pages": [],
    "claims": [],
    "agencies": [],
    "documents": [],
    "services": [],
    "service_guides": [],
  };
}

/**
 * Save knowledge base to file
 * @param {Object} kb - KB data structure
 * @param {string} kbPath - Path to save to
 */
function saveKB(kb, kbPath) {
  kb.last_updated_at = new Date().toISOString();
  kb.data_version = (kb.data_version || 0) + 1;
  
  const kbDir = path.dirname(kbPath);
  ensureDir(kbDir);
  fs.writeFileSync(kbPath, JSON.stringify(kb, null, 2), 'utf-8');
  console.log(`💾 KB saved to: ${kbPath}`);
}

// ============================================================================
// AGENCY MANAGEMENT
// ============================================================================

/**
 * Ensure an agency exists in the KB
 * @param {Object} kb - KB data structure
 * @param {string} domain - Domain to get agency for
 * @returns {string} - Agency ID
 */
function ensureAgency(kb, domain) {
  const cleanDomain = domain.replace(/^www\./, '');
  const agencyInfo = AGENCY_MAP[domain] || AGENCY_MAP[cleanDomain];
  
  if (!agencyInfo) {
    // Create a generic agency for unknown domains
    const agencyId = `agency.${cleanDomain.replace(/[^a-z0-9]/g, '_')}`;
    const existing = kb.agencies.find(a => a.agency_id === agencyId);
    if (!existing) {
      kb.agencies.push({
        agency_id: agencyId,
        name: cleanDomain,
        domain_allowlist: [domain, cleanDomain],
        claims: [],
      });
    }
    return agencyId;
  }
  
  const existing = kb.agencies.find(a => a.agency_id === agencyInfo.id);
  if (!existing) {
    kb.agencies.push({
      agency_id: agencyInfo.id,
      name: agencyInfo.name,
      domain_allowlist: [domain, cleanDomain],
      claims: [],
    });
  } else if (!existing.domain_allowlist.includes(domain)) {
    existing.domain_allowlist.push(domain);
  }
  
  return agencyInfo.id;
}

// ============================================================================
// SOURCE PAGE MANAGEMENT
// ============================================================================

/**
 * Add or update a source page in the KB
 * @param {Object} kb - KB data structure
 * @param {Object} pageData - Page data
 * @param {Function} classifyPage - Page classification function
 * @returns {string} - Source page ID
 */
function addOrUpdateSourcePage(kb, pageData, classifyPage) {
  const sourcePageId = generateSourcePageId(pageData.url);
  const agencyId = ensureAgency(kb, pageData.domain);
  
  const pageTypes = classifyPage(pageData.url, pageData.title, pageData.markdown);
  
  // Detect languages
  const languages = [];
  if (/[a-z]/i.test(pageData.markdown)) languages.push('en');
  if (/[\u0980-\u09FF]/.test(pageData.markdown)) languages.push('bn');
  if (languages.length === 0) languages.push('en');
  
  const sourcePage = {
    source_page_id: sourcePageId,
    canonical_url: pageData.url,
    agency_id: agencyId,
    page_type: pageTypes[0] || 'other',
    page_types: pageTypes,
    title: pageData.title || pageData.url,
    language: languages,
    crawl_method: 'html_static',
    last_crawled_at: new Date().toISOString(),
    content_hash: pageData.contentHash,
    snapshot_ref: pageData.snapshotRef,
    status: 'active',
    change_log: [],
  };
  
  const existingIdx = kb.source_pages.findIndex(sp => sp.source_page_id === sourcePageId);
  if (existingIdx >= 0) {
    const existing = kb.source_pages[existingIdx];
    if (existing.content_hash !== pageData.contentHash) {
      sourcePage.previous_hash = existing.content_hash;
      sourcePage.change_log = existing.change_log || [];
      sourcePage.change_log.push({
        detected_at: new Date().toISOString(),
        hash_before: existing.content_hash,
        hash_after: pageData.contentHash,
      });
    }
    kb.source_pages[existingIdx] = sourcePage;
  } else {
    kb.source_pages.push(sourcePage);
  }
  
  return sourcePageId;
}

/**
 * Add claims to KB (deduplicating by ID)
 * @param {Object} kb - KB data structure
 * @param {Array} claims - Claims to add
 * @returns {number} - Number of claims added
 */
function addClaimsToKB(kb, claims) {
  let added = 0;
  for (const claim of claims) {
    const existing = kb.claims.find(c => c.claim_id === claim.claim_id);
    if (!existing) {
      kb.claims.push(claim);
      added++;
    }
  }
  return added;
}

module.exports = {
  AGENCY_MAP,
  generateHash,
  generateSourcePageId,
  getDateString,
  ensureDir,
  loadOrCreateKB,
  saveKB,
  ensureAgency,
  addOrUpdateSourcePage,
  addClaimsToKB,
};

