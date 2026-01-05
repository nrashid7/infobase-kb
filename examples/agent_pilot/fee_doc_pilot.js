/**
 * Fees + Docs Verification Pilot
 * 
 * Targeted pilot to verify:
 * - Fee extraction from epassport.gov.bd
 * - Document link discovery
 * - Deterministic claim ID idempotency
 * 
 * Run A: Initial scrape and extraction
 * Run B: Re-run to verify idempotency (no new claims)
 */

const path = require('path');
const fs = require('fs');

// Import extraction and KB modules
const { extractStructuredData, extractClaims, classifyPage } = require('../../scripts/crawler/extraction');
const { loadOrCreateKB, saveKB, addOrUpdateSourcePage, addClaimsToKB, generateHash, generateSourcePageId, ensureDir, getDateString } = require('../../scripts/crawler/kb_writer');

// Paths
const KB_DIR = path.join(__dirname, '../../kb');
const KB_PATH = path.join(KB_DIR, 'bangladesh_government_services_kb_v3.json');
const RUNS_DIR = path.join(KB_DIR, 'runs');
const PUBLISHED_DIR = path.join(KB_DIR, 'published');
const SNAPSHOTS_DIR = path.join(KB_DIR, 'snapshots');

// Pre-scraped data from Firecrawl MCP calls
// This contains the actual scrape results from epassport.gov.bd
const SCRAPED_PAGES = [
  {
    url: "https://www.epassport.gov.bd/instructions/passport-fees",
    title: "E‑Passport Online Registration Portal",
    markdown: "Welcome to Bangladesh e-Passport Portal\n\n[Sign in](https://www.epassport.gov.bd/authorization/login)\n\nEnglishবাংলা\n\nA+A-\n\nWelcome to Bangladesh e-Passport Portal",
    html: "",
    noContent: true, // JS-rendered page - no actual fee content extracted
    notes: "Fee table is JS-rendered Angular component - Firecrawl returned no actual fee data"
  },
  {
    url: "https://www.epassport.gov.bd/instructions/five-step-to-your-epassport",
    title: "5 Steps to your e-Passport",
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
    html: ""
  },
  {
    url: "https://www.epassport.gov.bd/instructions/application-form",
    title: "Application at RPO Bangladesh Secretariat and Dhaka Cantonment",
    markdown: `# Application at RPO Bangladesh Secretariat and Dhaka Cantonment

Last updated: 12 September 2024

This application form is applicable for applicants who are **applying for e-Passport at RPO Bangladesh Secretariat and Dhaka Cantonment.**

It cannot be used for enrolments at other RPOs. Eligibility of applicants must be checked by responsible officer before enrolment.

If you are eligible to apply at Bangladesh Secretariat/DhakaCantonment please download the application form, fill up all required information and present it before enrolment.

**Important note:**

1. PDF form needs to be downloaded to the computer first
2. Open and fille up with the tool " **Adobe Acrobat Reader DC**" to support all required functions.

For free download of Adobe Acrobat Reader on [**Adobe.com**](https://acrobat.adobe.com/us/en/acrobat/pdf-reader.html)

[Download a PDF form](https://www.epassport.gov.bd/api/v1/registrations/download-offline-form)`,
    html: `<a href="https://www.epassport.gov.bd/api/v1/registrations/download-offline-form" download="">Download a PDF form</a>`
  },
  {
    url: "https://www.epassport.gov.bd/instructions/urgent-applications",
    title: "Urgent Applications",
    markdown: `# Urgent Applications

Last updated: 1 June 2025

## **What is Super Express passport delivery service?**

There are occasions when a citizen needs passport urgently. In such situation, citizens can apply for **Super Express** delivery (specific conditions and fees apply). Passport will be issued within 2 (two) working days for Super Express delivery.

## **Who can apply for Super Express delivery?**

Any citizen of Bangladesh can apply for Super Express delivery.

## **Where can I apply for Super Express passport?**

Super Express service is applicable for citizens applying from Bangladesh. This service is not available outside Bangladesh i.e. Bangladesh Missions abroad. Applications for Super Express delivery can be made through the Online Application Portal and it can be processed through any passport office of Bangladesh.

## **What is the Super Express passport delivery process?**

Super Express passports are delivered only from the Divisional Passport and Visa Office, Agargaon, Dhaka-1207. Citizens will have to collect Super Express passport from there. Shipment to other passport offices is not possible.

## **Address for passport pickup (Super Express delivery):**

Divisional Passport and Visa Office, Building # 2

E-7, Sher-E-Bangla Nagor, Agargaon, Dhaka-1207

Contact No: +880 2-8123788`,
    html: ""
  },
  {
    url: "https://www.epassport.gov.bd/landing/notices/34",
    title: "Documents need to be carried while enrolment at Passport offices",
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
    html: ""
  },
  {
    url: "https://www.epassport.gov.bd/landing/notices/160",
    title: "Documents Checklist for e-Passport Enrollment",
    markdown: `# Documents Checklist for e-Passport Enrollment

# পাসপোর্টের আবেদন জমা নেওয়ার ক্ষেত্রে চেকলিস্ট

Last updated: 21 October 2024

পাসপোর্টের আবেদন জমা নেওয়ার ক্ষেত্রে চেকলিস্ট

১. আবেদনকারী কর্তৃক অনলাইনে আবেদনকৃত (পিডিএফ) ফরম প্রিন্টেড কপি।

২. পাসপোর্টের ফি জমা প্রদানের চালান রশিদ (অফলাইন পেমেন্টের ক্ষেত্রে)।

৩. অনলাইন জন্ম নিবন্ধন সনদ (ইংরেজী ভার্সন) মূলকপি এবং ফটোকপি।

৪. জাতীয় পরিচয় পত্রের মূল ও ফটোকপি (২০ বছরের উর্ধ্বের নাগরিকদের জন্য)।

৫. বর্তমান ঠিকানা প্রমাণের স্বপক্ষে Job ID/Student ID/গ্যাস বিলের কপি/ বিদ্যুৎ বিলের কপি/ টেলিফোন বিলের কপি/পানির বিলের কপি যেটি প্রযোজ্য সেটার মূলকপি প্রদর্শন করা।

৬. দত্তক/অভিভাবকত্ব গ্রহণের ক্ষেত্রে সুরক্ষা সেবা বিভাগ, স্বরাষ্ট মন্ত্রণালয় হতে জারীকৃত আদেশের কপি।

৭. টেকনিক্যাল পেশা প্রমাণের স্বপক্ষে (ডাক্তার, ইঞ্জিনিয়ার, ড্রাইভার ইত্যাদি) টেকনিক্যাল সনদের কপি।

৮. রি-ইস্যু আবেদনের ক্ষেত্রে মূল পাসপোর্ট (Original Passport) এবং পাসপোর্টের ফটোকপি

৯. ধূসর ব্যাকগ্রাউন্ডের 3R সাইজের ফটো (০৬ বছরের নিচে শিশুদের ক্ষেত্রে)।

১০. অপ্রাপ্ত বয়স্ক আবেদনকারীর ক্ষেত্রে পিতা/মাতার জাতীয় পরিচয়পত্রের কপি।

১১. মেডিকেল সনদ (চোখের আইরিশ, ফিঙ্গারপ্রিন্ট মিসিং হবার ক্ষেত্রে)।

১২. সরকারী আদেশ (GO)/অনাপত্তি সনদ (NOC)/প্রত্যয়নপত্র এর কপি যা ইস্যুকারী কর্তৃপক্ষের নিজ নিজ Website এ আপলোড থাকতে হবে। (প্রযোজ্য ক্ষেত্রে)

১৩. PRL এর আদেশ/পেনশন বই এর কপি। (প্রযোজ্য ক্ষেত্রে)

১৪. বৈবাহিক অবস্থার পরিবর্তন হলে বিবাহ সনদ/কাবিন নামার কপি।

১৫. বিবাহ বিচ্ছেদ হলে বিচ্ছেদের সনদ/তালাক নামার কপি।

১৬. হারানো পাসপোর্টের ক্ষেত্রে সাধারণ ডায়েরী (GD) এর মূল কপি।

১৭. পূর্বের পাসপোর্ট এবং NID/BRC-তে তথ্য গড়মিল থাকলে নির্ধারিত ফরম্যাটে পূরণকৃত অঙ্গীকারনামা।

১৮. Multiple Active পাসপোর্টের ক্ষেত্রে নির্ধারিত ফরম্যাটে পূরণকৃত অঙ্গীকারনামা।

১৯. তথ্য সংশোধনের জন্য অপ্রাপ্তবয়স্কদের ক্ষেত্রে শিক্ষাগত সনদ (JSC/SSC/HSC/সমমান)।

২০. সরকারী চাকুরীজীবীদের তথ্য সংশোধনের ক্ষেত্রে NID, শিক্ষাগত সনদ ও সার্ভিস রেকর্ড অনুযায়ী অফিসের প্রত্যয়নপত্র এবং সার্ভিস রেকর্ডের ফটোকপি।

২১. দ্বৈত নাগরিকত্বের ক্ষেত্রে স্বরাষ্ট্র মন্ত্রণালয়ের Dual Citizenship সনদ (প্রযোজ্য ক্ষেত্রে)।

২২. অপ্রাপ্ত বয়স্কদের ক্ষেত্রে পিতা-মাতার অনুমতিপত্র এবং পিতা-মাতার উভয় বা যেকোন একজন উপস্থিত থাকা।

(বিঃদ্রঃ বায়ো-এনরোলমেন্ট এর সময় ছবি উঠানোর জন্য সাদা পোশাকের পরিবর্তে রঙ্গিন পোশাক পরিধান করতে হবে)।`,
    html: ""
  },
  {
    url: "https://www.epassport.gov.bd/landing/notices/161",
    title: "Special Notice: Resumption of Operations of the Narayanganj Regional Passport Office",
    markdown: `Welcome to Bangladesh e-Passport Portal

[Sign in](https://www.epassport.gov.bd/authorization/login)

Englishবাংলা

A+A-

Welcome to Bangladesh e-Passport Portal`,
    html: "",
    noContent: true,
    notes: "Notice page with empty content body"
  },
  {
    url: "https://www.epassport.gov.bd/landing/notices",
    title: "All Notices",
    markdown: `# All Notices

[Documents need to be carried while enrolment at Passport offices.](https://www.epassport.gov.bd/landing/notices/34)

[Special Notice: Resumption of Operations of the Narayanganj Regional Passport Office](https://www.epassport.gov.bd/landing/notices/161)

[Documents Checklist for e-Passport Enrollment](https://www.epassport.gov.bd/landing/notices/160)

[Dhaka Cantonment Passport Office Jurisdiction Redistribution of e-Passport Service](https://www.epassport.gov.bd/landing/notices/158)

[Enrolment of Biometric data for the Citizens older than 06 (six) years.](https://www.epassport.gov.bd/landing/notices/156)

[List of functional e-Passport Offices](https://www.epassport.gov.bd/landing/notices/33)

[Temporary halt of 64 pages passport booklet delivery](https://www.epassport.gov.bd/landing/notices/151)

[Guidelines for e-Passport application of government employees](https://www.epassport.gov.bd/landing/notices/39)`,
    html: ""
  },
  {
    url: "https://www.epassport.gov.bd/landing/faqs",
    title: "Frequently Asked Questions",
    markdown: `# Frequently Asked Questions

Account & Account Settings

- [I forgot the password of my online application account – what should I do?](https://www.epassport.gov.bd/landing/faqs/12)
- [Can I change the mobile number registered in my online application account?](https://www.epassport.gov.bd/landing/faqs/14)
- [Can I change the email address for my online application account?](https://www.epassport.gov.bd/landing/faqs/13)
- [I did not receive the account activation email when using online application – what should I do?](https://www.epassport.gov.bd/landing/faqs/11)

Appointments

Payment

Application

General Queries

Others`,
    html: ""
  }
];

/**
 * Run the pilot extraction
 * @param {string} runId - Run identifier (e.g., 'fee_doc_pilot_run_a')
 * @param {boolean} isRerun - Whether this is a re-run (for idempotency check)
 * @returns {Object} - Run results
 */
async function runPilot(runId, isRerun = false) {
  const runStartTime = new Date();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 Starting ${runId} (isRerun: ${isRerun})`);
  console.log(`${'='.repeat(60)}\n`);

  // Create output directory
  const outputDir = path.join(RUNS_DIR, runId);
  ensureDir(outputDir);
  ensureDir(SNAPSHOTS_DIR);

  // Load or create KB
  const kb = loadOrCreateKB(KB_PATH);
  const initialClaimsCount = kb.claims.length;

  // Track extraction stats
  const stats = {
    pages_processed: 0,
    pages_with_content: 0,
    pages_no_content: 0,
    fees_extracted: 0,
    steps_extracted: 0,
    faq_pairs_extracted: 0,
    doc_links_found: 0,
    claims_extracted: 0,
    claims_written: 0,
    duplicates_skipped: 0,
    per_page_stats: {}
  };

  // Process each page
  for (const pageData of SCRAPED_PAGES) {
    console.log(`\n📄 Processing: ${pageData.url}`);
    
    stats.pages_processed++;
    
    if (pageData.noContent) {
      console.log(`  ⚠️  No content extracted (${pageData.notes || 'JS-rendered or empty'})`);
      stats.pages_no_content++;
      stats.per_page_stats[pageData.url] = {
        steps: 0,
        fees: 0,
        faqs: 0,
        docs: 0,
        claims: 0,
        note: pageData.notes || 'No content'
      };
      continue;
    }

    stats.pages_with_content++;

    // Generate content hash
    const contentHash = generateHash(pageData.markdown);
    const sourcePageId = generateSourcePageId(pageData.url);
    const domain = new URL(pageData.url).hostname;

    // Save snapshot
    const snapshotDir = path.join(SNAPSHOTS_DIR, sourcePageId);
    ensureDir(snapshotDir);
    const snapshotRef = `snapshots/${sourcePageId}/${getDateString()}`;
    const snapshotPath = path.join(snapshotDir, `${getDateString()}.md`);
    fs.writeFileSync(snapshotPath, pageData.markdown, 'utf-8');

    // Add/update source page
    addOrUpdateSourcePage(kb, {
      url: pageData.url,
      domain: domain,
      title: pageData.title,
      markdown: pageData.markdown,
      contentHash: contentHash,
      snapshotRef: snapshotRef,
    }, classifyPage);

    // Extract structured data
    const structuredData = extractStructuredData(pageData.markdown, pageData.url, pageData.html || '');
    
    console.log(`  📊 Extracted: ${structuredData.stats.steps_extracted} steps, ${structuredData.stats.fees_extracted} fees, ${structuredData.stats.faq_pairs_extracted} FAQs, ${structuredData.stats.doc_links_found} docs`);

    // Update stats
    stats.fees_extracted += structuredData.stats.fees_extracted;
    stats.steps_extracted += structuredData.stats.steps_extracted;
    stats.faq_pairs_extracted += structuredData.stats.faq_pairs_extracted;
    stats.doc_links_found += structuredData.stats.doc_links_found;

    // Extract claims
    const claims = extractClaims(pageData.markdown, sourcePageId, pageData.url, structuredData);
    stats.claims_extracted += claims.length;

    // Add claims to KB (deduplication happens here)
    const addedCount = addClaimsToKB(kb, claims);
    stats.claims_written += addedCount;
    stats.duplicates_skipped += (claims.length - addedCount);

    console.log(`  📝 Claims: ${claims.length} extracted, ${addedCount} written, ${claims.length - addedCount} duplicates`);

    // Per-page stats
    stats.per_page_stats[pageData.url] = {
      steps: structuredData.stats.steps_extracted,
      fees: structuredData.stats.fees_extracted,
      faqs: structuredData.stats.faq_pairs_extracted,
      docs: structuredData.stats.doc_links_found,
      claims: claims.length,
      claims_written: addedCount
    };

    // Log document links if found
    if (structuredData.documentList.length > 0) {
      console.log(`  📎 Document links found:`);
      for (const doc of structuredData.documentList) {
        console.log(`     - ${doc.text}: ${doc.url}`);
      }
    }
  }

  // Save KB
  saveKB(kb, KB_PATH);

  // Generate crawl report
  const runEndTime = new Date();
  const crawlReport = {
    run_id: runId,
    started_at: runStartTime.toISOString(),
    completed_at: runEndTime.toISOString(),
    duration_ms: runEndTime - runStartTime,
    status: "completed",
    pilot_type: "fee_doc_verification",
    is_rerun: isRerun,
    domain: "epassport.gov.bd",
    
    summary: {
      pages_processed: stats.pages_processed,
      pages_with_content: stats.pages_with_content,
      pages_no_content: stats.pages_no_content,
      fees_extracted: stats.fees_extracted,
      steps_extracted: stats.steps_extracted,
      faq_pairs_extracted: stats.faq_pairs_extracted,
      doc_links_found: stats.doc_links_found,
      claims_extracted: stats.claims_extracted,
      claims_written: stats.claims_written,
      duplicates_skipped: stats.duplicates_skipped,
      total_kb_claims: kb.claims.length,
      initial_kb_claims: initialClaimsCount,
      net_new_claims: kb.claims.length - initialClaimsCount
    },

    per_page_extraction: stats.per_page_stats,

    findings: {
      fee_page_status: "NO_CONTENT - JavaScript rendered (Angular SPA)",
      fee_page_url: "https://www.epassport.gov.bd/instructions/passport-fees",
      fee_page_issue: "Fee table is dynamically loaded via Angular. Firecrawl cannot extract JS-rendered content without additional configuration.",
      doc_links_url_found: stats.doc_links_found > 0 
        ? Object.entries(stats.per_page_stats)
            .filter(([url, s]) => s.docs > 0)
            .map(([url]) => url)
        : [],
      recommendation: stats.fees_extracted === 0 
        ? "Fee content requires JavaScript rendering. Consider: (1) Using Firecrawl's waitFor option, (2) Browser automation, or (3) Direct API access if available."
        : "Fees extracted successfully."
    },

    errors: []
  };

  // Save crawl report
  const reportPath = path.join(outputDir, 'crawl_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(crawlReport, null, 2), 'utf-8');
  console.log(`\n📋 Crawl report saved to: ${reportPath}`);

  // Print summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 ${runId} Summary`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Pages processed: ${stats.pages_processed}`);
  console.log(`Pages with content: ${stats.pages_with_content}`);
  console.log(`Pages with no content: ${stats.pages_no_content}`);
  console.log(`Fees extracted: ${stats.fees_extracted}`);
  console.log(`Steps extracted: ${stats.steps_extracted}`);
  console.log(`FAQ pairs extracted: ${stats.faq_pairs_extracted}`);
  console.log(`Document links found: ${stats.doc_links_found}`);
  console.log(`Claims extracted: ${stats.claims_extracted}`);
  console.log(`Claims written (new): ${stats.claims_written}`);
  console.log(`Duplicates skipped: ${stats.duplicates_skipped}`);
  console.log(`Total KB claims: ${kb.claims.length}`);
  console.log(`${'='.repeat(60)}\n`);

  return {
    runId,
    stats,
    report: crawlReport,
    kb
  };
}

/**
 * Build and update public_guides.json with extracted data
 * @param {Object} kb - Knowledge base
 */
function updatePublicGuides(kb) {
  const publicGuidesPath = path.join(PUBLISHED_DIR, 'public_guides.json');
  ensureDir(PUBLISHED_DIR);

  let guides = { guides: [] };
  if (fs.existsSync(publicGuidesPath)) {
    try {
      guides = JSON.parse(fs.readFileSync(publicGuidesPath, 'utf-8'));
    } catch (e) {
      console.warn('⚠️  Could not load existing public_guides.json, creating new');
    }
  }

  // Find or create ePassport guide
  let epassportGuide = guides.guides.find(g => g.guide_id === 'guide.epassport');
  if (!epassportGuide) {
    epassportGuide = {
      guide_id: 'guide.epassport',
      service_id: 'svc.epassport',
      agency_id: 'agency.dip',
      agency_name: 'Department of Immigration and Passports',
      title: 'e-Passport Application',
      overview: null,
      steps: [],
      sections: {
        application_steps: [],
        fees: [],
        document_links: []
      },
      variants: [],
      required_documents: null,
      fees: [],
      official_links: [],
      meta: {
        total_steps: 0,
        total_citations: 0,
        verification_summary: {
          total: 0,
          verified: 0,
          unverified: 0
        },
        last_crawled_at: new Date().toISOString(),
        source_domains: ['www.epassport.gov.bd'],
        generated_at: new Date().toISOString(),
        status: 'draft'
      }
    };
    guides.guides.push(epassportGuide);
  }

  // Get ePassport claims from KB
  const epassportClaims = kb.claims.filter(c => 
    c.entity_ref?.id === 'svc.www_epassport' || 
    c.entity_ref?.id === 'svc.epassport' ||
    (c.citations && c.citations[0]?.canonical_url?.includes('epassport.gov.bd'))
  );

  // Update fees section
  const feeClaims = epassportClaims.filter(c => c.claim_type === 'fee');
  epassportGuide.sections.fees = feeClaims.map(c => ({
    label: c.text,
    amount_bdt: c.structured_data?.amount_bdt,
    variant: c.structured_data?.variant,
    citations: c.citations?.map(cit => ({
      source_page_id: cit.source_page_id,
      canonical_url: cit.canonical_url,
      quoted_text: cit.quoted_text
    }))
  }));
  epassportGuide.fees = epassportGuide.sections.fees;

  // Update steps section
  const stepClaims = epassportClaims.filter(c => c.claim_type === 'step');
  epassportGuide.sections.application_steps = stepClaims.map(c => ({
    order: c.structured_data?.order,
    title: c.structured_data?.title,
    description: c.structured_data?.description,
    citations: c.citations?.map(cit => ({
      source_page_id: cit.source_page_id,
      canonical_url: cit.canonical_url
    }))
  })).sort((a, b) => (a.order || 0) - (b.order || 0));
  epassportGuide.steps = epassportGuide.sections.application_steps;

  // Update document links section
  const docClaims = epassportClaims.filter(c => c.claim_type === 'document_requirement');
  epassportGuide.sections.document_links = docClaims.map(c => ({
    text: c.text,
    url: c.structured_data?.url,
    extension: c.structured_data?.extension,
    citations: c.citations?.map(cit => ({
      source_page_id: cit.source_page_id,
      canonical_url: cit.canonical_url
    }))
  }));

  // Update meta
  epassportGuide.meta.total_steps = epassportGuide.steps.length;
  epassportGuide.meta.total_citations = epassportClaims.reduce((sum, c) => sum + (c.citations?.length || 0), 0);
  epassportGuide.meta.last_crawled_at = new Date().toISOString();
  epassportGuide.meta.verification_summary.total = epassportClaims.length;
  epassportGuide.meta.verification_summary.unverified = epassportClaims.filter(c => c.status === 'unverified').length;

  // Save
  fs.writeFileSync(publicGuidesPath, JSON.stringify(guides, null, 2), 'utf-8');
  console.log(`📚 Public guides updated: ${publicGuidesPath}`);

  return guides;
}

/**
 * Main entry point
 */
async function main() {
  console.log('\n🔬 Fee + Docs Verification Pilot for epassport.gov.bd\n');
  
  try {
    // Run A - Initial extraction
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║                        RUN A                              ║');
    console.log('║              Initial Scrape & Extraction                  ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    
    const runAResults = await runPilot('fee_doc_pilot_run_a', false);
    
    // Update public guides
    const guides = updatePublicGuides(runAResults.kb);

    // Run B - Idempotency check
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║                        RUN B                              ║');
    console.log('║                 Idempotency Check                         ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    
    const runBResults = await runPilot('fee_doc_pilot_run_b', true);

    // Final summary
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║                   PILOT COMPLETE                          ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');
    
    console.log('📊 Comparison:');
    console.log(`   Run A claims written: ${runAResults.stats.claims_written}`);
    console.log(`   Run B claims written: ${runBResults.stats.claims_written}`);
    console.log(`   Idempotency check: ${runBResults.stats.claims_written === 0 ? '✅ PASSED' : '⚠️  Some new claims written'}`);
    
    console.log('\n📁 Deliverables:');
    console.log(`   - kb/runs/fee_doc_pilot_run_a/crawl_report.json`);
    console.log(`   - kb/runs/fee_doc_pilot_run_b/crawl_report.json`);
    console.log(`   - kb/published/public_guides.json`);
    
    // Key findings
    console.log('\n🔍 Key Findings:');
    console.log(`   Fees extracted: ${runAResults.stats.fees_extracted}`);
    if (runAResults.stats.fees_extracted === 0) {
      console.log('   ⚠️  ISSUE: passport-fees page is JavaScript-rendered (Angular SPA)');
      console.log('      Firecrawl returned "No content" for the fee table.');
      console.log('      Fee data requires JS rendering which is not currently supported.');
    }
    console.log(`   Document links found: ${runAResults.stats.doc_links_found}`);
    console.log(`   Steps extracted: ${runAResults.stats.steps_extracted}`);
    console.log(`   FAQ pairs extracted: ${runAResults.stats.faq_pairs_extracted}`);

  } catch (error) {
    console.error('❌ Pilot failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { runPilot, updatePublicGuides, SCRAPED_PAGES };
