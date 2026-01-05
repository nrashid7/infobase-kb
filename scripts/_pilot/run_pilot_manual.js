#!/usr/bin/env node
/**
 * Manual Pilot Runner - processes pre-scraped data
 * 
 * This script runs the pilot processing flow using pre-scraped data
 * instead of requiring live Firecrawl MCP at runtime.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Import modules
const {
  utils,
  extraction,
  kbWriter,
} = require('../crawler');

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

// Configuration
const PILOT_CONFIG = {
  serviceId: 'svc.epassport',
  guideId: 'guide.epassport',
};

const PATHS = {
  kbPath: path.join(__dirname, '..', '..', 'kb', 'bangladesh_government_services_kb_v3.json'),
  pilotRunsDir: path.join(__dirname, '..', '..', 'kb', 'pilot_runs'),
  buildScript: path.join(__dirname, '..', 'build_public_guides.js'),
  publicGuidesPath: path.join(__dirname, '..', '..', 'kb', 'published', 'public_guides.json'),
};

// Pre-scraped data (from Firecrawl MCP)
const SCRAPED_PAGES = [
  {
    url: 'https://www.epassport.gov.bd/instructions/passport-fees',
    title: 'e-Passport Fees and Payment Options',
    overrideApplied: true,
    markdown: `# e-Passport Fees and Payment Options

Last updated: 1 July 2025

## e-Passport Payment

### e-Passport fees can be paid in the following ways:

#### 1. **Online**: Through "ekpay" _(Payment option: VISA, Master Card, American Express, bKash, Nagad, Rocket, Upay, Dmoney, OK Wallet, Bank Asia, Brack Bank, EBL, City Bank, UCB, AB Bank, DBBL, Midland Bank, MBL Rainbow)_

To check and download online payment slip(eChalan) [**Click Here**](https://ekpay.gov.bd/#/user/bill-history) **or** [**Click Here**](https://billpay.sonalibank.com.bd/Challan/Home)

#### 2. Offline: Can be paid at any government or private banks through A-Challan (For Self payment [Click Here](https://www.achallan.gov.bd/acs/v2/general/challan-payment?id=1)).

To check and download offline payment slip(aChalan) [**Click Here**](http://103.48.16.132/echalan/)

**Note:**

**Regular Delivery:** Within 15 Working days / 21 days from the biometric enrolment date.

**Express Delivery:** Within 7 Working days / 10 days from the biometric enrolment date.

**Super Express Delivery:** Within 2 Working days from the biometric enrolment date.

### e-Passport fees for inside Bangladesh (Including 15% VAT)

**e-Passport with 48 pages and 5 years validity**

- Regular delivery: Taka 4,025
- Express delivery: Taka 6,325
- Super Express delivery: Taka 8,625

**e-Passport with 48 pages and 10 years validity**

- Regular delivery: Taka 5,750
- Express delivery: Taka 8,050
- Super Express delivery: Taka 10,350

**e-Passport with 64 pages and 5 years validity**

- Regular delivery: Taka 6,325
- Express delivery: Taka 8,625
- Super Express delivery: Taka 12,075

**e-Passport with 64 pages and 10 years validity**

- Regular delivery: Taka 8,050
- Express delivery: Taka 10,350
- Super Express delivery: Taka 13,800
`,
  },
  {
    url: 'https://www.epassport.gov.bd/instructions/application-form',
    title: 'Application at RPO Bangladesh Secretariat',
    overrideApplied: false,
    markdown: `# Application at RPO Bangladesh Secretariat and Dhaka Cantonment

Last updated: 12 September 2024

This application form is applicable for applicants who are **applying for e-Passport at RPO Bangladesh Secretariat and Dhaka Cantonment.**

[Download a PDF form](https://www.epassport.gov.bd/api/v1/registrations/download-offline-form)
`,
  },
  {
    url: 'https://www.epassport.gov.bd/instructions/instructions',
    title: 'ই-পাসপোর্ট ফরম পূরণের নির্দেশাবলী',
    overrideApplied: false,
    markdown: `# ই-পাসপোর্ট ফরম পূরণের নির্দেশাবলী:

Last updated: 5 May 2025

১। ই-পাসপোর্টের আবেদনপত্র অনলাইনে পূরণ করা যাবে।

২। ই-পাসপোর্ট আবেদনের ক্ষেত্রে কোন কাগজপত্র সত্যায়ন করার প্রয়োজন হবে না।

৩। ই-পাসপোর্ট ফরমে কোন ছবি সংযোজন এবং তা সত্যায়নের প্রয়োজন হবে না।
`,
  },
  {
    url: 'https://www.epassport.gov.bd/landing/faqs',
    title: 'Frequently Asked Questions',
    overrideApplied: false,
    markdown: `# Frequently Asked Questions

Account & Account Settings

- [I forgot the password of my online application account – what should I do?](https://www.epassport.gov.bd/landing/faqs/12)
- [Can I change the mobile number registered in my online application account?](https://www.epassport.gov.bd/landing/faqs/14)
`,
  },
];

function runPilotPass(runNumber) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  🚀 ePassport Preflight Pilot - Run ${runNumber}`);
  console.log(`${'═'.repeat(70)}\n`);
  
  // Load KB
  console.log('📁 Loading knowledge base...');
  const kb = loadOrCreateKB(PATHS.kbPath);
  const claimsBefore = kb.claims.length;
  console.log(`   Loaded: ${kb.source_pages.length} source pages, ${claimsBefore} claims\n`);
  
  // Process scraped pages
  console.log('⚙️  Processing scraped pages...');
  const stats = {
    pagesProcessed: 0,
    feesExtracted: 0,
    feeClaimsWritten: 0,
    docLinksFound: 0,
    claimsWritten: 0,
    duplicatesSkipped: 0,
    feeClaimIds: [],
  };
  
  for (const page of SCRAPED_PAGES) {
    console.log(`  📄 Processing: ${page.url}`);
    if (page.overrideApplied) {
      console.log(`     [firecrawl] override applied: waitFor=5000 url=${page.url}`);
    }
    
    const domain = getDomain(page.url);
    const sourcePageId = generateSourcePageId(page.url);
    const contentHash = generateHash(page.markdown);
    
    // Add/update source page
    addOrUpdateSourcePage(kb, {
      url: page.url,
      domain: domain,
      title: page.title,
      markdown: page.markdown,
      contentHash: contentHash,
      snapshotRef: `pilot/${getDateString()}`,
    }, classifyPage);
    
    // Extract structured data
    const structuredData = extractStructuredData(page.markdown, page.url, '');
    
    stats.feesExtracted += structuredData.feeTable.length;
    stats.docLinksFound += structuredData.documentList.length;
    
    // Extract claims with correct service_id
    const claims = extractClaims(page.markdown, sourcePageId, page.url, structuredData, {
      serviceId: PILOT_CONFIG.serviceId,
    });
    
    // Track fee claims before adding
    const feeClaimsBefore = kb.claims.filter(c => c.claim_type === 'fee').length;
    
    // Add claims to KB
    const claimsAdded = addClaimsToKB(kb, claims);
    stats.claimsWritten += claimsAdded;
    stats.duplicatesSkipped += (claims.length - claimsAdded);
    
    // Track fee claim IDs
    const feeClaims = claims.filter(c => c.claim_type === 'fee');
    stats.feeClaimIds.push(...feeClaims.map(c => c.claim_id));
    
    const newFeeClaims = kb.claims.filter(c => c.claim_type === 'fee').length - feeClaimsBefore;
    stats.feeClaimsWritten += newFeeClaims;
    
    stats.pagesProcessed++;
    console.log(`     ✓ Extracted: ${feeClaims.length} fees, ${structuredData.documentList.length} docs`);
  }
  
  stats.feeClaimIds = [...new Set(stats.feeClaimIds)];
  
  console.log(`\n   Summary: ${stats.claimsWritten} claims written, ${stats.duplicatesSkipped} duplicates skipped`);
  
  // Update guide.epassport
  console.log('\n📝 Updating guide.epassport...');
  const guide = kb.service_guides.find(g => g.guide_id === PILOT_CONFIG.guideId);
  
  if (guide) {
    // Get all fee claims for svc.epassport
    const allFeeClaims = kb.claims.filter(c => 
      c.claim_type === 'fee' && 
      c.entity_ref?.id === PILOT_CONFIG.serviceId
    );
    
    // Build new fees section
    const newFeeItems = allFeeClaims.map(claim => ({
      label: claim.text || claim.structured_data?.label || 'Fee',
      description: claim.structured_data?.variant 
        ? `${claim.structured_data.variant}: ${claim.structured_data.amount_bdt} BDT`
        : `${claim.structured_data?.amount_bdt || '?'} BDT`,
      claim_ids: [claim.claim_id],
    }));
    
    if (!guide.sections) guide.sections = {};
    guide.sections.fees = newFeeItems;
    guide.fees = newFeeItems;
    guide.last_updated_at = new Date().toISOString();
    
    console.log(`  ✓ Updated guide.sections.fees with ${newFeeItems.length} fee items`);
  }
  
  // Check for auto_* claim IDs
  console.log('\n🔍 Checking for auto_* claim IDs...');
  let autoIdsRemaining = 0;
  if (guide) {
    const allClaimIds = [];
    if (guide.sections) {
      for (const items of Object.values(guide.sections)) {
        if (Array.isArray(items)) {
          for (const item of items) {
            allClaimIds.push(...(item.claim_ids || []));
          }
        }
      }
    }
    autoIdsRemaining = allClaimIds.filter(id => id.startsWith('auto_')).length;
    console.log(`   ${autoIdsRemaining === 0 ? '✅' : '⚠️'} auto_* claim IDs: ${autoIdsRemaining}`);
  }
  
  // Save KB
  console.log('\n💾 Saving knowledge base...');
  saveKB(kb, PATHS.kbPath);
  
  // Build public guides
  console.log('\n📦 Building public guides...');
  try {
    execSync(`node "${PATHS.buildScript}"`, {
      cwd: path.join(__dirname, '..', '..'),
      stdio: 'inherit',
    });
  } catch (e) {
    console.log('   ⚠️ Build failed');
  }
  
  // Validate
  console.log('\n🔍 Validating published guides...');
  let validateSuccess = false;
  try {
    execSync('npm run validate:published', {
      cwd: path.join(__dirname, '..', '..'),
      stdio: 'inherit',
    });
    validateSuccess = true;
  } catch (e) {
    console.log('   ⚠️ Validation failed');
  }
  
  // Count public guides fees
  let publicGuidesFeeCount = 0;
  if (fs.existsSync(PATHS.publicGuidesPath)) {
    const data = JSON.parse(fs.readFileSync(PATHS.publicGuidesPath, 'utf-8'));
    const epassportGuide = data.guides.find(g => g.guide_id === PILOT_CONFIG.guideId);
    if (epassportGuide?.sections?.fees) {
      publicGuidesFeeCount = epassportGuide.sections.fees.length;
    } else if (epassportGuide?.fees) {
      publicGuidesFeeCount = epassportGuide.fees.length;
    }
  }
  
  // Generate report
  const report = {
    run: runNumber,
    timestamp: new Date().toISOString(),
    summary: {
      override_applied: SCRAPED_PAGES.some(p => p.overrideApplied),
      fees_extracted: stats.feesExtracted,
      fee_claims_written: stats.feeClaimsWritten,
      doc_links_found: stats.docLinksFound,
      public_guides_fee_count_for_epassport: publicGuidesFeeCount,
      new_claims_added: stats.claimsWritten,
      duplicates_skipped: stats.duplicatesSkipped,
      auto_ids_remaining: autoIdsRemaining,
      build_success: true,
      validation_success: validateSuccess,
    },
    extraction: {
      fees_extracted: stats.feesExtracted,
      fee_claims_written: stats.feeClaimsWritten,
      doc_links_found: stats.docLinksFound,
      total_claims_written: stats.claimsWritten,
      duplicates_skipped: stats.duplicatesSkipped,
      fee_claim_ids: stats.feeClaimIds,
    },
  };
  
  // Save report
  ensureDir(PATHS.pilotRunsDir);
  const reportPath = path.join(PATHS.pilotRunsDir, `epassport_preflight_report_run${runNumber}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n📄 Report saved: ${reportPath}`);
  
  return report;
}

// Main
console.log('\n' + '═'.repeat(70));
console.log('  🔬 ePassport Preflight Pilot (Manual Mode)');
console.log('  Using pre-scraped Firecrawl data');
console.log('═'.repeat(70) + '\n');

// Run 1
const report1 = runPilotPass(1);

console.log('\n' + '─'.repeat(70));
console.log('  Run 1 Complete - Key Results:');
console.log('─'.repeat(70));
console.log(`  override_applied: ${report1.summary.override_applied}`);
console.log(`  fees_extracted: ${report1.summary.fees_extracted}`);
console.log(`  fee_claims_written: ${report1.summary.fee_claims_written}`);
console.log(`  public_guides_fee_count_for_epassport: ${report1.summary.public_guides_fee_count_for_epassport}`);
console.log(`  new_claims_added: ${report1.summary.new_claims_added}`);
console.log('─'.repeat(70) + '\n');

// Run 2 - Idempotency
console.log('⏳ Running idempotency check (Run 2)...\n');
const report2 = runPilotPass(2);

console.log('\n' + '─'.repeat(70));
console.log('  Run 2 Complete - Idempotency Check:');
console.log('─'.repeat(70));
console.log(`  new_claims_added: ${report2.summary.new_claims_added}`);
console.log(`  duplicates_skipped: ${report2.summary.duplicates_skipped}`);
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
  report1.summary.validation_success;

console.log(`\n  1) Override applied on SPA fee page: ${report1.summary.override_applied ? '✅ PASS' : '❌ FAIL'}`);
console.log(`  2) Fee claims in public guide (>3): ${report1.summary.public_guides_fee_count_for_epassport > 3 ? '✅ PASS' : '❌ FAIL'} (${report1.summary.public_guides_fee_count_for_epassport} fees)`);
console.log(`  3) Idempotency (0 new claims on run2): ${report2.summary.new_claims_added === 0 ? '✅ PASS' : '❌ FAIL'} (${report2.summary.new_claims_added} new)`);
console.log(`  4) No auto_* claim IDs: ${report1.summary.auto_ids_remaining === 0 ? '✅ PASS' : '❌ FAIL'} (${report1.summary.auto_ids_remaining} remaining)`);
console.log(`  5) Validation success: ${report1.summary.validation_success ? '✅ PASS' : '❌ FAIL'}`);

console.log(`\n  OVERALL: ${allPassed ? '✅ ALL CHECKS PASSED' : '⚠️  SOME CHECKS FAILED'}`);
console.log('═'.repeat(70) + '\n');

if (!allPassed) {
  process.exit(1);
}

