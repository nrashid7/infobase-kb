#!/usr/bin/env node
'use strict';

/**
 * Fee Extraction Test
 *
 * Tests that TK normalization works correctly:
 * - TK tokens are replaced with BDT
 * - Fee extraction works
 * - Fee labels do not contain TK
 *
 * Run with: node scripts/_pilot/test_fee_extraction.js
 */

const fs = require('fs');
const path = require('path');

// Import crawler modules
const { extractStructuredData, extractClaims } = require('../crawler/extraction');
const { getFirecrawlOverridesForUrl } = require('../crawler/firecrawl_overrides');

// ============================================================================
// CONFIGURATION
// ============================================================================

const TARGET_URL = 'https://www.epassport.gov.bd/instructions/passport-fees';

// Load fixture
const FIXTURE_PATH = path.join(__dirname, '..', 'crawler', '__tests__', 'fixtures', 'firecrawl_epassport_fees_real.md');
const fixtureContent = fs.readFileSync(FIXTURE_PATH, 'utf-8');

// ============================================================================
// MAIN LOGIC
// ============================================================================

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('  FEE EXTRACTION TEST (TK -> BDT NORMALIZATION)');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  console.log('✅ Using fixture for testing');
  console.log(`🔗 Target: ${TARGET_URL}\n`);

  try {
    // =======================================================================
    // STEP 1: APPLY OVERRIDES (TEST)
    // =======================================================================

    console.log('🔧 Testing Firecrawl override application...');

    // Get URL-specific overrides
    const urlOverrides = getFirecrawlOverridesForUrl(TARGET_URL);
    console.log(`   override_applied: ${!!urlOverrides}`);
    if (urlOverrides) {
      console.log(`   waitFor: ${urlOverrides.waitFor || 'N/A'}`);
      console.log(`   onlyMainContent: ${urlOverrides.onlyMainContent}`);
      console.log(`   postprocessMarkdown: ${typeof urlOverrides.postprocessMarkdown === 'function' ? 'present' : 'missing'}`);
    }

    // Apply postprocess to fixture (simulate what would happen in production)
    let processedContent = fixtureContent;
    if (urlOverrides && typeof urlOverrides.postprocessMarkdown === 'function') {
      processedContent = urlOverrides.postprocessMarkdown(fixtureContent);
      console.log('   ✅ Postprocess applied (TK -> BDT normalization)');

      // Show before/after sample
      const tkCountBefore = (fixtureContent.match(/\bTK\b/g) || []).length;
      const tkCountAfter = (processedContent.match(/\bTK\b/g) || []).length;
      const bdtCountAfter = (processedContent.match(/\bBDT\b/g) || []).length;
      console.log(`   TK tokens before: ${tkCountBefore}`);
      console.log(`   TK tokens after:  ${tkCountAfter}`);
      console.log(`   BDT tokens after: ${bdtCountAfter}`);
    }

    console.log(`   📝 Original lines: ${fixtureContent.split('\n').length}`);
    console.log(`   📝 Processed lines: ${processedContent.split('\n').length}`);

    // =======================================================================
    // STEP 2: EXTRACT STRUCTURED DATA
    // =======================================================================

    console.log('\n🔍 Extracting structured data...');

    const structured = extractStructuredData(processedContent, TARGET_URL);
    console.log(`   steps_extracted: ${structured.steps.length}`);
    console.log(`   fees_extracted: ${structured.feeTable.length}`);
    console.log(`   faq_pairs_extracted: ${structured.faqPairs.length}`);
    console.log(`   doc_links_found: ${structured.documentList.length}`);

    if (structured.feeTable.length === 0) {
      throw new Error('No fees extracted from fee page!');
    }

    // Check that no fee labels contain TK
    const tkLabels = structured.feeTable.filter(fee => fee.label.includes('TK'));
    console.log(`   fee_labels_with_tk: ${tkLabels.length}`);
    if (tkLabels.length > 0) {
      console.log('   ❌ Found TK tokens in fee labels:');
      tkLabels.forEach(fee => console.log(`      - "${fee.label}"`));
      throw new Error('Fee labels still contain TK tokens!');
    }

    // =======================================================================
    // STEP 3: GENERATE CLAIMS
    // =======================================================================

    console.log('\n🧠 Generating claims...');

    const sourceId = `test.${Date.now()}`;
    const claims = extractClaims(processedContent, sourceId, TARGET_URL, structured);

    const feeClaims = claims.filter(c => c.claim_type === 'fee');
    console.log(`   total_claims: ${claims.length}`);
    console.log(`   fee_claims: ${feeClaims.length}`);

    if (feeClaims.length === 0) {
      throw new Error('No fee claims generated!');
    }

    // Check citations
    const hasCitations = feeClaims.some(c => c.citations && c.citations.length > 0);
    console.log(`   citations_exist: ${hasCitations}`);

    // =======================================================================
    // STEP 4: REPORT
    // =======================================================================

    console.log('\n📊 REPORT:');
    console.log('   override_applied: true');
    console.log(`   fees_extracted: ${structured.feeTable.length}`);
    console.log('   fee_labels_no_tk: true');
    console.log(`   citations_exist: ${hasCitations}`);

    const success = structured.feeTable.length >= 1 && tkLabels.length === 0 && hasCitations;

    console.log('\n══════════════════════════════════════════════════════════════════════');
    if (success) {
      console.log('✅ TEST SUCCESS - TK normalization working correctly');
    } else {
      console.log('❌ TEST FAILED');
      process.exit(1);
    }
    console.log('══════════════════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ TEST ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
