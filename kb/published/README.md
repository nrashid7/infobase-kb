# Published Guides

This folder contains the **only public UI contract** between `infobase-kb` and `infobase-web`.

## Files

- **`public_guides.json`** - UI-ready guides with resolved citations, variants, and steps
- **`public_guides_index.json`** - Search index by title/keywords
- **`public_guides.schema.json`** - JSON schema for validation

## Automatic Sync

These files are **automatically synced** to `infobase-web` via GitHub Actions:

- **Trigger**: Push to master/main when files here change
- **Workflow**: `.github/workflows/sync-guides-to-web.yml`
- **Destination**: `infobase-web/src/data/`

See the main [README.md](../../README.md) for setup instructions.

## Contract Rules

### ✅ DO

- **Prefer automatic sync** - The GitHub Action handles copying to infobase-web
- Alternatively, web can consume the raw GitHub URL:
  `https://raw.githubusercontent.com/your-org/infobase-kb/master/kb/published/public_guides.json`
- Use `npm run publish` to regenerate these files
- Validate with `npm run validate:published` before committing

### ❌ DON'T

- **Do not import raw KB into web** - web should never see `claim.*`, `claim_ids`, or internal KB structure
- **Do not modify these files manually** - they are generated from the source KB
- **Do not commit these files if they're out of sync** with the source KB

## Branch Name

⚠️ **Important**: The raw GitHub URL depends on the branch name. If you switch from `master` → `main` (or vice versa), update the web app's URL accordingly.

Current branch: **`master`** (default)

If you need to change branches:
1. Update the web app's fetch URL
2. Document the change in this README
3. Consider setting up a redirect or alias

## Publishing

To regenerate the published files:

```bash
npm run publish
```

This will:
1. Read `kb/bangladesh_government_services_kb_v3.json`
2. Generate `public_guides.json` and `public_guides_index.json`
3. Overwrite existing files deterministically

## Validation

To validate the published files:

```bash
npm run validate:published
```

This checks:
- ✅ JSON is valid
- ✅ Schema compliance
- ✅ No `claim.*` references leaked
- ✅ Required fields present
- ✅ Variants/steps properly formatted
- ✅ Citations have valid URLs and dates

## Schema

The `public_guides.schema.json` file defines the contract. Key points:

- Guides must have `guide_id`, `service_id`, `agency_id`, `title`, `meta`
- Steps must have `step_number`, `title`, `citations`
- Citations must have `source_page_id`, `canonical_url`, `domain`, `page_title`, `locator`, `quoted_text`, `retrieved_at`, `language`
- Variants must have `variant_id`, `label`, `fees`, `processing_times`
- **No `claim_ids` or `claim.*` references allowed** - everything must be resolved to citations

## What Web Should See

The web app should display:
- ✅ Guide pages with **variant tabs** (Regular/Express/Super Express)
- ✅ Steps as **cards**
- ✅ Fees as **human-readable text**
- ✅ Citations as **accordions with official links**
- ❌ **No** `claim.*` references
- ❌ **No** internal IDs exposed
- ❌ **No** "Copy JSON" buttons for internal structure

## Maintenance

- Run `npm run publish:validate` before each release
- Keep the schema up-to-date as the contract evolves
- Document any breaking changes in the schema version

