/**
 * Index Builder for KB v2.0
 * 
 * Generates derived indexes for efficient chatbot retrieval:
 * - claims_by_service.json
 * - claims_by_document.json
 * - claims_by_source_page.json
 * 
 * These indexes are build-time artifacts - the chatbot should query these
 * indexes rather than scanning raw JSON.
 * 
 * Performance: Uses Sets internally for O(n) deduplication instead of O(n²) 
 * array.includes() patterns. Converts to arrays at output time.
 * 
 * Incremental Rebuild Support:
 * - Pass changedClaimIds to only update entries affected by those claims
 * - Pass changedSourcePageIds to only update entries for those source pages
 * - Both require existing indexes to be loaded first
 * - Falls back to full rebuild if no diff provided or no existing indexes
 */

const fs = require('fs');
const path = require('path');

class IndexBuilder {
  constructor(kbData, options = {}) {
    this.kbData = kbData;
    // Use Maps with Sets internally for O(1) deduplication
    this.claimsByService = new Map();    // service_id → Set<claim_id>
    this.claimsByDocument = new Map();   // document_id → Set<claim_id>
    this.claimsBySourcePage = new Map(); // source_page_id → Set<claim_id>
    
    // Incremental rebuild options
    this.changedClaimIds = options.changedClaimIds || null;    // Set<claim_id> or null
    this.changedSourcePageIds = options.changedSourcePageIds || null; // Set<source_page_id> or null
    this.existingIndexes = options.existingIndexes || null;    // { claims_by_service, claims_by_document, claims_by_source_page }
  }

  /**
   * Load existing indexes from disk for incremental rebuilds
   */
  static loadExistingIndexes(indexDir) {
    const indexes = {};
    const files = [
      { name: 'claims_by_service.json', key: 'claims_by_service' },
      { name: 'claims_by_document.json', key: 'claims_by_document' },
      { name: 'claims_by_source_page.json', key: 'claims_by_source_page' }
    ];

    for (const { name, key } of files) {
      const filePath = path.join(indexDir, name);
      if (fs.existsSync(filePath)) {
        try {
          indexes[key] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch (err) {
          console.warn(`  ⚠ Failed to load ${name}: ${err.message}`);
          return null; // Can't do incremental without all indexes
        }
      } else {
        return null; // Can't do incremental without all indexes
      }
    }
    return indexes;
  }

  /**
   * Convert object with arrays to Map with Sets (for internal processing)
   */
  objectToMapOfSets(obj) {
    const map = new Map();
    for (const [key, arr] of Object.entries(obj)) {
      map.set(key, new Set(arr));
    }
    return map;
  }

  /**
   * Check if incremental rebuild is possible
   */
  canDoIncrementalRebuild() {
    const hasChanges = this.changedClaimIds || this.changedSourcePageIds;
    return hasChanges && this.existingIndexes;
  }

  /**
   * Main build method - automatically chooses full or incremental
   */
  build() {
    if (this.canDoIncrementalRebuild()) {
      return this.buildIncremental();
    }
    return this.buildFull();
  }

  /**
   * Full rebuild of all indexes (original behavior)
   */
  buildFull() {
    console.log('📚 Building indexes for chatbot retrieval (full rebuild)...\n');

    if (!Array.isArray(this.kbData.claims)) {
      console.error('ERROR: No claims array found in KB');
      return null;
    }

    // Build claims map for O(1) lookups
    const claimsMap = new Map();
    this.kbData.claims.forEach(claim => {
      claimsMap.set(claim.claim_id, claim);
    });

    // Build claims_by_service index
    this.buildClaimsByService(claimsMap);

    // Build claims_by_document index
    this.buildClaimsByDocument(claimsMap);

    // Build claims_by_source_page index
    this.buildClaimsBySourcePage(claimsMap);

    // Convert Sets to arrays for output (backward compatible)
    return {
      claims_by_service: this.mapOfSetsToObject(this.claimsByService),
      claims_by_document: this.mapOfSetsToObject(this.claimsByDocument),
      claims_by_source_page: this.mapOfSetsToObject(this.claimsBySourcePage)
    };
  }

  /**
   * Incremental rebuild - only update affected entries
   */
  buildIncremental() {
    const changedClaimCount = this.changedClaimIds ? this.changedClaimIds.size : 0;
    const changedSourceCount = this.changedSourcePageIds ? this.changedSourcePageIds.size : 0;
    
    console.log('📚 Building indexes for chatbot retrieval (incremental)...');
    console.log(`  Changed claims: ${changedClaimCount}, Changed source pages: ${changedSourceCount}\n`);

    if (!Array.isArray(this.kbData.claims)) {
      console.error('ERROR: No claims array found in KB');
      return null;
    }

    // Load existing indexes into internal Maps
    this.claimsByService = this.objectToMapOfSets(this.existingIndexes.claims_by_service);
    this.claimsByDocument = this.objectToMapOfSets(this.existingIndexes.claims_by_document);
    this.claimsBySourcePage = this.objectToMapOfSets(this.existingIndexes.claims_by_source_page);

    // Build claims map for O(1) lookups
    const claimsMap = new Map();
    this.kbData.claims.forEach(claim => {
      claimsMap.set(claim.claim_id, claim);
    });

    // Collect all claim_ids that need reindexing
    const claimsToReindex = new Set(this.changedClaimIds || []);

    // If source pages changed, find all claims that cite them
    if (this.changedSourcePageIds && this.changedSourcePageIds.size > 0) {
      claimsMap.forEach((claim, claimId) => {
        if (Array.isArray(claim.citations)) {
          for (const citation of claim.citations) {
            if (this.changedSourcePageIds.has(citation.source_page_id)) {
              claimsToReindex.add(claimId);
              break;
            }
          }
        }
      });
    }

    console.log(`  Total claims to reindex: ${claimsToReindex.size}`);

    // Remove old entries for claims that need reindexing
    this.removeClaimsFromIndexes(claimsToReindex);

    // Re-add claims that still exist in KB
    this.reindexClaims(claimsToReindex, claimsMap);

    // Handle changed source pages (ensure keys exist even if empty)
    if (this.changedSourcePageIds) {
      this.updateSourcePageKeys();
    }

    // Convert Sets to arrays for output
    return {
      claims_by_service: this.mapOfSetsToObject(this.claimsByService),
      claims_by_document: this.mapOfSetsToObject(this.claimsByDocument),
      claims_by_source_page: this.mapOfSetsToObject(this.claimsBySourcePage)
    };
  }

  /**
   * Remove specified claims from all indexes
   */
  removeClaimsFromIndexes(claimIds) {
    for (const claimId of claimIds) {
      // Remove from claims_by_service
      this.claimsByService.forEach(claimSet => {
        claimSet.delete(claimId);
      });
      // Remove from claims_by_document
      this.claimsByDocument.forEach(claimSet => {
        claimSet.delete(claimId);
      });
      // Remove from claims_by_source_page
      this.claimsBySourcePage.forEach(claimSet => {
        claimSet.delete(claimId);
      });
    }
  }

  /**
   * Re-add claims to indexes based on current KB data
   */
  reindexClaims(claimIds, claimsMap) {
    for (const claimId of claimIds) {
      const claim = claimsMap.get(claimId);
      if (!claim) {
        // Claim was deleted, already removed from indexes
        continue;
      }

      // Index by service (via entity_ref)
      if (claim.entity_ref && claim.entity_ref.type === 'service') {
        const serviceId = claim.entity_ref.id;
        if (!this.claimsByService.has(serviceId)) {
          this.claimsByService.set(serviceId, new Set());
        }
        this.claimsByService.get(serviceId).add(claimId);
      }

      // Index by document (via entity_ref)
      if (claim.entity_ref && claim.entity_ref.type === 'document') {
        const documentId = claim.entity_ref.id;
        if (!this.claimsByDocument.has(documentId)) {
          this.claimsByDocument.set(documentId, new Set());
        }
        this.claimsByDocument.get(documentId).add(claimId);
      }

      // Index by source page (via citations)
      if (Array.isArray(claim.citations)) {
        claim.citations.forEach(citation => {
          if (citation.source_page_id) {
            if (!this.claimsBySourcePage.has(citation.source_page_id)) {
              this.claimsBySourcePage.set(citation.source_page_id, new Set());
            }
            this.claimsBySourcePage.get(citation.source_page_id).add(claimId);
          }
        });
      }
    }

    // Also check services/documents direct references for reindexed claims
    this.reindexServiceReferences(claimIds, claimsMap);
    this.reindexDocumentReferences(claimIds, claimsMap);
  }

  /**
   * Re-check service direct claim references
   */
  reindexServiceReferences(claimIds, claimsMap) {
    if (!Array.isArray(this.kbData.services)) return;
    
    this.kbData.services.forEach(service => {
      if (Array.isArray(service.claims)) {
        const claimSet = this.claimsByService.get(service.service_id);
        if (claimSet) {
          service.claims.forEach(claimId => {
            if (claimIds.has(claimId) && claimsMap.has(claimId)) {
              claimSet.add(claimId);
            }
          });
        }
      }
    });
  }

  /**
   * Re-check document direct claim references
   */
  reindexDocumentReferences(claimIds, claimsMap) {
    if (!Array.isArray(this.kbData.documents)) return;
    
    this.kbData.documents.forEach(doc => {
      if (Array.isArray(doc.claims)) {
        const claimSet = this.claimsByDocument.get(doc.document_id);
        if (claimSet) {
          doc.claims.forEach(claimId => {
            if (claimIds.has(claimId) && claimsMap.has(claimId)) {
              claimSet.add(claimId);
            }
          });
        }
      }
    });
  }

  /**
   * Ensure source page keys exist in index (for new/changed source pages)
   */
  updateSourcePageKeys() {
    if (!Array.isArray(this.kbData.source_pages)) return;
    
    const sourcePageIds = new Set(this.kbData.source_pages.map(sp => sp.source_page_id));
    
    // Add new source page keys
    this.changedSourcePageIds.forEach(sourcePageId => {
      if (sourcePageIds.has(sourcePageId) && !this.claimsBySourcePage.has(sourcePageId)) {
        this.claimsBySourcePage.set(sourcePageId, new Set());
      }
    });
    
    // Remove deleted source page keys
    this.changedSourcePageIds.forEach(sourcePageId => {
      if (!sourcePageIds.has(sourcePageId)) {
        this.claimsBySourcePage.delete(sourcePageId);
      }
    });
  }

  buildClaimsByService(claimsMap) {
    console.log('  Building claims_by_service index...');

    // Initialize with services (using Sets for O(1) add)
    if (Array.isArray(this.kbData.services)) {
      this.kbData.services.forEach(service => {
        if (!this.claimsByService.has(service.service_id)) {
          this.claimsByService.set(service.service_id, new Set());
        }
      });
    }

    // Add claims that reference services via entity_ref
    // O(n) where n = number of claims
    claimsMap.forEach((claim, claimId) => {
      if (claim.entity_ref && claim.entity_ref.type === 'service') {
        const serviceId = claim.entity_ref.id;
        if (!this.claimsByService.has(serviceId)) {
          this.claimsByService.set(serviceId, new Set());
        }
        // Set.add is O(1)
        this.claimsByService.get(serviceId).add(claimId);
      }
    });

    // Also add claims referenced directly by services
    // O(s * c) where s = services, c = claims per service (typically small)
    if (Array.isArray(this.kbData.services)) {
      this.kbData.services.forEach(service => {
        if (Array.isArray(service.claims)) {
          const claimSet = this.claimsByService.get(service.service_id);
          if (claimSet) {
            service.claims.forEach(claimId => {
              // Only add if claim exists (Set.add is O(1))
              if (claimsMap.has(claimId)) {
                claimSet.add(claimId);
              }
            });
          }
        }
      });
    }

    console.log(`    ✓ Indexed ${this.claimsByService.size} services`);
  }

  buildClaimsByDocument(claimsMap) {
    console.log('  Building claims_by_document index...');

    // Initialize with documents (using Sets)
    if (Array.isArray(this.kbData.documents)) {
      this.kbData.documents.forEach(doc => {
        if (!this.claimsByDocument.has(doc.document_id)) {
          this.claimsByDocument.set(doc.document_id, new Set());
        }
      });
    }

    // Add claims that reference documents via entity_ref - O(n)
    claimsMap.forEach((claim, claimId) => {
      if (claim.entity_ref && claim.entity_ref.type === 'document') {
        const documentId = claim.entity_ref.id;
        if (!this.claimsByDocument.has(documentId)) {
          this.claimsByDocument.set(documentId, new Set());
        }
        this.claimsByDocument.get(documentId).add(claimId);
      }
    });

    // Also add claims referenced directly by documents - O(d * c)
    if (Array.isArray(this.kbData.documents)) {
      this.kbData.documents.forEach(doc => {
        if (Array.isArray(doc.claims)) {
          const claimSet = this.claimsByDocument.get(doc.document_id);
          if (claimSet) {
            doc.claims.forEach(claimId => {
              if (claimsMap.has(claimId)) {
                claimSet.add(claimId);
              }
            });
          }
        }
      });
    }

    console.log(`    ✓ Indexed ${this.claimsByDocument.size} documents`);
  }

  buildClaimsBySourcePage(claimsMap) {
    console.log('  Building claims_by_source_page index...');

    // Initialize with source pages (using Sets)
    if (Array.isArray(this.kbData.source_pages)) {
      this.kbData.source_pages.forEach(source => {
        if (!this.claimsBySourcePage.has(source.source_page_id)) {
          this.claimsBySourcePage.set(source.source_page_id, new Set());
        }
      });
    }

    // Add claims that cite source pages - O(n * c) where c = citations per claim
    claimsMap.forEach((claim, claimId) => {
      if (Array.isArray(claim.citations)) {
        claim.citations.forEach(citation => {
          if (citation.source_page_id) {
            if (!this.claimsBySourcePage.has(citation.source_page_id)) {
              this.claimsBySourcePage.set(citation.source_page_id, new Set());
            }
            // Set.add is O(1) - no need for array.includes check
            this.claimsBySourcePage.get(citation.source_page_id).add(claimId);
          }
        });
      }
    });

    console.log(`    ✓ Indexed ${this.claimsBySourcePage.size} source pages`);
  }

  /**
   * Convert a Map of Sets to a plain object with arrays (backward compatible output)
   */
  mapOfSetsToObject(map) {
    const obj = {};
    map.forEach((valueSet, key) => {
      obj[key] = Array.from(valueSet);
    });
    return obj;
  }

  saveIndexes(outputDir) {
    const indexes = this.build();
    if (!indexes) {
      return false;
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Save individual index files
    const files = [
      { name: 'claims_by_service.json', data: indexes.claims_by_service },
      { name: 'claims_by_document.json', data: indexes.claims_by_document },
      { name: 'claims_by_source_page.json', data: indexes.claims_by_source_page }
    ];

    files.forEach(({ name, data }) => {
      const filePath = path.join(outputDir, name);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`    ✓ Saved ${name}`);
    });

    console.log(`\n✅ Indexes saved to: ${outputDir}\n`);
    return true;
  }
}

/**
 * Parse CLI arguments for incremental rebuild
 * Supports:
 *   --claim-ids=id1,id2,id3
 *   --source-page-ids=id1,id2,id3
 *   --incremental (auto-detect from existing indexes, requires diff file)
 *   --diff-file=path/to/diff.json (JSON with { claim_ids: [], source_page_ids: [] })
 */
function parseArgs(args) {
  const parsed = {
    kbFile: null,
    outputDir: null,
    changedClaimIds: null,
    changedSourcePageIds: null,
    diffFile: null
  };

  const positional = [];

  for (const arg of args) {
    if (arg.startsWith('--claim-ids=')) {
      const ids = arg.slice('--claim-ids='.length).split(',').filter(Boolean);
      parsed.changedClaimIds = new Set(ids);
    } else if (arg.startsWith('--source-page-ids=')) {
      const ids = arg.slice('--source-page-ids='.length).split(',').filter(Boolean);
      parsed.changedSourcePageIds = new Set(ids);
    } else if (arg.startsWith('--diff-file=')) {
      parsed.diffFile = arg.slice('--diff-file='.length);
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  parsed.kbFile = positional[0] || path.join(__dirname, 'kb_v2.json');
  parsed.outputDir = positional[1] || path.join(__dirname, 'indexes');

  return parsed;
}

/**
 * Load diff from JSON file
 * Expected format: { "claim_ids": ["claim.foo", ...], "source_page_ids": ["source.abc", ...] }
 */
function loadDiffFile(diffFilePath) {
  if (!fs.existsSync(diffFilePath)) {
    console.error(`ERROR: Diff file not found: ${diffFilePath}`);
    return null;
  }

  try {
    const content = JSON.parse(fs.readFileSync(diffFilePath, 'utf-8'));
    return {
      changedClaimIds: content.claim_ids ? new Set(content.claim_ids) : null,
      changedSourcePageIds: content.source_page_ids ? new Set(content.source_page_ids) : null
    };
  } catch (err) {
    console.error(`ERROR: Failed to parse diff file: ${err.message}`);
    return null;
  }
}

// Main execution
function main() {
  const args = process.argv.slice(2);
  
  // Show help
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Index Builder for KB v2.0

Usage:
  node index_builder.js [kb-file.json] [output-dir] [options]

Options:
  --claim-ids=id1,id2,...       Incremental: only rebuild for these claim IDs
  --source-page-ids=id1,id2,... Incremental: only rebuild for these source page IDs
  --diff-file=path/to/diff.json Load changed IDs from JSON file
                                 Format: { "claim_ids": [...], "source_page_ids": [...] }
  --help, -h                    Show this help message

Examples:
  # Full rebuild (default)
  node index_builder.js kb_v2.json ./indexes

  # Incremental rebuild for specific claims
  node index_builder.js kb_v2.json ./indexes --claim-ids=claim.fee.passport_regular,claim.step.nid_apply

  # Incremental rebuild using diff file
  node index_builder.js kb_v2.json ./indexes --diff-file=changes.json

Notes:
  - Incremental rebuilds require existing indexes in the output directory
  - Falls back to full rebuild if existing indexes are not found
  - Combines --claim-ids and --source-page-ids if both provided
`);
    process.exit(0);
  }

  const parsed = parseArgs(args);

  if (!fs.existsSync(parsed.kbFile)) {
    console.error(`ERROR: KB file not found: ${parsed.kbFile}`);
    console.error('Usage: node index_builder.js [kb-file.json] [output-dir] [options]');
    console.error('       node index_builder.js --help for more options');
    process.exit(1);
  }

  // Load diff file if specified
  if (parsed.diffFile) {
    const diff = loadDiffFile(parsed.diffFile);
    if (!diff) {
      process.exit(1);
    }
    // Merge with any CLI-specified IDs
    if (diff.changedClaimIds) {
      parsed.changedClaimIds = parsed.changedClaimIds 
        ? new Set([...parsed.changedClaimIds, ...diff.changedClaimIds])
        : diff.changedClaimIds;
    }
    if (diff.changedSourcePageIds) {
      parsed.changedSourcePageIds = parsed.changedSourcePageIds
        ? new Set([...parsed.changedSourcePageIds, ...diff.changedSourcePageIds])
        : diff.changedSourcePageIds;
    }
  }

  let kbData;
  try {
    const rawContent = fs.readFileSync(parsed.kbFile, 'utf-8');
    kbData = JSON.parse(rawContent);
  } catch (err) {
    console.error('ERROR: Failed to parse KB JSON:', err.message);
    process.exit(1);
  }

  // Prepare options for incremental rebuild
  const options = {};
  const hasIncrementalRequest = parsed.changedClaimIds || parsed.changedSourcePageIds;

  if (hasIncrementalRequest) {
    // Try to load existing indexes for incremental rebuild
    const existingIndexes = IndexBuilder.loadExistingIndexes(parsed.outputDir);
    
    if (existingIndexes) {
      options.existingIndexes = existingIndexes;
      options.changedClaimIds = parsed.changedClaimIds;
      options.changedSourcePageIds = parsed.changedSourcePageIds;
      console.log('ℹ️  Incremental rebuild mode enabled\n');
    } else {
      console.log('⚠️  No existing indexes found, falling back to full rebuild\n');
    }
  }

  const builder = new IndexBuilder(kbData, options);
  const success = builder.saveIndexes(parsed.outputDir);

  process.exit(success ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { IndexBuilder };
