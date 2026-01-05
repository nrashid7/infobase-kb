# Agent Pilot Helpers - NON-PRODUCTION

⚠️ **WARNING: These files are experimental pilot helpers and are NOT part of the production crawl pipeline.**

## Purpose

These scripts were created during early development to assist with agent-orchestrated crawl experiments. They provide utility functions that the AI agent may use during pilot testing.

## Files

| File | Description |
|------|-------------|
| `agent_crawl_pilot.js` | URL prioritization helpers for agent orchestration |
| `agent_crawl_processor.js` | Processing helpers for pilot crawl results |
| `agent_pilot_complete.js` | Complete pilot workflow (deprecated) |
| `process_epassport_pilot.js` | ePassport-specific pilot processing |
| `process_pilot_results.js` | Pilot results post-processing |
| `process_urls_temp.js` | Temporary URL processing utilities |

## Status

**DO NOT USE FOR PRODUCTION CRAWLS**

These files:
- Are not maintained or tested
- May contain outdated logic
- Are not referenced by the canonical crawler
- Should not be used for real data collection

## Production Crawler

For production crawls, use **only** the canonical crawler:

```bash
# Production crawl commands
npm run crawl:full       # Full crawl
npm run crawl:refresh    # Refresh changed pages
npm run crawl:dry        # Dry run (preview)
```

The production crawler is located at `scripts/crawl.js`.

## Forbidden Patterns

The following patterns are **NOT ALLOWED** in production:

- ❌ MCP bridges or queue systems
- ❌ Agent-orchestrated parallel crawls
- ❌ External scheduling systems
- ❌ Uncited data extraction

## See Also

- [Main README](../../README.md) - Project overview
- [ARCHITECTURE.md](../../ARCHITECTURE.md) - System design
- [scripts/crawl.js](../../scripts/crawl.js) - Canonical crawler

