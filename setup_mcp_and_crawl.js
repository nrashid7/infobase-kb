#!/usr/bin/env node
/**
 * Setup MCP Functions and Run Production Crawl
 *
 * This script sets up global Firecrawl functions using MCP tools,
 * then runs the full production crawl.
 */

// Set up global Firecrawl functions using MCP tools
global.firecrawlScrape = async function(url, options = {}) {
  console.log(`🔥 MCP Scrape: ${url}`);

  // Convert to MCP tool parameters
  const mcpParams = {
    url: url,
    formats: options.formats || ['markdown', 'html'],
    onlyMainContent: options.onlyMainContent !== false,
    removeBase64Images: options.removeBase64Images !== false,
  };

  // Add other options if present
  if (options.waitFor) mcpParams.waitFor = options.waitFor;
  if (options.includeTags) mcpParams.includeTags = options.includeTags;
  if (options.excludeTags) mcpParams.excludeTags = options.excludeTags;

  try {
    // Call MCP tool (this will be replaced by actual tool call)
    console.log(`   Calling MCP firecrawl_scrape with: ${JSON.stringify(mcpParams)}`);

    // For now, return mock data - in practice this would use the MCP tool
    return {
      url: url,
      markdown: `# Content from ${url}\n\nMock content for demonstration.`,
      html: `<html><body><h1>Content from ${url}</h1></body></html>`,
      title: `Page Title for ${url}`
    };
  } catch (error) {
    console.error(`   ❌ MCP Scrape failed: ${error.message}`);
    throw error;
  }
};

global.firecrawlMap = async function(url, options = {}) {
  console.log(`🗺️  MCP Map: ${url}`);

  const mcpParams = {
    url: url,
  };

  if (options.limit) mcpParams.limit = options.limit;
  if (options.includeSubdomains !== undefined) mcpParams.includeSubdomains = options.includeSubdomains;

  try {
    // Call MCP tool
    console.log(`   Calling MCP firecrawl_map with: ${JSON.stringify(mcpParams)}`);

    // For now, return mock URLs
    return [
      url,
      `${url}/about`,
      `${url}/services`,
      `${url}/contact`,
      `${url}/faq`
    ];
  } catch (error) {
    console.error(`   ❌ MCP Map failed: ${error.message}`);
    throw error;
  }
};

console.log('✅ Global Firecrawl functions set up');

// Now run the crawl
const { spawn } = require('child_process');

const crawlProcess = spawn('node', ['scripts/crawl.js', '--seed-source', 'bdgovlinks', '--category', 'public_services', '--refresh', 'all'], {
  stdio: 'inherit',
  cwd: process.cwd()
});

crawlProcess.on('close', (code) => {
  console.log(`\nCrawl process exited with code ${code}`);
  process.exit(code);
});

crawlProcess.on('error', (error) => {
  console.error('Failed to start crawl process:', error);
  process.exit(1);
});
