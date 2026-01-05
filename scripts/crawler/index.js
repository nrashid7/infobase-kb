/**
 * Crawler Module Index
 * 
 * Re-exports all crawler sub-modules for convenient access.
 * 
 * @module crawler
 */

const utils = require('./utils');
const discovery = require('./discovery');
const filtering = require('./filtering');
const extraction = require('./extraction');
const scraping = require('./scraping');
const kbWriter = require('./kb_writer');
const crawlState = require('./crawl_state');
const crawlReport = require('./crawl_report');
const firecrawlOverrides = require('./firecrawl_overrides');
const serviceMap = require('./service_map');

module.exports = {
  // Shared utilities module
  utils,
  
  // Discovery module
  discovery,
  
  // Filtering module
  filtering,
  
  // Extraction module
  extraction,
  
  // Scraping module
  scraping,
  
  // KB Writer module
  kbWriter,
  
  // Crawl State module
  crawlState,
  
  // Crawl Report module
  crawlReport,
  
  // Firecrawl Overrides module
  firecrawlOverrides,
  
  // Service Map module
  serviceMap,
  
  // Re-export error classes for convenience
  FirecrawlUnavailableError: scraping.FirecrawlUnavailableError,
  FirecrawlMapError: scraping.FirecrawlMapError,
  FirecrawlScrapeError: scraping.FirecrawlScrapeError,
  HttpDownloadNotAllowedError: scraping.HttpDownloadNotAllowedError,
  
  // Re-export firecrawlMcp for convenience
  firecrawlMcp: scraping.firecrawlMcp,
};

