#!/usr/bin/env node

const firecrawlMcp = require('../firecrawl_mcp');

async function runSmokeCheck() {
  console.log('🔍 PHASE 0: Firecrawl Smoke Check');
  console.log('Testing Firecrawl availability with single scrape...');

  try {
    // Use same access pattern as real crawler (scripts/crawl.js)
    let scrapeFunc = null;
    let mapFunc = null;
    let mode = 'none';

    // Check for global MCP functions first (preferred)
    if (typeof global.firecrawlScrape === 'function') {
      scrapeFunc = global.firecrawlScrape;
      mapFunc = global.firecrawlMap;
      mode = 'MCP (globals)';
    }

    // If no MCP globals, try API key fallback
    if (!scrapeFunc && process.env.FIRECRAWL_API_KEY) {
      firecrawlMcp.initializeWithApiKey(process.env.FIRECRAWL_API_KEY, {
        firecrawlRequired: true,
        allowHttpDocDownload: false,
      });
      scrapeFunc = firecrawlMcp.firecrawlScrape;
      mapFunc = firecrawlMcp.firecrawlMap;
      mode = 'Firecrawl API fallback';
    }

    if (!scrapeFunc) {
      console.log('❌ FAIL: Firecrawl NOT AVAILABLE in this environment.');
      console.log('');
      console.log('Expected configuration (one of the following):');
      console.log('  1. Cursor Agent mode with Firecrawl MCP enabled');
      console.log('     - Must run in Cursor Agent mode (not terminal)');
      console.log('     - Firecrawl MCP must be enabled in Cursor MCP settings');
      console.log('  2. FIRECRAWL_API_KEY environment variable');
      console.log('     - Set FIRECRAWL_API_KEY=<your-api-key> in environment');
      console.log('');
      console.log('Note: Terminal execution without API key will fail by design.');
      process.exit(1);
    }

    console.log(`✅ Firecrawl available: ${mode}`);

    // Initialize firecrawlMcp with MCP functions if using globals (not needed for API fallback)
    if (mode === 'MCP (globals)') {
      firecrawlMcp.initialize({
        scrape: scrapeFunc,
        map: mapFunc,
      }, {
        firecrawlRequired: true,
        allowHttpDocDownload: false,
      });
    }

    const testUrl = 'https://www.epassport.gov.bd/instructions/five-step-to-your-epassport';

    console.log(`Target URL: ${testUrl}`);
    console.log('Requesting formats: ["markdown"], onlyMainContent: true');

    const startTime = Date.now();
    const result = await firecrawlMcp.firecrawlScrape(testUrl, {
      formats: ['markdown'],
      onlyMainContent: true
    });
    const duration = Date.now() - startTime;

    if (!result || !result.markdown) {
      console.log('❌ FAIL: No markdown content returned');
      console.log('Result:', result);
      process.exit(1);
    }

    const markdownLength = result.markdown.length;
    console.log(`✅ PASS: Firecrawl MCP available (${duration}ms)`);
    console.log(`Markdown length: ${markdownLength} characters`);
    console.log(`Overrides applied: false`);

    if (markdownLength < 100) {
      console.log('⚠️  WARNING: Markdown content seems too short');
      console.log('Preview:', result.markdown.substring(0, 200) + '...');
    }

    process.exit(0);

  } catch (error) {
    console.log('❌ FAIL: Firecrawl NOT AVAILABLE in this environment.');
    console.log('');
    console.log('Expected configuration (one of the following):');
    console.log('  1. Cursor Agent mode with Firecrawl MCP enabled');
    console.log('     - Must run in Cursor Agent mode (not terminal)');
    console.log('     - Firecrawl MCP must be enabled in Cursor MCP settings');
    console.log('  2. FIRECRAWL_API_KEY environment variable');
    console.log('     - Set FIRECRAWL_API_KEY=<your-api-key> in environment');
    console.log('');
    console.log('Note: Terminal execution without API key will fail by design.');
    console.log('');
    console.log('Error details:', error.message);
    if (error.stack) {
      console.log('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  runSmokeCheck();
}

module.exports = { runSmokeCheck };
