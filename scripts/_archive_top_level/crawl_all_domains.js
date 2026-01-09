#!/usr/bin/env node
/**
 * Crawl All 13 Domains - MCP Orchestrated
 *
 * Efficiently crawls all seed domains and generates production report
 */

const fs = require('fs');
const path = require('path');

// Import extraction logic
const { extractStructuredData } = require('./scripts/crawler/extraction');

// Configuration
const CONFIG = {
  maxPagesPerDomain: 20,  // Focus on quality over quantity
  rateLimitMs: 1500,      // Respectful rate limiting
  runDir: 'kb/runs/production_2026-01-05_full_1'
};

// Load seeds
function loadSeeds() {
  const seedsPath = path.join(__dirname, 'kb', 'seeds', 'public_services_seeds.json');
  const seedsData = JSON.parse(fs.readFileSync(seedsPath, 'utf-8'));
  return seedsData.seeds;
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

// Process single domain
async function processDomain(seed, runStats) {
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

  console.log(`\n🌐 Processing: ${seed.label} (${domain})`);

  try {
    // Map site navigation
    let navigationUrls = [];
    try {
      // Use MCP firecrawl_map
      const mapResult = await global.firecrawlMap({
        url: seed.start_urls[0],
        limit: CONFIG.maxPagesPerDomain,
        includeSubdomains: false,
        ignoreQueryParameters: true
      });

      if (mapResult && Array.isArray(mapResult)) {
        navigationUrls = mapResult.map(item => typeof item === 'string' ? item : item.url).filter(url => url);
      }
    } catch (e) {
      console.log(`  ⚠️  Map failed: ${e.message}`);
      domainStats.errors.push(`Map failed: ${e.message}`);
      navigationUrls = seed.start_urls; // Fallback to start URLs
    }

    // Filter URLs to same domain
    const uniqueUrls = [...new Set(navigationUrls)].filter(url => {
      const urlDomain = getDomain(url);
      return urlDomain && (urlDomain === domain || urlDomain === `www.${domain}`);
    });

    domainStats.pagesDiscovered = uniqueUrls.length;
    console.log(`  📋 Found ${uniqueUrls.length} URLs`);

    if (uniqueUrls.length === 0) {
      domainStats.errors.push('No URLs to crawl after filtering');
      return domainStats;
    }

    // Scrape top URLs (limit for efficiency)
    const urlsToScrape = uniqueUrls.slice(0, Math.min(10, uniqueUrls.length));

    for (const pageUrl of urlsToScrape) {
      try {
        // Use MCP firecrawl_scrape
        const scrapeResult = await global.firecrawlScrape({
          url: pageUrl,
          formats: ['markdown', 'html'],
          onlyMainContent: true,
          removeBase64Images: true
        });

        if (!scrapeResult || !scrapeResult.markdown) {
          domainStats.errors.push(`No content: ${pageUrl}`);
          continue;
        }

        const markdown = scrapeResult.markdown;
        const html = scrapeResult.html || '';

        // Extract structured data
        const structuredData = extractStructuredData(markdown, pageUrl, html);

        // Update stats
        domainStats.steps += structuredData.stats.steps_extracted;
        domainStats.fees += structuredData.stats.fees_extracted;
        domainStats.faqs += structuredData.stats.faq_pairs_extracted;
        domainStats.docs += structuredData.stats.doc_links_found;
        domainStats.pagesProcessed++;
        domainStats.pagesSaved++;

        // Claims count
        const claimsCount = structuredData.steps.length +
                           structuredData.feeTable.length +
                           structuredData.faqPairs.length;
        domainStats.claimsExtracted += claimsCount;

        // Rate limiting
        await sleep(CONFIG.rateLimitMs);

      } catch (e) {
        domainStats.errors.push(`${pageUrl}: ${e.message}`);
      }
    }

    console.log(`  ✅ Completed: ${domainStats.pagesSaved} pages, ${domainStats.claimsExtracted} claims, ${domainStats.errors.length} errors`);

  } catch (e) {
    console.error(`  ❌ Fatal error: ${e.message}`);
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

// Generate report
function generateReport(runStats) {
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
      domains_failed_reasons: runStats.domainsFailedReasons || {},
      domains_skipped_reasons: runStats.domainsSkippedReasons || {},
      pages_total: runStats.pagesTotal,
      pages_kept: runStats.pagesKept,
      pages_excluded: runStats.pagesExcluded,
      pages_unchanged: runStats.pagesUnchanged,
      docs_downloaded: runStats.docsDownloaded || 0,
      documents_fetched_via_firecrawl: runStats.documentsFetchedViaFirecrawl || 0,
      documents_fetched_via_http_fallback: runStats.documentsFetchedViaHttpFallback || 0,
      claims_extracted: runStats.claimsExtracted,
      errors: runStats.errors.length,
      steps_extracted: runStats.stepsExtracted,
      fees_extracted: runStats.feesExtracted,
      faq_pairs_extracted: runStats.faqPairsExtracted,
      doc_links_found: runStats.docLinksFound,
    },
    extraction_details: runStats.extractionDetails || {},
    domains: runStats.domainDetails,
    errors: runStats.errors.slice(0, 50)
  };

  const reportPath = path.join(CONFIG.runDir, 'crawl_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  return report;
}

// Print summaries
function printSummaries(report) {
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

  const failedDomains = report.domains.filter(d => d.errors.length > 0);
  if (failedDomains.length > 0) {
    console.log('\n❌ FAILED DOMAINS:');
    for (const domain of failedDomains) {
      console.log(`• ${domain.label} (${domain.domain})`);
      console.log(`  Reason: ${domain.errors[0]}`);
    }
  }
}

// Main execution
async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('  🕷️  Full Production Crawl - All 13 Domains');
  console.log('═'.repeat(70) + '\n');

  const seeds = loadSeeds();
  console.log(`🚀 Processing ${seeds.length} domains...\n`);

  const runStats = {
    startedAt: new Date().toISOString(),
    domainsAttempted: seeds.length,
    domainsCrawled: 0,
    domainsFailed: 0,
    domainsSkipped: 0,
    pagesTotal: 0,
    pagesKept: 0,
    claimsExtracted: 0,
    stepsExtracted: 0,
    feesExtracted: 0,
    faqPairsExtracted: 0,
    docLinksFound: 0,
    errors: [],
    domainDetails: []
  };

  // Process each domain sequentially
  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    console.log(`\n[${i + 1}/${seeds.length}] Starting domain: ${seed.label}`);

    try {
      await processDomain(seed, runStats);
    } catch (e) {
      console.error(`💥 Domain ${seed.domain} crashed: ${e.message}`);
      runStats.domainsFailed++;
      runStats.errors.push(`Domain crash: ${seed.domain}: ${e.message}`);
    }

    // Progress update
    console.log(`Progress: ${runStats.domainsCrawled}/${seeds.length} domains completed`);
  }

  // Generate final report
  const report = generateReport(runStats);
  printSummaries(report);

  console.log(`\n🎯 Crawl completed!`);
  console.log(`📁 Run directory: ${CONFIG.runDir}`);
  console.log(`📊 Total claims extracted: ${runStats.claimsExtracted}`);

  return report;
}

module.exports = { main };

if (require.main === module) {
  main().catch(err => {
    console.error('💥 Fatal error:', err);
    process.exit(1);
  });
}
