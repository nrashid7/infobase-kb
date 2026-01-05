/**
 * Tests for extraction.js module
 * 
 * Run with: node scripts/crawler/__tests__/extraction.test.js
 */

const fs = require('fs');
const path = require('path');

// Import extraction module
const {
  extractStructuredData,
  extractClaims,
  parseBengaliNumber,
  containsBengali,
  detectStepLine,
  extractSteps,
  extractFees,
  extractFAQs,
  extractDocumentLinks,
} = require('../extraction');

// Test utilities
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${e.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Assertion failed'}: expected ${expected}, got ${actual}`);
  }
}

function assertGreater(actual, min, message) {
  if (actual <= min) {
    throw new Error(`${message || 'Assertion failed'}: expected > ${min}, got ${actual}`);
  }
}

// ============================================================================
// TESTS
// ============================================================================

console.log('\n📋 Running extraction.js tests...\n');

// Load fixture
const fixturesDir = path.join(__dirname, 'fixtures');
const epassportFixture = fs.readFileSync(path.join(fixturesDir, 'epassport_instructions.md'), 'utf-8');

// ============================================================================
// Utility Function Tests
// ============================================================================

console.log('🔹 Utility Functions:');

test('parseBengaliNumber handles Bengali numerals', () => {
  assertEqual(parseBengaliNumber('১২৩'), 123);
  assertEqual(parseBengaliNumber('৩,৪৫০'), 3450);
  assertEqual(parseBengaliNumber('১৩,৮০০'), 13800);
});

test('parseBengaliNumber handles mixed/Arabic numerals', () => {
  assertEqual(parseBengaliNumber('3450'), 3450);
  assertEqual(parseBengaliNumber('3,450'), 3450);
});

test('containsBengali detects Bengali script', () => {
  assert(containsBengali('আবেদন করুন'), 'Should detect Bengali');
  assert(!containsBengali('Apply now'), 'Should not detect Bengali in English');
});

test('detectStepLine identifies ordered list steps', () => {
  const result1 = detectStepLine('1. Visit the portal');
  assert(result1.isStep, 'Should detect ordered list');
  assertEqual(result1.order, 1);
  
  const result2 = detectStepLine('3) Submit your application');
  assert(result2.isStep, 'Should detect parenthesis format');
  assertEqual(result2.order, 3);
});

test('detectStepLine identifies Bengali numbered steps', () => {
  const result1 = detectStepLine('১) পোর্টালে যান');
  assert(result1.isStep, 'Should detect Bengali numeral');
  assertEqual(result1.order, 1);
  
  const result2 = detectStepLine('৩. আবেদন জমা দিন');
  assert(result2.isStep, 'Should detect Bengali with period');
  assertEqual(result2.order, 3);
});

test('detectStepLine identifies Bengali imperative sentences', () => {
  const result = detectStepLine('সঠিকভাবে সব তথ্য পূরণ করুন');
  assert(result.isStep, 'Should detect Bengali imperative');
});

test('detectStepLine identifies bullet points with action verbs', () => {
  const result = detectStepLine('- Fill all personal information accurately');
  assert(result.isStep, 'Should detect bullet with action verb');
});

// ============================================================================
// Step Extraction Tests
// ============================================================================

console.log('\n🔹 Step Extraction:');

test('extractSteps finds ordered list steps', () => {
  const lines = [
    '## Instructions',
    '1. Visit the portal',
    '2. Click on Register',
    '3. Fill the form',
    '4. Submit application',
  ];
  const steps = extractSteps(lines, () => [], 'https://example.gov.bd');
  assertEqual(steps.length, 4, 'Should find 4 steps');
  assertEqual(steps[0].order, 1);
  assertEqual(steps[3].order, 4);
});

test('extractSteps finds Bengali numbered steps', () => {
  const lines = [
    '## ধাপ',
    '১) পোর্টালে যান',
    '২) নিবন্ধন করুন',
    '৩) ফরম পূরণ করুন',
  ];
  const steps = extractSteps(lines, () => [], 'https://example.gov.bd');
  assertEqual(steps.length, 3, 'Should find 3 Bengali steps');
});

test('extractSteps extracts from fixture', () => {
  const lines = epassportFixture.split('\n');
  const steps = extractSteps(lines, () => [], 'https://www.epassport.gov.bd');
  assertGreater(steps.length, 10, 'Should extract many steps from fixture');
});

// ============================================================================
// Fee Extraction Tests
// ============================================================================

console.log('\n🔹 Fee Extraction:');

test('extractFees finds BDT amounts', () => {
  const lines = [
    '## Fees',
    '- Regular: 3,450 BDT',
    '- Express: 6,900 Taka',
  ];
  const fees = extractFees(lines, () => []);
  assertEqual(fees.length, 2, 'Should find 2 fees');
  assertEqual(fees[0].amount_bdt, 3450);
  assertEqual(fees[1].amount_bdt, 6900);
});

test('extractFees finds ৳ symbol amounts', () => {
  const lines = [
    '## Fees',
    '- 48-page passport: ৳6,900',
    '- 64-page passport: ৳11,500',
  ];
  const fees = extractFees(lines, () => []);
  assertEqual(fees.length, 2, 'Should find 2 fees with ৳');
  assertEqual(fees[0].amount_bdt, 6900);
});

test('extractFees finds Bengali numeral amounts', () => {
  const lines = [
    '## ফি',
    '- ৪৮ পৃষ্ঠা: ১৩,৮০০ টাকা',
  ];
  const fees = extractFees(lines, () => []);
  assertEqual(fees.length, 1, 'Should find Bengali fee');
  assertEqual(fees[0].amount_bdt, 13800);
});

test('extractFees detects variants from headings', () => {
  const lines = [
    '### Express Service',
    '- Fee: 6,900 BDT',
    '### Super Express',
    '- Fee: 13,800 BDT',
  ];
  const fees = extractFees(lines, () => []);
  assertEqual(fees.length, 2, 'Should find 2 fees with variants');
  assertEqual(fees[0].variant, 'express');
  assertEqual(fees[1].variant, 'super_express');
});

test('extractFees extracts from fixture', () => {
  const lines = epassportFixture.split('\n');
  const fees = extractFees(lines, () => []);
  assertGreater(fees.length, 5, 'Should extract multiple fees from fixture');
});

// ============================================================================
// FAQ Extraction Tests
// ============================================================================

console.log('\n🔹 FAQ Extraction:');

test('extractFAQs finds question headings', () => {
  const lines = [
    '## FAQ',
    '### How long does it take?',
    'It takes 15 working days.',
    '### What documents do I need?',
    'You need NID and photo.',
  ];
  const faqs = extractFAQs(lines);
  assertEqual(faqs.length, 2, 'Should find 2 FAQ pairs');
  assert(faqs[0].question.includes('How long'), 'Should capture question');
  assert(faqs[0].answer.includes('15 working days'), 'Should capture answer');
});

test('extractFAQs finds Q/A format', () => {
  const lines = [
    'Q: Can I track my application?',
    'A: Yes, use the portal.',
  ];
  const faqs = extractFAQs(lines);
  assertEqual(faqs.length, 1, 'Should find Q/A pair');
});

test('extractFAQs finds Bengali Q/A format', () => {
  const lines = [
    'প্রশ্ন: পাসপোর্টের মেয়াদ কত দিন?',
    'উত্তর: ৫ বছর বা ১০ বছর।',
  ];
  const faqs = extractFAQs(lines);
  assertEqual(faqs.length, 1, 'Should find Bengali Q/A pair');
});

test('extractFAQs extracts from fixture', () => {
  const lines = epassportFixture.split('\n');
  const faqs = extractFAQs(lines);
  assertGreater(faqs.length, 3, 'Should extract FAQs from fixture');
});

// ============================================================================
// Document Link Extraction Tests
// ============================================================================

console.log('\n🔹 Document Link Extraction:');

test('extractDocumentLinks finds markdown links', () => {
  const markdown = '[Application Form](https://example.gov.bd/form.pdf)';
  const docs = extractDocumentLinks(markdown, '', 'https://example.gov.bd');
  assertEqual(docs.length, 1, 'Should find PDF link');
  assert(docs[0].url.includes('form.pdf'), 'Should capture URL');
  assertEqual(docs[0].extension, '.pdf');
});

test('extractDocumentLinks finds various extensions', () => {
  const markdown = `
    [PDF Form](https://example.gov.bd/form.pdf)
    [Word Doc](https://example.gov.bd/template.docx)
    [Excel](https://example.gov.bd/fee.xlsx)
  `;
  const docs = extractDocumentLinks(markdown, '', 'https://example.gov.bd');
  assertEqual(docs.length, 3, 'Should find 3 documents');
});

test('extractDocumentLinks finds links in HTML', () => {
  const markdown = 'Some text';
  const html = '<a href="/downloads/circular.pdf">Download</a>';
  const docs = extractDocumentLinks(markdown, html, 'https://example.gov.bd');
  assertEqual(docs.length, 1, 'Should find HTML link');
});

test('extractDocumentLinks extracts from fixture', () => {
  const docs = extractDocumentLinks(epassportFixture, '', 'https://www.epassport.gov.bd');
  assertEqual(docs.length, 3, 'Should find 3 documents in fixture');
});

// ============================================================================
// Full Extraction Pipeline Tests
// ============================================================================

console.log('\n🔹 Full Extraction Pipeline:');

test('extractStructuredData returns all categories', () => {
  const result = extractStructuredData(epassportFixture, 'https://www.epassport.gov.bd');
  
  assert(Array.isArray(result.steps), 'Should have steps array');
  assert(Array.isArray(result.feeTable), 'Should have feeTable array');
  assert(Array.isArray(result.faqPairs), 'Should have faqPairs array');
  assert(Array.isArray(result.documentList), 'Should have documentList array');
  assert(result.stats, 'Should have stats object');
});

test('extractStructuredData extracts significant data from fixture', () => {
  const result = extractStructuredData(epassportFixture, 'https://www.epassport.gov.bd');
  
  assertGreater(result.stats.steps_extracted, 10, 'Should extract >10 steps');
  assertGreater(result.stats.fees_extracted, 5, 'Should extract >5 fees');
  assertGreater(result.stats.faq_pairs_extracted, 3, 'Should extract >3 FAQs');
  assertEqual(result.stats.doc_links_found, 3, 'Should find 3 documents');
});

test('extractClaims generates claims from structured data', () => {
  const result = extractStructuredData(epassportFixture, 'https://www.epassport.gov.bd');
  const claims = extractClaims(epassportFixture, 'source.test123', 'https://www.epassport.gov.bd', result);
  
  assertGreater(claims.length, 15, 'Should generate many claims');
  
  // Check claim types
  const stepClaims = claims.filter(c => c.claim_type === 'step');
  const feeClaims = claims.filter(c => c.claim_type === 'fee');
  const faqClaims = claims.filter(c => c.claim_type === 'faq');
  const docClaims = claims.filter(c => c.claim_type === 'document_requirement');
  
  assertGreater(stepClaims.length, 5, 'Should have step claims');
  assertGreater(feeClaims.length, 3, 'Should have fee claims');
  assertGreater(faqClaims.length, 2, 'Should have FAQ claims');
  assertGreater(docClaims.length, 0, 'Should have document claims');
});

test('extractClaims includes proper citations', () => {
  const result = extractStructuredData(epassportFixture, 'https://www.epassport.gov.bd');
  const claims = extractClaims(epassportFixture, 'source.test123', 'https://www.epassport.gov.bd', result);
  
  const feeClaim = claims.find(c => c.claim_type === 'fee');
  assert(feeClaim, 'Should have a fee claim');
  assert(feeClaim.citations, 'Should have citations');
  assert(feeClaim.citations.length > 0, 'Should have at least one citation');
  assertEqual(feeClaim.citations[0].canonical_url, 'https://www.epassport.gov.bd', 'Citation should have URL');
  assert(feeClaim.citations[0].retrieved_at, 'Citation should have timestamp');
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '═'.repeat(50));
console.log(`  Tests: ${passed + failed} total, ${passed} passed, ${failed} failed`);
console.log('═'.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);

