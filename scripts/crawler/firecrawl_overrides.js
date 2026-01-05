/**
 * Firecrawl per-URL option overrides
 * 
 * Provides explicit overrides for specific URLs that require non-default
 * Firecrawl scrape options (e.g., SPA pages that need waitFor).
 * 
 * @module crawler/firecrawl_overrides
 */

'use strict';

// ============================================================================
// URL-SPECIFIC OVERRIDES
// ============================================================================

/**
 * URL patterns that require custom Firecrawl options.
 * Key: canonical URL (with https protocol)
 * Value: partial options to merge into scrape call
 * Matching is done by normalized hostname+pathname (strips www., trailing slash)
 */
const EXACT_URL_OVERRIDES = {
  // ePassport fee page is an Angular SPA that requires JS render wait
  'https://www.epassport.gov.bd/instructions/passport-fees': {
    onlyMainContent: false,
    formats: ['markdown', 'rawHtml'],
    waitFor: 5000,
    // Normalize "TK" currency token to "BDT" for fee extraction heuristics
    postprocessMarkdown: (markdown) => markdown.replace(/\bTK\b/gi, 'BDT'),
  },
};

// ============================================================================
// URL NORMALIZATION
// ============================================================================

/**
 * Normalize URL for override matching by extracting hostname + pathname.
 * Strips "www." prefix from hostname, trims trailing "/" from pathname (except "/").
 *
 * @param {string} url - The URL to normalize
 * @returns {string|null} - Normalized "hostname/pathname" or null if invalid
 */
function normalizeUrlForOverride(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    const parsed = new URL(url);

    // Strip "www." from hostname
    let hostname = parsed.hostname;
    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4);
    }

    // Trim trailing "/" from pathname (but keep if it's just "/")
    let pathname = parsed.pathname;
    if (pathname !== '/' && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    return `${hostname}${pathname}`;
  } catch (e) {
    // Invalid URL
    return null;
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Get Firecrawl option overrides for a specific URL.
 *
 * @param {string} url - The URL to check for overrides
 * @returns {Object|null} - Partial options to merge, or null if no override
 */
function getFirecrawlOverridesForUrl(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  // Normalize URL for matching: hostname (no www) + pathname (no trailing slash)
  const normalized = normalizeUrlForOverride(url);

  if (!normalized) {
    return null;
  }

  // Check exact match by normalized hostname + pathname
  for (const [overrideUrl, override] of Object.entries(EXACT_URL_OVERRIDES)) {
    const overrideNormalized = normalizeUrlForOverride(overrideUrl);
    if (overrideNormalized === normalized) {
      return { ...override };  // Return a copy to prevent mutation
    }
  }

  return null;
}

/**
 * Format override for logging (single line)
 * @param {Object} overrides - The override object
 * @param {string} url - The URL
 * @returns {string} - Log line
 */
function formatOverrideLog(overrides, url) {
  if (!overrides) return '';
  
  const parts = [];
  if (overrides.waitFor !== undefined) {
    parts.push(`waitFor=${overrides.waitFor}`);
  }
  if (overrides.onlyMainContent !== undefined) {
    parts.push(`onlyMainContent=${overrides.onlyMainContent}`);
  }
  if (overrides.formats) {
    parts.push(`formats=${overrides.formats.join(',')}`);
  }
  parts.push(`url=${url}`);
  
  return `[firecrawl] override applied: ${parts.join(' ')}`;
}

module.exports = {
  getFirecrawlOverridesForUrl,
  formatOverrideLog,
  normalizeUrlForOverride,
  // Export for testing/inspection
  EXACT_URL_OVERRIDES,
};

