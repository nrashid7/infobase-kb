/**
 * Agent-Orchestrated Crawl Pilot - Helper Functions
 * 
 * This script provides helper functions for the agent-orchestrated crawl workflow.
 * The actual orchestration happens via Firecrawl MCP tools called by the agent.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

// Import extraction logic from crawl.js
const crawlModule = require('./crawl');

// URL Priority patterns (from crawl.js)
const PRIORITY_PATTERNS = {
  high: [
    /apply/i, /application/i, /procedure/i, /process/i, /steps?/i,
    /guide/i, /instruction/i, /requirements?/i, /documents?/i,
    /fees?/i, /payment/i, /faq/i, /help/i, /track/i, /status/i,
    /form/i, /download/i, /eligibility/i, /how-to/i, /tutorial/i,
  ],
  low: [
    /notice/i,  // Sometimes has fees/requirements
  ],
  exclude: [
    /press[-_]?release/i, /news/i, /tender/i, /job/i, /career/i,
    /vacancy/i, /event/i, /gallery/i, /media/i, /photo/i, /video/i,
    /blog/i, /article/i, /archive/i, /circular/i, /recruitment/i,
  ],
};

function getDomain(urlStr) {
  try {
    return new URL(urlStr).hostname.toLowerCase();
  } catch (e) {
    return null;
  }
}

function getUrlDepth(urlStr) {
  try {
    const url = new URL(urlStr);
    const pathParts = url.pathname.split('/').filter(p => p.length > 0);
    return pathParts.length;
  } catch (e) {
    return 999;
  }
}

function getUrlPriority(url) {
  const lower = url.toLowerCase();
  
  // Check exclusions first
  for (const pattern of PRIORITY_PATTERNS.exclude) {
    if (pattern.test(lower)) {
      return -1;  // Strongly exclude
    }
  }
  
  // Check high priority
  let priority = 0;
  for (const pattern of PRIORITY_PATTERNS.high) {
    if (pattern.test(lower)) {
      priority += 10;
    }
  }
  
  // Check low priority (de-prioritize but don't exclude)
  for (const pattern of PRIORITY_PATTERNS.low) {
    if (pattern.test(lower)) {
      priority -= 2;
    }
  }
  
  return priority;
}

function filterAndPrioritizeUrls(urls, targetDomain, maxDepth = 3, maxPages = 30) {
  // Extract URLs from map result (handle both array of strings and array of objects)
  const urlList = urls.map(item => typeof item === 'string' ? item : item.url || item.link);
  
  // Filter by domain
  const domainFiltered = urlList.filter(url => {
    const domain = getDomain(url);
    if (!domain) return false;
    // Allow both www.epassport.gov.bd and epassport.gov.bd
    return domain === targetDomain || domain === `www.${targetDomain}` || domain.replace(/^www\./, '') === targetDomain;
  });
  
  // Filter by depth
  const depthFiltered = domainFiltered.filter(url => getUrlDepth(url) <= maxDepth);
  
  // Remove duplicates
  const uniqueUrls = [...new Set(depthFiltered)];
  
  // Prioritize
  const prioritized = uniqueUrls
    .map(url => ({ url, priority: getUrlPriority(url) }))
    .filter(item => item.priority >= 0)  // Exclude negative priority
    .sort((a, b) => b.priority - a.priority)
    .map(item => item.url)
    .slice(0, maxPages);
  
  return prioritized;
}

module.exports = {
  filterAndPrioritizeUrls,
  getDomain,
  getUrlDepth,
  getUrlPriority,
};

