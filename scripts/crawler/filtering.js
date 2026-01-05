/**
 * URL Filtering and Prioritization Module
 * 
 * Handles URL priority scoring, filtering, and robots.txt/sitemap parsing.
 * Enhanced with high-value service page detection.
 * 
 * @module crawler/filtering
 */

const { URL } = require('url');

// ============================================================================
// URL PRIORITY PATTERNS
// ============================================================================

/**
 * Priority scoring weights
 * Higher score = more likely to be a valuable service page
 */
const PRIORITY_WEIGHTS = {
  very_high: 15,   // Critical service pages
  high: 10,        // Important service pages
  medium: 5,       // Useful pages
  low: 2,          // Background/supplementary
  penalty: -3,     // De-prioritize but don't exclude
  exclude: -999,   // Fully exclude
};

const PRIORITY_PATTERNS = {
  // Very high priority - core service content
  very_high: [
    /instruction/i,
    /how[-_]?to/i,
    /step[-_]?by[-_]?step/i,
    /guide/i,
    /procedure/i,
    /process/i,
    /apply/i,
    /application/i,
    /requirements?/i,
    /documents?[-_]?(?:need|require|list)/i,
    /fee[s]?(?:[-_]|$)/i,
    /payment/i,
    /eligibility/i,
    /faq/i,
    /frequently[-_]?asked/i,
    /help/i,
    /support/i,
    // Bengali equivalents
    /নির্দেশনা/,             // instructions
    /আবেদন[-_]?পদ্ধতি/,      // application procedure
    /প্রয়োজনীয়[-_]?কাগজপত্র/, // required documents
    /ফি/,                    // fee
    /সাহায্য/,               // help
  ],
  
  // High priority - important service-related
  high: [
    /download/i,
    /form/i,
    /template/i,
    /timeline/i,
    /processing[-_]?time/i,
    /delivery/i,
    /status/i,
    /track/i,
    /schedule/i,
    /appointment/i,
    /booking/i,
    /tutorial/i,
    /steps?/i,
    /checklist/i,
    /service/i,
    /portal/i,
    /online/i,
    /e[-_]?passport/i,
    /e[-_]?service/i,
    /citizen/i,
    /public/i,
    // Bengali
    /ডাউনলোড/,    // download
    /ফরম/,        // form
    /সময়সীমা/,    // timeline
    /অবস্থা/,      // status
  ],
  
  // Medium priority - useful supplementary
  medium: [
    /about/i,
    /overview/i,
    /info/i,
    /contact/i,
    /office/i,
    /location/i,
    /branch/i,
    /center/i,
    /centre/i,
    /hotline/i,
    /helpline/i,
    /notice/i,         // Sometimes has important updates
    /circular/i,       // Sometimes has requirements/fees
    /announcement/i,
    // Bengali
    /যোগাযোগ/,    // contact
    /অফিস/,       // office
    /শাখা/,       // branch
    /নোটিশ/,      // notice
  ],
  
  // Low priority but keep (penalty applied)
  low: [
    /archive/i,
    /history/i,
    /past/i,
    /old/i,
    /previous/i,
  ],
  
  // Exclude completely
  exclude: [
    /press[-_]?release/i,
    /news(?:[-_]|$)/i,
    /tender/i,
    /job/i,
    /career/i,
    /vacancy/i,
    /recruitment/i,
    /event/i,
    /gallery/i,
    /photo/i,
    /image/i,
    /video/i,
    /media/i,
    /blog/i,
    /article/i,
    /award/i,
    /achievement/i,
    /rti/i,                  // Right to Information (not service-related)
    /grievance/i,
    /complaint/i,
    /feedback/i,
    /survey/i,
    /login/i,               // Login pages aren't content
    /register(?:[-_]|$)/i,  // Registration forms
    /signin/i,
    /signup/i,
    /logout/i,
    /password/i,
    /forgot/i,
    /reset/i,
    /verify[-_]?email/i,
    /activation/i,
    /print/i,              // Print versions
    /share/i,
    /social/i,
    /facebook/i,
    /twitter/i,
    /youtube/i,
    /sitemap/i,
    /rss/i,
    /feed/i,
    /api\//i,
    /ajax/i,
    /json/i,
    /xml/i,
    /\.js$/i,
    /\.css$/i,
    /\.png$/i,
    /\.jpg$/i,
    /\.gif$/i,
    /\.svg$/i,
    // Bengali
    /সংবাদ/,      // news
    /প্রেস/,       // press
    /ছবি/,        // photo
  ],
};

// ============================================================================
// URL PRIORITIZATION
// ============================================================================

/**
 * Calculate priority score for a URL
 * @param {string} url - URL to score
 * @returns {number} - Priority score (-999 means exclude, higher = better)
 */
function getUrlPriority(url) {
  const lower = url.toLowerCase();
  
  // Check exclusions first
  for (const pattern of PRIORITY_PATTERNS.exclude) {
    if (pattern.test(lower)) {
      return PRIORITY_WEIGHTS.exclude;
    }
  }
  
  let priority = 0;
  
  // Check very high priority patterns
  for (const pattern of PRIORITY_PATTERNS.very_high) {
    if (pattern.test(lower)) {
      priority += PRIORITY_WEIGHTS.very_high;
    }
  }
  
  // Check high priority patterns
  for (const pattern of PRIORITY_PATTERNS.high) {
    if (pattern.test(lower)) {
      priority += PRIORITY_WEIGHTS.high;
    }
  }
  
  // Check medium priority patterns
  for (const pattern of PRIORITY_PATTERNS.medium) {
    if (pattern.test(lower)) {
      priority += PRIORITY_WEIGHTS.medium;
    }
  }
  
  // Apply penalty for low priority
  for (const pattern of PRIORITY_PATTERNS.low) {
    if (pattern.test(lower)) {
      priority += PRIORITY_WEIGHTS.penalty;
    }
  }
  
  // Bonus for short, clean URLs (likely main content pages)
  try {
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/').filter(s => s);
    if (pathSegments.length <= 2) {
      priority += 2; // Bonus for shallow pages
    }
    if (pathSegments.length === 1) {
      priority += 3; // Extra bonus for top-level pages
    }
  } catch (e) {
    // Invalid URL, no bonus
  }
  
  return priority;
}

/**
 * Sort URLs by priority (highest first)
 * @param {string[]} urls - Array of URLs
 * @returns {string[]} - Sorted and filtered URLs
 */
function sortUrlsByPriority(urls) {
  return urls
    .map(url => ({ url, priority: getUrlPriority(url) }))
    .filter(item => item.priority > PRIORITY_WEIGHTS.exclude)  // Exclude negative priority
    .sort((a, b) => {
      // Sort by priority descending, then by URL length (shorter first)
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.url.length - b.url.length;
    })
    .map(item => item.url);
}

/**
 * Get URL depth (number of path segments)
 * @param {string} urlStr - URL string
 * @param {string} [baseDomain] - Base domain (unused, for API compat)
 * @returns {number} - Path depth
 */
function getUrlDepth(urlStr, baseDomain) {
  try {
    const url = new URL(urlStr);
    const pathParts = url.pathname.split('/').filter(p => p.length > 0);
    return pathParts.length;
  } catch (e) {
    return 999;
  }
}

/**
 * Check if URL is likely a document/download page
 * @param {string} url - URL to check
 * @returns {boolean}
 */
function isDocumentPage(url) {
  const lower = url.toLowerCase();
  return /\.(pdf|docx?|xlsx?|pptx?)(\?|$)/i.test(lower) ||
         /download|attachment|circular|notice|form/i.test(lower);
}

/**
 * Check if URL is likely a service content page
 * @param {string} url - URL to check
 * @returns {boolean}
 */
function isServicePage(url) {
  const score = getUrlPriority(url);
  return score >= PRIORITY_WEIGHTS.high;
}

// ============================================================================
// ROBOTS.TXT PARSING
// ============================================================================

/**
 * Parse robots.txt content
 * @param {string} content - robots.txt file content
 * @param {string} [userAgent='*'] - User agent to match
 * @returns {{disallow: string[], allow: string[], sitemaps: string[]}}
 */
function parseRobotsTxt(content, userAgent = '*') {
  const rules = {
    disallow: [],
    allow: [],
    sitemaps: [],
  };
  
  if (!content) return rules;
  
  const lines = content.split('\n');
  let currentAgent = null;
  let appliesToUs = false;
  
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    
    const directive = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();
    
    if (directive === 'user-agent') {
      currentAgent = value.toLowerCase();
      appliesToUs = (currentAgent === '*' || currentAgent === userAgent.toLowerCase());
    } else if (directive === 'sitemap') {
      rules.sitemaps.push(value);
    } else if (appliesToUs) {
      if (directive === 'disallow' && value) {
        rules.disallow.push(value);
      } else if (directive === 'allow' && value) {
        rules.allow.push(value);
      }
    }
  }
  
  return rules;
}

/**
 * Check if a path is allowed by robots.txt rules
 * @param {string} urlPath - URL pathname
 * @param {{disallow: string[], allow: string[]}} robotsRules - Parsed rules
 * @returns {boolean} - True if allowed
 */
function isPathAllowed(urlPath, robotsRules) {
  // Check allow rules first (they have priority)
  for (const allow of robotsRules.allow) {
    if (urlPath.startsWith(allow)) {
      return true;
    }
  }
  
  // Check disallow rules
  for (const disallow of robotsRules.disallow) {
    if (urlPath.startsWith(disallow)) {
      return false;
    }
  }
  
  return true;  // Default: allowed
}

// ============================================================================
// SITEMAP PARSING
// ============================================================================

/**
 * Parse sitemap XML content
 * @param {string} content - Sitemap XML content
 * @returns {{type: 'index'|'urlset', sitemaps?: string[], urls?: string[]}}
 */
function parseSitemapXml(content) {
  const urls = [];
  
  if (!content) return { type: 'urlset', urls };
  
  // Handle sitemap index
  const sitemapIndexMatches = content.matchAll(/<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<\/sitemap>/gi);
  const sitemapUrls = [];
  for (const match of sitemapIndexMatches) {
    sitemapUrls.push(match[1].trim());
  }
  
  if (sitemapUrls.length > 0) {
    return { type: 'index', sitemaps: sitemapUrls };
  }
  
  // Handle regular sitemap
  const urlMatches = content.matchAll(/<url>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<\/url>/gi);
  for (const match of urlMatches) {
    urls.push(match[1].trim());
  }
  
  return { type: 'urlset', urls };
}

module.exports = {
  PRIORITY_PATTERNS,
  PRIORITY_WEIGHTS,
  getUrlPriority,
  sortUrlsByPriority,
  getUrlDepth,
  isDocumentPage,
  isServicePage,
  parseRobotsTxt,
  isPathAllowed,
  parseSitemapXml,
};
