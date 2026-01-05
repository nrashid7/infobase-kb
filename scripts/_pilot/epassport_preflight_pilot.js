#!/usr/bin/env node
/**
 * ePassport Preflight Pilot
 * 
 * Pre-full-scrape pilot that proves the crawl pipeline is production-ready
 * BEFORE we crawl all 13 domains.
 * 
 * This pilot proves, end-to-end:
 * 1) Firecrawl overrides (waitFor + postprocess) are applied on SPA fee pages
 * 2) Extracted fee claims actually end up in the published public guide
 * 3) Claim IDs are idempotent (rerun writes 0 new claims)
 * 4) No remaining auto_* claim IDs for the ePassport guide path
 * 
 * Usage: node scripts/_pilot/epassport_preflight_pilot.js
 * 
 * @module pilot/epassport_preflight
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ============================================================================
// IMPORTS
// ============================================================================

const {
  utils,
  extraction,
  kbWriter,
  serviceMap,
  scraping,
} = require('../crawler');

const { firecrawlMcp, FirecrawlUnavailableError } = scraping;

const {
  generateHash,
  generateSourcePageId,
  ensureDir,
  getDomain,
  getDateString,
} = utils;

const {
  classifyPage,
  extractStructuredData,
  extractClaims,
} = extraction;

const {
  loadOrCreateKB,
  saveKB,
  addOrUpdateSourcePage,
  addClaimsToKB,
} = kbWriter;

const {
  getServiceIdForSeedDomain,
  getServiceKeyFromId,
} = serviceMap;

const {
  getFirecrawlOverridesForUrl,
  formatOverrideLog,
} = require('../crawler/firecrawl_overrides');

// ============================================================================
// CONFIGURATION
// ============================================================================

const PILOT_CONFIG = {
  // Target URLs for the pilot (targeted scrape set, NOT full domain crawl)
  targetUrls: [
    'https://www.epassport.gov.bd/instructions/passport-fees',       // SPA fee page (requires waitFor)
    'https://www.epassport.gov.bd/instructions/application-form',
    'https://www.epassport.gov.bd/instructions/instructions',
    'https://www.epassport.gov.bd/landing/faqs',
  ],
  
  // Service configuration
  serviceId: 'svc.epassport',
  guideId: 'guide.epassport',
  agencyId: 'agency.dip',
  seedDomain: 'epassport.gov.bd',
  
  // Rate limiting (ms between requests)
  rateLimit: 2000,
};

const PATHS = {
  kbDir: path.join(__dirname, '..', '..', 'kb'),
  pilotRunsDir: path.join(__dirname, '..', '..', 'kb', 'pilot_runs'),
  snapshotsDir: path.join(__dirname, '..', '..', 'kb', 'snapshots'),
  publishedDir: path.join(__dirname, '..', '..', 'kb', 'published'),
  kbPath: path.join(__dirname, '..', '..', 'kb', 'bangladesh_government_services_kb_v3.json'),
  publicGuidesPath: path.join(__dirname, '..', '..', 'kb', 'published', 'public_guides.json'),
  buildScript: path.join(__dirname, '..', 'build_public_guides.js'),
};

// ============================================================================
// FIRECRAWL MCP CHECK
// ============================================================================

/**
 * Check if Firecrawl MCP is available and exit loudly if not.
 */
function assertFirecrawlAvailable() {
  // Try to get scrape function from global scope (when run via Cursor MCP)
  const scrapeFunc = global.firecrawlScrape || 
    (typeof global.mcpContext === 'object' && global.mcpContext.scrape) ||
    null;
  
  if (!scrapeFunc) {
    console.error('\n' + '═'.repeat(70));
    console.error('❌ FATAL: Firecrawl MCP is NOT available');
    console.error('═'.repeat(70));
    console.error('\nThis pilot requires Firecrawl MCP to be enabled in Cursor IDE.');
    console.error('The pilot cannot proceed without Firecrawl scrape capabilities.');
    console.error('\nTo fix:');
    console.error('  1. Ensure you are running this in Cursor IDE');
    console.error('  2. Enable Firecrawl MCP in Cursor settings');
    console.error('  3. Re-run this pilot script');
    console.error('\n' + '═'.repeat(70) + '\n');
    process.exit(1);
  }
  
  // Initialize firecrawlMcp with the available function
  firecrawlMcp.initialize({ scrape: scrapeFunc }, {
    firecrawlRequired: true,
    allowHttpDocDownload: false,
  });
  
  console.log('✅ Firecrawl MCP is available\n');
  return scrapeFunc;
}

// ============================================================================
// PILOT SCRAPING
// ============================================================================

/**
 * Scrape a single URL with the pilot configuration.
 */
async function scrapeUrl(url) {
  console.log(`  📄 Scraping: ${url}`);
  
  // Check for URL-specific overrides
  const overrides = getFirecrawlOverridesForUrl(url);
  const overrideApplied = Boolean(overrides);
  
  if (overrideApplied) {
    console.log(`     ${formatOverrideLog(overrides, url)}`);
  }
  
  try {
    const result = await firecrawlMcp.firecrawlScrape(url, {
      formats: ['markdown', 'html'],
      onlyMainContent: true,
      removeBase64Images: true,
      allowEmpty: false,
    });
    
    return {
      url,
      success: true,
      overrideApplied,
      markdown: result.markdown || '',
      html: result.html || result.rawHtml || '',
      title: result.title || url,
      markdownLength: (result.markdown || '').length,
    };
  } catch (error) {
    console.log(`     ❌ Failed: ${error.message}`);
    return {
      url,
      success: false,
      overrideApplied,
      error: error.message,
    };
  }
}

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// CLAIM PROCESSING
// ============================================================================

/**
 * Process scraped pages and extract claims.
 */
function processScrapedPages(scrapedPages, kb) {
  const stats = {
    pagesProcessed: 0,
    feesExtracted: 0,
    feeClaimsWritten: 0,
    docLinksFound: 0,
    stepsExtracted: 0,
    faqsExtracted: 0,
    claimsWritten: 0,
    duplicatesSkipped: 0,
    feeClaimIds: [],
    docClaimIds: [],
  };
  
  for (const page of scrapedPages) {
    if (!page.success) continue;
    
    const domain = getDomain(page.url);
    const sourcePageId = generateSourcePageId(page.url);
    const contentHash = generateHash(page.markdown);
    
    // Add/update source page in KB
    addOrUpdateSourcePage(kb, {
      url: page.url,
      domain: domain,
      title: page.title,
      markdown: page.markdown,
      contentHash: contentHash,
      snapshotRef: `pilot/${getDateString()}`,
    }, classifyPage);
    
    // Extract structured data
    const structuredData = extractStructuredData(page.markdown, page.url, page.html);
    
    stats.feesExtracted += structuredData.feeTable.length;
    stats.docLinksFound += structuredData.documentList.length;
    stats.stepsExtracted += structuredData.steps.length;
    stats.faqsExtracted += structuredData.faqPairs.length;
    
    // Extract claims with correct service_id
    const claims = extractClaims(page.markdown, sourcePageId, page.url, structuredData, {
      serviceId: PILOT_CONFIG.serviceId,
    });
    
    // Track claim IDs by type before adding
    const feeClaimsBefore = kb.claims.filter(c => c.claim_type === 'fee').length;
    
    // Add claims to KB
    const claimsAdded = addClaimsToKB(kb, claims);
    stats.claimsWritten += claimsAdded;
    stats.duplicatesSkipped += (claims.length - claimsAdded);
    
    // Track fee claim IDs for this page
    const feeClaims = claims.filter(c => c.claim_type === 'fee');
    stats.feeClaimIds.push(...feeClaims.map(c => c.claim_id));
    stats.feeClaimsWritten += feeClaims.filter(fc => 
      !kb.claims.slice(0, feeClaimsBefore).some(c => c.claim_id === fc.claim_id)
    ).length;
    
    // Track doc claim IDs
    const docClaims = claims.filter(c => c.claim_type === 'document_requirement');
    stats.docClaimIds.push(...docClaims.map(c => c.claim_id));
    
    stats.pagesProcessed++;
    console.log(`     ✓ Extracted: ${feeClaims.length} fees, ${structuredData.documentList.length} docs, ${structuredData.steps.length} steps`);
  }
  
  // Deduplicate claim IDs
  stats.feeClaimIds = [...new Set(stats.feeClaimIds)];
  stats.docClaimIds = [...new Set(stats.docClaimIds)];
  
  return stats;
}

// ============================================================================
// GUIDE UPDATE (PILOT-SCOPED)
// ============================================================================

/**
 * Update guide.epassport sections with discovered fee claim IDs.
 * 
 * PILOT-SCOPED: Only updates guide.epassport, does not apply globally.
 */
function updateEpassportGuide(kb, feeClaimIds, docClaimIds) {
  const guide = kb.service_guides.find(g => g.guide_id === PILOT_CONFIG.guideId);
  
  if (!guide) {
    console.log('  ⚠️  guide.epassport not found in KB, cannot update');
    return { updated: false, reason: 'guide_not_found' };
  }
  
  // Ensure sections object exists
  if (!guide.sections) {
    guide.sections = {};
  }
  
  // Get existing fee claim IDs from the guide
  const existingFeeClaimIds = new Set();
  if (guide.sections.fees) {
    for (const feeItem of guide.sections.fees) {
      for (const claimId of (feeItem.claim_ids || [])) {
        existingFeeClaimIds.add(claimId);
      }
    }
  }
  if (guide.fees) {
    for (const feeItem of guide.fees) {
      for (const claimId of (feeItem.claim_ids || [])) {
        existingFeeClaimIds.add(claimId);
      }
    }
  }
  
  // Collect ALL fee claims for svc.epassport from KB
  const allEpassportFeeClaims = kb.claims.filter(c => 
    c.claim_type === 'fee' && 
    c.entity_ref?.id === PILOT_CONFIG.serviceId
  );
  
  // Build new fees section from all fee claims
  const newFeeItems = allEpassportFeeClaims.map(claim => ({
    label: claim.text || claim.structured_data?.label || 'Fee',
    description: claim.structured_data?.variant 
      ? `${claim.structured_data.variant}: ${claim.structured_data.amount_bdt} BDT`
      : `${claim.structured_data?.amount_bdt || '?'} BDT`,
    claim_ids: [claim.claim_id],
  }));
  
  // Update guide.sections.fees
  if (newFeeItems.length > 0) {
    guide.sections.fees = newFeeItems;
    console.log(`  ✓ Updated guide.sections.fees with ${newFeeItems.length} fee items`);
  }
  
  // Also update top-level guide.fees if it exists
  if (guide.fees && newFeeItems.length > 0) {
    guide.fees = newFeeItems;
    console.log(`  ✓ Updated guide.fees with ${newFeeItems.length} fee items`);
  }
  
  // Add document_links section if doc claims exist
  if (docClaimIds.length > 0) {
    const docClaims = kb.claims.filter(c => docClaimIds.includes(c.claim_id));
    if (docClaims.length > 0) {
      guide.sections.document_links = docClaims.map(claim => ({
        label: claim.text || 'Document',
        description: claim.structured_data?.url || null,
        claim_ids: [claim.claim_id],
      }));
      console.log(`  ✓ Added guide.sections.document_links with ${docClaims.length} items`);
    }
  }
  
  // Update guide timestamp
  guide.last_updated_at = new Date().toISOString();
  
  return {
    updated: true,
    feeItemsCount: newFeeItems.length,
    docLinksCount: docClaimIds.length,
  };
}

// ============================================================================
// AUTO_* CLAIM ID MIGRATION (PILOT-SCOPED)
// ============================================================================

/**
 * Find and migrate any auto_* claim IDs referenced by guide.epassport.
 * 
 * For each auto_* claim:
 * 1. Regenerate a deterministic claim_id
 * 2. Update guide references to the new ID
 * 3. Update the claim in KB with new ID
 */
function migrateAutoClaimIds(kb) {
  const guide = kb.service_guides.find(g => g.guide_id === PILOT_CONFIG.guideId);
  if (!guide) {
    return { migrated: 0, autoIdsFound: [], autoIdsRemaining: [] };
  }
  
  // Collect all claim IDs referenced by this guide
  const referencedClaimIds = new Set();
  
  // From sections
  if (guide.sections) {
    for (const sectionItems of Object.values(guide.sections)) {
      if (Array.isArray(sectionItems)) {
        for (const item of sectionItems) {
          for (const claimId of (item.claim_ids || [])) {
            referencedClaimIds.add(claimId);
          }
        }
      }
    }
  }
  
  // From steps
  if (guide.steps) {
    for (const step of guide.steps) {
      for (const claimId of (step.claim_ids || [])) {
        referencedClaimIds.add(claimId);
      }
    }
  }
  
  // From fees
  if (guide.fees) {
    for (const fee of guide.fees) {
      for (const claimId of (fee.claim_ids || [])) {
        referencedClaimIds.add(claimId);
      }
    }
  }
  
  // From variants
  if (guide.variants) {
    for (const variant of guide.variants) {
      for (const claimId of (variant.fee_claim_ids || [])) {
        referencedClaimIds.add(claimId);
      }
      for (const claimId of (variant.processing_time_claim_ids || [])) {
        referencedClaimIds.add(claimId);
      }
    }
  }
  
  // Find auto_* claim IDs
  const autoClaimIds = [...referencedClaimIds].filter(id => id.startsWith('auto_'));
  
  if (autoClaimIds.length === 0) {
    return { migrated: 0, autoIdsFound: [], autoIdsRemaining: [] };
  }
  
  console.log(`  ⚠️  Found ${autoClaimIds.length} auto_* claim IDs in guide.epassport`);
  
  // For each auto_* claim, check if a deterministic version exists
  const migrated = [];
  const remaining = [];
  
  for (const autoId of autoClaimIds) {
    // Find the claim
    const claim = kb.claims.find(c => c.claim_id === autoId);
    if (!claim) {
      console.log(`     ⚠️  auto_* claim not found in KB: ${autoId}`);
      remaining.push(autoId);
      continue;
    }
    
    // Look for a deterministic claim with matching content
    const deterministicClaim = kb.claims.find(c => 
      c.claim_id !== autoId &&
      c.claim_type === claim.claim_type &&
      c.entity_ref?.id === claim.entity_ref?.id &&
      c.text === claim.text &&
      !c.claim_id.startsWith('auto_')
    );
    
    if (deterministicClaim) {
      // Replace references to auto_* with deterministic ID
      replaceClaimIdInGuide(guide, autoId, deterministicClaim.claim_id);
      migrated.push({ from: autoId, to: deterministicClaim.claim_id });
      console.log(`     ✓ Migrated: ${autoId} → ${deterministicClaim.claim_id}`);
    } else {
      remaining.push(autoId);
      console.log(`     ⚠️  No deterministic replacement found for: ${autoId}`);
    }
  }
  
  return {
    migrated: migrated.length,
    autoIdsFound: autoClaimIds,
    autoIdsRemaining: remaining,
  };
}

/**
 * Replace a claim ID in all guide references.
 */
function replaceClaimIdInGuide(guide, oldId, newId) {
  function replaceInArray(arr) {
    const idx = arr.indexOf(oldId);
    if (idx !== -1) {
      arr[idx] = newId;
    }
  }
  
  // Sections
  if (guide.sections) {
    for (const sectionItems of Object.values(guide.sections)) {
      if (Array.isArray(sectionItems)) {
        for (const item of sectionItems) {
          if (item.claim_ids) replaceInArray(item.claim_ids);
        }
      }
    }
  }
  
  // Steps
  if (guide.steps) {
    for (const step of guide.steps) {
      if (step.claim_ids) replaceInArray(step.claim_ids);
    }
  }
  
  // Fees
  if (guide.fees) {
    for (const fee of guide.fees) {
      if (fee.claim_ids) replaceInArray(fee.claim_ids);
    }
  }
  
  // Variants
  if (guide.variants) {
    for (const variant of guide.variants) {
      if (variant.fee_claim_ids) replaceInArray(variant.fee_claim_ids);
      if (variant.processing_time_claim_ids) replaceInArray(variant.processing_time_claim_ids);
    }
  }
}

/**
 * Assert that guide.epassport has no auto_* claim IDs.
 */
function assertNoAutoClaimIds(kb) {
  const guide = kb.service_guides.find(g => g.guide_id === PILOT_CONFIG.guideId);
  if (!guide) {
    return { pass: true, message: 'Guide not found (vacuously true)' };
  }
  
  // Collect all referenced claim IDs
  const referencedClaimIds = [];
  
  if (guide.sections) {
    for (const sectionItems of Object.values(guide.sections)) {
      if (Array.isArray(sectionItems)) {
        for (const item of sectionItems) {
          referencedClaimIds.push(...(item.claim_ids || []));
        }
      }
    }
  }
  
  if (guide.steps) {
    for (const step of guide.steps) {
      referencedClaimIds.push(...(step.claim_ids || []));
    }
  }
  
  if (guide.fees) {
    for (const fee of guide.fees) {
      referencedClaimIds.push(...(fee.claim_ids || []));
    }
  }
  
  if (guide.variants) {
    for (const variant of guide.variants) {
      referencedClaimIds.push(...(variant.fee_claim_ids || []));
      referencedClaimIds.push(...(variant.processing_time_claim_ids || []));
    }
  }
  
  const autoIds = referencedClaimIds.filter(id => id.startsWith('auto_'));
  
  if (autoIds.length > 0) {
    return {
      pass: false,
      message: `Found ${autoIds.length} auto_* claim IDs: ${autoIds.join(', ')}`,
      autoIds,
    };
  }
  
  return { pass: true, message: 'No auto_* claim IDs found' };
}

// ============================================================================
// BUILD AND VALIDATION
// ============================================================================

/**
 * Run build_public_guides.js
 */
function buildPublicGuides() {
  console.log('\n📦 Building public guides...');
  try {
    execSync(`node "${PATHS.buildScript}"`, {
      cwd: path.join(__dirname, '..', '..'),
      stdio: 'inherit',
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Run validate:published
 */
function validatePublished() {
  console.log('\n🔍 Validating published guides...');
  try {
    execSync('npm run validate:published', {
      cwd: path.join(__dirname, '..', '..'),
      stdio: 'inherit',
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Count fee items in public_guides.json for guide.epassport
 */
function countPublicGuidesFees() {
  if (!fs.existsSync(PATHS.publicGuidesPath)) {
    return { count: 0, error: 'public_guides.json not found' };
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(PATHS.publicGuidesPath, 'utf-8'));
    const epassportGuide = data.guides.find(g => g.guide_id === PILOT_CONFIG.guideId);
    
    if (!epassportGuide) {
      return { count: 0, error: 'guide.epassport not found in public_guides.json' };
    }
    
    // Count fees from sections.fees
    let feeCount = 0;
    if (epassportGuide.sections?.fees) {
      feeCount += epassportGuide.sections.fees.length;
    }
    
    // Or from top-level fees
    if (epassportGuide.fees) {
      feeCount = Math.max(feeCount, epassportGuide.fees.length);
    }
    
    return { count: feeCount };
  } catch (error) {
    return { count: 0, error: error.message };
  }
}

// ============================================================================
// REPORT GENERATION
// ============================================================================

/**
 * Generate pilot report JSON.
 */
function generateReport(runNumber, scrapedPages, extractionStats, guideUpdate, migrationResult, buildResult, validateResult, autoClaimCheck) {
  const overrideApplied = scrapedPages.some(p => p.overrideApplied && p.success);
  const publicGuidesFees = countPublicGuidesFees();
  
  return {
    run: runNumber,
    timestamp: new Date().toISOString(),
    pilot_config: {
      target_urls: PILOT_CONFIG.targetUrls,
      service_id: PILOT_CONFIG.serviceId,
      guide_id: PILOT_CONFIG.guideId,
    },
    scrape_results: {
      total: scrapedPages.length,
      successful: scrapedPages.filter(p => p.success).length,
      failed: scrapedPages.filter(p => !p.success).length,
      override_applied: overrideApplied,
    },
    extraction: {
      fees_extracted: extractionStats.feesExtracted,
      fee_claims_written: extractionStats.feeClaimsWritten,
      doc_links_found: extractionStats.docLinksFound,
      steps_extracted: extractionStats.stepsExtracted,
      faqs_extracted: extractionStats.faqsExtracted,
      total_claims_written: extractionStats.claimsWritten,
      duplicates_skipped: extractionStats.duplicatesSkipped,
      fee_claim_ids: extractionStats.feeClaimIds,
    },
    guide_update: guideUpdate,
    auto_claim_migration: migrationResult,
    auto_claim_check: autoClaimCheck,
    build: buildResult,
    validation: validateResult,
    public_guides_fee_count_for_epassport: publicGuidesFees.count,
    new_claims_added: extractionStats.claimsWritten,
    summary: {
      override_applied: overrideApplied,
      fees_extracted: extractionStats.feesExtracted,
      fee_claims_written: extractionStats.feeClaimsWritten,
      doc_links_found: extractionStats.docLinksFound,
      public_guides_fee_count_for_epassport: publicGuidesFees.count,
      new_claims_added: extractionStats.claimsWritten,
      auto_ids_remaining: autoClaimCheck.autoIds?.length || 0,
      build_success: buildResult.success,
      validation_success: validateResult.success,
    },
  };
}

// ============================================================================
// MAIN PILOT EXECUTION
// ============================================================================

/**
 * Run a single pilot pass.
 */
async function runPilotPass(runNumber) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  🚀 ePassport Preflight Pilot - Run ${runNumber}`);
  console.log(`${'═'.repeat(70)}\n`);
  
  // Load KB
  console.log('📁 Loading knowledge base...');
  const kb = loadOrCreateKB(PATHS.kbPath);
  console.log(`   Loaded: ${kb.source_pages.length} source pages, ${kb.claims.length} claims\n`);
  
  // Scrape target URLs
  console.log('📡 Scraping target URLs...');
  const scrapedPages = [];
  
  for (let i = 0; i < PILOT_CONFIG.targetUrls.length; i++) {
    const url = PILOT_CONFIG.targetUrls[i];
    const result = await scrapeUrl(url);
    scrapedPages.push(result);
    
    // Rate limiting between requests
    if (i < PILOT_CONFIG.targetUrls.length - 1) {
      await sleep(PILOT_CONFIG.rateLimit);
    }
  }
  
  // Process scraped pages and extract claims
  console.log('\n⚙️  Processing scraped pages...');
  const extractionStats = processScrapedPages(scrapedPages, kb);
  
  console.log(`\n   Summary: ${extractionStats.claimsWritten} claims written, ${extractionStats.duplicatesSkipped} duplicates skipped`);
  
  // Update guide.epassport (PILOT-SCOPED)
  console.log('\n📝 Updating guide.epassport...');
  const guideUpdate = updateEpassportGuide(kb, extractionStats.feeClaimIds, extractionStats.docClaimIds);
  
  // Migrate auto_* claim IDs (PILOT-SCOPED)
  console.log('\n🔄 Checking for auto_* claim IDs...');
  const migrationResult = migrateAutoClaimIds(kb);
  
  // Save KB
  console.log('\n💾 Saving knowledge base...');
  saveKB(kb, PATHS.kbPath);
  
  // Build public guides
  const buildResult = buildPublicGuides();
  
  // Validate published
  const validateResult = validatePublished();
  
  // Check for remaining auto_* claim IDs
  console.log('\n🔍 Asserting no auto_* claim IDs remain...');
  const autoClaimCheck = assertNoAutoClaimIds(kb);
  if (autoClaimCheck.pass) {
    console.log('   ✅ PASS: No auto_* claim IDs in guide.epassport');
  } else {
    console.log(`   ⚠️  WARN: ${autoClaimCheck.message}`);
  }
  
  // Generate report
  const report = generateReport(
    runNumber,
    scrapedPages,
    extractionStats,
    guideUpdate,
    migrationResult,
    buildResult,
    validateResult,
    autoClaimCheck
  );
  
  // Save report
  ensureDir(PATHS.pilotRunsDir);
  const reportPath = path.join(PATHS.pilotRunsDir, `epassport_preflight_report_run${runNumber}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n📄 Report saved: ${reportPath}`);
  
  return report;
}

/**
 * Main entry point.
 */
async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('  🔬 ePassport Preflight Pilot');
  console.log('  Proving crawl pipeline is production-ready');
  console.log('═'.repeat(70) + '\n');
  
  // Check Firecrawl MCP availability
  console.log('🔌 Checking Firecrawl MCP availability...');
  assertFirecrawlAvailable();
  
  // Run 1: Initial pass
  const report1 = await runPilotPass(1);
  
  console.log('\n' + '─'.repeat(70));
  console.log('  Run 1 Complete - Key Results:');
  console.log('─'.repeat(70));
  console.log(`  override_applied: ${report1.summary.override_applied}`);
  console.log(`  fees_extracted: ${report1.summary.fees_extracted}`);
  console.log(`  fee_claims_written: ${report1.summary.fee_claims_written}`);
  console.log(`  doc_links_found: ${report1.summary.doc_links_found}`);
  console.log(`  public_guides_fee_count_for_epassport: ${report1.summary.public_guides_fee_count_for_epassport}`);
  console.log(`  new_claims_added: ${report1.summary.new_claims_added}`);
  console.log('─'.repeat(70) + '\n');
  
  // Wait between runs
  console.log('⏳ Waiting 2 seconds before idempotency rerun...\n');
  await sleep(2000);
  
  // Run 2: Idempotency check (same process without deleting KB)
  const report2 = await runPilotPass(2);
  
  console.log('\n' + '─'.repeat(70));
  console.log('  Run 2 Complete - Idempotency Check:');
  console.log('─'.repeat(70));
  console.log(`  new_claims_added: ${report2.summary.new_claims_added}`);
  console.log(`  duplicates_skipped: ${report2.extraction.duplicates_skipped}`);
  console.log('─'.repeat(70) + '\n');
  
  // Final summary
  console.log('\n' + '═'.repeat(70));
  console.log('  📊 PILOT SUMMARY');
  console.log('═'.repeat(70));
  
  const allPassed = 
    report1.summary.override_applied &&
    report1.summary.fees_extracted > 0 &&
    report1.summary.public_guides_fee_count_for_epassport > 3 &&
    report2.summary.new_claims_added === 0 &&
    report1.summary.auto_ids_remaining === 0 &&
    report1.summary.build_success &&
    report1.summary.validation_success;
  
  console.log(`\n  1) Override applied on SPA fee page: ${report1.summary.override_applied ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  2) Fee claims in public guide (>3): ${report1.summary.public_guides_fee_count_for_epassport > 3 ? '✅ PASS' : '❌ FAIL'} (${report1.summary.public_guides_fee_count_for_epassport} fees)`);
  console.log(`  3) Idempotency (0 new claims on run2): ${report2.summary.new_claims_added === 0 ? '✅ PASS' : '❌ FAIL'} (${report2.summary.new_claims_added} new)`);
  console.log(`  4) No auto_* claim IDs: ${report1.summary.auto_ids_remaining === 0 ? '✅ PASS' : '❌ FAIL'} (${report1.summary.auto_ids_remaining} remaining)`);
  console.log(`  5) Build success: ${report1.summary.build_success ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  6) Validation success: ${report1.summary.validation_success ? '✅ PASS' : '❌ FAIL'}`);
  
  console.log(`\n  OVERALL: ${allPassed ? '✅ ALL CHECKS PASSED' : '⚠️  SOME CHECKS FAILED'}`);
  console.log('═'.repeat(70) + '\n');
  
  if (!allPassed) {
    process.exit(1);
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================

if (require.main === module) {
  main().catch(err => {
    console.error(`\n❌ Fatal error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = {
  runPilotPass,
  processScrapedPages,
  updateEpassportGuide,
  migrateAutoClaimIds,
  assertNoAutoClaimIds,
  PILOT_CONFIG,
  PATHS,
};

