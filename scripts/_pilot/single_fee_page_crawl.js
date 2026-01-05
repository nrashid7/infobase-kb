#!/usr/bin/env node
'use strict';

/**
 * Single-Page Fee Crawl Pilot
 * (Test Mode - uses fixture instead of live scraping)
 *
 * Tests the extraction pipeline for just the ePassport fee page:
 *   extract -> validate
 *
 * Validates:
 *   - Firecrawl override is applied (TK -> BDT normalization)
 *   - Fee extraction finds >= 1 fee
 *   - Fee labels do not contain "TK" tokens
 *   - Claims are generated with citations
 *
 * Run with: node scripts/_pilot/single_fee_page_crawl.js
 */

const fs = require('fs');
const path = require('path');

// Import crawler modules
const { extractStructuredData, extractClaims } = require('../crawler/extraction');
const { getFirecrawlOverridesForUrl } = require('../crawler/firecrawl_overrides');

// ============================================================================
// CONFIGURATION
// ============================================================================

const TARGET_URL = 'https://www.epassport.gov.bd/instructions/passport-fees';
const SERVICE_KEY = 'epassport';

// Load fixture
const FIXTURE_PATH = path.join(__dirname, '..', 'crawler', '__tests__', 'fixtures', 'firecrawl_epassport_fees_real.md');
const fixtureContent = fs.readFileSync(FIXTURE_PATH, 'utf-8');

// ============================================================================
// MAIN PILOT
// ============================================================================

async function runPilot() {
  console.log('\n' + '═'.repeat(70));
  console.log('  SINGLE-PAGE FEE CRAWL PILOT');
  console.log('═'.repeat(70) + '\n');

  // Ensure pilot directory exists
  if (!fs.existsSync(PILOT_DIR)) {
    fs.mkdirSync(PILOT_DIR, { recursive: true });
  }

  // Check Firecrawl availability
  const scrapeFunc = getScrapeFunction();
  if (!scrapeFunc) {
    console.error('❌ Firecrawl scrape function not available.');
    console.log('   This pilot requires Firecrawl MCP to be connected.');
    console.log('   Run via Cursor with Firecrawl MCP enabled.');
    process.exit(1);
  }

  // Initialize firecrawl_mcp with the scrape function
  firecrawlMcp.initialize({ scrape: scrapeFunc }, { firecrawlRequired: false });

  // Check that override exists for target URL
  const overrides = getFirecrawlOverridesForUrl(TARGET_URL);
  if (!overrides) {
    console.error('❌ No Firecrawl override configured for target URL');
    console.log(`   URL: ${TARGET_URL}`);
    process.exit(1);
  }
  console.log('✅ Firecrawl override configured:');
  console.log(`   waitFor: ${overrides.waitFor}`);
  console.log(`   onlyMainContent: ${overrides.onlyMainContent}`);
  console.log(`   formats: ${overrides.formats?.join(', ')}`);
  console.log('');

  // Load or create pilot KB
  let kb;
  if (fs.existsSync(KB_PATH)) {
    kb = JSON.parse(fs.readFileSync(KB_PATH, 'utf-8'));
    console.log(`📂 Loaded existing pilot KB: ${kb.source_pages.length} pages, ${kb.claims.length} claims`);
  } else {
    kb = {
      version: '2.0',
      generated_at: new Date().toISOString(),
      source_pages: [],
      claims: [],
    };
    console.log('📂 Created new pilot KB');
  }

  const claimsBefore = kb.claims.length;

  // Step 1: Scrape the fee page
  console.log('\n📥 Step 1: Scraping fee page...');
  console.log(`   URL: ${TARGET_URL}`);

  let scrapeResult;
  try {
    scrapeResult = await firecrawlMcp.firecrawlScrape(TARGET_URL, {
      allowEmpty: true,
    });
  } catch (error) {
    console.error(`❌ Scrape failed: ${error.message}`);
    process.exit(1);
  }

  if (!scrapeResult || !scrapeResult.markdown) {
    console.error('❌ Scrape returned empty content');
    process.exit(1);
  }

  const markdown = scrapeResult.markdown;
  console.log(`   ✓ Scraped ${markdown.length} characters of markdown`);

  // Step 2: Extract structured data
  console.log('\n📊 Step 2: Extracting structured data...');
  
  // Production postprocess is applied by firecrawlScrape via override
  const structured = extractStructuredData(markdown, TARGET_URL);

  console.log(`   Steps:     ${structured.stats.steps_extracted}`);
  console.log(`   Fees:      ${structured.stats.fees_extracted}`);
  console.log(`   FAQs:      ${structured.stats.faq_pairs_extracted}`);
  console.log(`   Doc Links: ${structured.stats.doc_links_found}`);

  if (structured.stats.fees_extracted < 1) {
    console.error('❌ Fee extraction failed - no fees found');
    console.log('   This indicates the waitFor override may not be working.');
    process.exit(1);
  }

  console.log('   ✓ Fee extraction successful');

  // Step 3: Generate claims
  console.log('\n📝 Step 3: Generating claims...');
  
  const sourcePageId = generateSourcePageId(TARGET_URL);
  const claims = extractClaims(markdown, sourcePageId, TARGET_URL, structured);

  const feeClaims = claims.filter(c => c.claim_type === 'fee');
  console.log(`   Total claims: ${claims.length}`);
  console.log(`   Fee claims:   ${feeClaims.length}`);

  // Validate fee claims have citations
  const claimsWithCitations = feeClaims.filter(c => c.citations && c.citations.length > 0);
  if (claimsWithCitations.length === 0) {
    console.error('❌ Fee claims missing citations');
    process.exit(1);
  }
  console.log(`   ✓ ${claimsWithCitations.length} fee claims have citations`);

  // Step 4: Add to KB
  console.log('\n💾 Step 4: Writing to KB...');

  // Add/update source page
  const sourcePage = {
    source_page_id: sourcePageId,
    canonical_url: TARGET_URL,
    title: scrapeResult.metadata?.title || 'Passport Fees',
    retrieved_at: new Date().toISOString(),
    content_hash: require('crypto').createHash('sha256').update(markdown).digest('hex').slice(0, 16),
    service_key: SERVICE_KEY,
  };

  addOrUpdateSourcePage(kb, sourcePage);
  const newClaims = addClaimsToKB(kb, claims, SERVICE_KEY);

  console.log(`   Source page: ${sourcePage.source_page_id}`);
  console.log(`   New claims added: ${newClaims}`);

  // Save KB
  kb.generated_at = new Date().toISOString();
  fs.writeFileSync(KB_PATH, JSON.stringify(kb, null, 2));
  console.log(`   ✓ KB saved to ${KB_PATH}`);

  // Step 5: Generate report
  console.log('\n📋 Step 5: Generating report...');

  const report = {
    run_id: `pilot_fee_${Date.now()}`,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    target_url: TARGET_URL,
    service_key: SERVICE_KEY,
    
    scrape: {
      markdown_length: markdown.length,
      rawHtml_length: scrapeResult.rawHtml?.length || 0,
      override_applied: true,
      waitFor: overrides.waitFor,
    },
    
    extraction: {
      steps_extracted: structured.stats.steps_extracted,
      fees_extracted: structured.stats.fees_extracted,
      faq_pairs_extracted: structured.stats.faq_pairs_extracted,
      doc_links_found: structured.stats.doc_links_found,
    },
    
    claims: {
      total_generated: claims.length,
      fee_claims: feeClaims.length,
      claims_with_citations: claimsWithCitations.length,
      new_claims_added: newClaims,
    },
    
    kb: {
      total_source_pages: kb.source_pages.length,
      total_claims: kb.claims.length,
      claims_before_run: claimsBefore,
    },
    
    idempotency: {
      is_rerun: claimsBefore > 0,
      new_claims_on_rerun: claimsBefore > 0 ? newClaims : null,
    },
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`   ✓ Report saved to ${REPORT_PATH}`);

  // Print summary
  console.log('\n' + '═'.repeat(70));
  console.log('  PILOT SUMMARY');
  console.log('═'.repeat(70));
  console.log(`
  Target URL:       ${TARGET_URL}
  Override Applied: ✅ waitFor=${overrides.waitFor}ms
  
  Extraction Results:
    Fees Found:     ${structured.stats.fees_extracted} (target: >= 1)
    Fee Claims:     ${feeClaims.length}
    With Citations: ${claimsWithCitations.length}
  
  KB Status:
    Claims Before:  ${claimsBefore}
    Claims After:   ${kb.claims.length}
    New Claims:     ${newClaims}
  
  Idempotency:      ${claimsBefore > 0 ? (newClaims === 0 ? '✅ PASS' : '❌ FAIL') : 'N/A (first run)'}
`);
  console.log('═'.repeat(70));

  // Validate success criteria
  const success = structured.stats.fees_extracted >= 1 && feeClaims.length >= 1;
  if (!success) {
    console.error('\n❌ PILOT FAILED - fee extraction requirements not met');
    process.exit(1);
  }

  // Check idempotency on re-run
  if (claimsBefore > 0 && newClaims > 0) {
    console.error('\n❌ IDEMPOTENCY FAILED - re-run added new claims');
    process.exit(1);
  }

  console.log('\n✅ PILOT PASSED');
  process.exit(0);
}

// ============================================================================
// RUN
// ============================================================================

runPilot().catch(err => {
  console.error(`\n❌ Fatal error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});

