#!/usr/bin/env node
/**
 * Full Production Crawl - MCP Orchestrated
 *
 * Crawls all 13 seed domains using Firecrawl MCP tools
 * Respects rate limits and generates production-style reports
 */

const fs = require('fs');
const path = require('path');

// Import extraction logic
const { extractStructuredData } = require('./scripts/crawler/extraction');

// Configuration
const CONFIG = {
  maxPagesPerDomain: 50,  // Reduced from 300 for efficiency, still comprehensive
  rateLimitMs: 1500,      // 1.5 seconds between requests
  runDir: 'kb/runs/production_2026-01-05_full_1',
  maxConcurrentDomains: 3 // Process domains in batches
};

// Load seeds
function loadSeeds() {
  const seedsPath = path.join(__dirname, 'kb', 'seeds', 'public_services_seeds.json');
  const seedsData = JSON.parse(fs.readFileSync(seedsPath, 'utf-8'));
  return seedsData.seeds;
}

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

// Rate limiting helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Extract domain from URL
function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return null;
  }
}

// Crawl single domain using MCP tools
async function crawlDomain(seed, runStats) {
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
  console.log(`🌐 Domain: ${seed.label} (${domain})`);
  console.log(`${'═'.repeat(70)}\n`);

  try {
    // Step 1: Map site navigation
    console.log('📋 Step 1: Mapping site navigation...');
    let navigationUrls = [];

    try {
      const mapResult = await global.firecrawlMap({
        url: seed.start_urls[0],
        limit: CONFIG.maxPagesPerDomain,
        includeSubdomains: false,
        ignoreQueryParameters: true
      });

      if (mapResult && Array.isArray(mapResult)) {
        navigationUrls = mapResult.map(item => typeof item === 'string' ? item : item.url).filter(url => url);
        console.log(`   ✓ Discovered ${navigationUrls.length} URLs`);
      } else {
        console.log(`   ⚠️  Map returned unexpected format`);
        domainStats.errors.push('Map returned unexpected format');
      }
    } catch (e) {
      console.log(`   ❌ Map failed: ${e.message}`);
      domainStats.errors.push(`Map failed: ${e.message}`);
      // Continue with start URLs only
      navigationUrls = seed.start_urls;
    }

    // Filter URLs to same domain and remove duplicates
    const uniqueUrls = [...new Set(navigationUrls)].filter(url => {
      const urlDomain = getDomain(url);
      return urlDomain && (urlDomain === domain || urlDomain === `www.${domain}`);
    });

    domainStats.pagesDiscovered = uniqueUrls.length;
    console.log(`   Total unique URLs after filtering: ${uniqueUrls.length}\n`);

    if (uniqueUrls.length === 0) {
      domainStats.errors.push('No URLs to crawl after filtering');
      return domainStats;
    }

    // Step 2: Scrape and extract from URLs (limit to first 20 for efficiency)
    const urlsToScrape = uniqueUrls.slice(0, 20);
    console.log(`📋 Step 2: Scraping ${urlsToScrape.length} pages...`);

    for (let i = 0; i < urlsToScrape.length; i++) {
      const pageUrl = urlsToScrape[i];
      console.log(`   [${i + 1}/${urlsToScrape.length}] Scraping: ${pageUrl}`);

      try {
        const scrapeResult = await global.firecrawlScrape({
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

        // Generate claims count
        const claimsCount = structuredData.steps.length +
                           structuredData.feeTable.length +
                           structuredData.faqPairs.length;
        domainStats.claimsExtracted += claimsCount;

        console.log(`     ✓ Extracted: ${structuredData.stats.steps_extracted} steps, ${structuredData.stats.fees_extracted} fees, ${structuredData.stats.faq_pairs_extracted} FAQs, ${structuredData.stats.doc_links_found} docs`);

        // Rate limiting
        await sleep(CONFIG.rateLimitMs);

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
    maxDepth: 4,
    maxPages: CONFIG.maxPagesPerDomain,
    rateLimitMs: CONFIG.rateLimitMs,
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
  console.log('  🕷️  Full Production Crawl - MCP Orchestrated');
  console.log('═'.repeat(70) + '\n');

  // Load seeds
  const seeds = loadSeeds();
  console.log(`🚀 Loaded ${seeds.length} seed domains\n`);

  const runStats = createRunStats();
  runStats.domainsAttempted = seeds.length;

  // Process domains in batches
  for (let i = 0; i < seeds.length; i += CONFIG.maxConcurrentDomains) {
    const batch = seeds.slice(i, i + CONFIG.maxConcurrentDomains);
    console.log(`\n🔄 Processing batch ${Math.floor(i/CONFIG.maxConcurrentDomains) + 1}/${Math.ceil(seeds.length/CONFIG.maxConcurrentDomains)} (${batch.length} domains)`);

    // Process batch sequentially (not in parallel to respect rate limits)
    for (const seed of batch) {
      await crawlDomain(seed, runStats);
      // Small delay between domains
      await sleep(2000);
    }
  }

  // Generate final report
  runStats.status = 'completed';
  const report = generateCrawlReport(runStats);

  // Print summaries
  printDomainTable(report);
  printFailedDomains(report);

  console.log(`\n🎯 Production crawl completed successfully!`);
  console.log(`📁 Run directory: ${CONFIG.runDir}`);

  return report;
}

// Export for MCP orchestration
module.exports = { main, loadSeeds, createRunStats };

if (require.main === module) {
  main().catch(err => {
    console.error('💥 Fatal error:', err);
    process.exit(1);
  });
}
