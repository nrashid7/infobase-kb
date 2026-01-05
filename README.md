# Bangladesh Government Services Knowledge Base v2.0

## Provenance-First Knowledge System

A **canonical knowledge-base system** for Bangladeshi government services. Every fact is traceable to an official government source.

---

## Quick Start

### Validate a KB File

```bash
node kb/validate_kb_v2.js examples/bangladesh_government_services_kb_v2_example.json
```

### Migrate from v1 to v2

```bash
node kb/migrate_v1_to_v2.js v1_kb.json output_v2.json
```

### Run Migration Self-Check

```bash
node kb/migrate_v1_to_v2.js --self-check
```

### Build Chatbot Indexes

```bash
node kb/index_builder.js examples/bangladesh_government_services_kb_v2_example.json kb/indexes/
```

---

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Source Pages** | Registry of government pages with deterministic IDs: `source.` + SHA1(url) |
| **Claims** | Atomic facts with citations. ID format: `claim.<type>.<entity>.<variant>` |
| **Documents/Services** | Referential only - no free text, only claim references |
| **Domain Allowlist** | URLs must match agency's allowed domains |

---

## ID Formats

| Entity | Format | Example |
|--------|--------|---------|
| Source Page | `source.<sha1_40_chars>` | `source.110d7afa9b2c8c39f3b55a125a73dc4c85f62869` |
| Agency | `agency.<slug>` | `agency.dip` |
| Service | `svc.<slug>` | `svc.epassport_new` |
| Document | `doc.<slug>` | `doc.nid` |
| Claim | `claim.<type>.<entity>.<variant>` | `claim.fee.epassport_new.48p_5y_regular` |

---

## Claim Status Lifecycle

**Claim Status Enum:** `verified | unverified | stale | deprecated | contradicted`

**Service/Document Status Enum:** `verified | partial | unverified | stale | deprecated | contradicted`

Services and documents have **derived status** based on their claims. Validation hard-fails on unknown status.

| Status | Meaning |
|--------|---------|
| `unverified` | New claim, not yet checked |
| `verified` | Confirmed against source |
| `stale` | Source changed, needs re-verification |
| `contradicted` | Conflicting sources |
| `deprecated` | No longer valid |
| `partial` | (Services/docs only) Mixed claim statuses |

**Key Rules**:
- When source `content_hash` changes → citing claims become `stale`
- Services/documents can only be `verified` if ALL their claims are verified
- Invalidation preserves `last_verified_*` fields (not overwritten)

---

## Locator Types (Strict Union)

| Type | Field |
|------|-------|
| `heading_path` | `heading_path: string[]` |
| `css_selector` | `css_selector: string` |
| `xpath` | `xpath: string` |
| `url_fragment` | `url_fragment: string` |
| `pdf_page` | `pdf_page: number` |

---

## Project Structure

```
Infobase/
├── kb/                    # Core knowledge base tools
│   ├── schema_v2.json     # JSON Schema definition
│   ├── validate_kb_v2.js  # Strict provenance validator
│   ├── migrate_v1_to_v2.js # Migration script (v1 → v2)
│   ├── index_builder.js   # Chatbot index builder
│   └── ...
├── scripts/               # Utility scripts
│   ├── create_kb_v2.js    # Create KB file from stdin
│   └── save_kb_v2.ps1     # Save KB from clipboard (Windows)
├── examples/              # Example files
│   └── bangladesh_government_services_kb_v2_example.json
└── docs/                  # Documentation files
    ├── ARCHITECTURE.md
    └── MIGRATION_NOTES.md
```

## Utility Scripts

### Create KB from stdin

```bash
node scripts/create_kb_v2.js
# Paste JSON and press Ctrl+D (Ctrl+Z on Windows)
```

### Save KB from clipboard (Windows)

```powershell
.\scripts\save_kb_v2.ps1
# Copies JSON from clipboard and saves to project root
```

---

## Documentation

- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Complete architecture, data model, and validation rules
- **[kb/README.md](kb/README.md)** - Tool documentation and usage
- **[MIGRATION_NOTES.md](MIGRATION_NOTES.md)** - Changelog and migration notes

---

## How Updates Happen

The KB file is a **snapshot** (static) until explicitly updated. The system is **dynamic-capable** through external tooling:

| Step | Tool/Process | Description |
|------|-------------|-------------|
| 1. Crawl | External (not in-repo) | Fetch current content from government pages |
| 2. Detect | `change_detector_v2.js` | Compare new content hash with stored `content_hash` |
| 3. Invalidate | `claim_invalidator.js` | Mark dependent claims as `stale` if hash changed |
| 4. Re-verify | Manual review | Human confirms claims still match sources |

**Key points:**
- No automatic crawling exists in this repo - you must wire in an external crawler
- When a source page's `content_hash` changes, all citing claims become `stale`
- The `audit_log` tracks all changes for provenance

---

## Automatic Sync to Web App

Published guides are automatically synced to the `infobase-web` repository via GitHub Actions.

### Sync Pipeline

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   infobase-kb   │      │  GitHub Actions  │      │  infobase-web   │
│                 │      │                  │      │                 │
│ kb/published/   │─────▶│  sync-guides-    │─────▶│ src/data/       │
│   *.json        │      │  to-web.yml      │      │   *.json        │
└─────────────────┘      └──────────────────┘      └─────────────────┘
```

### Triggers

The sync workflow runs when:

1. **Push to master/main** - When files in `kb/published/**` change
2. **Daily schedule** - 6 AM UTC as a backup
3. **Manual dispatch** - Via GitHub Actions UI

### Required Secrets

You must configure the following secret in the `infobase-kb` repository:

| Secret Name | Description |
|-------------|-------------|
| `WEB_REPO_PAT` | GitHub Personal Access Token with write access to `infobase-web` |

#### Creating the Token

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. Click **Generate new token**
3. Configure:
   - **Token name**: `infobase-web-sync`
   - **Expiration**: 90 days (or your preference)
   - **Repository access**: Select `infobase-web`
   - **Permissions**: Contents → Read and Write
4. Copy the token and add it as a secret:
   - Go to `infobase-kb` → **Settings → Secrets and variables → Actions**
   - Click **New repository secret**
   - Name: `WEB_REPO_PAT`
   - Value: (paste the token)

### Files Synced

| Source (infobase-kb) | Destination (infobase-web) |
|---------------------|---------------------------|
| `kb/published/public_guides.json` | `src/data/public_guides.json` |
| `kb/published/public_guides_index.json` | `src/data/public_guides_index.json` |

### Manual Publishing

To regenerate and validate published files locally:

```bash
npm run publish          # Generate public_guides.json and index
npm run validate:published  # Validate against schema
npm run publish:validate    # Both in one command
```

---

## Non-Goals

- ❌ No UI (data layer only)
- ❌ No automatic scraping (crawling is external)
- ❌ No form submission automation
- ❌ No personal data storage
- ❌ No uncited summaries

---

**License**: Public service. All information sourced from official government portals.
