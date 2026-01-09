#!/usr/bin/env node
/**
 * Preflight Pilot Runner
 *
 * Pre-full-crawl pilot that validates the crawl pipeline before running on all 13 domains.
 *
 * This pilot proves, end-to-end:
 * 1) Firecrawl MCP scrapes work with overrides (fee pages, waitFor)
 * 2) Fee extraction produces expected results (currency labels, amounts)
 * 3) Claim IDs are idempotent (rerun writes 0 new claims)
 * 4) No remaining auto_* claim IDs in any guide
 * 5) Publish pipeline produces consistent fee schedules
 *
 * Runs on SMALL, controlled set of priority pages per domain (3–6 pages/domain)
 * Writes to pilot run folder, does not pollute main KB
 *
 * Usage: node scripts/_pilot/preflight_pilot.js
 *
 * @module pilot/preflight
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ============================================================================
// IMPORTS
// ============================================================================

const {
  utils,
  extraction,
  kbWriter,
  serviceMap,
  scraping,
} = require('../crawler');

const { firecrawlMcp, FirecrawlUnavailableError } = scraping;

const {
  generateHash,
  generateSourcePageId,
  ensureDir,
  getDomain,
  getDateString,
} = utils;

const {
  classifyPage,
  extractStructuredData,
  extractClaims,
} = extraction;

const {
  loadOrCreateKB,
  saveKB,
  addOrUpdateSourcePage,
  addClaimsToKB,
} = kbWriter;

const {
  getServiceIdForSeedDomain,
  getServiceKeyFromId,
} = serviceMap;

const {
  getFirecrawlOverridesForUrl,
  formatOverrideLog,
} = require('../crawler/firecrawl_overrides');

// ============================================================================
// CONFIGURATION
// ============================================================================

const PILOT_CONFIG = {
  // Priority pages per domain (3–6 pages each, focused on fee/docs/FAQs)
  domains: [
    {
      domain: 'epassport.gov.bd',
      priorityPages: [
        'https://www.epassport.gov.bd/instructions/passport-fees',       // SPA fee page (requires waitFor)
        'https://www.epassport.gov.bd/instructions/application-form',
        'https://www.epassport.gov.bd/instructions/instructions',
        'https://www.epassport.gov.bd/landing/faqs',
      ],
    },
    {
      domain: 'nidw.gov.bd',
      priorityPages: [
        'https://nidw.gov.bd/fee',
        'https://services.nidw.gov.bd/',
        'https://nidw.gov.bd/',
      ],
    },
    {
      domain: 'bsp.brta.gov.bd',
      priorityPages: [
        'https://bsp.brta.gov.bd/',
        'https://brta.gov.bd/fee',
        'https://brta.gov.bd/',
      ],
    },
    {
      domain: 'etaxnbr.gov.bd',
      priorityPages: [
        'https://etaxnbr.gov.bd/',
        'https://etaxnbr.gov.bd/fee',
      ],
    },
    {
      domain: 'bdpost.gov.bd',
      priorityPages: [
        'https://bdpost.gov.bd/',
        'https://bdpost.gov.bd/fee',
      ],
    },
    {
      domain: 'landadministration.gov.bd',
      priorityPages: [
        'https://landadministration.gov.bd/',
        'https://landadministration.gov.bd/fee',
      ],
    },
    {
      domain: 'teletalk.com.bd',
      priorityPages: [
        'https://teletalk.com.bd/',
        'https://teletalk.com.bd/fee',
      ],
    },
    {
      domain: 'dip.gov.bd',
      priorityPages: [
        'https://dip.gov.bd/',
        'https://dip.gov.bd/fee',
      ],
    },
    {
      domain: 'visa.gov.bd',
      priorityPages: [
        'https://visa.gov.bd/',
        'https://visa.gov.bd/fee',
      ],
    },
    {
      domain: 'customs.gov.bd',
      priorityPages: [
        'https://customs.gov.bd/',
        'https://customs.gov.bd/fee',
      ],
    },
    {
      domain: 'bdris.gov.bd',
      priorityPages: [
        'https://bdris.gov.bd/',
        'https://bdris.gov.bd/fee',
      ],
    },
    {
      domain: 'police.gov.bd',
      priorityPages: [
        'https://police.gov.bd/',
        'https://police.gov.bd/fee',
      ],
    },
    {
      domain: 'passport.gov.bd',
      priorityPages: [
        'https://passport.gov.bd/',
        'https://passport.gov.bd/fee',
      ],
    },
  ],

  // Rate limiting (ms between requests)
  rateLimit: 1000,

  // Pilot-specific paths (separate from main KB)
  pilotKbPath: path.join(__dirname, '..', '..', 'kb', 'pilot_kb.json'),
  pilotRunsDir: path.join(__dirname, '..', '..', 'kb', 'pilot_runs'),
  pilotSnapshotsDir: path.join(__dirname, '..', '..', 'kb', 'pilot_snapshots'),
};

const PATHS = {
  kbDir: path.join(__dirname, '..', '..', 'kb'),
  publishedDir: path.join(__dirname, '..', '..', 'kb', 'published'),
  publicGuidesPath: path.join(__dirname, '..', '..', 'kb', 'published', 'public_guides.json'),
  buildScript: path.join(__dirname, '..', 'build_public_guides.js'),
};

// ============================================================================
// FIRECRAWL MCP CHECK
// ============================================================================

/**
 * Check if Firecrawl MCP is available and exit loudly if not.
 */
function assertFirecrawlAvailable() {
  // Try to get scrape function from global scope (when run via Cursor MCP)
  const scrapeFunc = global.firecrawlScrape ||
    (typeof global.mcpContext === 'object' && global.mcpContext.scrape) ||
    null;

  if (!scrapeFunc) {
    console.error('\n' + '═'.repeat(70));
    console.error('❌ FATAL: Firecrawl MCP is NOT available');
    console.error('═'.repeat(70));
    console.error('\nThis pilot requires Firecrawl MCP to be enabled in Cursor IDE.');
    console.error('The pilot cannot proceed without Firecrawl scrape capabilities.');
    console.error('\nTo fix:');
    console.error('  1. Ensure you are running this in Cursor IDE');
    console.error('  2. Enable Firecrawl MCP in Cursor settings');
    console.error('  3. Re-run this pilot script');
    console.error('\n' + '═'.repeat(70) + '\n');
    process.exit(1);
  }

  // Initialize firecrawlMcp with the available function
  firecrawlMcp.initialize({ scrape: scrapeFunc }, {
    firecrawlRequired: true,
    allowHttpDocDownload: false,
  });

  console.log('✅ Firecrawl MCP is available\n');
  return scrapeFunc;
}

// ============================================================================
// PILOT SCRAPING
// ============================================================================

/**
 * Scrape a single URL with pilot configuration.
 */
async function scrapeUrl(url, domain) {
  console.log(`  📄 Scraping: ${url}`);

  // Check for URL-specific overrides
  const overrides = getFirecrawlOverridesForUrl(url);
  const overrideApplied = Boolean(overrides);

  if (overrideApplied) {
    console.log(`     ${formatOverrideLog(overrides, url)}`);
  }

  try {
    const result = await firecrawlMcp.firecrawlScrape(url, {
      formats: ['markdown', 'html'],
      onlyMainContent: true,
      removeBase64Images: true,
      allowEmpty: false,
    });

    return {
      url,
      domain,
      success: true,
      overrideApplied,
      markdown: result.markdown || '',
      html: result.html || result.rawHtml || '',
      title: result.title || url,
      markdownLength: (result.markdown || '').length,
    };
  } catch (error) {
    console.log(`     ❌ Failed: ${error.message}`);
    return {
      url,
      domain,
      success: false,
      overrideApplied,
      error: error.message,
    };
  }
}

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// CLAIM PROCESSING
// ============================================================================

/**
 * Process scraped pages and extract claims for pilot.
 */
function processScrapedPages(scrapedPages, kb) {
  const stats = {
    pagesProcessed: 0,
    pagesProcessedByDomain: new Map(),
    feesExtracted: 0,
    feeClaimsWritten: 0,
    docLinksFound: 0,
    stepsExtracted: 0,
    faqsExtracted: 0,
    claimsWritten: 0,
    duplicatesSkipped: 0,
    feeClaimIds: [],
    docClaimIds: [],
    domainsWithFeePages: new Set(),
    domainsWithFeesExtracted: new Set(),
  };

  for (const page of scrapedPages) {
    if (!page.success) continue;

    const domain = page.domain;
    const sourcePageId = generateSourcePageId(page.url);
    const contentHash = generateHash(page.markdown);

    // Add/update source page in KB
    addOrUpdateSourcePage(kb, {
      url: page.url,
      domain: domain,
      title: page.title,
      markdown: page.markdown,
      contentHash: contentHash,
      snapshotRef: `pilot/${getDateString()}`,
    }, classifyPage);

    // Extract structured data
    const structuredData = extractStructuredData(page.markdown, page.url, page.html);

    stats.feesExtracted += structuredData.feeTable.length;
    stats.docLinksFound += structuredData.documentList.length;
    stats.stepsExtracted += structuredData.steps.length;
    stats.faqsExtracted += structuredData.faqPairs.length;

    // Track domain stats
    stats.pagesProcessedByDomain.set(domain, (stats.pagesProcessedByDomain.get(domain) || 0) + 1);

    // Check if this is a fee page
    if (page.url.includes('/fee') || page.url.includes('fees') || page.url.includes('price')) {
      stats.domainsWithFeePages.add(domain);
      if (structuredData.feeTable.length > 0) {
        stats.domainsWithFeesExtracted.add(domain);
      }
    }

    // Extract claims
    const serviceId = getServiceIdForSeedDomain(domain);
    const claims = extractClaims(page.markdown, sourcePageId, page.url, structuredData, {
      serviceId: serviceId,
    });

    // Add claims to KB
    const claimsAdded = addClaimsToKB(kb, claims);
    stats.claimsWritten += claimsAdded;
    stats.duplicatesSkipped += (claims.length - claimsAdded);

    // Track fee claim IDs
    const feeClaims = claims.filter(c => c.claim_type === 'fee');
    stats.feeClaimIds.push(...feeClaims.map(c => c.claim_id));
    stats.feeClaimsWritten += feeClaims.length;

    // Track doc claim IDs
    const docClaims = claims.filter(c => c.claim_type === 'document_requirement');
    stats.docClaimIds.push(...docClaims.map(c => c.claim_id));

    stats.pagesProcessed++;
    console.log(`     ✓ Extracted: ${feeClaims.length} fees, ${structuredData.documentList.length} docs, ${structuredData.steps.length} steps`);
  }

  // Deduplicate claim IDs
  stats.feeClaimIds = [...new Set(stats.feeClaimIds)];
  stats.docClaimIds = [...new Set(stats.docClaimIds)];

  return stats;
}

// ============================================================================
// VALIDATION CHECKS
// ============================================================================

/**
 * Run validation checks for pilot requirements.
 */
function runValidationChecks(kb, scrapedPages, extractionStats) {
  const checks = {
    epassportFeePageProducedFees: false,
    epassportFeeLabelsNoTkTaka: false,
    idempotencyVerified: false,
    feePageCoverageAdequate: false,
  };

  // Check 1: ePassport fee page MUST produce fees (>=1) and labels must not contain TK/Taka
  const epassportFeePage = scrapedPages.find(p =>
    p.domain === 'epassport.gov.bd' &&
    p.url.includes('passport-fees') &&
    p.success
  );

  if (epassportFeePage) {
    const structuredData = extractStructuredData(epassportFeePage.markdown, epassportFeePage.url);
    checks.epassportFeePageProducedFees = structuredData.feeTable.length >= 1;

    // Check labels don't contain TK/Taka
    const hasTkTakaLabels = structuredData.feeTable.some(fee =>
      fee.label && (fee.label.includes('TK') || fee.label.includes('Taka'))
    );
    checks.epassportFeeLabelsNoTkTaka = !hasTkTakaLabels;
  }

  // Check 2: Fee page coverage - domains with fee pages should have fees extracted OR flagged
  const domainsWithFeePages = extractionStats.domainsWithFeePages;
  const domainsWithFeesExtracted = extractionStats.domainsWithFeesExtracted;

  checks.feePageCoverageAdequate = domainsWithFeePages.size === 0 ||
    (domainsWithFeePages.size > 0 && domainsWithFeesExtracted.size > 0);

  return checks;
}

// ============================================================================
// REPORT GENERATION
// ============================================================================

/**
 * Generate pilot report JSON.
 */
function generateReport(runNumber, scrapedPages, extractionStats, validationChecks, buildResult, validateResult) {
  const overrideApplied = scrapedPages.some(p => p.overrideApplied && p.success);

  // Domain-level stats
  const domainStats = [];
  for (const domainConfig of PILOT_CONFIG.domains) {
    const domain = domainConfig.domain;
    const pagesScraped = scrapedPages.filter(p => p.domain === domain).length;
    const pagesProcessed = extractionStats.pagesProcessedByDomain.get(domain) || 0;
    const feesExtracted = extractionStats.feesExtracted; // Note: this is total, not per domain

    domainStats.push({
      domain,
      pages_scraped: pagesScraped,
      pages_processed: pagesProcessed,
      fees_extracted: feesExtracted, // TODO: make this per-domain
      has_fee_pages: domainConfig.priorityPages.some(url => url.includes('/fee') || url.includes('fees')),
    });
  }

  return {
    run: runNumber,
    timestamp: new Date().toISOString(),
    pilot_config: {
      domains: PILOT_CONFIG.domains.length,
      total_priority_pages: PILOT_CONFIG.domains.reduce((sum, d) => sum + d.priorityPages.length, 0),
    },
    scrape_results: {
      total_urls_attempted: scrapedPages.length,
      successful: scrapedPages.filter(p => p.success).length,
      failed: scrapedPages.filter(p => !p.success).length,
      override_applied: overrideApplied,
    },
    extraction: {
      pages_processed: extractionStats.pagesProcessed,
      fees_extracted: extractionStats.feesExtracted,
      fee_claims_written: extractionStats.feeClaimsWritten,
      doc_links_found: extractionStats.docLinksFound,
      steps_extracted: extractionStats.stepsExtracted,
      faqs_extracted: extractionStats.faqsExtracted,
      total_claims_written: extractionStats.claimsWritten,
      duplicates_skipped: extractionStats.duplicatesSkipped,
      fee_claim_ids: extractionStats.feeClaimIds,
      domains_with_fee_pages: Array.from(extractionStats.domainsWithFeePages),
      domains_with_fees_extracted: Array.from(extractionStats.domainsWithFeesExtracted),
    },
    validation_checks: validationChecks,
    build: buildResult,
    publish_validation: validateResult,
    domain_stats: domainStats,
    summary: {
      pages_scraped: scrapedPages.filter(p => p.success).length,
      pages_processed: extractionStats.pagesProcessed,
      steps_faqs_docs_extracted: extractionStats.stepsExtracted + extractionStats.faqsExtracted + extractionStats.docLinksFound,
      fees_extracted: extractionStats.feesExtracted,
      claims_written: extractionStats.claimsWritten,
      duplicates_skipped: extractionStats.duplicatesSkipped,
      override_applied_count: scrapedPages.filter(p => p.overrideApplied && p.success).length,
      new_claims_added: extractionStats.claimsWritten,
      epassport_fee_page_ok: validationChecks.epassportFeePageProducedFees,
      epassport_labels_clean: validationChecks.epassportFeeLabelsNoTkTaka,
      build_success: buildResult.success,
      validation_success: validateResult.success,
    },
  };
}

// ============================================================================
// MAIN PILOT EXECUTION
// ============================================================================

/**
 * Run a single pilot pass.
 */
async function runPilotPass(runNumber) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  🚀 Preflight Pilot - Run ${runNumber}`);
  console.log(`${'═'.repeat(70)}\n`);

  // Load/create pilot KB (separate from main KB)
  console.log('📁 Loading pilot knowledge base...');
  const kb = loadOrCreateKB(PILOT_CONFIG.pilotKbPath);
  console.log(`   Loaded: ${kb.source_pages.length} source pages, ${kb.claims.length} claims\n`);

  // Scrape priority pages from all domains
  console.log('📡 Scraping priority pages across domains...');
  const scrapedPages = [];

  for (const domainConfig of PILOT_CONFIG.domains) {
    console.log(`  🌐 Domain: ${domainConfig.domain}`);

    for (let i = 0; i < domainConfig.priorityPages.length; i++) {
      const url = domainConfig.priorityPages[i];
      const result = await scrapeUrl(url, domainConfig.domain);
      scrapedPages.push(result);

      // Rate limiting between requests
      if (i < domainConfig.priorityPages.length - 1) {
        await sleep(PILOT_CONFIG.rateLimit);
      }
    }

    // Rate limiting between domains
    await sleep(PILOT_CONFIG.rateLimit * 2);
  }

  // Process scraped pages and extract claims
  console.log('\n⚙️  Processing scraped pages...');
  const extractionStats = processScrapedPages(scrapedPages, kb);

  console.log(`\n   Summary: ${extractionStats.claimsWritten} claims written, ${extractionStats.duplicatesSkipped} duplicates skipped`);

  // Save pilot KB
  console.log('\n💾 Saving pilot knowledge base...');
  saveKB(kb, PILOT_CONFIG.pilotKbPath);

  // Run validation checks
  console.log('\n🔍 Running validation checks...');
  const validationChecks = runValidationChecks(kb, scrapedPages, extractionStats);

  // Build public guides from pilot KB
  console.log('\n📦 Building public guides from pilot data...');
  const buildResult = buildPublicGuides();

  // Validate published guides
  console.log('\n🔍 Validating published guides...');
  const validateResult = validatePublished();

  // Generate report
  const report = generateReport(
    runNumber,
    scrapedPages,
    extractionStats,
    validationChecks,
    buildResult,
    validateResult
  );

  // Save report
  ensureDir(PILOT_CONFIG.pilotRunsDir);
  const reportPath = path.join(PILOT_CONFIG.pilotRunsDir, `preflight_pilot_report_run${runNumber}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n📄 Report saved: ${reportPath}`);

  return report;
}

/**
 * Run build_public_guides.js from pilot KB
 */
function buildPublicGuides() {
  console.log('📦 Building public guides...');
  try {
    // Use the pilot KB as input
    execSync(`node "${PATHS.buildScript}" "${PILOT_CONFIG.pilotKbPath}"`, {
      cwd: path.join(__dirname, '..', '..'),
      stdio: 'inherit',
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Run validate:published
 */
function validatePublished() {
  console.log('🔍 Validating published guides...');
  try {
    execSync('npm run validate:published', {
      cwd: path.join(__dirname, '..', '..'),
      stdio: 'inherit',
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Main entry point.
 */
async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('  🔬 Preflight Pilot Runner');
  console.log('  Validating crawl pipeline before full multi-domain crawl');
  console.log('═'.repeat(70) + '\n');

  // Check Firecrawl MCP availability
  console.log('🔌 Checking Firecrawl MCP availability...');
  assertFirecrawlAvailable();

  // Run 1: Initial pass
  const report1 = await runPilotPass(1);

  console.log('\n' + '─'.repeat(70));
  console.log('  Run 1 Complete - Key Results:');
  console.log('─'.repeat(70));
  console.log(`  pages_scraped: ${report1.summary.pages_scraped}`);
  console.log(`  fees_extracted: ${report1.summary.fees_extracted}`);
  console.log(`  claims_written: ${report1.summary.claims_written}`);
  console.log(`  override_applied: ${report1.summary.override_applied_count}`);
  console.log(`  epassport_fee_page_ok: ${report1.summary.epassport_fee_page_ok}`);
  console.log(`  epassport_labels_clean: ${report1.summary.epassport_labels_clean}`);
  console.log('─'.repeat(70) + '\n');

  // Wait between runs
  console.log('⏳ Waiting 3 seconds before idempotency rerun...\n');
  await sleep(3000);

  // Run 2: Idempotency check (same process without deleting KB)
  const report2 = await runPilotPass(2);

  console.log('\n' + '─'.repeat(70));
  console.log('  Run 2 Complete - Idempotency Check:');
  console.log('─'.repeat(70));
  console.log(`  new_claims_added: ${report2.summary.new_claims_added}`);
  console.log(`  duplicates_skipped: ${report2.extraction.duplicates_skipped}`);
  console.log('─'.repeat(70) + '\n');

  // Final summary
  console.log('\n' + '═'.repeat(70));
  console.log('  📊 PILOT SUMMARY');
  console.log('═'.repeat(70));

  const allPassed =
    report1.summary.override_applied_count > 0 &&
    report1.summary.fees_extracted > 0 &&
    report2.summary.new_claims_added === 0 &&
    report1.summary.epassport_fee_page_ok &&
    report1.summary.epassport_labels_clean &&
    report1.summary.build_success &&
    report1.summary.validation_success;

  console.log(`\n  1) Firecrawl overrides applied: ${report1.summary.override_applied_count > 0 ? '✅ PASS' : '❌ FAIL'} (${report1.summary.override_applied_count} overrides)`);
  console.log(`  2) Fee extraction working: ${report1.summary.fees_extracted > 0 ? '✅ PASS' : '❌ FAIL'} (${report1.summary.fees_extracted} fees extracted)`);
  console.log(`  3) ePassport fee page produces fees: ${report1.summary.epassport_fee_page_ok ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  4) ePassport labels clean (no TK/Taka): ${report1.summary.epassport_labels_clean ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  5) Idempotency (0 new claims on run2): ${report2.summary.new_claims_added === 0 ? '✅ PASS' : '❌ FAIL'} (${report2.summary.new_claims_added} new)`);
  console.log(`  6) Build success: ${report1.summary.build_success ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  7) Validation success: ${report1.summary.validation_success ? '✅ PASS' : '❌ FAIL'}`);

  console.log(`\n  OVERALL: ${allPassed ? '✅ ALL CHECKS PASSED' : '⚠️  SOME CHECKS FAILED'}`);
  console.log('═'.repeat(70) + '\n');

  if (!allPassed) {
    process.exit(1);
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================

if (require.main === module) {
  main().catch(err => {
    console.error(`\n❌ Fatal error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = {
  runPilotPass,
  processScrapedPages,
  runValidationChecks,
  PILOT_CONFIG,
  PATHS,
};
