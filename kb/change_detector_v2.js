/**
 * Change Detection Utility for Source Pages (v2)
 * 
 * Compares current content hash with stored hash to detect changes.
 * When a change is detected, marks dependent claims as stale using the 'status' field.
 * 
 * STANDARDIZED STATUS ENUM: verified | unverified | stale | deprecated | contradicted
 * This module delegates status changes to claim_invalidator.js which writes 'stale'.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { invalidateClaimsForSourceChange, loadClaimsBySourceIndex } = require('./claim_invalidator');
const { 
  createSourceChangeEntry, 
  appendToAuditLog, 
  scriptActor 
} = require('./audit_log');

const SCRIPT_ACTOR = scriptActor('change_detector_v2.js');

class ChangeDetector {
  /**
   * Compute SHA-256 hash of content
   * @param {string} content - The content to hash
   * @returns {string} Hexadecimal hash
   */
  static computeHash(content) {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Normalize content before hashing (removes variable content like timestamps)
   * @param {string} content - Raw HTML/content
   * @returns {string} Normalized content
   */
  static normalizeContent(content) {
    // Remove common variable elements:
    // - Timestamps (ISO 8601, various formats)
    // - Session IDs
    // - Random tokens
    // - Whitespace normalization
    
    let normalized = content;
    
    // Remove timestamps (ISO 8601)
    normalized = normalized.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[Z\+\-]\d{2}:\d{2}/g, '');
    
    // Normalize whitespace
    normalized = normalized.replace(/\s+/g, ' ').trim();
    
    // Remove common dynamic content markers
    normalized = normalized.replace(/data-timestamp="[^"]*"/g, '');
    normalized = normalized.replace(/data-session="[^"]*"/g, '');
    
    return normalized;
  }

  /**
   * Check if a source page has changed by comparing hashes
   * @param {Object} sourcePage - Source page object from KB
   * @param {string} currentContent - Current page content
   * @returns {Object} Change detection result
   */
  static detectChange(sourcePage, currentContent) {
    const normalized = this.normalizeContent(currentContent);
    const currentHash = this.computeHash(normalized);
    const storedHash = sourcePage.content_hash;

    const hasChanged = currentHash !== storedHash;

    return {
      hasChanged,
      currentHash,
      previousHash: storedHash,
      sourcePageId: sourcePage.source_page_id,
      url: sourcePage.canonical_url
    };
  }

  /**
   * Update source page with new hash and log change
   * @param {Object} sourcePage - Source page object (will be modified)
   * @param {string} newHash - New content hash
   * @param {string} timestamp - ISO 8601 timestamp
   */
  static updateSourcePageHash(sourcePage, newHash, timestamp) {
    if (sourcePage.content_hash && sourcePage.content_hash !== newHash) {
      // Log the change
      if (!sourcePage.change_log) {
        sourcePage.change_log = [];
      }
      
      sourcePage.change_log.push({
        detected_at: timestamp,
        hash_before: sourcePage.content_hash,
        hash_after: newHash,
        notes: 'Content hash changed - dependent claims need re-verification'
      });
      
      // Update previous hash
      sourcePage.previous_hash = sourcePage.content_hash;
    }
    
    sourcePage.content_hash = newHash;
    sourcePage.last_crawled_at = timestamp;
  }

  /**
   * Process a changed source page and update KB accordingly
   * @param {Object} kbData - Full KB data object (will be modified)
   * @param {string} sourcePageId - ID of the source page that changed
   * @param {string} newContent - New content from the source page
   * @param {string} timestamp - ISO 8601 timestamp
   * @param {Object} [claimsBySourceIndex] - Optional pre-built index: { source_page_id: [claim_ids] }
   * @returns {Object} Result object with summary
   */
  static processSourceChange(kbData, sourcePageId, newContent, timestamp, claimsBySourceIndex = null) {
    // Find the source page
    const sourcePage = kbData.source_pages?.find(sp => sp.source_page_id === sourcePageId);
    if (!sourcePage) {
      throw new Error(`Source page not found: ${sourcePageId}`);
    }
    
    // Compute hash
    const normalized = this.normalizeContent(newContent);
    const currentHash = this.computeHash(normalized);
    
    // Check if changed
    const hasChanged = currentHash !== sourcePage.content_hash;
    
    if (!hasChanged) {
      return {
        changed: false,
        message: `Source page ${sourcePageId} has not changed`,
        sourcePageId
      };
    }
    
    // Store previous hash before update
    const previousHash = sourcePage.content_hash;
    
    // Create a snapshot of the KB before update (for invalidation comparison)
    const oldKB = JSON.parse(JSON.stringify(kbData));
    
    // Update source page hash fields + change_log
    this.updateSourcePageHash(sourcePage, currentHash, timestamp);
    
    // Log source_change audit event
    const sourceChangeEntry = createSourceChangeEntry({
      sourcePageIds: [sourcePageId],
      actor: SCRIPT_ACTOR,
      hashBefore: previousHash,
      hashAfter: currentHash,
      description: `Source page content changed: ${sourcePage.canonical_url}`
    });
    appendToAuditLog(kbData, sourceChangeEntry);
    
    // Invalidate claims for source change (all claim dependency logic is in claim_invalidator.js)
    // This will also add a claim_invalidation audit entry if claims are affected
    // Pass index if available for O(1) lookup instead of O(C) claim scanning
    const invalidationResult = invalidateClaimsForSourceChange(oldKB, kbData, null, claimsBySourceIndex);
    
    // Return summary
    return {
      changed: true,
      sourcePageId,
      previousHash: previousHash,
      newHash: currentHash,
      invalidatedClaims: invalidationResult.invalidatedClaims.map(c => c.claim_id),
      invalidatedClaimCount: invalidationResult.invalidatedClaims.length,
      message: `Source page ${sourcePageId} changed. ${invalidationResult.invalidatedClaims.length} claim(s) marked as stale.`
    };
  }

  /**
   * Save snapshot of content for a source page
   * @param {string} sourcePageId - Source page ID
   * @param {string} content - Content to save
   * @param {string} snapshotDir - Directory to save snapshots
   * @returns {string} Path to saved snapshot
   */
  static saveSnapshot(sourcePageId, content, snapshotDir = 'snapshots') {
    // Ensure directory exists
    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const filename = `${sourcePageId}_${timestamp}.html`;
    const filepath = path.join(snapshotDir, filename);
    
    fs.writeFileSync(filepath, content, 'utf8');
    
    return filepath;
  }
}

// CLI usage
function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: node change_detector_v2.js <kb-file> <source-page-id> [new-content-file]');
    console.log('');
    console.log('Examples:');
    console.log('  # Detect change by comparing with stored hash');
    console.log('  node change_detector_v2.js kb_v2.json source.abc123...');
    console.log('');
    console.log('  # Compare new content from file and invalidate claims');
    console.log('  node change_detector_v2.js kb_v2.json source.abc123... new_content.html');
    process.exit(1);
  }
  
  const kbFile = args[0];
  const sourcePageId = args[1];
  const newContentFile = args[2];
  
  if (!fs.existsSync(kbFile)) {
    console.error(`ERROR: KB file not found: ${kbFile}`);
    process.exit(1);
  }
  
  // Load KB
  let kbData;
  try {
    const rawContent = fs.readFileSync(kbFile, 'utf-8');
    kbData = JSON.parse(rawContent);
  } catch (err) {
    console.error('ERROR: Failed to parse KB JSON:', err.message);
    process.exit(1);
  }
  
  // Find source page
  const sourcePage = kbData.source_pages?.find(sp => sp.source_page_id === sourcePageId);
  if (!sourcePage) {
    console.error(`ERROR: Source page not found: ${sourcePageId}`);
    process.exit(1);
  }
  
  console.log(`Checking source page: ${sourcePageId}`);
  console.log(`URL: ${sourcePage.canonical_url}`);
  console.log(`Current hash: ${sourcePage.content_hash}`);
  console.log('');
  
  // Try to auto-load claims_by_source_page index for efficient invalidation
  const indexPath = path.join(path.dirname(kbFile), 'kb', 'indexes', 'claims_by_source_page.json');
  const altIndexPath = path.join(path.dirname(kbFile), 'indexes', 'claims_by_source_page.json');
  let claimsBySourceIndex = loadClaimsBySourceIndex(indexPath);
  if (!claimsBySourceIndex) {
    claimsBySourceIndex = loadClaimsBySourceIndex(altIndexPath);
  }
  
  if (claimsBySourceIndex) {
    console.log('📇 Using claims_by_source_page index for efficient invalidation');
  } else {
    console.log('ℹ️  No index found - will scan claims directly');
  }
  console.log('');
  
  if (newContentFile) {
    // Compare with new content from file and process change
    if (!fs.existsSync(newContentFile)) {
      console.error(`ERROR: New content file not found: ${newContentFile}`);
      process.exit(1);
    }
    
    const newContent = fs.readFileSync(newContentFile, 'utf-8');
    const result = ChangeDetector.processSourceChange(kbData, sourcePageId, newContent, new Date().toISOString(), claimsBySourceIndex);
    
    if (result.changed) {
      console.log('✅ CHANGE DETECTED');
      console.log(`Previous hash: ${result.previousHash}`);
      console.log(`New hash: ${result.newHash}`);
      console.log(`Invalidated claims: ${result.invalidatedClaimCount}`);
      if (result.invalidatedClaims.length > 0) {
        console.log(`  ${result.invalidatedClaims.slice(0, 5).join(', ')}${result.invalidatedClaims.length > 5 ? '...' : ''}`);
      }
      
      // Save updated KB
      fs.writeFileSync(kbFile, JSON.stringify(kbData, null, 2), 'utf-8');
      console.log(`\n✅ Updated KB saved to: ${kbFile}`);
    } else {
      console.log('✅ No change detected');
      console.log(`Hash matches: ${result.previousHash}`);
    }
  } else {
    // Just show current status
    console.log('To detect changes, provide a file with new content:');
    console.log(`  node change_detector_v2.js ${kbFile} ${sourcePageId} <new-content.html>`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { ChangeDetector };
