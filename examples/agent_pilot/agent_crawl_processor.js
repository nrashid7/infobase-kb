/**
 * Agent-Orchestrated Crawl Processor
 * 
 * Processes scraped pages and generates KB v3 structure
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

// Import extraction logic from crawl.js
const crawlModule = require('./crawl');

const PATHS = {
  kbDir: path.join(__dirname, '..', 'kb'),
  snapshotsDir: path.join(__dirname, '..', 'kb', 'snapshots'),
  documentsDir: path.join(__dirname, '..', 'kb', 'snapshots', 'documents'),
  docTextDir: path.join(__dirname, '..', 'kb', 'snapshots', 'doc_text'),
  runsDir: path.join(__dirname, '..', 'kb', 'runs'),
  stateFile: path.join(__dirname, 'crawl_state.json'),
  kbPath: path.join(__dirname, '..', 'kb', 'bangladesh_government_services_kb_v3.json'),
};

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function generateHash(content, algorithm = 'sha256') {
  return crypto.createHash(algorithm).update(content, 'utf8').digest('hex');
}

function generateSourcePageId(url) {
  return `source.${generateHash(url, 'sha1')}`;
}

function getDateString() {
  return new Date().toISOString().split('T')[0];
}

function getDomain(urlStr) {
  try {
    return new URL(urlStr).hostname.toLowerCase();
  } catch (e) {
    return null;
  }
}

/**
 * Process scraped pages and generate KB structure
 */
function processScrapedPages(scrapedPages, domain) {
  const kb = loadOrCreateKB();
  const state = loadCrawlState();
  
  const results = {
    pagesProcessed: 0,
    pagesSaved: 0,
    pagesWithErrors: 0,
    claimsExtracted: 0,
    documentsFound: 0,
    errors: [],
  };
  
  for (const page of scrapedPages) {
    try {
      const url = page.url;
      const markdown = page.markdown || '';
      const html = page.html || '';
      const title = page.metadata?.title || url;
      
      // Skip if no content
      if (!markdown || markdown.trim().length === 0) {
        results.pagesWithErrors++;
        results.errors.push({ url, error: 'No content received' });
        continue;
      }
      
      const sourcePageId = generateSourcePageId(url);
      const contentHash = generateHash(markdown);
      
      // Save snapshot
      const { snapshotRef } = saveSnapshot(sourcePageId, url, html, markdown);
      state.pageHashes[sourcePageId] = contentHash;
      
      // Extract structured data
      const structuredData = crawlModule.extractStructuredData(markdown, url);
      
      // Add to KB
      crawlModule.addOrUpdateSourcePage(kb, {
        url: url,
        domain: domain,
        title: title,
        markdown: markdown,
        contentHash: contentHash,
        snapshotRef: snapshotRef,
      });
      
      // Extract and add claims
      const claims = crawlModule.extractClaims(markdown, sourcePageId, url, structuredData);
      const addedClaims = crawlModule.addClaimsToKB(kb, claims);
      results.claimsExtracted += addedClaims;
      
      // Track documents
      if (structuredData.documentList.length > 0) {
        results.documentsFound += structuredData.documentList.length;
      }
      
      results.pagesProcessed++;
      results.pagesSaved++;
      
    } catch (e) {
      results.pagesWithErrors++;
      results.errors.push({ url: page.url, error: e.message });
    }
  }
  
  // Save KB and state
  crawlModule.saveKB(kb);
  crawlModule.saveCrawlState(state);
  
  return results;
}

function loadOrCreateKB() {
  if (fs.existsSync(PATHS.kbPath)) {
    try {
      return JSON.parse(fs.readFileSync(PATHS.kbPath, 'utf-8'));
    } catch (e) {
      console.warn('Failed to load KB, creating new');
    }
  }
  
  return {
    "$schema_version": "3.0.0",
    "data_version": 1,
    "last_updated_at": new Date().toISOString(),
    "updated_by": "agent:crawl_pilot",
    "change_log": [{
      "version": 1,
      "date": getDateString(),
      "changes": ["Initial agent-orchestrated crawl"]
    }],
    "source_pages": [],
    "claims": [],
    "agencies": [],
    "documents": [],
    "services": [],
    "service_guides": [],
  };
}

function loadCrawlState() {
  if (fs.existsSync(PATHS.stateFile)) {
    try {
      return JSON.parse(fs.readFileSync(PATHS.stateFile, 'utf-8'));
    } catch (e) {
      console.warn('Failed to load crawl state, creating new');
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

function saveSnapshot(sourcePageId, url, html, markdown) {
  const date = getDateString();
  const snapshotPath = path.join(PATHS.snapshotsDir, sourcePageId, date);
  
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

module.exports = {
  processScrapedPages,
  loadOrCreateKB,
  loadCrawlState,
  PATHS,
};

