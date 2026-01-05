/**
 * Claim Invalidation Utility
 * 
 * Implements logic to invalidate claims when source pages change.
 * When a source page's content_hash changes, all claims citing that source
 * are marked as stale.
 * 
 * STANDARDIZED STATUS ENUM: verified | unverified | stale | deprecated | contradicted
 * This module writes ONLY 'stale' status when invalidating claims.
 */

const { 
  createClaimInvalidationEntry, 
  appendToAuditLog, 
  scriptActor 
} = require('./audit_log');

const SCRIPT_ACTOR = scriptActor('claim_invalidator.js');

/**
 * Valid claim status values. Scripts should only write these values.
 * @type {string[]}
 */
const VALID_STATUS_ENUM = ['verified', 'unverified', 'stale', 'deprecated', 'contradicted'];

/**
 * Invalidates claims that cite a source page when that source changes
 * 
 * EFFICIENCY: If newKB.indexes.claims_by_source_page exists or claimsBySourceIndex is provided,
 * uses O(1) index lookup instead of O(C) claim scanning for each source.
 * 
 * @param {Object} oldKB - Previous KB state (for comparison)
 * @param {Object} newKB - Current KB state (will be modified)
 * @param {Array} sourcePageIds - Optional array of source page IDs to check (if not provided, checks all)
 * @param {Object} [claimsBySourceIndex] - Optional pre-built index: { source_page_id: [claim_ids] }
 * @returns {Object} Result with summary of invalidated claims
 */
function invalidateClaimsForSourceChange(oldKB, newKB, sourcePageIds = null, claimsBySourceIndex = null) {
  const result = {
    invalidatedClaims: [],
    changedSources: [],
    errors: [],
    usedIndex: false
  };

  if (!oldKB.source_pages || !newKB.source_pages) {
    result.errors.push('Missing source_pages arrays in KB data');
    return result;
  }

  // Try to use an index for efficient claim lookup
  // Priority: 1) Provided index, 2) KB embedded index, 3) Fall back to scanning
  let effectiveIndex = claimsBySourceIndex;
  if (!effectiveIndex && newKB.indexes && newKB.indexes.claims_by_source_page) {
    effectiveIndex = newKB.indexes.claims_by_source_page;
  }
  
  if (effectiveIndex) {
    result.usedIndex = true;
  }

  // Build map of old source pages by ID
  const oldSourceMap = new Map();
  oldKB.source_pages.forEach(source => {
    oldSourceMap.set(source.source_page_id, source);
  });

  // Performance optimization: Build claim map once for O(1) lookups
  // Complexity improvement: O(C*K) -> O(C+K) where C=claims, K=dependent claims
  // Instead of linear scan per dependent claim, use map lookup
  const claimMap = new Map();
  if (Array.isArray(newKB.claims)) {
    newKB.claims.forEach(claim => {
      if (claim && claim.claim_id) {
        claimMap.set(claim.claim_id, claim);
      }
    });
  }

  // Check each source page for changes
  newKB.source_pages.forEach(newSource => {
    // If sourcePageIds is provided, only check sources in that list
    if (sourcePageIds && Array.isArray(sourcePageIds) && !sourcePageIds.includes(newSource.source_page_id)) {
      return;
    }

    const oldSource = oldSourceMap.get(newSource.source_page_id);

    if (oldSource && oldSource.content_hash && newSource.content_hash) {
      if (oldSource.content_hash !== newSource.content_hash) {
        // Source has changed
        result.changedSources.push({
          source_page_id: newSource.source_page_id,
          old_hash: oldSource.content_hash,
          new_hash: newSource.content_hash,
          url: newSource.canonical_url
        });

        // Find and invalidate all claims citing this source
        // Uses index if available (O(1)), otherwise scans claims (O(C))
        const dependentClaimIds = findClaimsCitingSource(newKB.claims, newSource.source_page_id, effectiveIndex);
        
        // Use map lookup instead of linear scan (O(1) vs O(C))
        dependentClaimIds.forEach(claimId => {
          const claim = claimMap.get(claimId);
          if (claim) {
            const wasInvalidated = markClaimAsStale(claim, newSource.content_hash);
            if (wasInvalidated) {
              result.invalidatedClaims.push({
                claim_id: claimId,
                source_page_id: newSource.source_page_id,
                previous_status: claim.previous_status || 'verified',
                new_status: claim.status
              });
            }
          }
        });
      }
    }
  });

  // Record in audit log using strict schema
  if (result.invalidatedClaims.length > 0) {
    const auditEntry = createClaimInvalidationEntry({
      claimIds: result.invalidatedClaims.map(c => c.claim_id),
      sourcePageIds: result.changedSources.map(s => s.source_page_id),
      actor: SCRIPT_ACTOR,
      description: `${result.invalidatedClaims.length} claim(s) invalidated due to source page changes`
    });
    appendToAuditLog(newKB, auditEntry);
  }

  return result;
}

/**
 * Find all claim IDs that cite a given source page
 * 
 * EFFICIENCY: If an index (claims_by_source_page) is provided, uses O(1) lookup.
 * Otherwise falls back to O(C) scan where C = number of claims.
 * 
 * @param {Array} claims - Array of claim objects
 * @param {string} sourcePageId - Source page ID to search for
 * @param {Object} [claimsBySourceIndex] - Optional pre-built index: { source_page_id: [claim_ids] }
 * @returns {Array} Array of claim IDs
 */
function findClaimsCitingSource(claims, sourcePageId, claimsBySourceIndex = null) {
  // Fast path: use pre-built index if available
  if (claimsBySourceIndex && typeof claimsBySourceIndex === 'object') {
    const indexedClaims = claimsBySourceIndex[sourcePageId];
    if (Array.isArray(indexedClaims)) {
      return [...indexedClaims]; // Return copy to avoid mutation issues
    }
    // Source not in index means no claims reference it
    return [];
  }

  // Slow path: scan all claims (O(C) where C = number of claims)
  const dependentClaimIds = [];

  if (!Array.isArray(claims)) {
    return dependentClaimIds;
  }

  claims.forEach(claim => {
    if (claim.citations && Array.isArray(claim.citations)) {
      const citesSource = claim.citations.some(citation =>
        citation.source_page_id === sourcePageId
      );

      if (citesSource) {
        dependentClaimIds.push(claim.claim_id);
      }
    }
  });

  return dependentClaimIds;
}

/**
 * Find a claim by its ID
 * @param {Array} claims - Array of claim objects
 * @param {string} claimId - Claim ID to find
 * @returns {Object|null} Claim object or null if not found
 */
function findClaimById(claims, claimId) {
  if (!Array.isArray(claims)) {
    return null;
  }

  return claims.find(claim => claim.claim_id === claimId) || null;
}

/**
 * Mark a claim as stale
 * 
 * IMPORTANT: Invalidation is NOT verification. This function:
 * - Preserves last_verified_at and last_verified_source_hash (these track the last known-good state)
 * - Sets stale_marked_at (when invalidation occurred)
 * - Sets stale_due_to_source_hash (the new source hash that triggered invalidation)
 * - Sets previous_status (for potential rollback or audit)
 * 
 * @param {Object} claim - Claim object (will be modified)
 * @param {string} newSourceHash - New content hash of the source that triggered invalidation
 * @returns {boolean} True if claim was actually changed
 */
function markClaimAsStale(claim, newSourceHash) {
  if (!claim) {
    return false;
  }

  const previousStatus = claim.status;
  
  // Mark as stale if currently verified or unverified (per ARCHITECTURE.md: source changed → mark as stale)
  if (claim.status === 'verified' || claim.status === 'unverified') {
    claim.previous_status = previousStatus;
    claim.status = 'stale';
    
    // Record when invalidation occurred (ISO 8601 timestamp)
    claim.stale_marked_at = new Date().toISOString();
    
    // Record which source hash triggered the invalidation
    // This is the NEW hash that differs from the verified hash
    claim.stale_due_to_source_hash = newSourceHash;
    
    // NOTE: We intentionally do NOT modify last_verified_at or last_verified_source_hash
    // Those fields track the last known-good verified state, not the invalidation event.
    // This preserves provenance: we know what was verified and when.
    
    return previousStatus !== 'stale';
  }

  // If already stale, update the stale tracking fields but don't mark as newly stale
  if (claim.status === 'stale') {
    claim.stale_due_to_source_hash = newSourceHash;
    claim.stale_marked_at = new Date().toISOString();
  }

  return false;
}

/**
 * Batch invalidate claims for multiple source changes
 * 
 * @param {Object} oldKB - Previous KB state
 * @param {Object} newKB - Current KB state (will be modified)
 * @param {Array} sourcePageIds - Array of source page IDs that changed (optional, if not provided checks all)
 * @param {Object} [claimsBySourceIndex] - Optional pre-built index: { source_page_id: [claim_ids] }
 * @returns {Object} Result with summary
 */
function batchInvalidateClaims(oldKB, newKB, sourcePageIds = null, claimsBySourceIndex = null) {
  if (sourcePageIds && Array.isArray(sourcePageIds)) {
    // Only check specified source pages
    // Filter oldKB for comparison, but pass original newKB so mutations affect the original
    const filteredOldKB = {
      ...oldKB,
      source_pages: oldKB.source_pages.filter(s => sourcePageIds.includes(s.source_page_id))
    };
    // Pass original newKB (not filtered) so audit_log and claims are mutated in the original
    return invalidateClaimsForSourceChange(filteredOldKB, newKB, sourcePageIds, claimsBySourceIndex);
  } else {
    // Check all source pages
    return invalidateClaimsForSourceChange(oldKB, newKB, null, claimsBySourceIndex);
  }
}

/**
 * Load claims_by_source_page index from file if it exists
 * 
 * @param {string} indexPath - Path to claims_by_source_page.json
 * @returns {Object|null} Index object or null if not found/invalid
 */
function loadClaimsBySourceIndex(indexPath) {
  const fs = require('fs');
  
  try {
    if (fs.existsSync(indexPath)) {
      const content = fs.readFileSync(indexPath, 'utf-8');
      const index = JSON.parse(content);
      
      // Basic validation: should be an object with arrays
      if (index && typeof index === 'object') {
        return index;
      }
    }
  } catch (e) {
    // Index not available or invalid - fall back to scanning
    console.warn(`Warning: Could not load claims_by_source_page index: ${e.message}`);
  }
  
  return null;
}

module.exports = {
  invalidateClaimsForSourceChange,
  findClaimsCitingSource,
  findClaimById,
  markClaimAsStale,
  batchInvalidateClaims,
  loadClaimsBySourceIndex,
  VALID_STATUS_ENUM
};

// Self-check test
if (require.main === module) {
  // Create tiny oldKB and newKB objects
  const oldKB = {
    source_pages: [
      {
        source_page_id: 'source1',
        content_hash: 'hash_old',
        canonical_url: 'https://example.com/page1'
      }
    ],
    claims: [
      {
        claim_id: 'claim1',
        status: 'verified',
        citations: [
          { source_page_id: 'source1' }
        ]
      }
    ]
  };

  const newKB = {
    source_pages: [
      {
        source_page_id: 'source1',
        content_hash: 'hash_new', // Changed hash
        canonical_url: 'https://example.com/page1'
      }
    ],
    claims: [
      {
        claim_id: 'claim1',
        status: 'verified',
        citations: [
          { source_page_id: 'source1' }
        ]
      }
    ]
  };

  // Simulate source hash change
  const result = invalidateClaimsForSourceChange(oldKB, newKB);

  // Verify the claim became stale
  const claim = newKB.claims.find(c => c.claim_id === 'claim1');
  const isStale = claim && claim.status === 'stale';
  const hasPreviousStatus = claim && claim.previous_status === 'verified';
  const wasInvalidated = result.invalidatedClaims.length === 1 && 
                         result.invalidatedClaims[0].claim_id === 'claim1';

  if (isStale && hasPreviousStatus && wasInvalidated) {
    console.log('Test 1: OK');
  } else {
    console.error('Test 1: FAIL: Claim should be stale with previous_status set');
    process.exit(1);
  }

  // Test 2: batchInvalidateClaims with sourcePageIds - verify audit_log is written to original newKB
  const oldKB2 = {
    source_pages: [
      {
        source_page_id: 'source1',
        content_hash: 'hash_old',
        canonical_url: 'https://example.com/page1'
      },
      {
        source_page_id: 'source2',
        content_hash: 'hash_old2',
        canonical_url: 'https://example.com/page2'
      }
    ],
    claims: [
      {
        claim_id: 'claim1',
        status: 'verified',
        citations: [
          { source_page_id: 'source1' }
        ]
      }
    ]
  };

  const newKB2 = {
    source_pages: [
      {
        source_page_id: 'source1',
        content_hash: 'hash_new', // Changed hash
        canonical_url: 'https://example.com/page1'
      },
      {
        source_page_id: 'source2',
        content_hash: 'hash_old2', // Unchanged
        canonical_url: 'https://example.com/page2'
      }
    ],
    claims: [
      {
        claim_id: 'claim1',
        status: 'verified',
        citations: [
          { source_page_id: 'source1' }
        ]
      }
    ]
    // No audit_log initially
  };

  // Call batchInvalidateClaims with sourcePageIds filter
  batchInvalidateClaims(oldKB2, newKB2, ['source1']);

  // Verify audit_log was written to original newKB
  if (newKB2.audit_log && newKB2.audit_log.length === 1) {
    console.log('Test 2: OK');
  } else {
    console.error(`Test 2: FAIL: Expected newKB2.audit_log.length === 1, got ${newKB2.audit_log ? newKB2.audit_log.length : 'undefined'}`);
    process.exit(1);
  }

  console.log('All tests passed');
}
