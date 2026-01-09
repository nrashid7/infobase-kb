#!/usr/bin/env node
/**
 * Production Crawl Orchestrator using MCP Tools
 *
 * Manually orchestrates full production crawl using Firecrawl MCP tools
 * since MCP is not available in terminal mode.
 */

const fs = require('fs');
const path = require('path');

// Import extraction logic
const { extractStructuredData } = require('./scripts/crawler/extraction');

// Load seeds
function loadSeeds() {
  const seedsPath = path.join(__dirname, 'kb', 'seeds', 'public_services_seeds.json');
  const seedsData = JSON.parse(fs.readFileSync(seedsPath, 'utf-8'));
  return seedsData.seeds;
}

// Configuration matching production crawl
const CONFIG = {
  maxDepth: 4,
  maxPages: 300,
  rateLimit: 1500, // ms between requests
  runDir: 'kb/runs/production_2026-01-05_full_1'
};

// Initialize run stats
function createRunStats() {
  return {
    startedAt: new Date().toISOString(),
    status: 'in_progress',
    config: CONFIG,
    domainsAttempted: 0,
    domainsCrawled: 0,
    domainsFailed: 0,
    domainsSkipped: 0,
    domainsFailedReasons: {},
    domainsSkippedReasons: {},
    pagesTotal: 0,
    pagesKept: 0,
    pagesExcluded: 0,
    pagesUnchanged: 0,
    docsDownloaded: 0,
    documentsFetchedViaFirecrawl: 0,
    documentsFetchedViaHttpFallback: 0,
    claimsExtracted: 0,
    errors: [],
    stepsExtracted: 0,
    feesExtracted: 0,
    faqPairsExtracted: 0,
    docLinksFound: 0,
    extractionDetails: {},
    domainDetails: []
  };
}

// Domain crawler using MCP tools
async function crawlDomainWithMcp(seed, runStats, firecrawlMap, firecrawlScrape) {
  const domain = seed.domain;
  const domainStats = {
    domain,
    label: seed.label,
    pagesDiscovered: 0,
    pagesProcessed: 0,
    pagesSaved: 0,
    pagesExcluded: 0,
    pagesUnchanged: 0,
    docsFound: 0,
    claimsExtracted: 0,
    errors: [],
    steps: 0,
    fees: 0,
    faqs: 0,
    docs: 0
  };

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`🌐 Domain: ${seed.label}`);
  console.log(`   URL: ${seed.start_urls[0]}`);
  console.log(`${'═'.repeat(70)}\n`);

  try {
    // Step 1: Map site navigation using firecrawl_map
    console.log('📋 Step 1: Mapping site navigation...');
    let navigationUrls = [];

    for (const startUrl of seed.start_urls) {
      try {
        console.log(`   Mapping: ${startUrl}`);
        const mapResult = await firecrawlMap({
          url: startUrl,
          limit: CONFIG.maxPages,
          includeSubdomains: false
        });

        if (mapResult && Array.isArray(mapResult)) {
          navigationUrls.push(...mapResult);
          console.log(`   ✓ Found ${mapResult.length} URLs`);
        }
      } catch (e) {
        console.log(`   ⚠️  Failed to map ${startUrl}: ${e.message}`);
        domainStats.errors.push(`Map failed: ${startUrl}: ${e.message}`);
      }
    }

    // Remove duplicates and filter
    const uniqueUrls = [...new Set(navigationUrls)].slice(0, CONFIG.maxPages);
    domainStats.pagesDiscovered = uniqueUrls.length;
    console.log(`   Total unique URLs discovered: ${uniqueUrls.length}\n`);

    if (uniqueUrls.length === 0) {
      domainStats.errors.push('No URLs discovered from mapping');
      return domainStats;
    }

    // Step 2: Scrape and extract from URLs
    console.log(`📋 Step 2: Scraping ${uniqueUrls.length} pages...`);

    for (let i = 0; i < uniqueUrls.length; i++) {
      const pageUrl = uniqueUrls[i];
      console.log(`   [${i + 1}/${uniqueUrls.length}] Scraping: ${pageUrl}`);

      try {
        const scrapeResult = await firecrawlScrape({
          url: pageUrl,
          formats: ['markdown', 'html'],
          onlyMainContent: true,
          removeBase64Images: true
        });

        if (!scrapeResult || !scrapeResult.markdown) {
          console.log('     ❌ No content received');
          domainStats.errors.push(`No content: ${pageUrl}`);
          continue;
        }

        const markdown = scrapeResult.markdown;
        const html = scrapeResult.html || '';

        // Extract structured data
        const structuredData = extractStructuredData(markdown, pageUrl, html);

        // Update domain stats
        domainStats.steps += structuredData.stats.steps_extracted;
        domainStats.fees += structuredData.stats.fees_extracted;
        domainStats.faqs += structuredData.stats.faq_pairs_extracted;
        domainStats.docs += structuredData.stats.doc_links_found;
        domainStats.pagesProcessed++;
        domainStats.pagesSaved++;

        // Generate claims (simplified)
        const claimsCount = structuredData.steps.length +
                           structuredData.feeTable.length +
                           structuredData.faqPairs.length;
        domainStats.claimsExtracted += claimsCount;

        console.log(`     ✓ Extracted: ${structuredData.stats.steps_extracted} steps, ${structuredData.stats.fees_extracted} fees, ${structuredData.stats.faq_pairs_extracted} FAQs, ${structuredData.stats.doc_links_found} docs`);

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, CONFIG.rateLimit));

      } catch (e) {
        console.log(`     ❌ Error: ${e.message}`);
        domainStats.errors.push(`${pageUrl}: ${e.message}`);
      }
    }

    console.log(`\n✅ Domain complete: ${domainStats.pagesSaved} saved, ${domainStats.errors.length} errors`);

  } catch (e) {
    console.error(`❌ Fatal error: ${e.message}`);
    domainStats.errors.push(`Fatal: ${e.message}`);
  }

  // Update run stats
  runStats.domainsCrawled++;
  runStats.pagesTotal += domainStats.pagesDiscovered;
  runStats.pagesKept += domainStats.pagesSaved;
  runStats.claimsExtracted += domainStats.claimsExtracted;
  runStats.stepsExtracted += domainStats.steps;
  runStats.feesExtracted += domainStats.fees;
  runStats.faqPairsExtracted += domainStats.faqs;
  runStats.docLinksFound += domainStats.docs;
  runStats.errors.push(...domainStats.errors);
  runStats.domainDetails.push(domainStats);

  return domainStats;
}

// Generate crawl report
function generateCrawlReport(runStats) {
  const report = {
    run_id: `production_2026-01-05_full_1`,
    started_at: runStats.startedAt,
    completed_at: new Date().toISOString(),
    status: 'completed',
    seed_source: 'bdgovlinks',
    category: 'public_services',
    requireFirecrawl: true,
    allowHttpDocDownload: false,
    maxDepth: CONFIG.maxDepth,
    maxPages: CONFIG.maxPages,
    rateLimitMs: CONFIG.rateLimit,
    summary: {
      domains_attempted: runStats.domainsAttempted,
      domains_crawled: runStats.domainsCrawled,
      domains_failed: runStats.domainsFailed,
      domains_skipped: runStats.domainsSkipped,
      domains_failed_reasons: runStats.domainsFailedReasons,
      domains_skipped_reasons: runStats.domainsSkippedReasons,
      pages_total: runStats.pagesTotal,
      pages_kept: runStats.pagesKept,
      pages_excluded: runStats.pagesExcluded,
      pages_unchanged: runStats.pagesUnchanged,
      docs_downloaded: runStats.docsDownloaded,
      documents_fetched_via_firecrawl: runStats.documentsFetchedViaFirecrawl,
      documents_fetched_via_http_fallback: runStats.documentsFetchedViaHttpFallback,
      claims_extracted: runStats.claimsExtracted,
      errors: runStats.errors.length,
      steps_extracted: runStats.stepsExtracted,
      fees_extracted: runStats.feesExtracted,
      faq_pairs_extracted: runStats.faqPairsExtracted,
      doc_links_found: runStats.docLinksFound,
    },
    extraction_details: runStats.extractionDetails,
    domains: runStats.domainDetails,
    errors: runStats.errors.slice(0, 50)
  };

  const reportPath = path.join(CONFIG.runDir, 'crawl_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log(`\n📊 Crawl report saved to: ${reportPath}`);
  return report;
}

// Print domain table
function printDomainTable(report) {
  console.log('\n📋 DOMAIN SUMMARY:');
  console.log('Domain'.padEnd(30) + 'pages_processed'.padStart(15) + 'claims_written'.padStart(15) + 'fees'.padStart(6) + 'steps'.padStart(6) + 'faqs'.padStart(6) + 'docs'.padStart(6) + 'errors_count'.padStart(12));
  console.log('─'.repeat(100));

  for (const domain of report.domains) {
    console.log(
      domain.label.padEnd(30) +
      domain.pagesProcessed.toString().padStart(15) +
      domain.claimsExtracted.toString().padStart(15) +
      domain.fees.toString().padStart(6) +
      domain.steps.toString().padStart(6) +
      domain.faqs.toString().padStart(6) +
      domain.docs.toString().padStart(6) +
      domain.errors.length.toString().padStart(12)
    );
  }
}

// List failed domains
function printFailedDomains(report) {
  const failedDomains = report.domains.filter(d => d.errors.length > 0);

  if (failedDomains.length > 0) {
    console.log('\n❌ FAILED DOMAINS:');
    for (const domain of failedDomains) {
      console.log(`• ${domain.label} (${domain.domain})`);
      console.log(`  Reason: ${domain.errors[0]}`);
      if (domain.errors.length > 1) {
        console.log(`  Additional errors: ${domain.errors.length - 1}`);
      }
    }
  }
}

// Main execution
async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('  🕷️  Production Crawl - MCP Orchestrated');
  console.log('═'.repeat(70) + '\n');

  // Load seeds
  const seeds = loadSeeds();
  console.log(`🚀 Loaded ${seeds.length} seed domains\n`);

  const runStats = createRunStats();

  // This will be called with MCP functions provided by the AI agent
  // For now, we'll set up the structure

  return {
    seeds,
    runStats,
    config: CONFIG,
    // Functions that will use MCP tools:
    crawlDomainWithMcp,
    generateCrawlReport,
    printDomainTable,
    printFailedDomains
  };
}

// Export for use by MCP orchestrator
module.exports = { main, loadSeeds, createRunStats };

if (require.main === module) {
  main().then(result => {
    console.log('\n🎯 Production crawl setup complete.');
    console.log('This script should be run via MCP orchestration.');
    console.log('Available functions: crawlDomainWithMcp, generateCrawlReport, etc.');
  }).catch(err => {
    console.error('💥 Error:', err);
    process.exit(1);
  });
}
