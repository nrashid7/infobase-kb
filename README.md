# Bangladesh Government Services Knowledge Base v2.0

## Provenance-First Knowledge System

A **canonical knowledge-base system** for Bangladeshi government services. Every fact is traceable to an official government source.

---

## ⚠️ Canonical Data Flow

> **IMPORTANT: Read this section before making any changes to the codebase.**

### Production Script

The **ONLY** production-ready crawler is:

```
scripts/crawl.js
```

All other crawl-related scripts are either:
- **Archived** (in `scripts/_archive/`)
- **Examples/Pilots** (in `examples/agent_pilot/` - NOT for production use)
- **Utilities** (supporting modules, not entry points)

### Forbidden Patterns

The following patterns are **strictly forbidden** in production:

| Pattern | Why Forbidden |
|---------|---------------|
| MCP bridges or message queues | Non-deterministic, hard to audit |
| Agent-orchestrated parallel crawls | Race conditions, duplicate data |
| External scheduling systems | Loss of provenance control |
| Uncited data extraction | Violates provenance-first principle |
| HTTP fallback without explicit flag | Security and consistency risks |

### Data Flow

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   Seeds File    │      │   crawl.js       │      │   KB v3 JSON    │
│   (seeds/)      │─────▶│   (Firecrawl)    │─────▶│   (kb/)         │
└─────────────────┘      └──────────────────┘      └─────────────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │   Snapshots      │
                         │   (kb/snapshots/)│
                         └──────────────────┘
```

### Module Structure

The crawler is organized into focused modules under `scripts/crawler/`:

| Module | Responsibility |
|--------|----------------|
| `discovery.js` | Seed extraction from bdgovlinks.com |
| `filtering.js` | URL prioritization, robots.txt, sitemaps |
| `extraction.js` | Structured data and claim extraction |
| `scraping.js` | Firecrawl MCP integration |
| `kb_writer.js` | KB file operations |
| `crawl_state.js` | State persistence across sessions |
| `crawl_report.js` | Run report generation |

---

## Quick Start

### Crawl Public Services (Canonical)

```bash
# Full crawl (all pages)
npm run crawl:full

# Refresh changed pages only
npm run crawl:refresh

# Dry run (see what would be crawled)
npm run crawl:dry
```

> **Note:** The canonical crawler is `scripts/crawl.js`. Legacy scripts have been moved to `scripts/_archive/`.

> **Firecrawl MCP Required:** By default, Firecrawl MCP is required. To allow direct HTTP document downloads (PDF/DOC), pass `--allow-http-doc-download` explicitly.

### Validate a KB File

```bash
# Validate v3 KB (current)
node scripts/validate_kb_v3.js kb/bangladesh_government_services_kb_v3.json

# Validate v2 KB (legacy)
node kb/validate_kb_v2.js examples/bangladesh_government_services_kb_v2_example.json
```

### Migrate from v1 to v2

```bash
node kb/migrate_v1_to_v2.js v1_kb.json output_v2.json
```

> **Note:** v2 to v3 migration script is archived in `scripts/_archive/migrate_v2_to_v3.js`. v3 is now the active schema.

### Build Chatbot Indexes

```bash
node kb/index_builder.js examples/bangladesh_government_services_kb_v2_example.json kb/indexes/
```

### How to confirm Firecrawl MCP is active

To verify that Firecrawl MCP tools are available in your Cursor Agent session:

```bash
node scripts/_pilot/mcp_smoke_check.js
```

#### Expected PASS output:
```
🔍 PHASE 0: Firecrawl MCP Smoke Check
Testing Firecrawl MCP availability with single scrape...
Target URL: https://www.epassport.gov.bd/instructions/five-step-to-your-epassport
Requesting formats: ["markdown"], onlyMainContent: true
✅ PASS: Firecrawl MCP available (1234ms)
Markdown length: 5678 characters
Overrides applied: false
```

#### Common FAIL causes:
- **MCP not enabled**: Firecrawl MCP must be enabled in Cursor MCP settings
- **Missing API key**: `FIRECRAWL_API_KEY` environment variable must be present
- **Wrong agent profile**: Must run in Cursor Agent mode (not terminal) - terminal execution fails by design

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
│   ├── schema_v3.json     # JSON Schema definition (current)
│   ├── schema_v2.json     # JSON Schema definition (legacy)
│   ├── validate_kb_v2.js  # Base provenance validator
│   ├── validate_kb_v3.js  # v3 guide-first validator
│   ├── migrate_v1_to_v2.js # Migration script (v1 → v2)
│   ├── index_builder.js   # Chatbot index builder
│   ├── published/         # Published guides for web app
│   ├── snapshots/         # Crawled page snapshots (gitignored)
│   ├── runs/              # Crawl run reports (gitignored)
│   └── indexes/           # Generated indexes (gitignored)
├── scripts/               # Utility scripts
│   ├── crawl.js           # 🔹 CANONICAL CRAWLER (entry point)
│   ├── crawler/           # 🔹 Crawler sub-modules
│   │   ├── discovery.js       # Seed extraction
│   │   ├── filtering.js       # URL prioritization
│   │   ├── extraction.js      # Structured data extraction
│   │   ├── scraping.js        # Firecrawl MCP integration
│   │   ├── kb_writer.js       # KB file operations
│   │   ├── crawl_state.js     # State persistence
│   │   ├── crawl_report.js    # Report generation
│   │   └── index.js           # Module exports
│   ├── document_harvester.js  # Document download & text extraction
│   ├── firecrawl_mcp.js   # Firecrawl MCP integration
│   ├── build_public_guides.js # Publish pipeline
│   ├── validate_kb_v3.js  # v3 validation CLI
│   ├── validate_published.js # Published guides validation
│   └── _archive/          # Deprecated legacy scripts
├── examples/              # Example files (NON-PRODUCTION)
│   ├── bangladesh_government_services_kb_v2_example.json
│   └── agent_pilot/       # ⚠️ Pilot helpers - NOT for production
└── docs/                  # Documentation files
    ├── ARCHITECTURE.md
    └── MIGRATION_NOTES.md
```

> **⚠️ WARNING:** Files in `examples/agent_pilot/` are experimental pilot helpers and are **NOT** part of the production crawl pipeline. See `examples/agent_pilot/README.md` for details.

## Crawler Scripts

### Canonical Crawler (`scripts/crawl.js`)

The main crawler for government service portals. Supports:

```bash
# Full crawl of all domains
npm run crawl:full
# or: node scripts/crawl.js --refresh all

# Refresh only changed pages  
npm run crawl:refresh
# or: node scripts/crawl.js --refresh changed

# Dry run to preview crawl plan
npm run crawl:dry
# or: node scripts/crawl.js --dry-run --verbose

# Crawl specific domain
node scripts/crawl.js --domain epassport.gov.bd --maxPages 100
```

### Optional Dependencies

For document text extraction, install:

```bash
npm install pdf-parse mammoth xlsx
```

These are optional - documents will still be downloaded and stored even if extraction fails.

## Utility Scripts

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

The KB file is a **snapshot** (static) until explicitly updated. The system is **dynamic-capable** through the built-in crawler:

| Step | Tool/Process | Description |
|------|-------------|-------------|
| 1. Crawl | `scripts/crawl.js` | Fetch current content from government pages via Firecrawl MCP |
| 2. Detect | `change_detector_v2.js` | Compare new content hash with stored `content_hash` |
| 3. Invalidate | `claim_invalidator.js` | Mark dependent claims as `stale` if hash changed |
| 4. Re-verify | Manual review | Human confirms claims still match sources |

**Key points:**
- Use `npm run crawl:refresh` to refresh changed pages
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

## Clean Zip Export

To create a shareable zip file without repository bloat (useful for sharing the codebase without large generated/cached files):

### Windows (PowerShell)

```powershell
.\scripts\export_clean_zip.ps1
```

### Linux/macOS (Bash)

```bash
chmod +x scripts/export_clean_zip.sh
./scripts/export_clean_zip.sh
```

### Output

The script creates `dist/infobase-kb-clean.zip` containing:
- Source code and scripts
- Package files (`package.json`, `package-lock.json`)
- Documentation (`README.md`, `ARCHITECTURE.md`, etc.)
- KB published outputs (`kb/published/`)
- Schema files

### Excluded from zip

The following are excluded to minimize size:
- `.git/` - Git history
- `.cursor/` - IDE configuration
- `node_modules/` - Dependencies (reinstall with `npm install`)
- `kb/runs/` - Crawl run reports
- `kb/snapshots/` - Crawled page snapshots
- `kb/indexes/` - Generated indexes
- OS junk files (`Thumbs.db`, `.DS_Store`)

---

## Non-Goals

- ❌ No UI (data layer only)
- ❌ No automatic scraping (crawling is external)
- ❌ No form submission automation
- ❌ No personal data storage
- ❌ No uncited summaries

---

**License**: Public service. All information sourced from official government portals.
