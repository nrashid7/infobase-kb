#!/usr/bin/env node
/**
 * Wrapper script to run crawler with MCP context
 * This provides MCP functions to the crawler when running from npm scripts
 */

const { main } = require('./crawl');

// Mock MCP context with functions that will use global MCP tools
const mcpContext = {
  scrape: async (url, options) => {
    // This will be handled by Cursor Agent MCP tools
    throw new Error('MCP scrape function should be provided by Cursor Agent');
  },
  map: async (url, options) => {
    // This will be handled by Cursor Agent MCP tools
    throw new Error('MCP map function should be provided by Cursor Agent');
  }
};

// Run the crawler with MCP context
main(mcpContext).catch(console.error);
