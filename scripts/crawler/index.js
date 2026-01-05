/**
 * Crawler Module Index
 * 
 * Re-exports all crawler sub-modules for convenient access.
 * 
 * @module crawler
 */

const discovery = require('./discovery');
const filtering = require('./filtering');
const extraction = require('./extraction');
const scraping = require('./scraping');
const kbWriter = require('./kb_writer');
const crawlState = require('./crawl_state');
const crawlReport = require('./crawl_report');

module.exports = {
  // Discovery module
  discovery,
  parsePublicServicesFromMarkdown: discovery.parsePublicServicesFromMarkdown,
  extractPublicServicesSeeds: discovery.extractPublicServicesSeeds,
  loadExistingSeeds: discovery.loadExistingSeeds,
  
  // Filtering module
  filtering,
  getUrlPriority: filtering.getUrlPriority,
  sortUrlsByPriority: filtering.sortUrlsByPriority,
  getUrlDepth: filtering.getUrlDepth,
  parseRobotsTxt: filtering.parseRobotsTxt,
  isPathAllowed: filtering.isPathAllowed,
  parseSitemapXml: filtering.parseSitemapXml,
  PRIORITY_PATTERNS: filtering.PRIORITY_PATTERNS,
  
  // Extraction module
  extraction,
  classifyPage: extraction.classifyPage,
  extractStructuredData: extraction.extractStructuredData,
  extractClaims: extraction.extractClaims,
  PAGE_TYPES: extraction.PAGE_TYPES,
  DOCUMENT_EXTENSIONS: extraction.DOCUMENT_EXTENSIONS,
  
  // Scraping module
  scraping,
  scrapePage: scraping.scrapePage,
  fetchRobotsTxt: scraping.fetchRobotsTxt,
  fetchSitemap: scraping.fetchSitemap,
  mapSiteUrls: scraping.mapSiteUrls,
  firecrawlMcp: scraping.firecrawlMcp,
  FirecrawlUnavailableError: scraping.FirecrawlUnavailableError,
  FirecrawlMapError: scraping.FirecrawlMapError,
  FirecrawlScrapeError: scraping.FirecrawlScrapeError,
  HttpDownloadNotAllowedError: scraping.HttpDownloadNotAllowedError,
  
  // KB Writer module
  kbWriter,
  loadOrCreateKB: kbWriter.loadOrCreateKB,
  saveKB: kbWriter.saveKB,
  ensureAgency: kbWriter.ensureAgency,
  addOrUpdateSourcePage: kbWriter.addOrUpdateSourcePage,
  addClaimsToKB: kbWriter.addClaimsToKB,
  AGENCY_MAP: kbWriter.AGENCY_MAP,
  
  // Crawl State module
  crawlState,
  loadCrawlState: crawlState.loadCrawlState,
  saveCrawlState: crawlState.saveCrawlState,
  getDomainState: crawlState.getDomainState,
  saveSnapshot: crawlState.saveSnapshot,
  snapshotExistsToday: crawlState.snapshotExistsToday,
  getExistingHash: crawlState.getExistingHash,
  
  // Crawl Report module
  crawlReport,
  generateRunReport: crawlReport.generateRunReport,
  generateFailureReport: crawlReport.generateFailureReport,
  createRunStats: crawlReport.createRunStats,
  updateExtractionStats: crawlReport.updateExtractionStats,
  printSummary: crawlReport.printSummary,
  
  // Shared utilities
  generateHash: kbWriter.generateHash,
  generateSourcePageId: kbWriter.generateSourcePageId,
  getDateString: crawlReport.getDateString,
  ensureDir: kbWriter.ensureDir,
  getDomain: discovery.getDomain,
};

