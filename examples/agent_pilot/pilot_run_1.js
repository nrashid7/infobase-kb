/**
 * Pilot Run #1 - Process Firecrawl MCP Results
 * 
 * This script processes the scraped epassport.gov.bd content
 * and writes claims to the KB for pilot testing.
 */

const fs = require('fs');
const path = require('path');

// Import extraction module
const { extractStructuredData, extractClaims, classifyPage } = require('../../scripts/crawler/extraction');
const { addOrUpdateSourcePage, addClaimsToKB, loadOrCreateKB, saveKB } = require('../../scripts/crawler/kb_writer');
const { generateSourcePageId, generateHash, ensureDir, getDateString } = require('../../scripts/crawler/utils');
const { generateRunReport } = require('../../scripts/crawler/crawl_report');

// Pilot scraped data from Firecrawl MCP
const SCRAPED_PAGES = [
  {
    url: 'https://www.epassport.gov.bd/instructions/five-step-to-your-epassport',
    title: 'E‑Passport Online Registration Portal',
    markdown: `# 5 Steps to your e-Passport

Last updated: 4 May 2025

You can apply for the new e-Passport in 5 easy steps

### **Step 1: Check if the new e-Passport is already available in your area**
- List of functional e-Passport Offices

### **Step 2: Fill in your e-Passport application online**
- For Online Application Click Here

### **Step 3: Pay passport fees**
- For Passport Fees and Bank List Click Here

### **Step 4: Visit your Passport Office for biometric enrolment**
- Make sure you have all required documents with you when you visit the passport office.

### **Step 5: Collect your e-Passport at the passport office**
- Delivery slip you received during passport enrolment
- Authorized representatives (has to bring his/her NID card) can collect the applicant's new passport.`
  },
  {
    url: 'https://www.epassport.gov.bd/instructions/urgent-applications',
    title: 'E‑Passport Online Registration Portal',
    markdown: `# Urgent Applications

Last updated: 1 June 2025

## What is Super Express passport delivery service?

There are occasions when a citizen needs passport urgently. In such situation, citizens can apply for **Super Express** delivery (specific conditions and fees apply). Passport will be issued within 2 (two) working days for Super Express delivery.

## Who can apply for Super Express delivery?

Any citizen of Bangladesh can apply for Super Express delivery.

## Where can I apply for Super Express passport?

Super Express service is applicable for citizens applying from Bangladesh. This service is not available outside Bangladesh i.e. Bangladesh Missions abroad. Applications for Super Express delivery can be made through the Online Application Portal and it can be processed through any passport office of Bangladesh.

## What is the Super Express passport delivery process?

Super Express passports are delivered only from the Divisional Passport and Visa Office, Agargaon, Dhaka-1207. Citizens will have to collect Super Express passport from there. Shipment to other passport offices is not possible.

## Address for passport pickup (Super Express delivery):

Divisional Passport and Visa Office, Building # 2
E-7, Sher-E-Bangla Nagor, Agargaon, Dhaka-1207
Contact No: +880 2-8123788`
  },
  {
    url: 'https://www.epassport.gov.bd/landing/notices/34',
    title: 'E‑Passport Online Registration Portal',
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
৭। তথ্য সংশোধনের ক্ষেত্রে প্রয়োজনীয় কাগজপত্র (যদি থাকে) ।`
  },
  {
    url: 'https://www.epassport.gov.bd/landing/faqs/7',
    title: 'E‑Passport Online Registration Portal',
    markdown: `# How can I check the status of my passport application?
# আমার পাসপোর্ট আবেদনের অগ্রগতি কিভাবে দেখতে পারব ?

Last updated: 28 August 2020

## Online Check

Go to the **Status Check** on the ePassport portal home page. Enter your **Application ID** or **Online Registration ID** and **date of birth** of the applicant to see the current status of your passport application. The Application ID can be found on the delivery slip you received after enrolment at the passport office.

You also see the status of all your applications in your online portal account.

পাসপোর্ট আবেদনের অগ্রগতি নিম্নরূপভাবে দেখা যেতে পারে ।

**অনলাইন চেক :** ই-পাসপোর্ট পোর্টালে 'স্ট্যাটাস চেক' এখানে । জন্ম তারিখ ও আবেদনের ক্রমিক সংখ্যা প্রবেশ করুন। এবার সার্চ অপশনে ক্লিক করুন ।`
  },
  {
    url: 'https://www.epassport.gov.bd/landing/faqs/72',
    title: 'E‑Passport Online Registration Portal',
    markdown: `# How do I fill in the "Given Name" and "Surname" part of the name?
# নামের "Given Name" এবং "Surname" অংশটি কিভাবে পূরণ করব ?

Last updated: 1 September 2021

## **Instruction to Fill up "Given Name" and "Surname":**

### **Case 1 : Name with single part**
**Example:** Bakar
**a. Given Name:** -----------
**b. Surname:** Bakar

### **Case 2 : Name with double part**
**Example:** Md Bakar
**Option 1**
**a. Given Name:** Md
**b. Surname:** Bakar

**Option 2**
**c. Given Name:** -----------
**d. Surname:** Md Bakar

### **Case 3 : Name with triple part**
**Example:** Md Abu Bakar
**Option 1**
**a. Given Name:** Md Abu
**b. Surname:** Bakar

**Option 2**
**c. Given Name:** Md
**d. Surname:** Abu Bakar`
  },
  {
    url: 'https://www.epassport.gov.bd/landing/notices/160',
    title: 'E‑Passport Online Registration Portal',
    markdown: `# Documents Checklist for e-Passport Enrollment
# পাসপোর্টের আবেদন জমা নেওয়ার ক্ষেত্রে চেকলিস্ট

Last updated: 21 October 2024

পাসপোর্টের আবেদন জমা নেওয়ার ক্ষেত্রে চেকলিস্ট

১. আবেদনকারী কর্তৃক অনলাইনে আবেদনকৃত (পিডিএফ) ফরম প্রিন্টেড কপি।
২. পাসপোর্টের ফি জমা প্রদানের চালান রশিদ (অফলাইন পেমেন্টের ক্ষেত্রে)।
৩. অনলাইন জন্ম নিবন্ধন সনদ (ইংরেজী ভার্সন) মূলকপি এবং ফটোকপি।
৪. জাতীয় পরিচয় পত্রের মূল ও ফটোকপি (২০ বছরের উর্ধ্বের নাগরিকদের জন্য)।
৫. বর্তমান ঠিকানা প্রমাণের স্বপক্ষে Job ID/Student ID/গ্যাস বিলের কপি/ বিদ্যুৎ বিলের কপি
৬. দত্তক/অভিভাবকত্ব গ্রহণের ক্ষেত্রে সুরক্ষা সেবা বিভাগ হতে জারীকৃত আদেশের কপি।
৭. টেকনিক্যাল পেশা প্রমাণের স্বপক্ষে টেকনিক্যাল সনদের কপি।
৮. রি-ইস্যু আবেদনের ক্ষেত্রে মূল পাসপোর্ট এবং পাসপোর্টের ফটোকপি
৯. ধূসর ব্যাকগ্রাউন্ডের 3R সাইজের ফটো (০৬ বছরের নিচে শিশুদের ক্ষেত্রে)।
১০. অপ্রাপ্ত বয়স্ক আবেদনকারীর ক্ষেত্রে পিতা/মাতার জাতীয় পরিচয়পত্রের কপি।
১১. মেডিকেল সনদ (চোখের আইরিশ, ফিঙ্গারপ্রিন্ট মিসিং হবার ক্ষেত্রে)।
১২. সরকারী আদেশ (GO)/অনাপত্তি সনদ (NOC)/প্রত্যয়নপত্র।`
  },
  {
    url: 'https://www.epassport.gov.bd/landing/notices/33',
    title: 'E‑Passport Online Registration Portal',
    markdown: `# List of functional e-Passport Offices
# চালুকৃত ই-পাসপোর্ট অফিসগুলির তালিকা।

Last updated: 20 September 2023

### **Currently following e-Passport Offices are functional:**

1. Agargaon
2. Jatrabari
3. Uttara
4. Dhaka Cantonment
5. Bangladesh Secretariate
6. Gazipur
7. Mansurabad
8. Mymensingh
9. Ministry of Foreign Affairs
10. Gaibandha
... (72 offices total across Bangladesh)`
  },
  {
    url: 'https://www.epassport.gov.bd/contact',
    title: 'Contact to Online Portal Support',
    markdown: `# Contact to Online Portal Support

**If you have questions, Please click here to get to the FAQs**

**To know your application status please visit the online status check here**

### **Passport Call Center number 16445 (from Bangladesh) and +88 09666716445 (from overseas)**

For specific query select topic from the drop down menu.`
  },
  {
    url: 'https://www.epassport.gov.bd/landing/faqs/20',
    title: 'E‑Passport Online Registration Portal',
    markdown: `# I made mistakes in my application data and my application is already submitted - what can I do?

Last updated: 1 September 2021

If you recognize that you have submitted your ePassport application, but some of the application data is not correct you should do the following:

Please visit you passport office with the printed "Application Summary". Your application will be found there and the incorrect data can be changed by the enrolment officer.

**IMPORTANT:** please provide the required document like NID or BRC and previous passport (if available), or other official documents to proof the correct data.

If you stated the **wrong name of the applicant and you already made the payment of the passport fees using the incorrect name** (either via online payment or bank payment) this can also be handled by the passport office.`
  },
  {
    url: 'https://www.epassport.gov.bd/landing/faqs/24',
    title: 'E‑Passport Online Registration Portal',
    markdown: `# I experienced issues with Online Payment - what can I do?

Last updated: 24 May 2025

Contact to your bank for refund if status is failed but payment done. After having refund from bank then delete this application and apply a new.

If payment is not done and status is failed then select offline payment option or delete this application and try a new.`
  },
  {
    url: 'https://www.epassport.gov.bd/landing/faqs/285',
    title: 'E‑Passport Online Registration Portal',
    markdown: `# After how many years e-passport must be re-issued?

Last updated: 18 October 2023

Generally, e-passport is issued with the validity of 5/10 years. You can re-issue a new passport by mentioning the previous passport number before or after the expiry date as per your requirement.`
  },
  {
    url: 'https://www.epassport.gov.bd/landing/csca',
    title: 'Country Signing Certificate Authority (CSCA)',
    markdown: `**The electronic passport (ePassport) was introduced in Bangladesh on 22 January 2020. Bangladesh is the first country in South Asia to issue ePassport. The passport of Bangladesh is an International Civil Aviation Organization (ICAO) compliant.**

**Bangladesh became a distinguished member of the ICAO on 29 January 2020. Bangladesh is the 72nd member country of ICAO.**`
  }
];

const PATHS = {
  kbDir: path.join(__dirname, '..', '..', 'kb'),
  runsDir: path.join(__dirname, '..', '..', 'kb', 'runs'),
  snapshotsDir: path.join(__dirname, '..', '..', 'kb', 'snapshots'),
  kbPath: path.join(__dirname, '..', '..', 'kb', 'bangladesh_government_services_kb_v3.json'),
};

async function runPilot() {
  console.log('═'.repeat(70));
  console.log('  🧪 PILOT RUN #1 - epassport.gov.bd');
  console.log('═'.repeat(70));
  console.log(`\n  Domain: epassport.gov.bd`);
  console.log(`  maxDepth: 3`);
  console.log(`  maxPages: 30`);
  console.log(`  Method: Firecrawl MCP (agent-orchestrated)`);
  console.log(`  Pages scraped: ${SCRAPED_PAGES.length}\n`);

  // Load KB
  const kb = loadOrCreateKB(PATHS.kbPath, PATHS.kbPath.replace('_v3', '_v2'));
  
  // Count existing epassport claims before
  const existingEpassportClaims = kb.claims.filter(c => 
    c.claim_id.includes('epassport') || c.claim_id.includes('svc_epassport')
  ).length;
  console.log(`  Existing epassport claims in KB: ${existingEpassportClaims}\n`);

  // Run stats
  const runStats = {
    runId: `run_${getDateString()}_pilot1_${Date.now()}`,
    startedAt: new Date().toISOString(),
    domain: 'epassport.gov.bd',
    pagesScraped: SCRAPED_PAGES.length,
    pagesProcessed: 0,
    stepsExtracted: 0,
    faqsExtracted: 0,
    feesExtracted: 0,
    docsExtracted: 0,
    claimsWritten: 0,
    claimsSkipped: 0,  // Already existed
    errors: [],
  };

  // Process each scraped page
  for (const page of SCRAPED_PAGES) {
    try {
      console.log(`  📄 Processing: ${page.url}`);
      
      const sourcePageId = generateSourcePageId(page.url);
      const contentHash = generateHash(page.markdown);
      
      // Extract structured data
      const structuredData = extractStructuredData(page.markdown, page.url, '');
      
      // Count extracted items
      runStats.stepsExtracted += structuredData.steps?.length || 0;
      runStats.faqsExtracted += structuredData.faqPairs?.length || 0;
      runStats.feesExtracted += structuredData.feeTable?.length || 0;
      runStats.docsExtracted += structuredData.documentList?.length || 0;

      // Add source page to KB
      addOrUpdateSourcePage(kb, {
        url: page.url,
        domain: 'epassport.gov.bd',
        title: page.title,
        markdown: page.markdown,
        contentHash: contentHash,
        snapshotRef: `snapshots/${sourcePageId}/${getDateString()}`,
      }, classifyPage);

      // Extract claims
      const claims = extractClaims(page.markdown, sourcePageId, page.url, structuredData);
      
      // Add claims to KB (will skip duplicates based on claim_id)
      const claimsBefore = kb.claims.length;
      const addedClaims = addClaimsToKB(kb, claims);
      const claimsAfter = kb.claims.length;
      
      const newClaims = claimsAfter - claimsBefore;
      runStats.claimsWritten += newClaims;
      runStats.claimsSkipped += (addedClaims - newClaims);
      
      console.log(`     ✓ Extracted: ${structuredData.steps?.length || 0} steps, ${structuredData.faqPairs?.length || 0} FAQs, ${structuredData.feeTable?.length || 0} fees`);
      console.log(`     ✓ Claims: ${newClaims} new, ${addedClaims - newClaims} skipped (duplicate)`);
      
      runStats.pagesProcessed++;
      
    } catch (err) {
      console.log(`     ❌ Error: ${err.message}`);
      runStats.errors.push(`${page.url}: ${err.message}`);
    }
  }

  runStats.completedAt = new Date().toISOString();

  // Save KB
  saveKB(kb, PATHS.kbPath);
  console.log(`\n  💾 Saved KB: ${PATHS.kbPath}`);

  // Count final epassport claims
  const finalEpassportClaims = kb.claims.filter(c => 
    c.claim_id.includes('epassport') || c.claim_id.includes('svc_epassport') || c.claim_id.includes('www_epassport')
  ).length;

  // Generate run report
  const dateStr = getDateString();
  const runDir = path.join(PATHS.runsDir, `run_1_${dateStr}`);
  ensureDir(runDir);
  
  const report = {
    run_id: runStats.runId,
    pilot_run: 1,
    started_at: runStats.startedAt,
    completed_at: runStats.completedAt,
    status: 'completed',
    domain: 'epassport.gov.bd',
    config: {
      maxDepth: 3,
      maxPages: 30,
      requireFirecrawl: true,
      method: 'firecrawl_mcp_agent'
    },
    summary: {
      pages_scraped: runStats.pagesScraped,
      pages_processed: runStats.pagesProcessed,
      steps_extracted: runStats.stepsExtracted,
      fees_extracted: runStats.feesExtracted,
      faq_pairs_extracted: runStats.faqsExtracted,
      doc_links_found: runStats.docsExtracted,
      total_claims_written: runStats.claimsWritten,
      claims_skipped_duplicate: runStats.claimsSkipped,
      errors: runStats.errors.length,
    },
    kb_state: {
      total_claims: kb.claims.length,
      epassport_claims_before: existingEpassportClaims,
      epassport_claims_after: finalEpassportClaims,
      new_epassport_claims: finalEpassportClaims - existingEpassportClaims,
    },
    errors: runStats.errors,
  };

  const reportPath = path.join(runDir, 'crawl_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`  📋 Saved report: ${reportPath}`);

  // Print summary
  console.log('\n' + '═'.repeat(70));
  console.log('  PILOT RUN #1 SUMMARY');
  console.log('═'.repeat(70));
  console.log(`  Pages processed: ${runStats.pagesProcessed}`);
  console.log(`  Steps extracted: ${runStats.stepsExtracted}`);
  console.log(`  FAQs extracted: ${runStats.faqsExtracted}`);
  console.log(`  Fees extracted: ${runStats.feesExtracted}`);
  console.log(`  Docs found: ${runStats.docsExtracted}`);
  console.log(`  Claims written: ${runStats.claimsWritten}`);
  console.log(`  Claims skipped (duplicate): ${runStats.claimsSkipped}`);
  console.log(`  Errors: ${runStats.errors.length}`);
  console.log('═'.repeat(70) + '\n');

  return report;
}

// Run
runPilot().then(report => {
  console.log('✅ Pilot Run #1 complete');
  console.log(JSON.stringify(report, null, 2));
}).catch(err => {
  console.error('❌ Pilot Run #1 failed:', err);
  process.exit(1);
});

