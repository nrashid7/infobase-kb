# Migration Notes & Changelog

## Changelog

### 2025-01-XX - v3.0 Guide-First Layer

#### Overview

Version 3.0 introduces the **Guide Layer** - a user-friendly presentation layer on top of the provenance-first foundation. Guides provide step-by-step service walkthroughs while claims + source_pages remain the audit backbone.

#### New Files

| File | Purpose |
|------|---------|
| `kb/schema_v3.json` | JSON Schema with `service_guides` entity |
| `scripts/migrate_v2_to_v3.js` | Migrate v2 KB to v3 (auto-generates guides) |
| `scripts/validate_kb_v3.js` | Validate v3 KB (guides + base entities) |
| `scripts/build_public_guides.js` | Build publishable `public_guides.json` |
| `kb/published/public_guides.json` | UI-ready guides with resolved citations |
| `kb/published/public_guides_index.json` | Search index by title/keywords |

#### New Entity: service_guides

Each guide represents a user-friendly view of a service:

```json
{
  "guide_id": "guide.epassport",
  "service_id": "svc.epassport",
  "agency_id": "agency.dip",
  "title": "e-Passport Application",
  "steps": [
    {
      "step_number": 1,
      "title": "Online Application",
      "description": "Visit www.epassport.gov.bd and complete the form",
      "claim_ids": ["claim.step.svc_epassport.1"]
    }
  ],
  "sections": {
    "fees": [...],
    "required_documents": [...],
    "eligibility": [...]
  },
  "variants": [
    { "variant_id": "regular", "label": "Regular (15 days)", "fee_claim_ids": [...] }
  ],
  "official_links": [
    { "label": "Official Portal", "url": "https://www.epassport.gov.bd/" }
  ]
}
```

#### Key Design Decisions

1. **No duplication**: Guides reference claim_ids, not raw text
2. **Provenance intact**: All facts trace back to claims → source_pages
3. **Auto-generation**: Migration script creates guides from existing claims
4. **Sections for grouping**: fees, documents, eligibility, processing_time, portal_links
5. **Variants**: Support for regular/express/super_express service tiers
6. **Official links required**: Every guide must have at least one official link

#### Migration Commands

```bash
# 1. Migrate v2 to v3
node scripts/migrate_v2_to_v3.js kb/bangladesh_government_services_kb_v2.json kb/bangladesh_government_services_kb_v3.json

# 2. Validate v3 KB
node scripts/validate_kb_v3.js kb/bangladesh_government_services_kb_v3.json

# 3. Build publishable guides
node scripts/build_public_guides.js kb/bangladesh_government_services_kb_v3.json kb/published/
```

#### V3 Validation Rules

In addition to all v2 rules, the v3 validator checks:

1. `guide_id` is unique and matches pattern `guide.<slug>`
2. `service_id` references an existing service
3. `agency_id` references an existing agency
4. All `claim_ids` in steps/sections reference existing claims
5. `official_links` is non-empty with valid URLs
6. Steps are sequentially numbered (1, 2, 3, ...)
7. Variants have unique `variant_id` values

#### Published Output Format

`public_guides.json` contains UI-ready data:

- Steps with resolved citations (domain, URL, quoted_text, locator)
- Verification summary per guide (verified/stale/unverified counts)
- Metadata: last_crawled_at, source_domains, step counts

`public_guides_index.json` contains search index entries:

- guide_id, title, agency_name
- Keywords extracted from title and steps
- Step and citation counts

#### Backward Compatibility

- All v2 entities (claims, source_pages, services, documents, agencies) are preserved
- v2 validator continues to work unchanged
- v2 KB files remain valid; v3 is additive

---

### 2025-01-XX - v2.0 Tooling Fixes

#### TASK A: Migration Script Fixes (`migrate_v1_to_v2.js`)

**1. Agency ID Handling**
- Fixed: Migration now creates per-domain auto-agencies when agency cannot be inferred from URL
- Auto-agency ID format: `agency.auto_<sha1(hostname)[:12]>`
- Auto-agencies have domain_allowlist matching the encountered hostname
- Ensures every `source_pages[].agency_id` references an existing agency

**2. Removed Placeholder Domains**
- Removed: `example.gov.bd` placeholder domains
- Domain allowlists are now inferred from:
  - Agency website URL
  - Service URLs linked to the agency
  - Auto-generated for unknown domains

**3. ID Normalization**
- Service IDs: Normalized to `svc.<slug>` format
- Document IDs: Normalized to `doc.<slug>` format
- Claim IDs: Follow pattern `claim.<type>.<entity>.<variant>`
- Original IDs can be tracked via migration warnings

**4. Citation Handling**
- Never fabricates `quoted_text`
- Placeholder citations use: `[PLACEHOLDER - Manual citation required...]`
- Claims with placeholder citations:
  - Status set to `unverified`
  - Tagged with `needs_manual_citation`
  - Locator type is `heading_path` with placeholder content

**5. Post-Migration Validation**
- Added CLI message recommending validation
- Added `--self-check` flag for internal testing
- Self-check verifies:
  - ID normalization (svc., doc. prefixes)
  - Agency reference integrity
  - Citation validity
  - No placeholder domains
  - Placeholder claims marked unverified

#### TASK B: Efficiency Improvements

**6. `index_builder.js`**
- Replaced O(n²) deduplication with O(n) using Sets
- Arrays converted at output time for backward compatibility
- No API or output format changes

**7. `claim_invalidator.js`**
- Already had claimMap optimization (verified working)
- Audit log correctly writes to original KB object
- No changes needed

#### TASK C: Documentation Consistency

**8. Unified Documentation**
- `ARCHITECTURE.md`: Single source of truth for data model
- `README.md`: Concise quick start guide
- `kb/README.md`: Tool documentation
- Consistent information across all docs on:
  - Deterministic ID formats
  - Locator union types (5 types)
  - Status lifecycle (verified/unverified/stale/contradicted/deprecated)
  - Source hash change → claims become `stale`

**9. Schema Alignment**
- Removed optional `enums` block from example KB
- Example KB now matches schema exactly
- Claim statuses match: `verified`, `unverified`, `stale`, `deprecated`, `contradicted`

---

## Migration Guide

### Before Migration

1. Ensure v1 KB has valid JSON
2. Check that agencies have website URLs (helps with domain inference)
3. Ensure services have source_url or portal_url where possible

### Running Migration

```bash
# Run self-check first
node kb/migrate_v1_to_v2.js --self-check

# Migrate your KB
node kb/migrate_v1_to_v2.js v1_kb.json v2_kb.json

# Validate output
node kb/validate_kb_v2.js v2_kb.json
```

### After Migration

1. **Review Warnings**: Check console output for migration warnings
2. **Fix Placeholder Citations**: Search for `needs_manual_citation` tag
3. **Review Auto-Agencies**: Search for `agency.auto_` IDs
4. **Update Content Hashes**: Placeholder hashes (all zeros) need actual values
5. **Verify Claims**: Update status from `unverified` to `verified` after review

### Common Post-Migration Tasks

```bash
# Find claims needing manual citation
grep -l "needs_manual_citation" v2_kb.json

# Find auto-generated agencies
grep "agency.auto_" v2_kb.json

# Validate final KB
node kb/validate_kb_v2.js v2_kb.json
```

---

## Test Fixtures

A synthetic v1 fixture is provided for testing:

```bash
# Test migration with sample v1 data
node kb/migrate_v1_to_v2.js kb/test_fixtures/v1_sample.json test_output.json

# Validate the output
node kb/validate_kb_v2.js test_output.json
```

---

## Breaking Changes from Previous Migration Script

1. **Auto-agencies instead of `agency.unknown`**: Unknown agencies now get deterministic per-domain IDs
2. **No placeholder domains**: `example.gov.bd` no longer used
3. **Stricter citation placeholders**: Clearly marked with `[PLACEHOLDER...]` text
4. **ID normalization**: IDs without proper prefixes are automatically fixed

---

## Compatibility Notes

- Output KB passes `validate_kb_v2.js` by default (if input has reasonable URLs)
- Index builder output format unchanged (backward compatible)
- Claim invalidator API unchanged
- All tools remain command-line compatible

