# Bangladesh Government Services Knowledge Base - Architecture v2.0

## Provenance-First Design

This knowledge base system is built on the principle that **every fact must be traceable to an official government source**. It is not a UI, not a separate application layer, and not a scraper. It is a **source-of-truth, provenance-first knowledge system** that powers chatbots and UIs while maintaining complete auditability.

---

## Core Principles

1. **Government websites are the only source of truth** - All info from official portals, verifiable via source URL
2. **No uncited facts** - Every fact requires at least one citation with exact quoted text
3. **Every claim is reversible to its source** - Stable IDs, citations via `source_page_id`, locators for exact location
4. **Source changes invalidate facts** - SHA-256 hashes track changes; dependent claims become **stale**
5. **KB explains the process, does NOT replace the portal** - Read-only guidance; users complete on official sites

---

## Deterministic IDs

All IDs in the system are deterministic and follow strict patterns:

| Entity | ID Pattern | Example |
|--------|-----------|---------|
| Source Page | `source.` + SHA1(canonical_url) | `source.110d7afa9b2c8c39f3b55a125a73dc4c85f62869` |
| Agency | `agency.<name_slug>` | `agency.dip`, `agency.auto_a1b2c3d4e5f6` |
| Service | `svc.<service_slug>` | `svc.epassport_new` |
| Document | `doc.<document_slug>` | `doc.nid` |
| Claim | `claim.<type>.<entity>.<variant>` | `claim.fee.epassport_new.48p_5y_regular` |

**Source Page ID Generation:**
```javascript
source_page_id = "source." + SHA1(canonical_url)
// Example: SHA1("https://www.epassport.gov.bd") = "110d7afa9b2c8c39f3b55a125a73dc4c85f62869"
// Result: "source.110d7afa9b2c8c39f3b55a125a73dc4c85f62869"
```

---

## Data Model

### Entity Relationships

```
┌─────────────┐
│ Source Pages│  (Global Registry - First-Class Entity)
│             │
│ - source_id │
│ - url       │◄────┐
│ - hash      │     │
│ - agency_id │     │
└─────────────┘     │
                    │ citations reference
                    │
┌─────────────┐     │
│   Claims    │◄────┘
│             │
│ - claim_id  │
│ - text      │◄────┐
│ - citations │     │
└─────────────┘     │
                    │
        ┌───────────┴───────────┐
        │                       │
        │                       │
┌───────▼──────┐       ┌────────▼───────┐
│  Documents   │       │    Services    │
│              │       │                │
│ - doc_id     │       │ - service_id   │
│ - claims[]   │       │ - claims[]     │
│              │       │ - portal_map   │
└──────────────┘       └────────────────┘
```

### 1. Source Pages Registry

**Purpose**: First-class registry of all government source pages

**Key Fields**:
- `source_page_id`: Deterministic ID: `source.` + SHA1(canonical_url) (40 hex chars)
- `canonical_url`: Official government URL
- `agency_id`: Reference to the agency
- `content_hash`: SHA-256 hash for change detection (64 hex chars)
- `last_crawled_at`: When the page was last retrieved

**Example**:
```json
{
  "source_page_id": "source.110d7afa9b2c8c39f3b55a125a73dc4c85f62869",
  "canonical_url": "https://www.epassport.gov.bd",
  "agency_id": "agency.dip",
  "page_type": "main_portal",
  "content_hash": "c4d5e43574893c3cc3d4baba65589248479a9fbfaf1f608eb1541ec0c6fe636f",
  "last_crawled_at": "2025-01-15T08:00:00Z"
}
```

---

### 2. Claims (Atomic Facts)

**Purpose**: Represent atomic, citable facts

**Key Fields**:
- `claim_id`: Deterministic ID following pattern `claim.<type>.<entity>.<variant>`
- `claim_type`: Category (eligibility_requirement, fee, step, etc.)
- `text`: Human-readable statement
- `citations`: **Array of at least one citation** (enforced)
- `structured_data`: Required for numeric facts (fees, processing times)
- `status`: Verification status

**Citation Structure**:
- `source_page_id`: Reference to source_pages registry
- `quoted_text`: **Exact text from source** (required, never fabricated)
- `locator`: Position within source (strict union type)
- `retrieved_at`: When citation was extracted

---

### 3. Locator Union Types

Locators identify the exact position of quoted text within a source page. **Strict union type** - must be exactly one of:

| Type | Required Field | Example |
|------|---------------|---------|
| `heading_path` | `heading_path: string[]` | `{"type": "heading_path", "heading_path": ["Fees", "48 Pages"]}` |
| `css_selector` | `css_selector: string` | `{"type": "css_selector", "css_selector": "#fee-table tr:nth-child(2)"}` |
| `xpath` | `xpath: string` | `{"type": "xpath", "xpath": "//table[@id='fees']/tr[2]"}` |
| `url_fragment` | `url_fragment: string` | `{"type": "url_fragment", "url_fragment": "#section-fees"}` |
| `pdf_page` | `pdf_page: number` | `{"type": "pdf_page", "pdf_page": 5}` |

**No extra fields allowed** - validator enforces strict union type.

---

### 4. Claim Status Lifecycle

**Claim Status Enum:** `verified | unverified | stale | deprecated | contradicted`

**Service/Document Status Enum:** `verified | partial | unverified | stale | deprecated | contradicted`

Services and documents have a **derived status** based on their referenced claims:
- `verified` only if ALL referenced claims are verified
- `partial` if claims have mixed statuses (some verified, some not)
- Otherwise inherits the "worst" status from claims

Validation hard-fails on unknown status values.

| Status | Meaning | Transition Trigger |
|--------|---------|-------------------|
| `unverified` | New claim, not yet checked against source | Initial state after creation |
| `verified` | Confirmed to match current source content | Human verification |
| `stale` | Source content has changed since last verification | `content_hash` change detected |
| `contradicted` | Multiple sources provide conflicting information | Human review |
| `deprecated` | Claim is no longer valid (manually marked) | Manual deprecation |
| `partial` | (Services/documents only) Some claims verified, others not | Derived from claims |

**Status Flow:**
```
[created] → unverified
              │
              ▼
           verified ←──────────────────┐
              │                        │
              ▼ (source hash changes)  │ (re-verification)
            stale ─────────────────────┘
              │
              ▼ (info removed from source)
          deprecated
```

**Key Rule**: When a source page's `content_hash` changes, all claims citing that source are automatically marked as `stale`.

### 4.1 Invalidation Semantics

When a claim is marked stale due to source changes, invalidation **preserves** the last known-good verification state:

| Field | On Invalidation | Purpose |
|-------|-----------------|---------|
| `last_verified_at` | **Preserved** | When the claim was last verified |
| `last_verified_source_hash` | **Preserved** | Source hash when last verified |
| `stale_marked_at` | **Set** to current timestamp | When invalidation occurred |
| `stale_due_to_source_hash` | **Set** to new hash | Which source hash triggered invalidation |
| `previous_status` | **Set** to old status | For audit trail |

This preserves provenance: we know what was verified and when, even after invalidation.

---

### 5. Documents & Services (Referential Only)

**Key Principle**: Documents and services do NOT contain raw text or instructions. They only reference claims.

**Documents**:
- `document_id`: Format `doc.<slug>`
- `claims[]`: Array of claim_ids that define this document
- `status`: **Derived** from claims - cannot be 'verified' unless all claims are verified
- No fields like `how_to_get`, `definition` - these must be claims

**Services**:
- `service_id`: Format `svc.<slug>`
- `claims[]`: Array of claim_ids - ALL facts about the service
- `status`: **Derived** from claims - cannot be 'verified' unless all claims are verified
- `portal_mapping`: Read-only guidance for using the official portal
- `official_entrypoints`: References to source pages for entry points

**Status Derivation Rule**: A service or document's status is derived from its claims:
- `verified` only if ALL claims are verified
- `partial` if some claims verified, others not
- Otherwise inherits worst status (deprecated > contradicted > stale > unverified)

---

## Domain Allowlist Enforcement

Every agency must have a `domain_allowlist`. Source pages are validated against their agency's allowlist:

```json
{
  "agency_id": "agency.dip",
  "name": "Department of Immigration and Passports",
  "domain_allowlist": ["epassport.gov.bd", "www.epassport.gov.bd"]
}
```

**Validation**: A source page's `canonical_url` hostname must match at least one entry in its agency's `domain_allowlist`.

**Migration**: If an agency cannot be inferred from a URL, the migrator creates an auto-agency:
- ID: `agency.auto_<sha1(hostname)[:12]>`
- `domain_allowlist` includes the hostname

---

## Static vs Dynamic: How Updates Happen

The KB file itself is a **snapshot** (static data). It only becomes "dynamic" when you re-crawl sources and run change detection.

### What This Repo Provides

| Capability | Tool | Description |
|------------|------|-------------|
| Change detection | `change_detector_v2.js` | Compares new content hash with stored `content_hash` |
| Claim invalidation | `claim_invalidator.js` | Marks dependent claims as `stale` |
| Audit logging | `audit_log.js` | Records all changes for provenance |

### What This Repo Does NOT Provide

- **No automatic crawling** - You must wire in an external crawler to fetch page content
- **No scheduled updates** - Updates happen when you explicitly run the tools
- **No web hooks** - The system is pull-based, not push-based

### Content Hash Change Flow

1. **Crawl** (external): Retrieve page content from government site
2. **Compute Hash**: SHA-256 of normalized content
3. **Compare**: Compare with stored `content_hash`
4. **If Changed**:
   - Update `previous_hash` ← `content_hash`
   - Update `content_hash` ← new hash
   - Add entry to `change_log`
   - Mark all claims citing this source as `stale`
   - Record `source_change` event in `audit_log`
   - Record `claim_invalidation` event in `audit_log`

---

## Audit Log Schema

The `audit_log` is a machine-queryable array of events tracking all changes to the knowledge base. Each entry follows a strict schema:

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `event_id` | `string` | Deterministic ID: `evt.` + SHA1(event_type + timestamp + JSON(affected_entities)) |
| `event_type` | `enum` | One of: `source_change`, `claim_invalidation`, `verification`, `migration` |
| `timestamp` | `string` | ISO 8601 timestamp |
| `affected_entities` | `object` | Typed object with entity ID arrays |
| `actor` | `string` | Who triggered: `system`, `user`, or `script:<name>` |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `description` | `string` | Human-readable description |
| `metadata` | `object` | Event-specific metadata (hashes, migration info, etc.) |

### Event Types

| Type | Description |
|------|-------------|
| `source_change` | A source page's content hash changed |
| `claim_invalidation` | Claims were marked as stale due to source changes |
| `verification` | Claims were verified against sources |
| `migration` | Data was migrated between schema versions |

### Actor Patterns

| Pattern | Example | Description |
|---------|---------|-------------|
| `system` | `system` | Automated system process |
| `user` | `user` | Human user action |
| `script:<name>` | `script:claim_invalidator.js` | Named script/tool |

### Affected Entities Object

The `affected_entities` field contains typed arrays of entity IDs:

```json
{
  "source_pages": ["source.<sha1>", ...],
  "claims": ["claim.<type>.<entity>.<variant>", ...],
  "services": ["svc.<slug>", ...],
  "documents": ["doc.<slug>", ...],
  "agencies": ["agency.<slug>", ...]
}
```

### Example: Claim Invalidation

```json
{
  "event_id": "evt.7a3b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b",
  "event_type": "claim_invalidation",
  "timestamp": "2025-01-15T10:00:00.000Z",
  "affected_entities": {
    "source_pages": ["source.110d7afa9b2c8c39f3b55a125a73dc4c85f62869"],
    "claims": ["claim.fee.epassport_new.48p_5y_regular"]
  },
  "actor": "script:claim_invalidator.js",
  "description": "1 claim(s) invalidated due to source page changes"
}
```

### Example: Source Change

```json
{
  "event_id": "evt.1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
  "event_type": "source_change",
  "timestamp": "2025-01-15T09:59:00.000Z",
  "affected_entities": {
    "source_pages": ["source.110d7afa9b2c8c39f3b55a125a73dc4c85f62869"]
  },
  "actor": "script:change_detector_v2.js",
  "description": "Source page content changed: https://www.epassport.gov.bd",
  "metadata": {
    "hash_before": "c4d5e43574893c3cc3d4baba65589248479a9fbfaf1f608eb1541ec0c6fe636f",
    "hash_after": "a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd"
  }
}
```

### Example: Migration

```json
{
  "event_id": "evt.9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b",
  "event_type": "migration",
  "timestamp": "2025-01-15T08:00:00.000Z",
  "affected_entities": {
    "source_pages": ["source.abc123..."],
    "claims": ["claim.fee.test.1"],
    "services": ["svc.test"],
    "documents": ["doc.test"],
    "agencies": ["agency.test"]
  },
  "actor": "script:migrate_v1_to_v2.js",
  "description": "Migrated 5 claims, 1 service, 1 document from v1 to v2 schema",
  "metadata": {
    "schema_version_from": "1.0",
    "schema_version_to": "2.0.0"
  }
}
```

### Querying the Audit Log

The audit log is designed for machine queries. Use the utility functions in `kb/audit_log.js`:

```javascript
const { queryByEventType, queryByAffectedEntity, queryByTimeRange, queryByActor } = require('./kb/audit_log');

// Find all claim invalidations
const invalidations = queryByEventType(kb.audit_log, 'claim_invalidation');

// Find events affecting a specific claim
const claimHistory = queryByAffectedEntity(kb.audit_log, 'claims', 'claim.fee.test.1');

// Find events in time range
const recentEvents = queryByTimeRange(kb.audit_log, '2025-01-01T00:00:00Z', '2025-01-31T23:59:59Z');

// Find events by actor
const scriptEvents = queryByActor(kb.audit_log, 'script:claim_invalidator.js');
```

---

## Validation Rules (Hard Failures)

The validator (`kb/validate_kb_v2.js`) enforces:

1. **Non-deterministic source_page_id**: Must be `source.` + SHA1(canonical_url)
2. **Uncited claims**: Every claim must have at least one citation
3. **Invalid citations**: All citations must reference existing source_page_ids
4. **Non-deterministic claim_id**: Must match pattern (claim.type.entity.variant)
5. **Invalid domains**: canonical_url must be in agency's domain_allowlist
6. **Free text in services/documents**: Must only reference claims
7. **Missing structured_data**: Fee and processing_time claims require it
8. **Invalid locator format**: Locators must be one of 5 strict union types
9. **Broken references**: All IDs must reference existing entities

---

## Migration (v1 → v2)

```bash
node kb/migrate_v1_to_v2.js v1_kb.json kb/kb_v2.json
```

**Migration guarantees**:
- All service IDs normalized to `svc.<slug>` format
- All document IDs normalized to `doc.<slug>` format
- All source page IDs generated as `source.` + SHA1(url)
- Unknown agencies get auto-generated with per-domain allowlists
- No placeholder domains (e.g., `example.gov.bd`)
- Claims without real quoted text marked `unverified` with tag `needs_manual_citation`

**Self-check**: `node kb/migrate_v1_to_v2.js --self-check`

---

## File Structure

```
Infobase/
├── kb/
│   ├── schema_v2.json            # JSON Schema definition
│   ├── validate_kb_v2.js         # Strict provenance validator
│   ├── change_detector_v2.js     # Source change detection
│   ├── migrate_v1_to_v2.js       # Migration script (v1 → v2)
│   ├── index_builder.js          # Chatbot index builder
│   ├── claim_invalidator.js      # Claim invalidation logic
│   ├── audit_log.js              # Audit log utilities
│   ├── indexes/                  # Generated index files (see note below)
│   │   ├── claims_by_document.json
│   │   ├── claims_by_service.json
│   │   └── claims_by_source_page.json
│   ├── test_fixtures/            # Test data for migration
│   │   └── v1_sample.json        # Sample v1 KB for testing
│   └── README.md                 # Tool documentation
├── scripts/
│   ├── create_kb_v2.js           # Utility: Create KB file from stdin
│   └── save_kb_v2.ps1            # Utility: Save KB from clipboard (Windows)
├── examples/
│   └── bangladesh_government_services_kb_v2_example.json  # Example KB
├── ARCHITECTURE.md               # Complete architecture documentation
├── README.md                     # Project overview and quick start
└── MIGRATION_NOTES.md            # Changelog and migration notes
```

### Generated Artifacts Policy

The `kb/indexes/` directory contains generated index files. These are **gitignored** (treated as build artifacts) because:

1. They can be regenerated with `node kb/index_builder.js <kb.json> kb/indexes/`
2. Keeping source control clean avoids noisy diffs
3. Different environments may need different indexes

**To regenerate indexes:**
```bash
node kb/index_builder.js examples/bangladesh_government_services_kb_v2_example.json kb/indexes/
```

The `change_detector_v2.js` CLI will automatically use the index if present (for O(1) claim lookups instead of O(C) scanning).

---

## Chatbot Integration

**Constraint**: LLM can only use claims (no free-form text).

**Flow**: Query claims → Return with citations → Link to sources → If no match: "Not found in official sources"

---

## Non-Goals (Important)

This system does NOT:
- ❌ Provide a UI (it's a data layer)
- ❌ Scrape or crawl automatically (scraping is external)
- ❌ Automate form submission (users use official portals)
- ❌ Store personal data (no user data in KB)
- ❌ Summarize without citations (everything must cite sources)

---

## Quality Bar

Should feel like: Legal knowledge systems, compliance engines, academic citations, government databases. NOT like: blog posts, how-to guides, or FAQ pages without provenance.

---

---

## V3: Guide-First Layer

### Overview

Version 3.0 adds a **guide layer** on top of the provenance-first foundation. The goal is to provide user-friendly, step-by-step service guides while maintaining the audit backbone of claims, source_pages, and citations.

**Key Principle**: Guides reference claims (no duplication of facts). Provenance stays intact.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                    │
│                                                          │
│  ┌──────────────────┐    ┌─────────────────────────┐    │
│  │ public_guides.json│    │ public_guides_index.json│    │
│  │ (UI-ready)        │    │ (search index)          │    │
│  └────────┬─────────┘    └───────────┬─────────────┘    │
│           │                          │                   │
│           └──────────┬───────────────┘                   │
│                      │                                   │
├──────────────────────┼───────────────────────────────────┤
│                      │   GUIDE LAYER (v3)                │
│                      ▼                                   │
│  ┌─────────────────────────────────────────────────┐    │
│  │              service_guides[]                    │    │
│  │  - guide_id, service_id, agency_id              │    │
│  │  - title, overview                              │    │
│  │  - steps[] (references claim_ids)               │    │
│  │  - sections{} (fees, documents, etc.)           │    │
│  │  - variants[] (regular, express)                │    │
│  │  - official_links[]                             │    │
│  └───────────────────────┬─────────────────────────┘    │
│                          │ references                    │
├──────────────────────────┼───────────────────────────────┤
│                          │   AUDIT BACKBONE (v2)         │
│                          ▼                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │                   claims[]                       │    │
│  │  - claim_id, text, claim_type                   │    │
│  │  - citations[] → source_pages[]                 │    │
│  │  - status (verified/stale/etc.)                 │    │
│  └───────────────────────┬─────────────────────────┘    │
│                          │                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │               source_pages[]                     │    │
│  │  - source_page_id (deterministic)               │    │
│  │  - canonical_url, content_hash                  │    │
│  │  - last_crawled_at                              │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### service_guides Entity

```json
{
  "guide_id": "guide.epassport",
  "service_id": "svc.epassport",
  "agency_id": "agency.dip",
  "title": "e-Passport Application",
  "overview": "Apply for a new e-Passport online",
  "steps": [
    {
      "step_number": 1,
      "title": "Online Application",
      "description": "Visit www.epassport.gov.bd and complete the form",
      "claim_ids": ["claim.step.svc_epassport.1"]
    }
  ],
  "sections": {
    "fees": [
      { "label": "Regular 48-page: 3,450 BDT", "claim_ids": ["claim.fee.svc_epassport.regular_48page"] }
    ],
    "required_documents": [],
    "eligibility": []
  },
  "variants": [
    {
      "variant_id": "regular",
      "label": "Regular (15 days)",
      "fee_claim_ids": ["claim.fee.svc_epassport.regular_48page"],
      "processing_time_claim_ids": []
    }
  ],
  "official_links": [
    { "label": "Official Portal", "url": "https://www.epassport.gov.bd/" }
  ],
  "status": "draft"
}
```

### Published Guides (public_guides.json)

The UI consumes `kb/published/public_guides.json` which contains:

- **Resolved citations**: Each step/item includes full citation data (canonical_url, domain, quoted_text, locator)
- **Verification summary**: Counts of verified/stale/unverified claims per guide
- **Metadata**: last_crawled_at, source_domains, step counts

```json
{
  "guide_id": "guide.epassport",
  "title": "e-Passport Application",
  "steps": [
    {
      "step_number": 1,
      "title": "Online Application",
      "description": "...",
      "citations": [
        {
          "canonical_url": "https://www.epassport.gov.bd/instructions/five-step-to-your-epassport",
          "domain": "www.epassport.gov.bd",
          "quoted_text": "Online Application: Visit www.epassport.gov.bd...",
          "locator": "5 Easy Steps > Step 1"
        }
      ]
    }
  ],
  "meta": {
    "total_steps": 5,
    "total_citations": 8,
    "verification_summary": { "verified": 0, "unverified": 8 },
    "last_crawled_at": "2025-12-31T14:45:00Z",
    "source_domains": ["www.epassport.gov.bd"]
  }
}
```

### Search Index (public_guides_index.json)

A lightweight index for searching guides by title/keywords:

```json
{
  "entries": [
    {
      "guide_id": "guide.epassport",
      "title": "e-Passport Application",
      "agency_name": "Department of Immigration and Passports",
      "keywords": ["passport", "application", "online", "biometric"],
      "step_count": 5,
      "citation_count": 8
    }
  ]
}
```

### Commands

```bash
# Migrate v2 to v3 (creates service_guides from services)
node scripts/migrate_v2_to_v3.js kb/bangladesh_government_services_kb_v2.json kb/bangladesh_government_services_kb_v3.json

# Validate v3 KB
node scripts/validate_kb_v3.js kb/bangladesh_government_services_kb_v3.json

# Build publishable guides
node scripts/build_public_guides.js kb/bangladesh_government_services_kb_v3.json kb/published/
```

### V3 File Structure

```
Infobase/
├── kb/
│   ├── schema_v2.json                    # v2 schema (unchanged)
│   ├── schema_v3.json                    # v3 schema with service_guides
│   ├── validate_kb_v2.js                 # v2 validator (unchanged)
│   ├── bangladesh_government_services_kb_v2.json
│   ├── bangladesh_government_services_kb_v3.json
│   └── published/                        # Generated outputs
│       ├── public_guides.json            # UI-ready guides
│       └── public_guides_index.json      # Search index
├── scripts/
│   ├── migrate_v2_to_v3.js               # v2 → v3 migration
│   ├── validate_kb_v3.js                 # v3 validation
│   └── build_public_guides.js            # Publish guides
```

---

## License & Attribution

This knowledge base is designed for public service. All information is sourced from official government portals and must remain traceable to those sources.
