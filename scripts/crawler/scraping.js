/**
 * Page Scraping Module
 * 
 * Handles Firecrawl MCP integration for page scraping.
 * Re-exports firecrawl_mcp functionality with crawl-specific helpers.
 * 
 * @module crawler/scraping
 */

// Re-export the firecrawl_mcp module
const firecrawlMcp = require('../firecrawl_mcp');

/**
 * Scrape a page and validate result
 * @param {Function} scrapeFunc - Firecrawl scrape function
 * @param {string} url - URL to scrape
 * @param {Object} [options] - Scrape options
 * @returns {Promise<{markdown: string, html: string, title: string}|null>}
 */
async function scrapePage(scrapeFunc, url, options = {}) {
  if (!scrapeFunc) {
    return null;
  }
  
  const scrapeOptions = {
    formats: ['markdown', 'html'],
    onlyMainContent: true,
    removeBase64Images: true,
    ...options,
  };
  
  const result = await scrapeFunc(url, scrapeOptions);
  
  if (!result) {
    return null;
  }
  
  return {
    markdown: result.markdown || '',
    html: result.html || '',
    title: result.title || url,
    raw: result,
  };
}

/**
 * Fetch robots.txt for a domain
 * @param {Function} scrapeFunc - Firecrawl scrape function
 * @param {string} domain - Domain to fetch robots.txt for
 * @returns {Promise<string|null>} - robots.txt content or null
 */
async function fetchRobotsTxt(scrapeFunc, domain) {
  if (!scrapeFunc) return null;
  
  try {
    const robotsUrl = `https://${domain}/robots.txt`;
    const result = await scrapeFunc(robotsUrl, { formats: ['rawHtml'] });
    return result?.rawHtml || null;
  } catch (e) {
    return null;
  }
}

/**
 * Fetch sitemap for a domain
 * @param {Function} scrapeFunc - Firecrawl scrape function
 * @param {string} sitemapUrl - Sitemap URL
 * @returns {Promise<string|null>} - Sitemap XML content or null
 */
async function fetchSitemap(scrapeFunc, sitemapUrl) {
  if (!scrapeFunc) return null;
  
  try {
    const result = await scrapeFunc(sitemapUrl, { formats: ['rawHtml'] });
    return result?.rawHtml || null;
  } catch (e) {
    return null;
  }
}

/**
 * Map site URLs using Firecrawl
 * @param {Function} mapFunc - Firecrawl map function
 * @param {string} startUrl - Start URL
 * @param {Object} [options] - Map options
 * @returns {Promise<string[]>} - Discovered URLs
 */
async function mapSiteUrls(mapFunc, startUrl, options = {}) {
  if (!mapFunc) return [];
  
  const mapOptions = {
    limit: options.limit || 500,
    includeSubdomains: options.includeSubdomains ?? false,
    ...options,
  };
  
  const result = await mapFunc(startUrl, mapOptions);
  
  if (Array.isArray(result)) {
    return result;
  }
  
  if (result?.links && Array.isArray(result.links)) {
    return result.links;
  }
  
  if (result?.urls && Array.isArray(result.urls)) {
    return result.urls;
  }
  
  return [];
}

module.exports = {
  scrapePage,
  fetchRobotsTxt,
  fetchSitemap,
  mapSiteUrls,
  // Re-export firecrawl_mcp
  firecrawlMcp,
  // Error classes
  FirecrawlUnavailableError: firecrawlMcp.FirecrawlUnavailableError,
  FirecrawlMapError: firecrawlMcp.FirecrawlMapError,
  FirecrawlScrapeError: firecrawlMcp.FirecrawlScrapeError,
  HttpDownloadNotAllowedError: firecrawlMcp.HttpDownloadNotAllowedError,
};

