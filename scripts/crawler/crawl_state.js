/**
 * Crawl State Management Module
 * 
 * Handles loading, saving, and managing crawl state across sessions.
 * 
 * @module crawler/crawl_state
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function generateHash(content, algorithm = 'sha256') {
  return crypto.createHash(algorithm).update(content, 'utf8').digest('hex');
}

function generateSourcePageId(url) {
  return `source.${generateHash(url, 'sha1')}`;
}

function getDateString() {
  return new Date().toISOString().split('T')[0];
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ============================================================================
// CRAWL STATE MANAGEMENT
// ============================================================================

/**
 * Load crawl state from file
 * @param {string} stateFile - Path to state file
 * @returns {Object} - Crawl state
 */
function loadCrawlState(stateFile) {
  if (fs.existsSync(stateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      // Ensure all required fields
      return {
        startedAt: state.startedAt || new Date().toISOString(),
        lastUpdated: state.lastUpdated || new Date().toISOString(),
        domainStates: state.domainStates || {},
        pageHashes: state.pageHashes || {},
        documentHashes: state.documentHashes || {},
        runs: state.runs || [],
      };
    } catch (e) {
      console.warn('⚠️  Failed to load crawl state, starting fresh');
    }
  }
  
  return {
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    domainStates: {},
    pageHashes: {},
    documentHashes: {},
    runs: [],
  };
}

/**
 * Save crawl state to file
 * @param {Object} state - Crawl state
 * @param {string} stateFile - Path to state file
 */
function saveCrawlState(state, stateFile) {
  state.lastUpdated = new Date().toISOString();
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Get or create domain state
 * @param {Object} state - Crawl state
 * @param {string} domain - Domain name
 * @returns {Object} - Domain state
 */
function getDomainState(state, domain) {
  if (!state.domainStates[domain]) {
    state.domainStates[domain] = {
      lastCrawled: null,
      pagesCrawled: 0,
      robotsRules: null,
      sitemapUrls: [],
      discoveredUrls: [],
      processedUrls: [],
      excludedUrls: [],
      errors: [],
    };
  }
  return state.domainStates[domain];
}

// ============================================================================
// SNAPSHOT MANAGEMENT
// ============================================================================

/**
 * Save a page snapshot
 * @param {string} sourcePageId - Source page ID
 * @param {string} url - Page URL
 * @param {string} html - HTML content
 * @param {string} markdown - Markdown content
 * @param {string} snapshotsDir - Snapshots directory
 * @returns {{snapshotRef: string, contentHash: string}}
 */
function saveSnapshot(sourcePageId, url, html, markdown, snapshotsDir) {
  const date = getDateString();
  const snapshotPath = path.join(snapshotsDir, sourcePageId, date);
  
  ensureDir(snapshotPath);
  
  if (html) {
    fs.writeFileSync(path.join(snapshotPath, 'page.html'), html, 'utf-8');
  }
  
  fs.writeFileSync(path.join(snapshotPath, 'page.md'), markdown, 'utf-8');
  
  const contentHash = generateHash(markdown);
  
  const meta = {
    canonical_url: url,
    source_page_id: sourcePageId,
    fetched_at: new Date().toISOString(),
    content_hash_sha256: contentHash,
    snapshot_date: date,
  };
  fs.writeFileSync(path.join(snapshotPath, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
  
  return {
    snapshotRef: `snapshots/${sourcePageId}/${date}`,
    contentHash,
  };
}

/**
 * Check if a snapshot exists for today
 * @param {string} sourcePageId - Source page ID
 * @param {string} snapshotsDir - Snapshots directory
 * @returns {boolean}
 */
function snapshotExistsToday(sourcePageId, snapshotsDir) {
  const date = getDateString();
  const metaPath = path.join(snapshotsDir, sourcePageId, date, 'meta.json');
  return fs.existsSync(metaPath);
}

/**
 * Get existing content hash for a source page
 * @param {string} sourcePageId - Source page ID
 * @param {Object} state - Crawl state
 * @returns {string|null} - Content hash or null
 */
function getExistingHash(sourcePageId, state) {
  return state.pageHashes[sourcePageId] || null;
}

module.exports = {
  generateHash,
  generateSourcePageId,
  getDateString,
  ensureDir,
  loadCrawlState,
  saveCrawlState,
  getDomainState,
  saveSnapshot,
  snapshotExistsToday,
  getExistingHash,
};

