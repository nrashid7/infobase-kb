# KB Tools - v2.0

Production-grade tools for the provenance-first knowledge base.

---

## Tools Overview

| Tool | Purpose | Command |
|------|---------|---------|
| `validate_kb_v2.js` | Strict provenance validation | `node validate_kb_v2.js <kb.json>` |
| `migrate_v1_to_v2.js` | Migrate v1 → v2 format | `node migrate_v1_to_v2.js <v1.json> [output.json]` |
| `index_builder.js` | Build chatbot indexes | `node index_builder.js <kb.json> [output-dir]` |
| `claim_invalidator.js` | Invalidate claims on source change | Library (use programmatically) |
| `change_detector_v2.js` | Detect source page changes | `node change_detector_v2.js <kb.json> <source_id> [content]` |
| `audit_log.js` | Create & query audit log entries | Library (use programmatically) |

---

## Validation

### Running Validation

```bash
node validate_kb_v2.js kb_v2.json
```

### Validation Rules (Hard Failures)

1. **Deterministic source_page_id**: Must be `source.` + SHA1(canonical_url)
2. **No uncited claims**: Every claim requires at least one citation
3. **Valid citations**: Citations must reference existing source_page_ids
4. **Deterministic claim_id**: Must match pattern `claim.<type>.<entity>.<variant>`
5. **Domain allowlist**: URLs must match agency's allowed domains
6. **No free text**: Services/documents reference claims only
7. **Structured data required**: Fee and processing_time claims need structured_data
8. **Valid locators**: Must be one of 5 strict union types
9. **Valid references**: All IDs must reference existing entities

---

## Migration

### Running Migration

```bash
# Migrate a v1 KB to v2
node migrate_v1_to_v2.js v1_kb.json kb_v2.json

# Run self-check to verify migration logic
node migrate_v1_to_v2.js --self-check
```

### Migration Guarantees

- **ID Normalization**: Service IDs get `svc.` prefix, documents get `doc.`
- **Deterministic Source IDs**: All source_page_ids are `source.` + SHA1(url)
- **Auto-Agencies**: Unknown domains get auto-agencies with matching allowlists
- **No Placeholder Domains**: No `example.gov.bd` or similar
- **Citation Integrity**: Never fabricates quoted_text; marks placeholders with `needs_manual_citation` tag and `unverified` status

### Post-Migration

After migration, manually review:
1. Claims tagged `needs_manual_citation`
2. Auto-generated agencies (ID starts with `agency.auto_`)
3. Placeholder hashes (all zeros)

Run validation: `node validate_kb_v2.js <migrated.json>`

---

## Index Builder

Generates chatbot retrieval indexes:

```bash
node index_builder.js kb_v2.json indexes/
```

**Output files**:
- `claims_by_service.json` - Map service_id → [claim_ids]
- `claims_by_document.json` - Map document_id → [claim_ids]
- `claims_by_source_page.json` - Map source_page_id → [claim_ids]

**Performance**: Uses Sets internally for O(n) deduplication (not O(n²) array.includes).

---

## Claim Invalidation

When a source page's `content_hash` changes, use `claim_invalidator.js` to mark citing claims as `stale`:

```javascript
const { invalidateClaimsForSourceChange, loadClaimsBySourceIndex } = require('./claim_invalidator');

// Basic usage
const result = invalidateClaimsForSourceChange(oldKB, newKB);
console.log(`Invalidated ${result.invalidatedClaims.length} claims`);

// With pre-built index for efficiency (O(1) lookup instead of O(C) scan)
const index = loadClaimsBySourceIndex('./indexes/claims_by_source_page.json');
const result = invalidateClaimsForSourceChange(oldKB, newKB, null, index);
```

**Status Flow**:
```
verified/unverified → [source hash changes] → stale → [re-verify] → verified
```

**Invalidation Semantics**:
- `last_verified_at` and `last_verified_source_hash` are **preserved** (not overwritten)
- `stale_marked_at` records when invalidation occurred
- `stale_due_to_source_hash` records which new hash triggered invalidation
- `previous_status` preserves the status before invalidation

**Audit Logging**: Automatically writes `claim_invalidation` entries to `audit_log`.

**Efficiency**: If `newKB.indexes.claims_by_source_page` exists or an index is provided, uses O(1) lookup instead of scanning all claims.

---

## Audit Log

Machine-queryable audit trail of all KB changes. Every entry has a deterministic `event_id` for deduplication.

### Event Types

| Type | Description |
|------|-------------|
| `source_change` | Source page content hash changed |
| `claim_invalidation` | Claims marked stale due to source changes |
| `verification` | Claims verified against sources |
| `migration` | Data migrated between schema versions |

### Creating Audit Entries

```javascript
const { 
  createClaimInvalidationEntry, 
  createSourceChangeEntry,
  createVerificationEntry,
  createMigrationEntry,
  appendToAuditLog,
  scriptActor 
} = require('./audit_log');

// Claim invalidation (also auto-created by claim_invalidator.js)
const entry = createClaimInvalidationEntry({
  claimIds: ['claim.fee.test.1'],
  sourcePageIds: ['source.abc123...'],
  actor: scriptActor('my_script.js'),
  description: 'Claims invalidated'
});
appendToAuditLog(kbData, entry);

// Verification
const verifyEntry = createVerificationEntry({
  claimIds: ['claim.fee.test.1'],
  actor: 'user',
  description: 'Manual verification complete'
});
appendToAuditLog(kbData, verifyEntry);
```

### Querying Audit Log

```javascript
const { 
  queryByEventType, 
  queryByAffectedEntity, 
  queryByTimeRange,
  queryByActor 
} = require('./audit_log');

// Find all claim invalidations
const invalidations = queryByEventType(kb.audit_log, 'claim_invalidation');

// Find events affecting a specific claim
const history = queryByAffectedEntity(kb.audit_log, 'claims', 'claim.fee.test.1');

// Find events in time range
const recent = queryByTimeRange(kb.audit_log, '2025-01-01T00:00:00Z', '2025-01-31T23:59:59Z');

// Find events by actor
const scriptEvents = queryByActor(kb.audit_log, 'script:claim_invalidator.js');
```

### Actor Patterns

| Pattern | Example | Description |
|---------|---------|-------------|
| `system` | `system` | Automated system |
| `user` | `user` | Human user |
| `script:<name>` | `script:my_script.js` | Named script |

### Self-Check

```bash
node audit_log.js
```

---

## Locator Types

Locators identify where quoted text appears in a source. **Strict union type** - exactly one of:

| Type | Required Field | Example |
|------|---------------|---------|
| `heading_path` | `heading_path: string[]` | `{"type": "heading_path", "heading_path": ["Fees"]}` |
| `css_selector` | `css_selector: string` | `{"type": "css_selector", "css_selector": "#fees"}` |
| `xpath` | `xpath: string` | `{"type": "xpath", "xpath": "//table[@id='fees']"}` |
| `url_fragment` | `url_fragment: string` | `{"type": "url_fragment", "url_fragment": "#fees"}` |
| `pdf_page` | `pdf_page: number` | `{"type": "pdf_page", "pdf_page": 5}` |

---

## Claim Status Values

**Claim Status Enum:** `verified | unverified | stale | deprecated | contradicted`

**Service/Document Status Enum:** `verified | partial | unverified | stale | deprecated | contradicted`

Services and documents have **derived status** - cannot be 'verified' unless all referenced claims are verified. 'partial' means mixed claim statuses.

| Status | Meaning | Next State |
|--------|---------|-----------|
| `unverified` | New, not checked | → `verified` after human review |
| `verified` | Confirmed against source | → `stale` if source changes |
| `stale` | Source changed | → `verified` after re-verification |
| `contradicted` | Conflicting sources | Manual resolution |
| `deprecated` | No longer valid | Terminal state |
| `partial` | (Services/docs) Mixed claims | Derived, update claims |

**Invalidation preserves provenance**: When marking claims stale, `last_verified_at` and `last_verified_source_hash` are **not** overwritten. New fields track invalidation:
- `stale_marked_at`: When claim was marked stale
- `stale_due_to_source_hash`: The new source hash that triggered invalidation
- `previous_status`: Status before invalidation

---

## Schema Reference

See `schema_v2.json` for complete JSON Schema definition.

See `../ARCHITECTURE.md` for data model and design principles.

---

## Test Fixtures

The `test_fixtures/` directory contains sample data for testing:

- `v1_sample.json` - Sample v1 KB for testing migration

Run migration self-check:
```bash
node migrate_v1_to_v2.js --self-check
```

---

## Troubleshooting

### "Non-deterministic source_page_id"
Ensure ID = `source.` + SHA1(canonical_url). Use validator's `generateSourcePageId()`.

### "Free text in services/documents"
Move all text to claims with citations. Services/documents should only contain claim_id arrays.

### "Invalid domain"
Add the domain to agency's `domain_allowlist`. Subdomain matching is supported.

### "Missing structured_data"
Fee claims need `structured_data.amount_bdt`. Processing time claims need duration fields.
