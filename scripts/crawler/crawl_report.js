/**
 * Crawl Report Generation Module
 * 
 * Generates and saves crawl run reports with extraction statistics.
 * 
 * @module crawler/crawl_report
 */

const fs = require('fs');
const path = require('path');

// Import shared utilities
const { getDateString, ensureDir } = require('./utils');

// ============================================================================
// RUN REPORT GENERATION
// ============================================================================

/**
 * Generate a crawl run report
 * @param {Object} runStats - Run statistics
 * @param {string} runsDir - Directory to save reports
 * @returns {Object} - Generated report
 */
function generateRunReport(runStats, runsDir) {
  const date = getDateString();
  const runDir = path.join(runsDir, date);
  ensureDir(runDir);
  
  const config = runStats.config || {};
  
  const report = {
    run_id: `run_${date}_${Date.now()}`,
    started_at: runStats.startedAt,
    completed_at: new Date().toISOString(),
    status: runStats.status || 'completed',
    // Always include explicit config fields for clarity
    seed_source: config.seedSource || 'unknown',
    category: config.category || 'unknown',
    requireFirecrawl: config.requireFirecrawl !== undefined ? config.requireFirecrawl : true,
    allowHttpDocDownload: config.allowHttpDocDownload !== undefined ? config.allowHttpDocDownload : false,
    maxDepth: config.maxDepth || 4,
    maxPages: config.maxPages || 300,
    rateLimitMs: config.rateLimit || 1500,
    config: config,
    summary: {
      // Domain counts with reasons
      domains_attempted: runStats.domainsAttempted || 0,
      domains_crawled: runStats.domainsCrawled || 0,
      domains_failed: runStats.domainsFailed || 0,
      domains_skipped: runStats.domainsSkipped || 0,
      domains_failed_reasons: runStats.domainsFailedReasons || {},
      domains_skipped_reasons: runStats.domainsSkippedReasons || {},
      // Page stats
      pages_total: runStats.pagesTotal,
      pages_kept: runStats.pagesKept,
      pages_excluded: runStats.pagesExcluded,
      pages_unchanged: runStats.pagesUnchanged,
      docs_downloaded: runStats.docsDownloaded,
      documents_fetched_via_firecrawl: runStats.documentsFetchedViaFirecrawl || 0,
      documents_fetched_via_http_fallback: runStats.documentsFetchedViaHttpFallback || 0,
      claims_extracted: runStats.claimsExtracted,
      errors: runStats.errors.length,
      // Extraction counters across all domains
      steps_extracted: runStats.stepsExtracted || 0,
      fees_extracted: runStats.feesExtracted || 0,
      faq_pairs_extracted: runStats.faqPairsExtracted || 0,
      doc_links_found: runStats.docLinksFound || 0,
    },
    // Extraction breakdown by domain
    extraction_details: runStats.extractionDetails || {},
    domains: runStats.domainDetails,
    errors: runStats.errors.slice(0, 50),  // Keep first 50 errors
  };
  
  // Add error summary for failed runs
  if (runStats.status === 'failed') {
    report.failure_stage = runStats.failureStage || runStats.failureType || 'unknown';
    report.failure_message = runStats.errorSummary || 'Unknown error';
    report.current_domain = runStats.currentDomain || null;
    // Keep legacy field for compatibility
    report.failure_type = runStats.failureType || 'unknown';
  }
  
  const reportPath = path.join(runDir, 'crawl_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  
  console.log(`\n📊 Run report saved to: ${reportPath}`);
  return report;
}

/**
 * Generate a failure report when crawler stops due to critical error
 * @param {Object} runStats - Run statistics
 * @param {Error} error - The error that caused the failure
 * @param {string|null} currentDomain - Domain being crawled when error occurred
 * @param {string} runsDir - Directory to save reports
 * @returns {Object} - Generated failure report
 */
function generateFailureReport(runStats, error, currentDomain, runsDir) {
  runStats.status = 'failed';
  runStats.errorSummary = error.message || String(error);
  runStats.currentDomain = currentDomain;
  
  // Classify failure type and stage
  if (error.name === 'FirecrawlUnavailableError') {
    runStats.failureType = 'firecrawl_unavailable';
    runStats.failureStage = error.message.includes('map') ? 'firecrawl_map' : 'firecrawl_scrape';
  } else if (error.name === 'FirecrawlMapError') {
    runStats.failureType = 'firecrawl_map_failed';
    runStats.failureStage = 'firecrawl_map';
  } else if (error.name === 'FirecrawlScrapeError') {
    runStats.failureType = 'firecrawl_scrape_failed';
    runStats.failureStage = 'firecrawl_scrape';
  } else if (error.name === 'HttpDownloadNotAllowedError') {
    runStats.failureType = 'http_download_blocked';
    runStats.failureStage = 'document_download';
  } else {
    runStats.failureType = 'unexpected_error';
    runStats.failureStage = 'unknown';
  }
  
  runStats.errors.push({
    type: runStats.failureType,
    stage: runStats.failureStage,
    message: error.message,
    domain: currentDomain,
    timestamp: new Date().toISOString(),
  });
  
  return generateRunReport(runStats, runsDir);
}

/**
 * Create initial run statistics object
 * @param {Object} config - Crawler configuration
 * @returns {Object} - Run statistics object
 */
function createRunStats(config) {
  return {
    startedAt: new Date().toISOString(),
    status: 'running',
    config: config,
    // Domain tracking
    domainsAttempted: 0,
    domainsCrawled: 0,
    domainsFailed: 0,
    domainsSkipped: 0,
    domainsFailedReasons: {},
    domainsSkippedReasons: {},
    // Page stats
    pagesTotal: 0,
    pagesKept: 0,
    pagesExcluded: 0,
    pagesUnchanged: 0,
    docsDownloaded: 0,
    documentsFetchedViaFirecrawl: 0,
    documentsFetchedViaHttpFallback: 0,
    claimsExtracted: 0,
    // Extraction counters
    stepsExtracted: 0,
    feesExtracted: 0,
    faqPairsExtracted: 0,
    docLinksFound: 0,
    extractionDetails: {},
    errors: [],
    domainDetails: [],
  };
}

/**
 * Update extraction stats from structured data
 * @param {Object} runStats - Run statistics object
 * @param {Object} structuredData - Extracted structured data with stats
 * @param {string} domain - Domain being crawled
 */
function updateExtractionStats(runStats, structuredData, domain) {
  if (!structuredData || !structuredData.stats) return;
  
  const stats = structuredData.stats;
  
  // Update global counters
  runStats.stepsExtracted += stats.steps_extracted || 0;
  runStats.feesExtracted += stats.fees_extracted || 0;
  runStats.faqPairsExtracted += stats.faq_pairs_extracted || 0;
  runStats.docLinksFound += stats.doc_links_found || 0;
  
  // Update per-domain breakdown
  if (!runStats.extractionDetails[domain]) {
    runStats.extractionDetails[domain] = {
      steps_extracted: 0,
      fees_extracted: 0,
      faq_pairs_extracted: 0,
      doc_links_found: 0,
      pages_processed: 0,
    };
  }
  
  runStats.extractionDetails[domain].steps_extracted += stats.steps_extracted || 0;
  runStats.extractionDetails[domain].fees_extracted += stats.fees_extracted || 0;
  runStats.extractionDetails[domain].faq_pairs_extracted += stats.faq_pairs_extracted || 0;
  runStats.extractionDetails[domain].doc_links_found += stats.doc_links_found || 0;
  runStats.extractionDetails[domain].pages_processed += 1;
}

/**
 * Print crawl summary to console
 * @param {Object} report - Crawl report
 * @param {Object} paths - Path configuration
 */
function printSummary(report, paths) {
  console.log('\n' + '═'.repeat(70));
  console.log('  CRAWL SUMMARY');
  console.log('═'.repeat(70));
  console.log(`
  Domains Attempted: ${report.summary.domains_attempted}
  Domains Crawled:   ${report.summary.domains_crawled}
  Domains Failed:    ${report.summary.domains_failed}
  Domains Skipped:   ${report.summary.domains_skipped}
  Pages Total:       ${report.summary.pages_total}
  Pages Saved:       ${report.summary.pages_kept}
  Pages Unchanged:   ${report.summary.pages_unchanged}
  Pages Excluded:    ${report.summary.pages_excluded}
  Docs Found:        ${report.summary.docs_downloaded}
  Claims Extracted:  ${report.summary.claims_extracted}
  Errors:            ${report.summary.errors}
`);

  // Print extraction breakdown
  console.log('  EXTRACTION DETAILS:');
  console.log(`    Steps Extracted:     ${report.summary.steps_extracted}`);
  console.log(`    Fees Extracted:      ${report.summary.fees_extracted}`);
  console.log(`    FAQ Pairs:           ${report.summary.faq_pairs_extracted}`);
  console.log(`    Doc Links Found:     ${report.summary.doc_links_found}`);
  console.log('');

  // Print per-domain breakdown if available
  if (report.domains && report.domains.length > 0) {
    console.log('  PER-DOMAIN BREAKDOWN:');
    console.log('  Domain                    Pages  Steps  Fees  FAQs  Docs  Claims  Errors');
    console.log('  ───────────────────────── ────── ────── ───── ───── ───── ─────── ──────');

    for (const domain of report.domains) {
      const extraction = report.extraction_details[domain.domain] || {};
      const label = domain.label || domain.domain;
      const truncatedLabel = label.length > 24 ? label.substring(0, 21) + '...' : label.padEnd(24);

      console.log(`  ${truncatedLabel} ${String(domain.pagesProcessed || 0).padStart(5)} ${String(extraction.steps_extracted || 0).padStart(6)} ${String(extraction.fees_extracted || 0).padStart(5)} ${String(extraction.faq_pairs_extracted || 0).padStart(5)} ${String(extraction.doc_links_found || 0).padStart(5)} ${String(domain.claimsExtracted || 0).padStart(7)} ${String((domain.errors || []).length).padStart(6)}`);
    }
    console.log('');
  }

  console.log('═'.repeat(70));
  if (paths) {
    console.log(`  📁 KB saved to: ${paths.kbPath}`);
    console.log(`  📁 Seeds: ${path.join(paths.seedsDir, 'public_services_seeds.json')}`);
    console.log(`  📊 Report: ${path.join(paths.runsDir, getDateString(), 'crawl_report.json')}`);
  }
  console.log('═'.repeat(70) + '\n');
}

module.exports = {
  getDateString,
  ensureDir,
  generateRunReport,
  generateFailureReport,
  createRunStats,
  updateExtractionStats,
  printSummary,
};
