#!/usr/bin/env node
'use strict';

/**
 * Firecrawl rendering probe for the ePassport fee page.
 *
 * Runs a small matrix of Firecrawl scrape options against the SPA fee page
 * to see if fee content can be captured without changing crawler behavior.
 */

const { firecrawlMcp } = require('../crawler/scraping');
const { sleep } = require('../crawler/utils');

const TARGET_URL = 'https://www.epassport.gov.bd/instructions/passport-fees';
const RATE_LIMIT_MS = 2500; // 2–3s between attempts

const attempts = [
  {
    label: 'A) baseline main content',
    options: {
      formats: ['markdown'],
      onlyMainContent: true,
    },
  },
  {
    label: 'B) full page content',
    options: {
      formats: ['markdown', 'rawHtml'],
      onlyMainContent: false,
    },
  },
  {
    label: 'C) wait 5s (JS render?)',
    options: {
      formats: ['markdown', 'rawHtml'],
      onlyMainContent: false,
      waitFor: 5000,
    },
  },
  {
    label: 'D) wait 12s + 120s timeout',
    options: {
      formats: ['markdown', 'rawHtml'],
      onlyMainContent: false,
      waitFor: 12000,
      timeout: 120000,
    },
  },
];

function getScrapeFunction() {
  const ctx = (typeof global !== 'undefined' && global.mcpContext) ? global.mcpContext : {};
  return ctx.scrape || global.firecrawlScrape || null;
}

function containsFeeSignals(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const tokens = [
    '৳',
    'টাকা',
    'bdt',
    'regular',
    'express',
    'super express',
  ];
  return tokens.some(token =>
    token === '৳' || token === 'টাকা'
      ? text.includes(token)
      : lower.includes(token)
  );
}

function formatSnippet(markdown) {
  if (!markdown) return '';
  return markdown.slice(0, 500).replace(/\s+/g, ' ').trim();
}

async function runAttempt(attempt) {
  console.log(`\n--- ${attempt.label} ---`);
  const options = {
    allowEmpty: true, // let the probe continue even if Firecrawl returns nothing
    ...attempt.options,
  };

  try {
    const result = await firecrawlMcp.firecrawlScrape(TARGET_URL, options);
    const markdown = result?.markdown || '';
    const rawHtml = result?.rawHtml || '';

    const markdownHasSignals = containsFeeSignals(markdown);
    const rawHtmlHasSignals = containsFeeSignals(rawHtml);

    console.log(`result exists: ${Boolean(result)}`);
    console.log(`markdown length: ${markdown.length}`);
    console.log(`rawHtml length: ${rawHtml ? rawHtml.length : 0}`);
    console.log(`markdown contains fee signals: ${markdownHasSignals}`);
    console.log(`rawHtml contains fee signals: ${rawHtmlHasSignals}`);
    console.log(`markdown snippet (first 500 chars): ${formatSnippet(markdown) || '<empty>'}`);

    return { result, markdown, rawHtml, markdownHasSignals, rawHtmlHasSignals };
  } catch (err) {
    console.log(`❌ attempt failed: ${err.message}`);
    return { error: err };
  }
}

async function main() {
  console.log('🔥 Firecrawl MCP fee page render probe');
  console.log(`Target URL: ${TARGET_URL}`);

  const scrapeFunc = getScrapeFunction();
  if (!scrapeFunc) {
    console.error('Firecrawl scrape function not available. Make sure Firecrawl MCP is connected.');
    process.exit(1);
  }

  // Initialize wrapper with the available scrape function
  firecrawlMcp.initialize({ scrape: scrapeFunc });

  const results = [];

  for (let i = 0; i < attempts.length; i++) {
    const res = await runAttempt(attempts[i]);
    results.push({ attempt: attempts[i].label, ...res });

    if (i < attempts.length - 1) {
      await sleep(RATE_LIMIT_MS);
    }
  }

  const success = results.find(r => r.markdownHasSignals || r.rawHtmlHasSignals);
  if (success) {
    console.log('\n✅ Fee signals detected in at least one attempt.');
    console.log(`First successful attempt: ${success.attempt}`);
  } else {
    console.log('\n⚠️  No fee signals detected in any attempt.');
  }
}

main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});


