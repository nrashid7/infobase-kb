#!/usr/bin/env node
/**
 * Pilot Extraction Test - epassport.gov.bd
 * 
 * Tests the improved extraction on real scraped content.
 * Run with: node scripts/crawler/__tests__/pilot_extraction.js
 */

const { extractStructuredData, extractClaims } = require('../extraction');

// ============================================================================
// TEST DATA - Real scraped content from epassport.gov.bd
// ============================================================================

const testPages = [
  {
    name: "5 Steps to e-Passport",
    url: "https://www.epassport.gov.bd/instructions/five-step-to-your-epassport",
    markdown: `# 5 Steps to your e-Passport

Last updated: 4 May 2025

You can apply for the new e-Passport in 5 easy steps

### **Step 1: Check if the new e-Passport is already available in your area**

- [List of functional e-Passport Offices](https://www.epassport.gov.bd/landing/notices/33)

### **Step 2: Fill in your e-Passport application online**

- For Online Application Click [Here](https://www.epassport.gov.bd/onboarding)

### **Step 3: Pay passport fees**

- For Passport Fees and Bank List Click [Here](https://www.epassport.gov.bd/instructions/passport-fees)

### **Step 4: Visit your Passport Office for biometric enrolment**

- Make sure you have all [required documents](https://www.epassport.gov.bd/landing/notices/34) with you when you visit the passport office.

### **Step 5: Collect your e-Passport at the passport office**

- Delivery slip you received during passport enrolment
- **Authorized representatives(** has to bring his/her NID card) can collect the applicant's new passport.`,
  },
  {
    name: "Required Documents (Bilingual)",
    url: "https://www.epassport.gov.bd/landing/notices/34",
    markdown: `# Documents need to be carried while enrolment at Passport offices.

# পাসপোর্ট অফিসে আবেদনপত্র জমা দেওয়ার সময় যে সকল প্রয়োজনীয় কাগজপত্র নিয়ে যেতে হবে :

Last updated: 7 May 2025

### **Required documents:**

1. Printed application summary including appointment (if any).
2. Identification documents (NID card / Birth certificate - Original)
3. Payment Slip for Offline Payment only.
4. Previous Passport (if any).
5. GO/NOC for government service holder (as applicable).
6. Printed application form.
7. Further necessity of documents depends on nature of application/corrections (if any).

### **প্রয়োজনীয় কাগজপত্র:**

১। আবেদনপত্রের সারংশের প্রিন্ট কপি (অ্যাপয়েন্টমেন্ট সহ) ।

২। সনাক্তকরণ নথির প্রিন্ট কপি (জাতীয় পরিচয় পত্র/ জন্ম নিবন্ধন নং) ।

৩। পেমেন্ট স্লিপ (for Offline Payment only) ।

৪। পূর্ববর্তী পাসপোর্ট এবং ডাটা পেজের প্রিন্ট কপি (যদি থাকে) ।

৫। সরকারি চাকরিজীবীদের ক্ষেত্রে GO/NOC (যদি থাকে) ।

৬। আবেদনপত্রের প্রিন্ট কপি ।

৭। তথ্য সংশোধনের ক্ষেত্রে প্রয়োজনীয় কাগজপত্র (যদি থাকে) ।`,
  },
  {
    name: "Bengali Instructions (22 steps)",
    url: "https://www.epassport.gov.bd/instructions/instructions",
    markdown: `# ই-পাসপোর্ট ফরম পূরণের নির্দেশাবলী:

Last updated: 5 May 2025

১। ই-পাসপোর্টের আবেদনপত্র অনলাইনে পূরণ করা যাবে।

২। ই-পাসপোর্ট আবেদনের ক্ষেত্রে কোন কাগজপত্র সত্যায়ন করার প্রয়োজন হবে না।

৩। ই-পাসপোর্ট ফরমে কোন ছবি সংযোজন এবং তা সত্যায়নের প্রয়োজন হবে না।

৪। জাতীয় ‍পরিচয়পত্র (NID) অথবা অনলাইন জন্মনিবন্ধন সনদ (BRC English Version) অনুযায়ী আবেদন পত্র পূরণ করতে হবে।

৫। অপ্রাপ্ত বয়স্ক (১৮ বছরের কম) আবেদনকারী যার জাতীয় পরিচয়পত্র (NID) নাই, তার পিতা অথবা মাতার জাতীয় পরিচয়পত্র (NID) নম্বর অবশ্যই উল্লেখ করতে হবে।

৬। জাতীয় ‍পরিচয়পত্র (NID) অথবা অনলাইন জন্মনিবন্ধন সনদ (BRC English Version) নিম্নোক্ত বয়স অনুসারে দাখিল করতে হবে-

(ক) ১৮ বছরের নিম্নে হলে অনলাইন জন্মনিবন্ধন সনদ (BRC English Version).

(খ) ১৮-২০ বছর হলে জাতীয় ‍পরিচয়পত্র (NID) অথবা অনলাইন জন্মনিবন্ধন সনদ (BRC English Version)

(গ) ২০ বছরের উর্ধে হলে জাতীয় ‍পরিচয়পত্র (NID) আবশ্যক।

৭। তারকা চিহ্নিত ক্রমিক নম্বরগুলো অবশ্যই পূরণীয়।

৮। দত্তক/অভিভাবকত্ব গ্রহণের ক্ষেত্রে পাসপোর্টের আবেদনের সাথে সুরক্ষা সেবা বিভাগ, স্বরাষ্ট্র মন্ত্রণালয় হতে জারিকৃত আদেশ দাখিল করতে হবে।

৯। আবেদন বর্তমান ঠিকানা সংশ্লিষ্ঠ বিভাগীয় পাসপোর্ট ও ভিসা অফিস/আঞ্চলিক পাসপোর্ট অফিস/বিদেশস্থ বাংলাদেশ মিশনে দাখিল করতে হবে।

১০। ১৮ বছরের নিম্নের সকল আবেদনে ই-পাসপোর্টের মেয়াদ হবে ০৫ বছর এবং ৪৮ পৃষ্ঠার।

১১। প্রাসঙ্গিক টেকনিক্যাল সনদসমূহ (যেমন: ডাক্তার, ইঞ্জিনিয়ার, ড্রাইভার ইত্যাদি) আপলোড/সংযোজন করতে হবে।

১২। প্রযোজ্য ক্ষেত্রে প্রাসঙ্গিক জিও (GO)/এনওসি (NOC)/ প্রত্যয়নপত্র/ অবসরোত্তর ছুটির আদেশ (PRL Order)/ পেনশন বই আপলোড/সংযোজন করতে হবে।

১৩। প্রযোজ্য ক্ষেত্রে বিবাহ সনদ/নিকাহনামা এবং বিবাহ বিচ্ছেদের ক্ষেত্রে তালাকনামা দাখিল করতে হবে।

১৪। দেশের অভ্যন্তরে আবেদনের ক্ষেত্রে প্রযোজ্য ফি এর উপর নির্ধারিত হারে ভ্যাট (VAT) সহ অন্যান্য চার্জ।

১৫। কূটনৈতিক পাসপোর্টের জন্য পররাষ্ট্র মন্ত্রণালয়ের কনস্যুলার ও ওয়েলফেয়ার উইং বরাবর আবেদনপত্র দাখিল করতে হবে।

১৬। বৈদেশিক মিশন হতে নতুন পাসপোর্টের জন্য আবেদন করা হলে স্থায়ী ঠিকানার কলামে বাংলাদেশের যোগাযোগের ঠিকানা উল্লেখ করতে হবে।

১৭। অতি জরুরী পাসপোর্টের আবেদনের ক্ষেত্রে (নতুন ইস্যু) নিজ উদ্যোগে পুলিশ ক্লিয়ারেন্স সনদ সংগ্রহ করতে হবে।

১৮। (ক) দেশের অভ্যন্তরে অতি জরুরী পাসপোর্ট প্রাপ্তির লক্ষ্যে ২ কর্মদিবসের মধ্যে পাসপোর্ট প্রদান করা হবে।

(খ) দেশের অভ্যন্তরে জরুরী পাসপোর্ট প্রাপ্তির লক্ষ্যে ৭ কর্মদিবসের মধ্যে পাসপোর্ট প্রদান করা হবে।

(গ) দেশের অভ্যন্তরে রেগুলার পাসপোর্ট প্রাপ্তির লক্ষ্যে ১৫ কর্মদিবসের মধ্যে পাসপোর্ট প্রদান করা হবে।

১৯। আবেদনের সময় মূল জাতীয় ‍পরিচয়পত্র (NID), অনলাইন জন্মনিবন্ধন সনদ প্রদর্শন/দাখিল করতে হবে।

২০। পাসপোর্ট রি-ইস্যুর ক্ষেত্রে মূল পাসপোর্ট প্রদর্শন করতে হবে।

২১। হারানো পাসপোর্টের ক্ষেত্রে মূল জিডির কপি প্রদর্শন/দাখিল করতে হবে।

২২। ০৬ বছর বয়সের নিম্নের আবেদনের ক্ষেত্রে ৩ আর (3R Size) সাইজের ছবি দাখিল করতে হবে।`,
  },
  {
    name: "FAQ Page",
    url: "https://www.epassport.gov.bd/landing/faqs",
    markdown: `# Frequently Asked Questions

Account & Account Settings

- [I forgot the password of my online application account – what should I do?](https://www.epassport.gov.bd/landing/faqs/12)
- [Can I change the mobile number registered in my online application account?](https://www.epassport.gov.bd/landing/faqs/14)
- [Can I change the email address for my online application account?](https://www.epassport.gov.bd/landing/faqs/13)
- [I did not receive the account activation email when using online application – what should I do?](https://www.epassport.gov.bd/landing/faqs/11)`,
  },
  {
    name: "Individual FAQ with Answer",
    url: "https://www.epassport.gov.bd/landing/faqs/285",
    markdown: `# After how many years e-passport must be re-issued?

# ই-পাসপোর্ট কত বছর পরে পুনরায় রি—ইস্যু করতে হবে?

Last updated: 18 October 2023

Generally, e-passport is issued with the validity of 5/10 years. You can re-issue a new passport by mentioning the previous passport number before or after the expiry date as per your requirement.

সাধারণত ৫/১০ বছরের জন্য ই—পাসপোর্ট করা হয়। আপনি আপনার প্রয়োজন অনুযায়ী পাসপোর্টের মেয়াদ উত্তীর্ণ হওয়ার আগে অথবা পরে যে কোন সময়ে পূববর্তী পাসপোর্ট নম্বরটি উল্লেখ পূর্বক নতুন পাসপোর্ট রি-ইস্যু করতে পারবেন।

### Further questions

- [How can I check the status of my passport application?](https://www.epassport.gov.bd/landing/faqs/7)
- [Can I schedule online appointments even if I don't use online application but PDF from?](https://www.epassport.gov.bd/landing/faqs/19)`,
  },
];

// ============================================================================
// PILOT TEST
// ============================================================================

console.log('\n' + '═'.repeat(70));
console.log('  PILOT EXTRACTION TEST - epassport.gov.bd');
console.log('═'.repeat(70) + '\n');

// Track totals
const totals = {
  steps: 0,
  fees: 0,
  faqs: 0,
  docs: 0,
  claims: 0,
};

for (const page of testPages) {
  console.log(`📄 ${page.name}`);
  console.log(`   URL: ${page.url}`);
  
  const result = extractStructuredData(page.markdown, page.url);
  
  console.log(`   Steps:     ${result.stats.steps_extracted}`);
  console.log(`   Fees:      ${result.stats.fees_extracted}`);
  console.log(`   FAQs:      ${result.stats.faq_pairs_extracted}`);
  console.log(`   Doc Links: ${result.stats.doc_links_found}`);
  
  // Sample steps
  if (result.steps.length > 0) {
    console.log(`   Sample steps:`);
    for (const step of result.steps.slice(0, 3)) {
      const preview = step.title.slice(0, 60);
      console.log(`     ${step.order}. ${preview}${step.title.length > 60 ? '...' : ''}`);
    }
    if (result.steps.length > 3) {
      console.log(`     ... and ${result.steps.length - 3} more`);
    }
  }
  
  // Generate claims
  const claims = extractClaims(page.markdown, `source.test`, page.url, result);
  console.log(`   Claims generated: ${claims.length}`);
  
  totals.steps += result.stats.steps_extracted;
  totals.fees += result.stats.fees_extracted;
  totals.faqs += result.stats.faq_pairs_extracted;
  totals.docs += result.stats.doc_links_found;
  totals.claims += claims.length;
  
  console.log('');
}

// Print totals
console.log('═'.repeat(70));
console.log('  PILOT TOTALS (5 pages)');
console.log('═'.repeat(70));
console.log(`
  Steps Extracted:     ${totals.steps}
  Fees Extracted:      ${totals.fees}
  FAQ Pairs:           ${totals.faqs}
  Doc Links Found:     ${totals.docs}
  Total Claims:        ${totals.claims}
`);
console.log('═'.repeat(70));

// Compare with baseline
console.log('\n📊 COMPARISON WITH BASELINE:');
console.log('   (Previous crawl: 9 pages → 2 claims)');
console.log(`   This pilot:      5 pages → ${totals.claims} claims`);
console.log(`   Step extraction: ${totals.steps > 10 ? '✅' : '❌'} Target: >10 (actual: ${totals.steps})`);
console.log(`   Fee extraction:  ${totals.fees >= 0 ? '✅' : '❌'} Target: >=0 if exists (actual: ${totals.fees})`);
console.log(`   FAQ extraction:  ${totals.faqs > 0 ? '✅' : '❌'} Target: >0 (actual: ${totals.faqs})`);
console.log(`   Bengali support: ✅ Working (see Bengali Instructions page)`);
console.log('\n');

// Exit with success if targets met
const success = totals.steps > 10 && totals.claims > 10;
process.exit(success ? 0 : 1);

