/**
 * Audit Log Utility
 * 
 * Provides functions to create machine-queryable audit log entries
 * with deterministic event IDs following the strict schema.
 * 
 * Event Types:
 * - source_change: A source page's content has changed
 * - claim_invalidation: Claims were marked as stale due to source changes
 * - verification: Claims were verified against sources
 * - migration: Data was migrated from one schema version to another
 */

const crypto = require('crypto');

/**
 * Valid event types as defined in schema
 */
const EVENT_TYPES = Object.freeze({
  SOURCE_CHANGE: 'source_change',
  CLAIM_INVALIDATION: 'claim_invalidation',
  VERIFICATION: 'verification',
  MIGRATION: 'migration'
});

/**
 * Valid actor patterns
 */
const ACTOR_PATTERNS = Object.freeze({
  SYSTEM: 'system',
  USER: 'user'
});

/**
 * Generate a deterministic event ID from event data
 * Format: evt. + SHA1(event_type + timestamp + JSON(affected_entities))
 * 
 * @param {string} eventType - The event type
 * @param {string} timestamp - ISO 8601 timestamp
 * @param {Object} affectedEntities - Affected entities object
 * @returns {string} Deterministic event ID
 */
function generateEventId(eventType, timestamp, affectedEntities) {
  // Normalize affected_entities for consistent hashing
  const normalizedEntities = normalizeAffectedEntities(affectedEntities);
  const payload = `${eventType}|${timestamp}|${JSON.stringify(normalizedEntities)}`;
  const hash = crypto.createHash('sha1').update(payload, 'utf8').digest('hex');
  return `evt.${hash}`;
}

/**
 * Normalize affected_entities object for consistent hashing
 * - Sort arrays alphabetically
 * - Sort object keys alphabetically
 * - Remove empty arrays
 * 
 * @param {Object} entities - Affected entities object
 * @returns {Object} Normalized object
 */
function normalizeAffectedEntities(entities) {
  if (!entities || typeof entities !== 'object') {
    return {};
  }

  const normalized = {};
  const sortedKeys = Object.keys(entities).sort();

  for (const key of sortedKeys) {
    const value = entities[key];
    if (Array.isArray(value) && value.length > 0) {
      normalized[key] = [...value].sort();
    }
  }

  return normalized;
}

/**
 * Create a script actor string
 * @param {string} scriptName - Name of the script
 * @returns {string} Actor string in format script:<name>
 */
function scriptActor(scriptName) {
  // Sanitize script name to match pattern
  const sanitized = scriptName.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  return `script:${sanitized}`;
}

/**
 * Create a complete audit log entry
 * 
 * @param {Object} options - Audit log entry options
 * @param {string} options.eventType - Event type (must be one of EVENT_TYPES)
 * @param {Object} options.affectedEntities - Object containing affected entity IDs
 * @param {string} options.actor - Actor string (system, user, or script:<name>)
 * @param {string} [options.description] - Optional description
 * @param {Object} [options.metadata] - Optional metadata
 * @param {string} [options.timestamp] - Optional timestamp (defaults to now)
 * @returns {Object} Complete audit log entry
 */
function createAuditLogEntry(options) {
  const {
    eventType,
    affectedEntities,
    actor,
    description,
    metadata,
    timestamp = new Date().toISOString()
  } = options;

  // Validate event type
  if (!Object.values(EVENT_TYPES).includes(eventType)) {
    throw new Error(`Invalid event type: ${eventType}. Must be one of: ${Object.values(EVENT_TYPES).join(', ')}`);
  }

  // Validate actor
  if (!isValidActor(actor)) {
    throw new Error(`Invalid actor: ${actor}. Must be 'system', 'user', or 'script:<name>'`);
  }

  // Validate affected entities structure
  const validatedEntities = validateAffectedEntities(affectedEntities);

  // Generate deterministic event ID
  const eventId = generateEventId(eventType, timestamp, validatedEntities);

  // Build the entry
  const entry = {
    event_id: eventId,
    event_type: eventType,
    timestamp: timestamp,
    affected_entities: validatedEntities,
    actor: actor
  };

  // Add optional fields
  if (description && typeof description === 'string') {
    entry.description = description;
  }

  if (metadata && typeof metadata === 'object' && Object.keys(metadata).length > 0) {
    entry.metadata = metadata;
  }

  return entry;
}

/**
 * Validate actor string
 * @param {string} actor - Actor string to validate
 * @returns {boolean} True if valid
 */
function isValidActor(actor) {
  if (!actor || typeof actor !== 'string') {
    return false;
  }

  const actorPattern = /^(system|user|script:[a-zA-Z0-9_\-\.]+)$/;
  return actorPattern.test(actor);
}

/**
 * Validate and sanitize affected_entities object
 * @param {Object} entities - Affected entities object
 * @returns {Object} Validated object
 */
function validateAffectedEntities(entities) {
  if (!entities || typeof entities !== 'object') {
    return {};
  }

  const validated = {};
  const validKeys = ['source_pages', 'claims', 'services', 'documents', 'agencies'];

  for (const key of validKeys) {
    if (entities[key] && Array.isArray(entities[key]) && entities[key].length > 0) {
      validated[key] = entities[key].filter(id => typeof id === 'string' && id.length > 0);
    }
  }

  return validated;
}

/**
 * Create a source_change audit log entry
 * 
 * @param {Object} options
 * @param {string[]} options.sourcePageIds - Source page IDs that changed
 * @param {string} options.actor - Actor string
 * @param {string} [options.hashBefore] - Content hash before change
 * @param {string} [options.hashAfter] - Content hash after change
 * @param {string} [options.description] - Optional description
 * @returns {Object} Audit log entry
 */
function createSourceChangeEntry(options) {
  const { sourcePageIds, actor, hashBefore, hashAfter, description } = options;

  const metadata = {};
  if (hashBefore) metadata.hash_before = hashBefore;
  if (hashAfter) metadata.hash_after = hashAfter;

  return createAuditLogEntry({
    eventType: EVENT_TYPES.SOURCE_CHANGE,
    affectedEntities: {
      source_pages: sourcePageIds
    },
    actor,
    description: description || `Source page content changed`,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined
  });
}

/**
 * Create a claim_invalidation audit log entry
 * 
 * @param {Object} options
 * @param {string[]} options.claimIds - Claim IDs that were invalidated
 * @param {string[]} options.sourcePageIds - Source page IDs that caused invalidation
 * @param {string} options.actor - Actor string
 * @param {string} [options.description] - Optional description
 * @returns {Object} Audit log entry
 */
function createClaimInvalidationEntry(options) {
  const { claimIds, sourcePageIds, actor, description } = options;

  return createAuditLogEntry({
    eventType: EVENT_TYPES.CLAIM_INVALIDATION,
    affectedEntities: {
      claims: claimIds,
      source_pages: sourcePageIds
    },
    actor,
    description: description || `${claimIds.length} claim(s) invalidated due to source changes`
  });
}

/**
 * Create a verification audit log entry
 * 
 * @param {Object} options
 * @param {string[]} options.claimIds - Claim IDs that were verified
 * @param {string[]} [options.sourcePageIds] - Source page IDs checked
 * @param {string} options.actor - Actor string
 * @param {string} [options.description] - Optional description
 * @returns {Object} Audit log entry
 */
function createVerificationEntry(options) {
  const { claimIds, sourcePageIds = [], actor, description } = options;

  const affectedEntities = { claims: claimIds };
  if (sourcePageIds.length > 0) {
    affectedEntities.source_pages = sourcePageIds;
  }

  return createAuditLogEntry({
    eventType: EVENT_TYPES.VERIFICATION,
    affectedEntities,
    actor,
    description: description || `${claimIds.length} claim(s) verified`
  });
}

/**
 * Create a migration audit log entry
 * 
 * @param {Object} options
 * @param {Object} options.affectedEntities - All entities affected by migration
 * @param {string} options.actor - Actor string
 * @param {string} [options.migrationSource] - Source file/system name
 * @param {string} [options.schemaVersionFrom] - Schema version before migration
 * @param {string} [options.schemaVersionTo] - Schema version after migration
 * @param {string} [options.description] - Optional description
 * @returns {Object} Audit log entry
 */
function createMigrationEntry(options) {
  const { 
    affectedEntities, 
    actor, 
    migrationSource, 
    schemaVersionFrom, 
    schemaVersionTo, 
    description 
  } = options;

  const metadata = {};
  if (migrationSource) metadata.migration_source = migrationSource;
  if (schemaVersionFrom) metadata.schema_version_from = schemaVersionFrom;
  if (schemaVersionTo) metadata.schema_version_to = schemaVersionTo;

  return createAuditLogEntry({
    eventType: EVENT_TYPES.MIGRATION,
    affectedEntities,
    actor,
    description: description || 'Data migrated to new schema version',
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined
  });
}

/**
 * Add an audit log entry to a KB object
 * Ensures the audit_log array exists and appends the entry
 * 
 * @param {Object} kbData - Knowledge base object
 * @param {Object} entry - Audit log entry to add
 * @returns {Object} The added entry
 */
function appendToAuditLog(kbData, entry) {
  if (!kbData.audit_log) {
    kbData.audit_log = [];
  }
  kbData.audit_log.push(entry);
  return entry;
}

/**
 * Query audit log entries by event type
 * 
 * @param {Array} auditLog - Audit log array
 * @param {string} eventType - Event type to filter by
 * @returns {Array} Matching entries
 */
function queryByEventType(auditLog, eventType) {
  if (!Array.isArray(auditLog)) return [];
  return auditLog.filter(entry => entry.event_type === eventType);
}

/**
 * Query audit log entries by affected entity
 * 
 * @param {Array} auditLog - Audit log array
 * @param {string} entityType - Entity type (source_pages, claims, services, documents, agencies)
 * @param {string} entityId - Entity ID to search for
 * @returns {Array} Matching entries
 */
function queryByAffectedEntity(auditLog, entityType, entityId) {
  if (!Array.isArray(auditLog)) return [];
  return auditLog.filter(entry => {
    const entities = entry.affected_entities?.[entityType];
    return Array.isArray(entities) && entities.includes(entityId);
  });
}

/**
 * Query audit log entries by time range
 * 
 * @param {Array} auditLog - Audit log array
 * @param {string} startTime - ISO 8601 start timestamp (inclusive)
 * @param {string} endTime - ISO 8601 end timestamp (inclusive)
 * @returns {Array} Matching entries
 */
function queryByTimeRange(auditLog, startTime, endTime) {
  if (!Array.isArray(auditLog)) return [];
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  
  return auditLog.filter(entry => {
    const ts = new Date(entry.timestamp).getTime();
    return ts >= start && ts <= end;
  });
}

/**
 * Query audit log entries by actor
 * 
 * @param {Array} auditLog - Audit log array
 * @param {string} actor - Actor string to match
 * @returns {Array} Matching entries
 */
function queryByActor(auditLog, actor) {
  if (!Array.isArray(auditLog)) return [];
  return auditLog.filter(entry => entry.actor === actor);
}

module.exports = {
  // Constants
  EVENT_TYPES,
  ACTOR_PATTERNS,
  
  // Core functions
  generateEventId,
  createAuditLogEntry,
  appendToAuditLog,
  
  // Helper functions
  scriptActor,
  isValidActor,
  normalizeAffectedEntities,
  
  // Convenience creators
  createSourceChangeEntry,
  createClaimInvalidationEntry,
  createVerificationEntry,
  createMigrationEntry,
  
  // Query functions
  queryByEventType,
  queryByAffectedEntity,
  queryByTimeRange,
  queryByActor
};

// Self-check test
if (require.main === module) {
  console.log('🧪 Running audit_log self-check...\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e) {
      console.log(`  ✗ ${name}: ${e.message}`);
      failed++;
    }
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  // Test 1: Generate deterministic event ID
  test('generateEventId produces deterministic results', () => {
    const id1 = generateEventId('source_change', '2025-01-15T10:00:00Z', { source_pages: ['source.abc'] });
    const id2 = generateEventId('source_change', '2025-01-15T10:00:00Z', { source_pages: ['source.abc'] });
    assert(id1 === id2, 'IDs should match');
    assert(id1.startsWith('evt.'), 'ID should start with evt.');
    assert(id1.length === 44, 'ID should be 44 chars (evt. + 40 hex)');
  });

  // Test 2: Event ID format
  test('generateEventId produces valid format', () => {
    const id = generateEventId('claim_invalidation', '2025-01-15T10:00:00Z', { claims: ['claim.fee.test'] });
    assert(/^evt\.[a-f0-9]{40}$/.test(id), 'Should match pattern evt.<40 hex>');
  });

  // Test 3: Create audit log entry
  test('createAuditLogEntry creates valid entry', () => {
    const entry = createAuditLogEntry({
      eventType: EVENT_TYPES.SOURCE_CHANGE,
      affectedEntities: { source_pages: ['source.abc123'] },
      actor: 'system',
      description: 'Test event'
    });
    assert(entry.event_id, 'Should have event_id');
    assert(entry.event_type === 'source_change', 'Should have correct event_type');
    assert(entry.actor === 'system', 'Should have correct actor');
    assert(entry.timestamp, 'Should have timestamp');
  });

  // Test 4: Invalid event type throws
  test('createAuditLogEntry throws on invalid event type', () => {
    let threw = false;
    try {
      createAuditLogEntry({
        eventType: 'invalid_type',
        affectedEntities: {},
        actor: 'system'
      });
    } catch (e) {
      threw = true;
    }
    assert(threw, 'Should throw on invalid event type');
  });

  // Test 5: Invalid actor throws
  test('createAuditLogEntry throws on invalid actor', () => {
    let threw = false;
    try {
      createAuditLogEntry({
        eventType: EVENT_TYPES.SOURCE_CHANGE,
        affectedEntities: {},
        actor: 'invalid actor with spaces'
      });
    } catch (e) {
      threw = true;
    }
    assert(threw, 'Should throw on invalid actor');
  });

  // Test 6: scriptActor helper
  test('scriptActor creates valid actor string', () => {
    const actor = scriptActor('claim_invalidator.js');
    assert(actor === 'script:claim_invalidator.js', 'Should format correctly');
    assert(isValidActor(actor), 'Should be valid actor');
  });

  // Test 7: Convenience creators
  test('createClaimInvalidationEntry creates valid entry', () => {
    const entry = createClaimInvalidationEntry({
      claimIds: ['claim.fee.test.1', 'claim.fee.test.2'],
      sourcePageIds: ['source.abc123'],
      actor: 'system'
    });
    assert(entry.event_type === 'claim_invalidation', 'Should be claim_invalidation type');
    assert(entry.affected_entities.claims.length === 2, 'Should have 2 claims');
    assert(entry.affected_entities.source_pages.length === 1, 'Should have 1 source page');
  });

  // Test 8: Query by event type
  test('queryByEventType filters correctly', () => {
    const log = [
      { event_type: 'source_change', event_id: 'evt.1' },
      { event_type: 'claim_invalidation', event_id: 'evt.2' },
      { event_type: 'source_change', event_id: 'evt.3' }
    ];
    const results = queryByEventType(log, 'source_change');
    assert(results.length === 2, 'Should find 2 entries');
  });

  // Test 9: Query by affected entity
  test('queryByAffectedEntity filters correctly', () => {
    const log = [
      { event_id: 'evt.1', affected_entities: { claims: ['claim.a', 'claim.b'] } },
      { event_id: 'evt.2', affected_entities: { claims: ['claim.c'] } },
      { event_id: 'evt.3', affected_entities: { claims: ['claim.a'] } }
    ];
    const results = queryByAffectedEntity(log, 'claims', 'claim.a');
    assert(results.length === 2, 'Should find 2 entries');
  });

  // Test 10: appendToAuditLog
  test('appendToAuditLog adds entry to KB', () => {
    const kb = {};
    const entry = createAuditLogEntry({
      eventType: EVENT_TYPES.VERIFICATION,
      affectedEntities: { claims: ['claim.test'] },
      actor: 'user'
    });
    appendToAuditLog(kb, entry);
    assert(Array.isArray(kb.audit_log), 'Should create audit_log array');
    assert(kb.audit_log.length === 1, 'Should have 1 entry');
  });

  console.log('');
  if (failed === 0) {
    console.log(`✅ All ${passed} tests passed!\n`);
    process.exit(0);
  } else {
    console.log(`❌ ${failed} of ${passed + failed} tests failed!\n`);
    process.exit(1);
  }
}

