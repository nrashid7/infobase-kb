#!/usr/bin/env node
/**
 * Process scraped data through extraction pipeline
 *
 * This script takes scraped content and processes it through the extraction pipeline
 * to generate structured claims that can be written to the KB.
 */

const fs = require('fs');
const path = require('path');

// Import extraction modules
const { extractStructuredData, extractClaims } = require('./crawler/extraction');

// Import KB writer
const { loadOrCreateKB, saveKB, addOrUpdateSourcePage, addClaimsToKB } = require('./crawler/kb_writer');

// Import utils
const { generateHash } = require('./crawler/utils');

// Sample scraped data from our crawl
const scrapedData = {
  'passport.gov.bd': {
    url: 'https://passport.gov.bd/',
    content: {
      markdown: `![BGDMRP banner](http://www.passport.gov.bd/images/banner.jpg)

Menu

- [MRP Related Instructions](http://www.passport.gov.bd/#)
  - Online Application Guide
  - [Application Guide for Primary/Initial MRP](http://www.passport.gov.bd/Reports/MRP_Application_Guide_New_MRP.pdf)
  - [Application Guide for Reissue/Correction/Alternation for MRP](http://www.passport.gov.bd/Reports/MRP_Application_Guide_Reissue_MRP.pdf)
- [Download Form](http://www.passport.gov.bd/#)
  - [DIP Form 1 : Primary/Initial Application for MRP](http://www.passport.gov.bd/Reports/MRP_Application_Form[Hard%20Copy].pdf)
  - [DIP Form 2 : Reissue/Correction/ Alternation for MRP](http://www.passport.gov.bd/Reports/MRP_Information_Alteration_Correction.pdf)
- [Contact](http://www.passport.gov.bd/Contact.aspx)
- [Application Status](http://www.passport.gov.bd/OnlineStatus.aspx)
- [Home](http://www.passport.gov.bd/Default.aspx)

[Forget Password?](http://www.passport.gov.bd/RecoverPassword.aspx)

- Application ID:
- Password:

## welcome to bangladesh machine readable passport online application website

### Please read the following guides in using this website:

- ১। সরকারি, আধাসরকারি, স্বায়ত্তশাষিত ও রাষ্ট্রায়ত্ত সংস্থার স্থায়ী কর্মকর্তা/কর্মচারী, অবসরপ্রাপ্ত সরকারি চাকুরীজীবি ও তাদের নির্ভরশীল স্ত্রী/স্বামী এবং সরকারি চাকুরীজীবিগণের ১৫ (পনের) বৎসরের কম বয়সের সন্তান, ৫ (পাঁচ)/১০ (দশ) বৎসরের অতিক্রান্ত, সমর্পণকৃত (সারেন্ডারড)দের জন্য একটি ফরম ও অন্যান্যদের ক্ষেত্রে নতুন পাসপোর্টের জন্য ২ (দুই) কপি পূরণকৃত পাসপোর্ট ফরম দাখিল করতে হবে।
- ২। অপ্রাপ্তবয়স্ক (১৫ বছরের কম) আবেদনকারীর ক্ষেত্রে আবেদনকারীর পিতা ও মাতার একটি করে রঙিন ছবি (৩০ x ২৫ মিঃমিঃ) আঠা দিয়ে লাগানোর পর সত্যায়ন করতে হবে।
- ৩। জাতীয় পরিচয়পত্র অথবা জন্ম নিবন্ধন সনদ এবং প্রযোজ্য ক্ষেত্রে প্রাসঙ্গিক টেকনক্যাল সনদসমূহের (যেমন ডাক্তার, ইঞ্জিনিয়ার, ড্রাইভার ইত্যাদি) সত্যায়িত ফটোকপি।
- ৪। যে সকল ব্যক্তিগণ পাসপোর্টের আবেদনপত্র ও ছবি প্রত্যায়ন ও সত্যায়ন করতে পারবেন – সংসদ সদস্য, সিটি কর্পোরেশনের মেয়র, ডেপুটি মেয়র ও কাউন্সিলরগণ, গেজেটেড কর্মকর্তা, পাবলিক বিশ্ববিদ্যালয়ের শিক্ষক, উপজেলা পরিষদের চেয়ারম্যান ও ভাইস চেয়ারম্যান, পৌরসভার মেয়র ও পৌর কাউন্সিলরগণ, বেসরকারি বিশ্ববিদ্যালয়ের অধ্যাপক, বেসরকারি কলেজের অধ্যক্ষ, বেসরকারি উচ্চ বিদ্যালয়ের প্রধান শিক্ষক, জাতীয় দৈনিক পত্রিকার সম্পাদক, নোটারী পাবলিক ও আধাসরকারি/স্বায়ত্তশাসিত/রাষ্ট্রায়ত্ত সংস্থার জাতীয় বেতন স্কেলের ৭ম ও তদুর্ধ্ব গ্রেডের গ্রেডের কর্মকর্তাগণ।
- ৫। প্রযোজ্য ক্ষেত্রে প্রাসঙ্গিক জিও (GO)/এনওসি(NOC) দাখিল করতে হবে।
- ৬। কূটনৈতিক পাসপোর্ট লাভের যোগ্য আবেদনকারীগণকে পূরণকৃত ফরম ও সংযুক্তিসমূহ পররাষ্ট্র মন্ত্রনালয়ে জমা দিতে হবে।
- ৭। শিক্ষাগত বা চাকুরীসূত্রে প্রাপ্ত পদবীসমূহ (যেমন ডাক্তার, ইঞ্জিনিয়ার, ডক্টর, পিএইচডি ইত্যাদি) নামের অংশ হিসেবে পরিগণিত হবে না। ফরমের ক্রমিক নং ৩ পূরনের ক্ষেত্রে, একাধিক অংশ থাকলে প্রতি অংশের মাঝখানে ১টি ঘর শূন্য রেখে পূরণ করতে হবে। আবেদনকারীর পিতা, মাতা, স্বামী/স্ত্রী মৃত হলেও তার/তাদের নামের পূর্বে 'মৃত/মরহুম/Late' লেখা যাবে না।

- Fill the form correctly with all mandatory fields(*) and click the "Save" button.
- On successful completion of first page, you will receive an email containing your Application ID and Password. Please preserve your Application ID and Password carefully for future print/view/modification of application.
- To submit your application, click "submit" button. You are not allowed to modify anything after you click "submit". You will also receive an "Online Application Form" in pdf format. You have to report to the Passport Office for providing biometric data along with a printed version of the Online Application form.
- After submission, the system will assign you to your authorised Regional Passport Office. Your application shall remain valid for 15 days from the date of submission. Your record will be removed automatically by the system after 15 days.
- If Acrobat reader is unavailable in your computer, then download [acrobat reader](http://get.adobe.com/uk/reader/) from here.

I have read the above information and the relevant guidance notes.

Start Time: 1/5/2026 7:28:22 PM

End Time: 1/5/2026 7:28:22 PM

(You Page Load took 0.8737657 second(s).)

Copyright © 2012 | Department of Immigration and Passport, Bangladesh

Bangladesh Machine Readable Passport - Online Application Website v4.4.0.9`,
      html: '',
      title: 'Online Application for Bangladesh Machine Readable Passport(BGDMRP) - Home'
    }
  },
  'epassport.gov.bd': {
    fees: {
      url: 'https://www.epassport.gov.bd/instructions/passport-fees',
      content: {
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

**Govt employees who have No Objection Certificate (NOC)/Retirement document (PRL)**

**a**. Express facilities with Regular fees.

**b.** Super-Express facilities with Express fees.

### e-Passport fees for inside Bangladesh (Including 15% VAT)

**e-Passport with 48 pages and 5 years validity**

- Regular delivery: TK 4,025
- Express delivery: TK 6,325
- Super Express delivery: TK 8,625

**e-Passport with 48 pages and 10 years validity**

- Regular delivery: TK 5,750
- Express delivery: TK 8,050
- Super Express delivery: TK 10,350

**e-Passport with 64 pages and 5 years validity**

- Regular delivery: TK 6,325
- Express delivery: TK 8,625
- Super Express delivery: TK 12,075

**e-Passport with 64 pages and 10 years validity**

- Regular delivery: TK 8,050
- Express delivery: TK 10,350
- Super Express delivery: TK 13,800

### e-Passport fees for Bangladesh Mission's General Applicants:

**e-Passport with 48 pages and 5 years validity**

- Regular delivery : USD 100
- Express delivery : USD 150

**e-Passport with 48 pages and 10 years validity**

- Regular delivery : USD 125
- Express delivery : USD 175

**e-Passport with 64 pages and 5 years validity**

- Regular delivery : USD 150
- Express delivery : USD 200

**e-Passport with 64 pages and 10 years validity**

- Regular delivery : USD 175
- Express delivery : USD 225

### e-Passport fees for Bangladesh Mission's Labors and Students:

**e-Passport with 48 pages and 5 years validity**

- Regular delivery : USD 30
- Express delivery : USD 45

**e-Passport with 48 pages and 10 years validity**

- Regular delivery : USD 50
- Express delivery : USD 75

**e-Passport with 64 pages and 5 years validity**

- Regular delivery : USD 150
- Express delivery : USD 200

**e-Passport with 64 pages and 10 years validity**

- Regular delivery : USD 175
- Express delivery : USD 225`,
        html: '',
        title: 'E‑Passport Online Registration Portal'
      }
    },
    steps: {
      url: 'https://www.epassport.gov.bd/instructions/five-step-to-your-epassport',
      content: {
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
        html: '',
        title: 'E‑Passport Online Registration Portal'
      }
    },
    faq: {
      url: 'https://www.epassport.gov.bd/landing/faqs/24',
      content: {
        markdown: `# I experienced issues with Online Payment - what can I do?

# আমি অনলাইন অর্থ প্রদানের ক্ষেত্রে কিছু সমস্যা পেয়েছি \\- আমি কী করতে পারি?

Last updated: 24 May 2025

Contact to your bank for refund if status is failed but payment done. After having refund from bank then delete this application and apply a new.

If payment is not done and status is failed then select offline payment option or delete this application and try a new.

আপনার টাকা কেটে নিয়ে স্ট্যাটাস ফেইল্ড দেখালে সংশ্লিষ্ট ব্যাংকে যোগাযোগ করুণ রিফান্ডের জন্য। রিফান্ড পেয়েগেলে উক্ত আবেদনটি ডিলিট করে নুতন আবেদন করুণ।

আর টাকা না কেটে স্ট্যাটাস ফেইল্ড দেখালে অফলাইনে পেমেন্ট সিলেক্ট করে আবেদনটি সাবমিট দিন। অথবা উক্ত আবেদনটি ডিলিট করে নুতন আবেদন করুণ。

### Further questions

[How can I check the status of my passport application?](https://www.epassport.gov.bd/landing/faqs/7)

[Can I schedule online appointments even if I don’t use online application but PDF from?](https://www.epassport.gov.bd/landing/faqs/19)

[I have retired from Government service. Now what documents are required to complete enrollment process of E-Passport?](https://www.epassport.gov.bd/landing/faqs/270)

[My present address changed compared to my previous passport - where do I need to apply?](https://www.epassport.gov.bd/landing/faqs/22)

[After how many years e-passport must be re-issued?](https://www.epassport.gov.bd/landing/faqs/285)`,
        html: '',
        title: 'E‑Passport Online Registration Portal'
      }
    }
  }
};

async function processScrapedData() {
  console.log('🔄 Processing scraped data through extraction pipeline...\n');

  // Load existing KB
  const kbPath = path.join(__dirname, '..', 'kb', 'bangladesh_government_services_kb_v3.json');
  let kb = loadOrCreateKB(kbPath);

  let totalClaims = 0;

  // Process each domain
  for (const [domain, domainData] of Object.entries(scrapedData)) {
    console.log(`📄 Processing domain: ${domain}`);

    if (domain === 'passport.gov.bd') {
      // Process passport.gov.bd content
      const { url, content } = domainData;

      // Extract structured data
      const structuredData = extractStructuredData(content.markdown, url);

      // Generate claims
      const claims = extractClaims(content.markdown, generateHash(url), url, structuredData, {
        source_domain: domain,
        canonical_url: url,
        source_page_id: generateHash(url),
        agency_name: 'Department of Immigration and Passport',
        service_name: 'Passport Application',
        last_updated: new Date().toISOString()
      });

        // Add source page to KB
        addOrUpdateSourcePage(kb, {
          url: url,
          domain: domain,
          title: content.title,
          markdown: content.markdown,
          contentHash: generateHash(content.markdown),
          snapshotRef: null
        }, () => ['other']); // Simple classify function

      // Add claims to KB
      addClaimsToKB(kb, claims);

      totalClaims += claims.length;
      console.log(`   ✓ Added ${claims.length} claims from ${url}`);

    } else if (domain === 'epassport.gov.bd') {
      // Process e-Passport content
      for (const [pageType, pageData] of Object.entries(domainData)) {
        const { url, content } = pageData;

        // Extract structured data
        const structuredData = extractStructuredData(content.markdown, url);

        // Generate claims
        const claims = extractClaims(content.markdown, generateHash(url), url, structuredData, {
          source_domain: domain,
          canonical_url: url,
          source_page_id: generateHash(url),
          agency_name: 'Department of Immigration and Passport',
          service_name: 'e-Passport Application',
          last_updated: new Date().toISOString()
        });

        // Add source page to KB
        addOrUpdateSourcePage(kb, {
          url: url,
          domain: domain,
          title: content.title,
          markdown: content.markdown,
          contentHash: generateHash(content.markdown),
          snapshotRef: null
        }, () => ['other']); // Simple classify function

        // Add claims to KB
        addClaimsToKB(kb, claims);

        totalClaims += claims.length;
        console.log(`   ✓ Added ${claims.length} claims from ${pageType} page`);
      }
    }
  }

  // Save updated KB
  saveKB(kb, kbPath);

  console.log(`\n✅ Extraction complete! Added ${totalClaims} total claims to KB`);
  console.log(`📁 KB saved to: ${kbPath}`);
}

// Run the processing
if (require.main === module) {
  processScrapedData().catch(console.error);
}

module.exports = { processScrapedData, scrapedData };
