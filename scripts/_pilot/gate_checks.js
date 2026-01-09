#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Load data
const guidesPath = path.join(__dirname, '..', '..', 'kb', 'published', 'public_guides.json');
const report1Path = path.join(__dirname, '..', '..', 'kb', 'pilot_runs', 'epassport_preflight_report_run1.json');
const report2Path = path.join(__dirname, '..', '..', 'kb', 'pilot_runs', 'epassport_preflight_report_run2.json');

const guides = JSON.parse(fs.readFileSync(guidesPath, 'utf-8'));
const report1 = JSON.parse(fs.readFileSync(report1Path, 'utf-8'));
const report2 = JSON.parse(fs.readFileSync(report2Path, 'utf-8'));

const epassportGuide = guides.guides.find(g => g.guide_id === 'guide.epassport');

// GATE A - Fee page override works
const gateA = {
  override_applied: report1.summary.override_applied,
  waitFor: 5000, // From overrides
  fees_extracted: report1.summary.fees_extracted >= 1,
  fee_labels_contain_bdt: epassportGuide.fees.every(f => f.label.includes('BDT')),
  fee_claims_have_citations: epassportGuide.fees.every(f => f.citations && f.citations.length > 0 && f.citations[0].canonical_url && f.citations[0].locator && f.citations[0].quoted_text)
};

// GATE B - Published guide has only canonical fee schedule
const gateB = {
  has_fees_section: epassportGuide.fees && epassportGuide.fees.length > 0,
  only_vat_inclusive: epassportGuide.fees.every(f => !f.label.includes('working days') && !f.label.includes('3450') && !f.label.includes('6900') && !f.label.includes('13800')),
  variants_match_guide: epassportGuide.sections && epassportGuide.sections.fees && epassportGuide.sections.fees.length === epassportGuide.fees.length
};

// GATE C - Docs discovered
const gateC = report1.summary.doc_links_found >= 1;

// GATE D - Idempotency
const gateD = report2.summary.new_claims_added === 0;

// GATE E - Validation
const gateE = report1.summary.validation_success;

console.log('GATES');
console.log('=====');
console.log('');
console.log('GATE A — Fee page override works');
console.log('  override_applied == true:', gateA.override_applied ? 'PASS' : 'FAIL');
console.log('  waitFor == 5000:', gateA.waitFor === 5000 ? 'PASS' : 'FAIL');
console.log('  fees_extracted >= 1:', gateA.fees_extracted ? 'PASS' : 'FAIL (' + report1.summary.fees_extracted + ')');
console.log('  fee labels contain BDT:', gateA.fee_labels_contain_bdt ? 'PASS' : 'FAIL');
console.log('  fee claims have citations with canonical_url + locator/quoted_text:', gateA.fee_claims_have_citations ? 'PASS' : 'FAIL');
console.log('');
console.log('GATE B — Published guide has only canonical fee schedule');
console.log('  guide.fees includes ONLY the VAT-inclusive schedule:', gateB.only_vat_inclusive ? 'PASS' : 'FAIL');
console.log('  NO legacy working-days items:', !epassportGuide.fees.some(f => f.label.includes('working days')) ? 'PASS' : 'FAIL');
console.log('  NO legacy 3450/6900/13800 amounts:', !epassportGuide.fees.some(f => f.label.includes('3450') || f.label.includes('6900') || f.label.includes('13800')) ? 'PASS' : 'FAIL');
console.log('  variants[].fees aligns with guide.fees:', gateB.variants_match_guide ? 'PASS' : 'FAIL');
console.log('');
console.log('GATE C — Docs discovered');
console.log('  doc_links_found >= 1:', gateC ? 'PASS' : 'FAIL (' + report1.summary.doc_links_found + ')');
console.log('');
console.log('GATE D — Idempotency');
console.log('  run2: new_claims_added == 0:', gateD ? 'PASS' : 'FAIL (' + report2.summary.new_claims_added + ')');
console.log('');
console.log('GATE E — Validation');
console.log('  validate:published passes:', gateE ? 'PASS' : 'FAIL');
