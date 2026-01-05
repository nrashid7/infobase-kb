#!/usr/bin/env node
/**
 * Bangladesh Government Services KB - Domain Deep Crawler
 * 
 * A comprehensive crawler that:
 * 1. Extracts Public Services domains from bdgovlinks.com
 * 2. Crawls each official site deeply to collect tutorials, FAQs, requirements, fees, etc.
 * 3. Downloads and indexes all service-related documents (PDF/DOC)
 * 4. Stores everything with provenance for later guide generation
 * 
 * Usage:
 *   node scripts/crawl.js --seed-source bdgovlinks --category public_services --refresh changed --maxDepth 4 --maxPages 300
 * 
 * @see README.md for full documentation
 */

const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// ============================================================================
// MODULAR IMPORTS
// ============================================================================

// Import crawler sub-modules
const crawler = require('./crawler');

// Import only what's needed for orchestration
const { discovery, filtering, extraction, scraping, kbWriter, crawlState, crawlReport } = crawler;

// Shared utilities
const { generateHash, generateSourcePageId, ensureDir, getDomain, sleep } = require('./crawler/utils');

// Discovery
const { parsePublicServicesFromMarkdown, extractPublicServicesSeeds, loadExistingSeeds } = discovery;

// Filtering
const { getUrlPriority, sortUrlsByPriority, getUrlDepth, parseRobotsTxt, isPathAllowed, parseSitemapXml, PRIORITY_PATTERNS } = filtering;

// Extraction
const { classifyPage, extractStructuredData, extractClaims, DOCUMENT_EXTENSIONS } = extraction;

// Scraping
const { firecrawlMcp, FirecrawlUnavailableError, FirecrawlMapError, FirecrawlScrapeError } = scraping;

// KB Writer
const { loadOrCreateKB, saveKB, addOrUpdateSourcePage, addClaimsToKB, AGENCY_MAP } = kbWriter;

// Crawl State
const { loadCrawlState, saveCrawlState, getDomainState, saveSnapshot, snapshotExistsToday, getExistingHash } = crawlState;

// Crawl Report
const { generateRunReport, generateFailureReport, createRunStats, updateExtractionStats, printSummary, getDateString } = crawlReport;

// Document harvesting module
const documentHarvester = require('./document_harvester');

// ============================================================================
// CLI ARGUMENT PARSING
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    seedSource: 'bdgovlinks',
    category: 'public_services',
    refresh: 'changed',  // 'changed' | 'missing' | 'all'
    maxDepth: 4,
    maxPages: 300,
    rateLimit: 1500,  // ms between requests
    verbose: false,
    dryRun: false,
    domains: [],  // specific domains to crawl (empty = all)
    // Firecrawl enforcement options (default: strict mode)
    requireFirecrawl: true,  // fail if Firecrawl unavailable
    allowHttpDocDownload: false,  // no HTTP fallback for documents
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--seed-source':
        config.seedSource = args[++i];
        break;
      case '--category':
        config.category = args[++i];
        break;
      case '--refresh':
        config.refresh = args[++i];
        break;
      case '--maxDepth':
        config.maxDepth = parseInt(args[++i], 10);
        break;
      case '--maxPages':
        config.maxPages = parseInt(args[++i], 10);
        break;
      case '--rate-limit':
        config.rateLimit = parseInt(args[++i], 10);
        break;
      case '--domain':
        config.domains.push(args[++i]);
        break;
      case '--verbose':
      case '-v':
        config.verbose = true;
        break;
      case '--dry-run':
        config.dryRun = true;
        break;
      case '--require-firecrawl':
        config.requireFirecrawl = args[++i] !== 'false';
        break;
      case '--no-require-firecrawl':
        config.requireFirecrawl = false;
        break;
      case '--allow-http-doc-download':
        config.allowHttpDocDownload = args[++i] !== 'false';
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }
  
  // Apply Firecrawl config from CLI args
  firecrawlMcp.setConfig('firecrawlRequired', config.requireFirecrawl);
  firecrawlMcp.setConfig('allowHttpDocDownload', config.allowHttpDocDownload);
  
  return config;
}

function printHelp() {
  console.log(`
Bangladesh Government Services KB - Domain Deep Crawler

USAGE:
  node scripts/crawl.js [OPTIONS]

OPTIONS:
  --seed-source <source>   Seed source (default: bdgovlinks)
  --category <cat>         Category to crawl (default: public_services)
  --refresh <mode>         Refresh mode: changed | missing | all (default: changed)
  --maxDepth <n>           Maximum crawl depth (default: 4)
  --maxPages <n>           Maximum pages per domain (default: 300)
  --rate-limit <ms>        Delay between requests in ms (default: 1500)
  --domain <domain>        Specific domain to crawl (can repeat)
  --verbose, -v            Verbose output
  --dry-run                Show what would be crawled without crawling
  --help, -h               Show this help

FIRECRAWL MCP OPTIONS (Strict Mode - Fail Loudly):
  --require-firecrawl <bool>      Require Firecrawl MCP (default: true)
                                  If true, crawler fails if Firecrawl is unavailable
  --no-require-firecrawl         Alias for --require-firecrawl false
  --allow-http-doc-download <bool>  Allow HTTP fallback for document downloads (default: false)
                                  Only set true if Firecrawl cannot fetch documents

EXAMPLES:
  # Full crawl with defaults (strict Firecrawl mode)
  node scripts/crawl.js --seed-source bdgovlinks --category public_services

  # Refresh only changed pages
  node scripts/crawl.js --refresh changed

  # Crawl specific domain
  node scripts/crawl.js --domain epassport.gov.bd --maxPages 100

  # Dry run to see what would be crawled
  node scripts/crawl.js --dry-run --verbose

  # Allow HTTP fallback for document downloads (not recommended)
  node scripts/crawl.js --allow-http-doc-download true

  # Disable Firecrawl requirement (for testing only)
  node scripts/crawl.js --no-require-firecrawl

NOTES:
  This crawler requires Firecrawl MCP to be enabled in Cursor IDE.
  In strict mode (default), the crawler will FAIL LOUDLY if:
    - Firecrawl map is unavailable → throws FirecrawlUnavailableError
    - Firecrawl scrape is unavailable → throws FirecrawlUnavailableError
    - Firecrawl map fails for a domain → throws FirecrawlMapError
    - Firecrawl scrape returns empty content → throws FirecrawlScrapeError
    - Document download via HTTP attempted without --allow-http-doc-download
`);
}

// ============================================================================
// PATHS AND CONFIGURATION
// ============================================================================

const PATHS = {
  kbDir: path.join(__dirname, '..', 'kb'),
  seedsDir: path.join(__dirname, '..', 'kb', 'seeds'),
  snapshotsDir: path.join(__dirname, '..', 'kb', 'snapshots'),
  documentsDir: path.join(__dirname, '..', 'kb', 'snapshots', 'documents'),
  docTextDir: path.join(__dirname, '..', 'kb', 'snapshots', 'doc_text'),
  runsDir: path.join(__dirname, '..', 'kb', 'runs'),
  stateFile: path.join(__dirname, 'crawl_state.json'),
  kbPath: path.join(__dirname, '..', 'kb', 'bangladesh_government_services_kb_v3.json'),
  kbPathV2: path.join(__dirname, '..', 'kb', 'bangladesh_government_services_kb_v2.json'),
};

// ============================================================================
// UTILITY FUNCTIONS (local helpers)
// ============================================================================

function normalizeUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    let normalized = `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname}`;
    if (normalized.endsWith('/') && url.pathname !== '/') {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch (e) {
    return null;
  }
}

// ============================================================================
// DOMAIN DEEP CRAWLER
// ============================================================================

async function crawlDomain(seed, config, state, kb, firecrawlScrapeFunc, firecrawlMapFunc, runStats) {
  const domain = seed.domain;
  const domainState = getDomainState(state, domain);
  
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`🌐 Domain: ${seed.label}`);
  console.log(`   URL: ${seed.start_urls[0]}`);
  console.log(`   Max Depth: ${config.maxDepth}, Max Pages: ${config.maxPages}`);
  console.log(`   Firecrawl Required: ${config.requireFirecrawl}`);
  console.log(`${'═'.repeat(70)}\n`);
  
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
  };
  
  // Enforce Firecrawl requirement for map
  if (config.requireFirecrawl && !firecrawlMapFunc) {
    throw new FirecrawlUnavailableError('map');
  }
  
  // Enforce Firecrawl requirement for scrape
  if (config.requireFirecrawl && !firecrawlScrapeFunc) {
    throw new FirecrawlUnavailableError('scrape');
  }
  
  try {
    // Step 1: Fetch robots.txt
    console.log('  📋 Step 1: Fetching robots.txt...');
    let robotsRules = { disallow: [], allow: [], sitemaps: [] };
    
    if (firecrawlScrapeFunc) {
      try {
        const robotsUrl = `https://${domain}/robots.txt`;
        const robotsResult = await firecrawlScrapeFunc(robotsUrl, { formats: ['rawHtml'] });
        if (robotsResult && robotsResult.rawHtml) {
          robotsRules = parseRobotsTxt(robotsResult.rawHtml);
          console.log(`     ✓ Found ${robotsRules.disallow.length} disallow rules, ${robotsRules.sitemaps.length} sitemaps`);
        }
      } catch (e) {
        // robots.txt is optional, don't fail on it
        console.log(`     ⚠️  robots.txt not accessible (non-fatal)`);
      }
    }
    domainState.robotsRules = robotsRules;
    
    // Step 2: Fetch and parse sitemaps
    console.log('  📋 Step 2: Fetching sitemaps...');
    let sitemapUrls = [];
    
    // Try default sitemap locations
    const sitemapLocations = [
      ...robotsRules.sitemaps,
      `https://${domain}/sitemap.xml`,
      `https://${domain}/sitemap_index.xml`,
    ];
    
    for (const sitemapUrl of [...new Set(sitemapLocations)]) {
      if (firecrawlScrapeFunc) {
        try {
          const sitemapResult = await firecrawlScrapeFunc(sitemapUrl, { formats: ['rawHtml'] });
          if (sitemapResult && sitemapResult.rawHtml) {
            const parsed = parseSitemapXml(sitemapResult.rawHtml);
            if (parsed.type === 'index') {
              // It's a sitemap index, fetch each child sitemap
              for (const childSitemapUrl of parsed.sitemaps.slice(0, 5)) {  // Limit to 5 child sitemaps
                const childResult = await firecrawlScrapeFunc(childSitemapUrl, { formats: ['rawHtml'] });
                if (childResult && childResult.rawHtml) {
                  const childParsed = parseSitemapXml(childResult.rawHtml);
                  if (childParsed.urls) {
                    sitemapUrls.push(...childParsed.urls);
                  }
                }
                await sleep(500);
              }
            } else if (parsed.urls) {
              sitemapUrls.push(...parsed.urls);
            }
            console.log(`     ✓ Found ${sitemapUrls.length} URLs from sitemaps`);
            break;
          }
        } catch (e) {
          // Sitemap not found is non-fatal, continue
        }
      }
    }
    domainState.sitemapUrls = sitemapUrls;
    
    // Step 3: Map site navigation (CRITICAL - fail loudly if required)
    console.log('  📋 Step 3: Mapping site navigation...');
    let navigationUrls = [];
    
    if (firecrawlMapFunc) {
      for (const startUrl of seed.start_urls) {
        try {
          const mapResult = await firecrawlMapFunc(startUrl, {
            limit: config.maxPages,
            includeSubdomains: false,
          });
          if (mapResult && Array.isArray(mapResult)) {
            navigationUrls.push(...mapResult);
          }
        } catch (e) {
          // In required mode, map failure is FATAL
          if (config.requireFirecrawl) {
            throw new FirecrawlMapError(domain, e);
          }
          console.log(`     ⚠️  Failed to map ${startUrl}: ${e.message}`);
          domainStats.errors.push(`Map failed: ${startUrl}: ${e.message}`);
        }
        await sleep(config.rateLimit);
      }
      console.log(`     ✓ Discovered ${navigationUrls.length} URLs from navigation`);
    } else if (config.requireFirecrawl) {
      throw new FirecrawlUnavailableError('map');
    }
    
    // Step 4: Combine and prioritize URLs
    console.log('  📋 Step 4: Prioritizing URLs...');
    const allUrls = [...new Set([...seed.start_urls, ...sitemapUrls, ...navigationUrls])];
    const filteredUrls = allUrls.filter(url => {
      const urlDomain = getDomain(url);
      if (!urlDomain || !urlDomain.includes(domain.replace(/^www\./, ''))) return false;
      
      const urlPath = new URL(url).pathname;
      if (!isPathAllowed(urlPath, robotsRules)) return false;
      
      if (getUrlDepth(url, domain) > config.maxDepth) return false;
      
      return true;
    });
    
    const prioritizedUrls = sortUrlsByPriority(filteredUrls).slice(0, config.maxPages);
    domainStats.pagesDiscovered = prioritizedUrls.length;
    console.log(`     ✓ ${prioritizedUrls.length} URLs after filtering and prioritization\n`);
    
    if (config.dryRun) {
      console.log('  🔍 Dry run - URLs that would be crawled:');
      for (const url of prioritizedUrls.slice(0, 20)) {
        console.log(`     - ${url}`);
      }
      if (prioritizedUrls.length > 20) {
        console.log(`     ... and ${prioritizedUrls.length - 20} more`);
      }
      return domainStats;
    }
    
    // Step 5: Crawl pages
    console.log(`  📋 Step 5: Crawling ${prioritizedUrls.length} pages...`);
    
    for (let i = 0; i < prioritizedUrls.length; i++) {
      const pageUrl = prioritizedUrls[i];
      const sourcePageId = generateSourcePageId(pageUrl);
      
      // Check refresh mode
      if (config.refresh === 'missing' && snapshotExistsToday(sourcePageId, PATHS.snapshotsDir)) {
        console.log(`     ⏭️  [${i + 1}/${prioritizedUrls.length}] Already exists: ${pageUrl}`);
        domainStats.pagesUnchanged++;
        continue;
      }
      
      try {
        console.log(`     📄 [${i + 1}/${prioritizedUrls.length}] Scraping: ${pageUrl}`);
        
        // Enforce Firecrawl requirement for scrape
        if (!firecrawlScrapeFunc) {
          if (config.requireFirecrawl) {
            throw new FirecrawlUnavailableError('scrape');
          }
          console.log('        ⚠️  Firecrawl not available, skipping');
          continue;
        }
        
        const scrapeResult = await firecrawlScrapeFunc(pageUrl, {
          formats: ['markdown', 'html'],
          onlyMainContent: true,
          removeBase64Images: true,
        });
        
        // In required mode, empty content is an error (except for binary docs)
        if (!scrapeResult || !scrapeResult.markdown) {
          const isBinaryDoc = firecrawlMcp.isBinaryDocumentUrl(pageUrl);
          if (!isBinaryDoc && config.requireFirecrawl) {
            throw new FirecrawlScrapeError(
              pageUrl,
              'Firecrawl returned empty markdown content'
            );
          }
          console.log('        ❌ No content received');
          domainStats.errors.push(`No content: ${pageUrl}`);
          continue;
        }
        
        const markdown = scrapeResult.markdown;
        const html = scrapeResult.html || '';
        const title = scrapeResult.title || pageUrl;
        
        // Check if content changed
        const contentHash = generateHash(markdown);
        const existingHash = getExistingHash(sourcePageId, state);
        
        if (config.refresh === 'changed' && existingHash === contentHash) {
          console.log('        ⏭️  Unchanged');
          domainStats.pagesUnchanged++;
          continue;
        }
        
        // Save snapshot
        const { snapshotRef } = saveSnapshot(sourcePageId, pageUrl, html, markdown, PATHS.snapshotsDir);
        state.pageHashes[sourcePageId] = contentHash;
        
        // Extract structured data (pass HTML for enhanced document detection)
        const structuredData = extractStructuredData(markdown, pageUrl, html);
        
        // Update extraction stats
        updateExtractionStats(runStats, structuredData, domain);
        
        // Add to KB
        addOrUpdateSourcePage(kb, {
          url: pageUrl,
          domain: domain,
          title: title,
          markdown: markdown,
          contentHash: contentHash,
          snapshotRef: snapshotRef,
        }, classifyPage);
        
        // Extract and add claims
        const claims = extractClaims(markdown, sourcePageId, pageUrl, structuredData);
        const addedClaims = addClaimsToKB(kb, claims);
        domainStats.claimsExtracted += addedClaims;
        
        // Harvest documents
        if (structuredData.documentList.length > 0) {
          console.log(`        📎 Found ${structuredData.documentList.length} documents...`);
          const docResults = await documentHarvester.processDocumentList(
            structuredData.documentList,
            domain,
            state,
            pageUrl,
            1000  // 1 second between downloads
          );
          for (const docResult of docResults) {
            if (!docResult.skipped && !docResult.error) {
              domainStats.docsFound++;
              // Track fetch method for aggregate reporting
              if (docResult.fetched_via === 'http_fallback') {
                runStats.documentsFetchedViaHttpFallback++;
              } else {
                // Default to firecrawl if fetched_via not specified or is 'firecrawl'
                runStats.documentsFetchedViaFirecrawl++;
              }
            }
          }
        }
        
        domainStats.pagesProcessed++;
        domainStats.pagesSaved++;
        
        console.log(`        ✓ Saved (${addedClaims} claims, ${structuredData.documentList.length} docs)`);
        
        // Rate limiting
        await sleep(config.rateLimit);
        
      } catch (e) {
        console.log(`        ❌ Error: ${e.message}`);
        domainStats.errors.push(`${pageUrl}: ${e.message}`);
      }
    }
    
    // Update domain state
    domainState.lastCrawled = new Date().toISOString();
    domainState.pagesCrawled = domainStats.pagesProcessed;
    
    console.log(`\n  ✅ Domain complete: ${domainStats.pagesSaved} saved, ${domainStats.pagesUnchanged} unchanged, ${domainStats.errors.length} errors`);
    
  } catch (e) {
    console.error(`\n  ❌ Fatal error: ${e.message}`);
    domainStats.errors.push(`Fatal: ${e.message}`);
    throw e;  // Re-throw to be caught by main
  }
  
  // Update run stats
  runStats.domainsCrawled++;
  runStats.pagesTotal += domainStats.pagesDiscovered;
  runStats.pagesKept += domainStats.pagesSaved;
  runStats.pagesExcluded += domainStats.pagesExcluded;
  runStats.pagesUnchanged += domainStats.pagesUnchanged;
  runStats.docsDownloaded += domainStats.docsFound;
  runStats.claimsExtracted += domainStats.claimsExtracted;
  runStats.errors.push(...domainStats.errors);
  runStats.domainDetails.push(domainStats);
  
  return domainStats;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

/**
 * Main crawler entry point
 * 
 * This function can be run in two modes:
 * 1. Standalone (node scripts/crawl.js) - runs in planning mode without actual scraping
 * 2. MCP-orchestrated - when the AI agent provides scrape results via parameters
 * 
 * @param {Object} [mcpContext] - Optional MCP context with scrape/map functions
 * @param {Object} [mcpContext.bdgovlinksResult] - Pre-fetched bdgovlinks.com scrape result
 * @param {Function} [mcpContext.scrape] - Firecrawl scrape function
 * @param {Function} [mcpContext.map] - Firecrawl map function
 */
async function main(mcpContext = null) {
  console.log('\n' + '═'.repeat(70));
  console.log('  🕷️  Bangladesh Government Services KB - Domain Deep Crawler');
  console.log('═'.repeat(70) + '\n');
  
  const config = parseArgs();
  
  console.log('📋 Configuration:');
  console.log(`   Seed Source: ${config.seedSource}`);
  console.log(`   Category: ${config.category}`);
  console.log(`   Refresh Mode: ${config.refresh}`);
  console.log(`   Max Depth: ${config.maxDepth}`);
  console.log(`   Max Pages/Domain: ${config.maxPages}`);
  console.log(`   Rate Limit: ${config.rateLimit}ms`);
  console.log(`   Dry Run: ${config.dryRun}`);
  console.log(`   Require Firecrawl: ${config.requireFirecrawl} (fail loudly if unavailable)`);
  console.log(`   Allow HTTP Doc Download: ${config.allowHttpDocDownload}`);
  if (config.domains.length > 0) {
    console.log(`   Specific Domains: ${config.domains.join(', ')}`);
  }
  console.log('');
  
  // Ensure directories exist
  ensureDir(PATHS.seedsDir);
  ensureDir(PATHS.snapshotsDir);
  ensureDir(PATHS.documentsDir);
  ensureDir(PATHS.docTextDir);
  ensureDir(PATHS.runsDir);
  
  // Load state and KB
  const state = loadCrawlState(PATHS.stateFile);
  const kb = loadOrCreateKB(PATHS.kbPath, PATHS.kbPathV2);
  
  console.log(`📊 Loaded KB: ${kb.source_pages.length} pages, ${kb.claims.length} claims\n`);
  
  // Initialize run stats
  const runStats = createRunStats(config);
  
  // Check for MCP context
  let firecrawlScrapeFunc = mcpContext?.scrape || null;
  let firecrawlMapFunc = mcpContext?.map || null;
  let bdgovlinksResult = mcpContext?.bdgovlinksResult || null;
  
  // Try to get MCP functions from global scope (when run via Cursor MCP)
  if (!firecrawlScrapeFunc && typeof global.firecrawlScrape === 'function') {
    firecrawlScrapeFunc = global.firecrawlScrape;
    firecrawlMapFunc = global.firecrawlMap;
  }
  
  // Initialize the firecrawl_mcp module if MCP functions are available
  if (firecrawlScrapeFunc || firecrawlMapFunc) {
    firecrawlMcp.initialize({
      scrape: firecrawlScrapeFunc,
      map: firecrawlMapFunc,
    }, {
      firecrawlRequired: config.requireFirecrawl,
      allowHttpDocDownload: config.allowHttpDocDownload,
    });
  }
  
  // STRICT MODE: Validate Firecrawl availability at startup
  if (config.requireFirecrawl && !config.dryRun) {
    console.log('🔒 Strict Mode: Validating Firecrawl MCP availability...');
    
    if (!firecrawlScrapeFunc || !firecrawlMapFunc) {
      const error = new FirecrawlUnavailableError(
        !firecrawlScrapeFunc ? 'scrape' : 'map'
      );
      console.error(`\n❌ FATAL: ${error.message}\n`);
      
      // Generate failure report
      generateFailureReport(runStats, error, null, PATHS.runsDir);
      
      throw error;
    }
    
    console.log('   ✅ firecrawlScrape: available');
    console.log('   ✅ firecrawlMap: available\n');
  } else if (firecrawlScrapeFunc || bdgovlinksResult) {
    console.log('✅ Firecrawl MCP context available\n');
  } else {
    console.log('⚠️  Firecrawl MCP not detected');
    console.log('   This script requires Firecrawl MCP to perform actual crawling.');
    if (config.requireFirecrawl) {
      console.log('   In strict mode, this will fail at domain crawl time.');
    }
    console.log('   Running in planning mode...');
    console.log('   Tip: Use existing seeds if available.\n');
  }
  
  // Extract or load seeds
  let seeds;
  
  // Try to use existing seeds first if no live bdgovlinks data
  if (!bdgovlinksResult) {
    const existingSeeds = loadExistingSeeds(PATHS.seedsDir);
    if (existingSeeds && existingSeeds.length > 0) {
      console.log(`📂 Loaded ${existingSeeds.length} existing seeds from file\n`);
      seeds = existingSeeds;
    } else {
      // Generate seeds from fallback list
      seeds = await extractPublicServicesSeeds(null, PATHS.seedsDir);
    }
  } else {
    // Generate seeds from live bdgovlinks data
    seeds = await extractPublicServicesSeeds(bdgovlinksResult, PATHS.seedsDir);
  }
  
  // Filter seeds if specific domains requested
  let targetSeeds = seeds;
  if (config.domains.length > 0) {
    targetSeeds = seeds.filter(s => 
      config.domains.some(d => s.domain.includes(d) || d.includes(s.domain))
    );
    console.log(`🎯 Filtered to ${targetSeeds.length} domains based on --domain flags\n`);
  }
  
  if (targetSeeds.length === 0) {
    console.log('❌ No seeds to crawl. Exiting.');
    process.exit(1);
  }
  
  console.log(`🚀 Ready to crawl ${targetSeeds.length} domains\n`);
  
  // In dry-run mode or without MCP, just show what would be crawled
  if (config.dryRun || (!firecrawlScrapeFunc && !bdgovlinksResult)) {
    console.log('📋 Domains to crawl:');
    for (const seed of targetSeeds) {
      console.log(`   • ${seed.label}: ${seed.start_urls[0]}`);
    }
    console.log('');
    
    if (!firecrawlScrapeFunc) {
      console.log('💡 To perform actual crawling:');
      console.log('   1. Run this in Cursor IDE with Firecrawl MCP enabled');
      console.log('   2. The AI agent will orchestrate the crawl using Firecrawl tools\n');
      
      if (config.requireFirecrawl) {
        console.log('⚠️  Note: Strict mode is enabled. Crawl will fail without Firecrawl MCP.\n');
      }
    }
    
    // Save initial state
    saveCrawlState(state, PATHS.stateFile);
    saveKB(kb, PATHS.kbPath);
    
    runStats.status = 'dry_run';
    return { seeds: targetSeeds, config, state, kb, runStats };
  }
  
  // Crawl each domain with error handling
  let currentDomain = null;
  
  try {
  for (const seed of targetSeeds) {
    currentDomain = seed.domain;
    runStats.domainsAttempted++;

    try {
      await crawlDomain(seed, config, state, kb, firecrawlScrapeFunc, firecrawlMapFunc, runStats);
    } catch (error) {
      runStats.domainsFailed++;

      // Track failure reasons
      const reason = error.name === 'FirecrawlUnavailableError' ? 'firecrawl_unavailable' :
                    error.name === 'FirecrawlMapError' ? 'firecrawl_map_failed' :
                    'other_error';

      runStats.domainsFailedReasons[reason] = (runStats.domainsFailedReasons[reason] || 0) + 1;

      console.error(`\n❌ Domain ${seed.domain} failed: ${error.message}`);
      // Continue with next domain instead of failing the entire crawl
    }

    // Save state after each domain
    saveCrawlState(state, PATHS.stateFile);
    saveKB(kb, PATHS.kbPath);
  }
    
    runStats.status = 'completed';
  } catch (error) {
    // Handle fatal errors and generate failure report
    console.error(`\n❌ FATAL ERROR during crawl: ${error.message}\n`);
    
    // Save current state before generating report
    saveCrawlState(state, PATHS.stateFile);
    saveKB(kb, PATHS.kbPath);
    
    // Generate failure report
    generateFailureReport(runStats, error, currentDomain, PATHS.runsDir);
    
    // Re-throw to signal failure to caller
    throw error;
  }
  
  // Generate success run report
  const report = generateRunReport(runStats, PATHS.runsDir);
  
  // Print summary
  printSummary(report, PATHS);
  
  return { seeds: targetSeeds, config, state, kb, runStats, report };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // CLI
  parseArgs,
  
  // Main entry point
  main,
  
  // Domain crawler
  crawlDomain,
  
  // Configuration
  PATHS,
  
  // Crawler sub-modules (use these for access to all functions)
  crawler,
  
  // Firecrawl MCP module for orchestration
  firecrawlMcp,
};

// Run if executed directly
if (require.main === module) {
  main().catch(err => {
    console.error('💥 Fatal error:', err);
    process.exit(1);
  });
}
