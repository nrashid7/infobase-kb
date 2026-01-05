/**
 * Bangladesh Government Services KB - Document Harvester
 * 
 * Downloads and processes documents (PDF, DOC, DOCX, XLS, etc.)
 * from government websites and extracts text for indexing.
 * 
 * Features:
 * - Downloads documents with deduplication by content hash
 * - Extracts text from PDFs using pdf-parse
 * - Stores document metadata with provenance
 * - Supports incremental updates
 * - Uses Firecrawl MCP for document fetching (strict mode)
 * 
 * Usage:
 *   const harvester = require('./document_harvester');
 *   await harvester.downloadAndProcess(docUrl, domain, state);
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

// Firecrawl MCP integration
const firecrawlMcp = require('./firecrawl_mcp');

// ============================================================================
// OPTIONAL DEPENDENCY LOADER
// ============================================================================

/**
 * Safely require an optional dependency
 * Returns null if the module is not installed
 * @param {string} moduleName - The module to require
 * @returns {any|null} - The module or null if not available
 */
function optionalRequire(moduleName) {
  try {
    return require(moduleName);
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      return null;
    }
    throw e; // Re-throw unexpected errors
  }
}

// Pre-load optional dependencies (null if not installed)
const pdfParse = optionalRequire('pdf-parse');
const mammoth = optionalRequire('mammoth');
const XLSX = optionalRequire('xlsx');

// Log optional dependency status at load time
if (!pdfParse) console.log('ℹ️  pdf-parse not installed (PDF text extraction disabled)');
if (!mammoth) console.log('ℹ️  mammoth not installed (Word text extraction disabled)');
if (!XLSX) console.log('ℹ️  xlsx not installed (Excel text extraction disabled)');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  documentsDir: path.join(__dirname, '..', 'kb', 'snapshots', 'documents'),
  docTextDir: path.join(__dirname, '..', 'kb', 'snapshots', 'doc_text'),
  maxFileSize: 50 * 1024 * 1024,  // 50MB max
  downloadTimeout: 60000,  // 60 seconds
  supportedExtensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'],
};

// ============================================================================
// MIME TYPE MAPPING
// ============================================================================

const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function generateHash(content, algorithm = 'sha256') {
  return crypto.createHash(algorithm).update(content).digest('hex');
}

function getExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).toLowerCase();
    return ext || '.pdf';  // Default to PDF if no extension
  } catch (e) {
    return '.pdf';
  }
}

function getMimeType(extension) {
  return MIME_TYPES[extension.toLowerCase()] || 'application/octet-stream';
}

function getDateString() {
  return new Date().toISOString().split('T')[0];
}

// ============================================================================
// DOCUMENT DOWNLOAD (FIRECRAWL MCP-BASED)
// ============================================================================

/**
 * Download result with fetch method tracking
 * @typedef {Object} DownloadResult
 * @property {Buffer} buffer - The downloaded file content
 * @property {string} fetched_via - "firecrawl" | "http_fallback"
 * @property {string} [contentType] - MIME type from response
 */

/**
 * Download a file from URL using Firecrawl MCP
 * 
 * This function uses the firecrawl_mcp module which:
 * 1. Tries Firecrawl MCP first for consistent behavior in Cursor
 * 2. Only falls back to HTTP if --allow-http-doc-download is set
 * 3. Throws errors loudly if required mode is enabled and download fails
 * 
 * @param {string} url - The URL to download from
 * @param {Object} [options] - Download options
 * @param {boolean} [options.allowHttpFallback] - Override global HTTP fallback setting
 * @returns {Promise<DownloadResult>} - The downloaded file with fetch method
 * @throws {FirecrawlUnavailableError} if Firecrawl required but unavailable
 * @throws {HttpDownloadNotAllowedError} if HTTP fallback needed but not allowed
 */
async function downloadFile(url, options = {}) {
  console.log(`    📥 Fetching document via Firecrawl MCP: ${url}`);
  
  try {
    const result = await firecrawlMcp.fetchBinary(url, options);
    
    if (!result || !result.buffer) {
      throw new Error('No binary content received from Firecrawl');
    }
    
    // Validate file size
    if (result.buffer.length > CONFIG.maxFileSize) {
      throw new Error(`File too large: ${result.buffer.length} bytes (max: ${CONFIG.maxFileSize})`);
    }
    
    console.log(`    ✓ Downloaded ${result.buffer.length} bytes (${result.contentType})`);
    
    // Return with fetch method tracking
    return {
      buffer: result.buffer,
      fetched_via: result.usedHttpFallback ? 'http_fallback' : 'firecrawl',
      contentType: result.contentType,
    };
    
  } catch (error) {
    // Re-throw Firecrawl-specific errors
    if (error instanceof firecrawlMcp.FirecrawlUnavailableError ||
        error instanceof firecrawlMcp.HttpDownloadNotAllowedError) {
      throw error;
    }
    
    // Wrap other errors with context
    throw new Error(`Document download failed for ${url}: ${error.message}`);
  }
}

/**
 * Legacy HTTP download function - DEPRECATED
 * Only used as internal fallback when explicitly allowed via --allow-http-doc-download
 * 
 * @deprecated Use downloadFile() which routes through Firecrawl MCP
 * @private
 */
function httpDownloadLegacy(url) {
  const https = require('https');
  const http = require('http');
  
  console.warn('    ⚠️  Using legacy HTTP download (deprecated)');
  
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const request = protocol.get(url, {
      timeout: CONFIG.downloadTimeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; InfobaseBot/1.0; +https://infobase.gov.bd)',
      },
    }, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirectUrl = new URL(response.headers.location, url).href;
        httpDownloadLegacy(redirectUrl).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }
      
      // Check content length
      const contentLength = parseInt(response.headers['content-length'], 10);
      if (contentLength > CONFIG.maxFileSize) {
        reject(new Error(`File too large: ${contentLength} bytes`));
        return;
      }
      
      const chunks = [];
      let totalLength = 0;
      
      response.on('data', (chunk) => {
        totalLength += chunk.length;
        if (totalLength > CONFIG.maxFileSize) {
          request.destroy();
          reject(new Error('File too large'));
          return;
        }
        chunks.push(chunk);
      });
      
      response.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      
      response.on('error', reject);
    });
    
    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Download timeout'));
    });
  });
}

// ============================================================================
// PDF TEXT EXTRACTION
// ============================================================================

/**
 * Extract text from PDF buffer
 * Uses pdf-parse if available, otherwise returns empty string
 * @param {Buffer} pdfBuffer - The PDF file as a buffer
 * @returns {Promise<{text: string, metadata: Object}>} - Extracted text and metadata
 */
async function extractPdfText(pdfBuffer) {
  if (!pdfParse) {
    console.log('    ⚠️  pdf-parse not installed - binary saved, text extraction skipped');
    return { text: '', metadata: { error: 'pdf-parse not installed', binary_saved: true } };
  }
  
  try {
    const data = await pdfParse(pdfBuffer, {
      // Limit to first 100 pages to avoid memory issues
      max: 100,
    });
    
    return {
      text: data.text || '',
      metadata: {
        pages: data.numpages || 0,
        info: data.info || {},
        version: data.version || null,
      },
    };
  } catch (e) {
    console.log(`    ⚠️  PDF extraction failed: ${e.message} - binary saved`);
    return { text: '', metadata: { error: e.message, binary_saved: true } };
  }
}

/**
 * Extract text from Word document buffer
 * Uses mammoth if available
 * @param {Buffer} buffer - The document buffer
 * @returns {Promise<{text: string, metadata: Object}>}
 */
async function extractWordText(buffer) {
  if (!mammoth) {
    console.log('    ⚠️  mammoth not installed - binary saved, text extraction skipped');
    return { text: '', metadata: { error: 'mammoth not installed', binary_saved: true } };
  }
  
  try {
    const result = await mammoth.extractRawText({ buffer });
    return {
      text: result.value || '',
      metadata: {
        messages: result.messages || [],
      },
    };
  } catch (e) {
    console.log(`    ⚠️  Word extraction failed: ${e.message} - binary saved`);
    return { text: '', metadata: { error: e.message, binary_saved: true } };
  }
}

/**
 * Extract text from Excel document buffer
 * Uses xlsx if available
 * @param {Buffer} buffer - The document buffer
 * @returns {Promise<{text: string, metadata: Object}>}
 */
async function extractExcelText(buffer) {
  if (!XLSX) {
    console.log('    ⚠️  xlsx not installed - binary saved, text extraction skipped');
    return { text: '', metadata: { error: 'xlsx not installed', binary_saved: true } };
  }
  
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    let text = '';
    const sheetNames = workbook.SheetNames;
    
    for (const sheetName of sheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      text += `\n=== Sheet: ${sheetName} ===\n${csv}\n`;
    }
    
    return {
      text: text.trim(),
      metadata: {
        sheets: sheetNames.length,
        sheetNames,
      },
    };
  } catch (e) {
    console.log(`    ⚠️  Excel extraction failed: ${e.message} - binary saved`);
    return { text: '', metadata: { error: e.message, binary_saved: true } };
  }
}

/**
 * Extract text from a document based on its type
 * @param {Buffer} buffer - The document buffer
 * @param {string} extension - The file extension
 * @returns {Promise<{text: string, metadata: Object}>} - Extracted text and metadata
 */
async function extractDocumentText(buffer, extension) {
  switch (extension.toLowerCase()) {
    case '.pdf':
      return await extractPdfText(buffer);
    case '.doc':
    case '.docx':
      return await extractWordText(buffer);
    case '.xls':
    case '.xlsx':
      return await extractExcelText(buffer);
    case '.ppt':
    case '.pptx':
      // PowerPoint extraction would need additional library
      console.log('    ⚠️  PowerPoint text extraction not implemented');
      return { text: '', metadata: { error: 'not implemented' } };
    default:
      return { text: '', metadata: { error: 'unsupported format' } };
  }
}

// ============================================================================
// DOCUMENT HARVESTER
// ============================================================================

/**
 * Document metadata structure
 * @typedef {Object} DocumentMeta
 * @property {string} url - Original URL
 * @property {string} filename - Local filename
 * @property {string} mime - MIME type
 * @property {string} hash - Content hash
 * @property {string} retrieved_at - ISO timestamp
 * @property {string} discovered_on_page - Source page URL
 * @property {string} [text_path] - Path to extracted text
 * @property {number} [text_length] - Length of extracted text
 */

/**
 * Download and process a document
 * 
 * Uses Firecrawl MCP for fetching (strict mode by default).
 * In strict mode, throws errors instead of returning null on failure.
 * 
 * @param {string} docUrl - The document URL
 * @param {string} domain - The domain it was found on
 * @param {Object} state - The crawl state object
 * @param {string} discoveredOnPage - URL of the page where doc was found
 * @param {Object} [options] - Download options
 * @param {boolean} [options.throwOnError=false] - Throw instead of returning error object
 * @returns {Promise<DocumentMeta|null>} - Document metadata or null if failed
 * @throws {FirecrawlUnavailableError} if Firecrawl required but unavailable (when throwOnError)
 * @throws {HttpDownloadNotAllowedError} if HTTP fallback needed but not allowed (when throwOnError)
 */
async function downloadAndProcess(docUrl, domain, state, discoveredOnPage, options = {}) {
  const extension = getExtension(docUrl);
  
  if (!CONFIG.supportedExtensions.includes(extension)) {
    console.log(`    ⏭️  Unsupported extension: ${extension}`);
    return null;
  }
  
  // Check if already downloaded (by URL)
  if (state.documentHashes && state.documentHashes[docUrl]) {
    console.log('    ⏭️  Already downloaded');
    return { skipped: true, hash: state.documentHashes[docUrl] };
  }
  
  const domainDir = path.join(CONFIG.documentsDir, domain.replace(/[^a-z0-9.-]/gi, '_'));
  const textDir = path.join(CONFIG.docTextDir, domain.replace(/[^a-z0-9.-]/gi, '_'));
  
  ensureDir(domainDir);
  ensureDir(textDir);
  
  try {
    console.log(`    📥 Downloading: ${docUrl}`);
    
    // Download the file using Firecrawl MCP (returns object with buffer and fetched_via)
    const downloadResult = await downloadFile(docUrl, options);
    const buffer = downloadResult.buffer;
    const fetchedVia = downloadResult.fetched_via || 'firecrawl';
    const contentHash = generateHash(buffer);
    
    // Check if we already have this content (different URL, same file)
    const existingFile = path.join(domainDir, `${contentHash}${extension}`);
    if (fs.existsSync(existingFile)) {
      console.log('    ⏭️  Duplicate content (same hash)');
      state.documentHashes[docUrl] = contentHash;
      return { skipped: true, hash: contentHash, duplicate: true, fetched_via: fetchedVia };
    }
    
    // Save the document
    fs.writeFileSync(existingFile, buffer);
    console.log(`    💾 Saved: ${contentHash}${extension} (via ${fetchedVia})`);
    
    // Extract text
    let textPath = null;
    let textLength = 0;
    let extractionMetadata = {};
    
    const extractionResult = await extractDocumentText(buffer, extension);
    const text = extractionResult.text || '';
    extractionMetadata = extractionResult.metadata || {};
    
    if (text && text.length > 0) {
      textPath = path.join(textDir, `${contentHash}.txt`);
      fs.writeFileSync(textPath, text, 'utf-8');
      textLength = text.length;
      console.log(`    📝 Extracted text: ${textLength} characters`);
    }
    
    // Save metadata with full provenance
    const meta = {
      url: docUrl,
      filename: `${contentHash}${extension}`,
      mime: getMimeType(extension),
      hash: contentHash,
      file_size: buffer.length,
      retrieved_at: new Date().toISOString(),
      discovered_on_page: discoveredOnPage,
      fetched_via: fetchedVia,  // Track fetch method: "firecrawl" | "http_fallback"
      text_path: textPath ? `doc_text/${domain.replace(/[^a-z0-9.-]/gi, '_')}/${contentHash}.txt` : null,
      text_length: textLength,
      extraction_metadata: extractionMetadata,
    };
    
    const metaPath = path.join(domainDir, `${contentHash}.meta.json`);
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
    
    // Update state
    if (!state.documentHashes) state.documentHashes = {};
    state.documentHashes[docUrl] = contentHash;
    
    return meta;
    
  } catch (e) {
    // Check if this is a Firecrawl-specific error that should be thrown
    if (e instanceof firecrawlMcp.FirecrawlUnavailableError ||
        e instanceof firecrawlMcp.HttpDownloadNotAllowedError) {
      console.log(`    ❌ ${e.name}: ${e.message}`);
      
      if (options.throwOnError || firecrawlMcp.getConfig('firecrawlRequired')) {
        throw e;
      }
    }
    
    console.log(`    ❌ Download failed: ${e.message}`);
    return { error: e.message, errorType: e.name || 'Error' };
  }
}

/**
 * Process multiple documents from a list
 * @param {Array<{url: string, text: string}>} documents - List of documents to process
 * @param {string} domain - The domain
 * @param {Object} state - Crawl state
 * @param {string} discoveredOnPage - Source page URL
 * @param {number} rateLimit - Ms between downloads
 * @returns {Promise<Array<DocumentMeta>>} - Array of processed document metadata
 */
async function processDocumentList(documents, domain, state, discoveredOnPage, rateLimit = 1000) {
  const results = [];
  
  for (const doc of documents) {
    const result = await downloadAndProcess(doc.url, domain, state, discoveredOnPage);
    if (result) {
      results.push({ ...result, label: doc.text });
    }
    
    // Rate limit between downloads
    if (documents.indexOf(doc) < documents.length - 1) {
      await new Promise(resolve => setTimeout(resolve, rateLimit));
    }
  }
  
  return results;
}

/**
 * Get document statistics for a domain
 * @param {string} domain - The domain to check
 * @returns {Object} - Statistics object
 */
function getDomainDocStats(domain) {
  const domainDir = path.join(CONFIG.documentsDir, domain.replace(/[^a-z0-9.-]/gi, '_'));
  
  if (!fs.existsSync(domainDir)) {
    return { total: 0, byExtension: {} };
  }
  
  const files = fs.readdirSync(domainDir).filter(f => !f.endsWith('.meta.json'));
  const byExtension = {};
  
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    byExtension[ext] = (byExtension[ext] || 0) + 1;
  }
  
  return {
    total: files.length,
    byExtension,
  };
}

/**
 * List all downloaded documents with metadata
 * @param {string} [domain] - Optional domain filter
 * @returns {Array<DocumentMeta>} - Array of document metadata
 */
function listDocuments(domain = null) {
  const documents = [];
  
  const baseDir = CONFIG.documentsDir;
  if (!fs.existsSync(baseDir)) return documents;
  
  const domains = domain 
    ? [domain.replace(/[^a-z0-9.-]/gi, '_')]
    : fs.readdirSync(baseDir).filter(d => fs.statSync(path.join(baseDir, d)).isDirectory());
  
  for (const d of domains) {
    const domainDir = path.join(baseDir, d);
    if (!fs.existsSync(domainDir)) continue;
    
    const metaFiles = fs.readdirSync(domainDir).filter(f => f.endsWith('.meta.json'));
    
    for (const metaFile of metaFiles) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(domainDir, metaFile), 'utf-8'));
        meta.domain = d;
        documents.push(meta);
      } catch (e) {
        // Skip invalid meta files
      }
    }
  }
  
  return documents;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  CONFIG,
  downloadFile,
  httpDownloadLegacy,  // Deprecated, kept for compatibility
  extractPdfText,
  extractWordText,
  extractExcelText,
  extractDocumentText,
  downloadAndProcess,
  processDocumentList,
  getDomainDocStats,
  listDocuments,
  getExtension,
  getMimeType,
  // Re-export Firecrawl MCP for convenience
  firecrawlMcp,
};

