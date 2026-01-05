/**
 * Firecrawl MCP Integration Module
 * 
 * Provides strict enforcement of Firecrawl MCP for all web scraping operations.
 * This module ensures that the crawler fails loudly if Firecrawl is unavailable
 * rather than silently falling back to alternative methods.
 * 
 * @module firecrawl_mcp
 */

const fs = require('fs');
const path = require('path');

// Import shared utilities
const {
  sleep,
  httpDownload,
} = require('./crawler/utils');

// Import per-URL Firecrawl overrides
const {
  getFirecrawlOverridesForUrl,
  formatOverrideLog,
} = require('./crawler/firecrawl_overrides');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Default to requiring Firecrawl - fail if unavailable
  firecrawlRequired: true,
  // Default to disallowing HTTP fallback for documents
  allowHttpDocDownload: false,
  // Timeout for Firecrawl operations (ms)
  timeout: 60000,
  // Max retries for transient failures
  maxRetries: 2,
  // Delay between retries (ms)
  retryDelay: 2000,
};

// ============================================================================
// ERROR CLASSES
// ============================================================================

/**
 * Error thrown when Firecrawl MCP is required but unavailable
 */
class FirecrawlUnavailableError extends Error {
  constructor(operation) {
    super(`Firecrawl MCP is required but unavailable for operation: ${operation}. ` +
          `Either enable Firecrawl MCP in Cursor or set --require-firecrawl=false`);
    this.name = 'FirecrawlUnavailableError';
    this.operation = operation;
    this.code = 'FIRECRAWL_UNAVAILABLE';
  }
}

/**
 * Error thrown when Firecrawl map operation fails
 */
class FirecrawlMapError extends Error {
  constructor(domain, originalError) {
    super(`Firecrawl map failed for domain '${domain}': ${originalError?.message || 'Unknown error'}. ` +
          `Cannot continue crawl without site map.`);
    this.name = 'FirecrawlMapError';
    this.domain = domain;
    this.code = 'FIRECRAWL_MAP_FAILED';
    this.originalError = originalError;
  }
}

/**
 * Error thrown when Firecrawl scrape operation fails or returns empty content
 */
class FirecrawlScrapeError extends Error {
  constructor(url, reason) {
    super(`Firecrawl scrape failed for '${url}': ${reason}`);
    this.name = 'FirecrawlScrapeError';
    this.url = url;
    this.code = 'FIRECRAWL_SCRAPE_FAILED';
    this.reason = reason;
  }
}

/**
 * Error thrown when HTTP document download is attempted but not allowed
 */
class HttpDownloadNotAllowedError extends Error {
  constructor(url) {
    super(`HTTP document download not allowed for '${url}'. ` +
          `Set --allow-http-doc-download=true to enable fallback, or ensure Firecrawl can fetch the document.`);
    this.name = 'HttpDownloadNotAllowedError';
    this.url = url;
    this.code = 'HTTP_DOWNLOAD_NOT_ALLOWED';
  }
}

// ============================================================================
// FIRECRAWL FUNCTION REGISTRY
// ============================================================================

/**
 * Registry for Firecrawl MCP functions
 * These are injected at runtime by the orchestrating agent
 */
let firecrawlFunctions = {
  scrape: null,
  map: null,
  crawl: null,
};

let configOverrides = {};

/**
 * Initialize Firecrawl MCP with the provided functions
 * @param {Object} functions - Object containing scrape, map, and optionally crawl functions
 * @param {Object} [options] - Configuration overrides
 */
function initialize(functions, options = {}) {
  if (functions.scrape) {
    firecrawlFunctions.scrape = functions.scrape;
  }
  if (functions.map) {
    firecrawlFunctions.map = functions.map;
  }
  if (functions.crawl) {
    firecrawlFunctions.crawl = functions.crawl;
  }
  
  // Apply configuration overrides
  Object.assign(configOverrides, options);
  
  console.log('✅ Firecrawl MCP initialized');
  console.log(`   - scrape: ${firecrawlFunctions.scrape ? 'available' : 'NOT available'}`);
  console.log(`   - map: ${firecrawlFunctions.map ? 'available' : 'NOT available'}`);
  console.log(`   - crawl: ${firecrawlFunctions.crawl ? 'available' : 'NOT available'}`);
}

/**
 * Get effective configuration value
 */
function getConfig(key) {
  return configOverrides[key] !== undefined ? configOverrides[key] : CONFIG[key];
}

/**
 * Set configuration option
 */
function setConfig(key, value) {
  configOverrides[key] = value;
}

/**
 * Check if Firecrawl is available for a given operation
 * @param {'scrape' | 'map' | 'crawl'} operation
 * @returns {boolean}
 */
function isAvailable(operation) {
  return typeof firecrawlFunctions[operation] === 'function';
}

/**
 * Assert that Firecrawl is available for a given operation
 * @param {'scrape' | 'map' | 'crawl'} operation
 * @throws {FirecrawlUnavailableError} if required but unavailable
 */
function assertAvailable(operation) {
  if (!isAvailable(operation) && getConfig('firecrawlRequired')) {
    throw new FirecrawlUnavailableError(operation);
  }
}

// ============================================================================
// WRAPPED FIRECRAWL OPERATIONS
// ============================================================================

/**
 * Scrape a URL using Firecrawl MCP
 * @param {string} url - URL to scrape
 * @param {Object} [options] - Scrape options
 * @param {boolean} [options.allowEmpty=false] - If false, throw on empty content
 * @returns {Promise<Object>} - Scrape result
 * @throws {FirecrawlUnavailableError} if Firecrawl required but unavailable
 * @throws {FirecrawlScrapeError} if scrape fails or returns empty content
 */
async function firecrawlScrape(url, options = {}) {
  assertAvailable('scrape');

  if (!isAvailable('scrape')) {
    console.log(`⚠️  Firecrawl scrape not available for: ${url}`);
    return null;
  }

  // Whitelist of allowed Firecrawl scrape option keys
  const ALLOWED_SCRAPE_KEYS = [
    'formats', 'onlyMainContent', 'removeBase64Images', 'waitFor', 'timeout',
    'includeTags', 'excludeTags', 'headers'
  ];

  /**
   * Pick only allowed scrape options from an object
   * @param {Object} obj - Object to filter
   * @returns {Object} - Filtered object with only allowed keys
   */
  function pickAllowedScrapeOptions(obj) {
    if (!obj || typeof obj !== 'object') return {};
    const result = {};
    for (const key of ALLOWED_SCRAPE_KEYS) {
      if (obj.hasOwnProperty(key)) {
        result[key] = obj[key];
      }
    }
    return result;
  }

  // Get URL-specific overrides (e.g., waitFor for SPA pages)
  const urlOverrides = getFirecrawlOverridesForUrl(url);

  // Build base options from defaults + caller options (only allowed keys)
  const baseOptionsSafe = pickAllowedScrapeOptions({
    formats: options.formats || ['markdown'],
    onlyMainContent: options.onlyMainContent !== false,
    removeBase64Images: options.removeBase64Images !== false,
    ...options
  });

  // Strip non-Firecrawl keys from URL overrides to avoid passing functions to MCP
  const { postprocessMarkdown, ...urlOverridesSafe } = urlOverrides || {};

  // Merge URL-specific overrides (highest priority) - also filtered to allowed keys
  const scrapeOptions = urlOverrides
    ? { ...baseOptionsSafe, ...pickAllowedScrapeOptions(urlOverridesSafe) }
    : baseOptionsSafe;

  // Log if override was applied
  if (urlOverrides) {
    console.log(formatOverrideLog(urlOverrides, url));
  }
  
  let lastError = null;
  const maxRetries = options.maxRetries ?? getConfig('maxRetries');
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await firecrawlFunctions.scrape(url, scrapeOptions);
      
      // Validate result
      if (!result) {
        throw new FirecrawlScrapeError(url, 'Firecrawl returned null/undefined result');
      }
      
      // Check for content unless explicitly allowed to be empty
      const allowEmpty = options.allowEmpty || isBinaryDocumentUrl(url);
      if (!allowEmpty && !result.markdown && !result.html && !result.rawHtml) {
        throw new FirecrawlScrapeError(url, 'Firecrawl returned empty content (no markdown/html)');
      }
      
      // Apply URL-specific postprocess to markdown if configured
      if (urlOverrides && typeof urlOverrides.postprocessMarkdown === 'function' && typeof result.markdown === 'string') {
        result.markdown = urlOverrides.postprocessMarkdown(result.markdown);
      }
      
      return result;
      
    } catch (error) {
      lastError = error;
      
      // Don't retry for our custom errors or final attempt
      if (error instanceof FirecrawlScrapeError || 
          error instanceof FirecrawlUnavailableError ||
          attempt >= maxRetries) {
        break;
      }
      
      console.log(`   ⚠️  Scrape attempt ${attempt + 1} failed, retrying...`);
      await sleep(getConfig('retryDelay'));
    }
  }
  
  // Re-throw if it's already our error type
  if (lastError instanceof FirecrawlScrapeError) {
    throw lastError;
  }
  
  throw new FirecrawlScrapeError(url, lastError?.message || 'Unknown scrape error');
}

/**
 * Map a website using Firecrawl MCP
 * @param {string} url - Starting URL to map
 * @param {Object} [options] - Map options
 * @returns {Promise<string[]>} - Array of discovered URLs
 * @throws {FirecrawlUnavailableError} if Firecrawl required but unavailable
 * @throws {FirecrawlMapError} if map fails
 */
async function firecrawlMap(url, options = {}) {
  assertAvailable('map');
  
  if (!isAvailable('map')) {
    console.log(`⚠️  Firecrawl map not available for: ${url}`);
    return [];
  }
  
  const mapOptions = {
    limit: options.limit || 500,
    includeSubdomains: options.includeSubdomains ?? false,
    ...options,
  };
  
  try {
    const result = await firecrawlFunctions.map(url, mapOptions);
    
    // Validate result
    if (!result) {
      throw new Error('Firecrawl map returned null/undefined result');
    }
    
    // Handle different result formats
    if (Array.isArray(result)) {
      return result;
    }
    
    if (result.links && Array.isArray(result.links)) {
      return result.links;
    }
    
    if (result.urls && Array.isArray(result.urls)) {
      return result.urls;
    }
    
    throw new Error('Firecrawl map returned unexpected format');
    
  } catch (error) {
    const domain = new URL(url).hostname;
    throw new FirecrawlMapError(domain, error);
  }
}

// ============================================================================
// BINARY DOCUMENT FETCHING
// ============================================================================

/**
 * Binary document extensions that need special handling
 */
const BINARY_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.rar'];

/**
 * Check if URL points to a binary document
 */
function isBinaryDocumentUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return BINARY_EXTENSIONS.some(ext => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

/**
 * Get file extension from URL
 */
function getExtensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).toLowerCase();
    return ext || null;
  } catch {
    return null;
  }
}

/**
 * Get MIME type from extension
 */
function getMimeFromExtension(ext) {
  const mimeMap = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * Fetch binary document content using Firecrawl MCP
 * 
 * Strategy:
 * 1. Try Firecrawl scrape with rawHtml format (may contain document link or content)
 * 2. If MCP cannot return raw binary, fall back to HTTP only if explicitly allowed
 * 
 * @param {string} url - Document URL to fetch
 * @param {Object} [options] - Fetch options
 * @param {boolean} [options.allowHttpFallback] - Override global HTTP fallback setting
 * @returns {Promise<{buffer: Buffer, contentType: string, filename: string}>}
 * @throws {FirecrawlUnavailableError} if Firecrawl required but unavailable
 * @throws {HttpDownloadNotAllowedError} if HTTP fallback needed but not allowed
 */
async function fetchBinary(url, options = {}) {
  const extension = getExtensionFromUrl(url);
  const contentType = getMimeFromExtension(extension);
  const filename = path.basename(new URL(url).pathname) || `document${extension || '.bin'}`;
  
  // Try Firecrawl first
  if (isAvailable('scrape')) {
    try {
      console.log(`   📥 Attempting Firecrawl fetch for binary: ${url}`);
      
      // Try with rawHtml format - some documents may be accessible this way
      const result = await firecrawlFunctions.scrape(url, {
        formats: ['rawHtml'],
        allowEmpty: true,
      });
      
      if (result) {
        // Check if we got any usable content
        if (result.rawHtml) {
          // Check if it's actual binary content encoded somehow
          // or if it's a redirect page
          const content = result.rawHtml;
          
          // If content looks like HTML, it might be a download page
          // In this case, we need HTTP fallback for the actual binary
          if (!content.startsWith('<!DOCTYPE') && !content.startsWith('<html')) {
            // Might be binary content - try to use it
            const buffer = Buffer.from(content, 'binary');
            console.log(`   ✓ Firecrawl returned content (${buffer.length} bytes)`);
            return { buffer, contentType, filename };
          }
        }
        
        // Check if result has a direct link to the file
        if (result.links && Array.isArray(result.links)) {
          const directLink = result.links.find(link => 
            link.endsWith(extension) || BINARY_EXTENSIONS.some(ext => link.endsWith(ext))
          );
          if (directLink && directLink !== url) {
            console.log(`   ↪️  Following direct link: ${directLink}`);
            return fetchBinary(directLink, options);
          }
        }
      }
      
      console.log(`   ⚠️  Firecrawl could not fetch binary content directly`);
      
    } catch (error) {
      console.log(`   ⚠️  Firecrawl binary fetch failed: ${error.message}`);
    }
  } else if (getConfig('firecrawlRequired')) {
    throw new FirecrawlUnavailableError('binary document fetch');
  }
  
  // Check if HTTP fallback is allowed
  const allowHttpFallback = options.allowHttpFallback ?? getConfig('allowHttpDocDownload');
  
  if (!allowHttpFallback) {
    throw new HttpDownloadNotAllowedError(url);
  }
  
  // HTTP fallback (only if explicitly allowed)
  console.log(`   ⚠️  Using HTTP fallback for binary download (allowed by flag)`);
  const buffer = await httpDownload(url, {
    timeout: getConfig('timeout'),
    maxFileSize: 50 * 1024 * 1024, // 50MB max
    userAgent: 'Mozilla/5.0 (compatible; InfobaseBot/1.0)',
  });
  return { buffer, contentType, filename, usedHttpFallback: true };
}

// Note: httpDownload is imported from utils.js

/**
 * Get status object for diagnostics
 */
function getStatus() {
  return {
    scrapeAvailable: isAvailable('scrape'),
    mapAvailable: isAvailable('map'),
    crawlAvailable: isAvailable('crawl'),
    firecrawlRequired: getConfig('firecrawlRequired'),
    allowHttpDocDownload: getConfig('allowHttpDocDownload'),
    initialized: Object.values(firecrawlFunctions).some(f => f !== null),
  };
}

/**
 * Validate that the crawler can proceed in required mode
 * @throws {FirecrawlUnavailableError} if required functions are missing
 */
function validateForCrawl() {
  if (!getConfig('firecrawlRequired')) {
    return { valid: true, message: 'Firecrawl not required - proceeding without validation' };
  }
  
  const errors = [];
  
  if (!isAvailable('map')) {
    errors.push('firecrawlMap is not available');
  }
  
  if (!isAvailable('scrape')) {
    errors.push('firecrawlScrape is not available');
  }
  
  if (errors.length > 0) {
    throw new FirecrawlUnavailableError(
      `Required Firecrawl functions missing: ${errors.join(', ')}`
    );
  }
  
  return { valid: true, message: 'Firecrawl MCP validated for crawl' };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Configuration
  CONFIG,
  initialize,
  getConfig,
  setConfig,
  
  // Status and validation
  isAvailable,
  assertAvailable,
  getStatus,
  validateForCrawl,
  
  // Core Firecrawl operations
  firecrawlScrape,
  firecrawlMap,
  
  // Binary document handling
  fetchBinary,
  isBinaryDocumentUrl,
  getExtensionFromUrl,
  getMimeFromExtension,
  
  // Error classes (for catching specific errors)
  FirecrawlUnavailableError,
  FirecrawlMapError,
  FirecrawlScrapeError,
  HttpDownloadNotAllowedError,
};

