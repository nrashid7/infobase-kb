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
 * Exact URL matches that require custom Firecrawl options.
 * Key: exact URL (lowercase, no trailing slash)
 * Value: partial options to merge into scrape call
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

  // Normalize URL: lowercase, remove trailing slash
  const normalized = url.toLowerCase().replace(/\/+$/, '');

  // Check exact match first
  const exactMatch = EXACT_URL_OVERRIDES[normalized];
  if (exactMatch) {
    return { ...exactMatch };  // Return a copy to prevent mutation
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
  // Export for testing/inspection
  EXACT_URL_OVERRIDES,
};

