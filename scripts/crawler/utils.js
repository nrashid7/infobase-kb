/**
 * Shared Utility Functions
 * 
 * Consolidated utilities used across crawler modules.
 * These functions are byte-for-byte equivalent to their original implementations.
 * 
 * @module crawler/utils
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

// ============================================================================
// HASHING FUNCTIONS
// ============================================================================

/**
 * Generate a hash of content
 * @param {string|Buffer} content - Content to hash
 * @param {string} [algorithm='sha256'] - Hash algorithm
 * @returns {string} - Hex-encoded hash
 */
function generateHash(content, algorithm = 'sha256') {
  return crypto.createHash(algorithm).update(content, 'utf8').digest('hex');
}

/**
 * Generate a source page ID from URL
 * @param {string} url - Page URL
 * @returns {string} - Source page ID in format "source.<sha1hash>"
 */
function generateSourcePageId(url) {
  return `source.${generateHash(url, 'sha1')}`;
}

// ============================================================================
// DETERMINISTIC CLAIM ID GENERATION
// ============================================================================

/**
 * Normalize text for fingerprinting: trim, collapse whitespace, lowercase
 * @param {string} text - Text to normalize
 * @returns {string} - Normalized text
 */
function normalizeForFingerprint(text) {
  if (!text) return '';
  return String(text)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Generate a deterministic payload fingerprint for claim ID generation.
 * 
 * Fingerprint rules (keep simple & stable, no behavior drift):
 * - steps: normalize(title + "\n" + description)
 * - fees: normalize(label + "\n" + amount + "\n" + currency + "\n" + variant if present)
 * - faq: normalize(question + "\n" + answer)
 * - documents: normalize(url + "\n" + title if present)
 * 
 * @param {string} claimType - Type of claim: 'step', 'fee', 'faq', 'document_requirement'
 * @param {Object} payload - Claim structured_data payload
 * @returns {string} - Normalized payload fingerprint
 */
function generatePayloadFingerprint(claimType, payload) {
  if (!payload) return '';
  
  let parts = [];
  
  switch (claimType) {
    case 'step':
      parts.push(payload.title || '');
      parts.push(payload.description || '');
      break;
      
    case 'fee':
      parts.push(payload.label || '');
      parts.push(String(payload.amount_bdt || ''));
      parts.push(payload.currency || '');
      if (payload.variant) {
        parts.push(payload.variant);
      }
      break;
      
    case 'faq':
      parts.push(payload.question || '');
      parts.push(payload.answer || '');
      break;
      
    case 'document_requirement':
      parts.push(payload.url || '');
      if (payload.text) {
        parts.push(payload.text);
      }
      break;
      
    default:
      // Fallback: JSON stringify the payload (sorted keys for stability)
      parts.push(JSON.stringify(payload, Object.keys(payload).sort()));
  }
  
  return normalizeForFingerprint(parts.join('\n'));
}

/**
 * Generate a deterministic claim ID that is stable across runs.
 * 
 * Format: claim.<type>.<serviceKey>.<sha1(...)>
 * 
 * SHA1 input includes:
 * - canonicalUrl
 * - claim type
 * - locator (if present; else empty string)
 * - normalized payload fingerprint
 * 
 * @param {Object} options - Options for claim ID generation
 * @param {string} options.type - Claim type: 'step', 'fee', 'faq', 'document_requirement'
 * @param {string} options.serviceKey - Service key prefix (e.g., 'epassport')
 * @param {string} options.canonicalUrl - Canonical URL of the source page
 * @param {string} [options.locator=''] - Locator string (heading path, line number, etc.)
 * @param {Object} options.payload - Claim structured_data payload
 * @returns {string} - Deterministic claim ID
 */
function makeDeterministicClaimId({ type, serviceKey, canonicalUrl, locator = '', payload }) {
  // Build the hash input
  const payloadFingerprint = generatePayloadFingerprint(type, payload);
  
  const hashInput = [
    canonicalUrl || '',
    type || '',
    locator || '',
    payloadFingerprint,
  ].join('\n');
  
  // Generate SHA1 hash (first 16 chars for reasonable uniqueness while keeping IDs readable)
  const hash = generateHash(hashInput, 'sha1').substring(0, 16);
  
  return `claim.${type}.${serviceKey}.${hash}`;
}

// ============================================================================
// FILE SYSTEM UTILITIES
// ============================================================================

/**
 * Ensure a directory exists, creating it recursively if necessary
 * @param {string} dirPath - Directory path to ensure
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ============================================================================
// DATE UTILITIES
// ============================================================================

/**
 * Get current date as ISO string (YYYY-MM-DD)
 * @returns {string} - Date string in YYYY-MM-DD format
 */
function getDateString() {
  return new Date().toISOString().split('T')[0];
}

// ============================================================================
// URL UTILITIES
// ============================================================================

/**
 * Get domain from URL
 * @param {string} urlStr - URL string
 * @returns {string|null} - Domain (hostname) or null if invalid
 */
function getDomain(urlStr) {
  try {
    return new URL(urlStr).hostname.toLowerCase();
  } catch (e) {
    return null;
  }
}

// ============================================================================
// ASYNC UTILITIES
// ============================================================================

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// MIME TYPE UTILITIES
// ============================================================================

/**
 * MIME type mapping for document extensions
 */
const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/**
 * Get MIME type from file extension
 * @param {string} extension - File extension (with or without leading dot)
 * @returns {string} - MIME type or 'application/octet-stream' if unknown
 */
function getMimeType(extension) {
  const ext = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  return MIME_TYPES[ext] || 'application/octet-stream';
}

// ============================================================================
// HTTP DOWNLOAD (CANONICAL IMPLEMENTATION)
// ============================================================================

/**
 * HTTP download function - canonical implementation
 * 
 * This is the single source of truth for HTTP downloads.
 * Used as fallback when Firecrawl cannot fetch binary content.
 * 
 * @param {string} url - URL to download
 * @param {Object} [options] - Download options
 * @param {number} [options.timeout=60000] - Request timeout in ms
 * @param {number} [options.maxFileSize=52428800] - Maximum file size (50MB default)
 * @param {string} [options.userAgent] - User-Agent header
 * @returns {Promise<Buffer>} - Downloaded content as Buffer
 */
async function httpDownload(url, options = {}) {
  const https = require('https');
  const http = require('http');
  
  const timeout = options.timeout || 60000;
  const maxFileSize = options.maxFileSize || 50 * 1024 * 1024; // 50MB
  const userAgent = options.userAgent || 'Mozilla/5.0 (compatible; InfobaseBot/1.0; +https://infobase.gov.bd)';
  
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const request = protocol.get(url, {
      timeout,
      headers: {
        'User-Agent': userAgent,
      },
    }, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirectUrl = new URL(response.headers.location, url).href;
        httpDownload(redirectUrl, options).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }
      
      // Check content length
      const contentLength = parseInt(response.headers['content-length'], 10);
      if (contentLength > maxFileSize) {
        reject(new Error(`File too large: ${contentLength} bytes (max: ${maxFileSize})`));
        return;
      }
      
      const chunks = [];
      let totalLength = 0;
      
      response.on('data', (chunk) => {
        totalLength += chunk.length;
        if (totalLength > maxFileSize) {
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
// EXPORTS
// ============================================================================

module.exports = {
  // Hashing
  generateHash,
  generateSourcePageId,
  
  // Deterministic claim IDs
  normalizeForFingerprint,
  generatePayloadFingerprint,
  makeDeterministicClaimId,
  
  // File system
  ensureDir,
  
  // Date
  getDateString,
  
  // URL
  getDomain,
  
  // Async
  sleep,
  
  // MIME types
  MIME_TYPES,
  getMimeType,
  
  // HTTP download
  httpDownload,
};

