/**
 * Process e-Passport Pilot Crawl Results
 * 
 * Processes scraped pages from Firecrawl MCP and generates:
 * - KB v3 source_pages and claims
 * - Crawl report
 * - Updated crawl_state.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// NOTE: This pilot file is NON-PRODUCTION - see README.md
const crawlModule = require('../../scripts/crawl');

// Utility functions (not exported from crawl.js)
function generateHash(content, algorithm = 'sha256') {
  return crypto.createHash(algorithm).update(content, 'utf8').digest('hex');
}

function generateSourcePageId(url) {
  return `source.${generateHash(url, 'sha1')}`;
}

function getDateString() {
  return new Date().toISOString().split('T')[0];
}

const domain = 'epassport.gov.bd';
const startTime = new Date().toISOString();

console.log('🚀 Processing e-Passport Pilot Crawl Results\n');
console.log(`Domain: ${domain}`);
console.log(`Started: ${startTime}\n`);

// Load KB and state
const kb = crawlModule.loadOrCreateKB();
const state = crawlModule.loadCrawlState();

// Get domain state (create if doesn't exist)
if (!state.domainStates[domain]) {
  state.domainStates[domain] = {
    lastCrawled: null,
    pagesCrawled: 0,
    robotsRules: null,
    sitemapUrls: [],
    discoveredUrls: [],
    processedUrls: [],
    excludedUrls: [],
    errors: [],
  };
}
const domainState = state.domainStates[domain];

// Scraped pages from Firecrawl MCP (actual results)
// Format: { url, markdown, html, metadata: { title } }
const scrapedPages = [
  {
    url: 'https://www.epassport.gov.bd/instructions/application-form',
    markdown: 'Welcome to Bangladesh e-Passport Portal\n\n[Sign in](https://www.epassport.gov.bd/authorization/login)\n\nEnglishবাংলা\n\nA+A-\n\nWelcome to Bangladesh e-Passport Portal\n\n# Application at RPO Bangladesh Secretariat and Dhaka Cantonment\n\nLast updated: 12 September 2024\n\nThis application form is applicable for applicants who are **applying for e-Passport at RPO Bangladesh Secretariat and Dhaka Cantonment.**\n\nIt cannot be used for enrolments at other RPOs. Eligibility of applicants must be checked by responsible officer before enrolment.\n\nIf you are eligible to apply at Bangladesh Secretariat/DhakaCantonment please download the application form, fill up all required information and present it before enrolment.\n\n**Important note:**\n\n1. PDF form needs to be downloaded to the computer first\n2. Open and fille up with the tool " **Adobe Acrobat Reader DC**" to support all required functions.\n\nFor free download of Adobe Acrobat Reader on [**Adobe.com**](https://acrobat.adobe.com/us/en/acrobat/pdf-reader.html)\n\n[Download a PDF form](https://www.epassport.gov.bd/api/v1/registrations/download-offline-form)',
    html: '',
    metadata: { title: 'E‑Passport Online Registration Portal' }
  },
  {
    url: 'https://www.epassport.gov.bd/instructions/instructions',
    markdown: 'Welcome to Bangladesh e-Passport Portal\n\n[Sign in](https://www.epassport.gov.bd/authorization/login)\n\nEnglishবাংলা\n\nA+A-\n\nWelcome to Bangladesh e-Passport Portal\n\n# ই-পাসপোর্ট ফরম পূরণের নির্দেশাবলী:\n\nLast updated: 5 May 2025\n\n১। ই-পাসপোর্টের আবেদনপত্র অনলাইনে পূরণ করা যাবে।\n\n২। ই-পাসপোর্ট আবেদনের ক্ষেত্রে কোন কাগজপত্র সত্যায়ন করার প্রয়োজন হবে না।\n\n৩। ই-পাসপোর্ট ফরমে কোন ছবি সংযোজন এবং তা সত্যায়নের প্রয়োজন হবে না।\n\n৪। জাতীয় ‍পরিচয়পত্র (NID) অথবা অনলাইন জন্মনিবন্ধন সনদ (BRC English Version) অনুযায়ী আবেদন পত্র পূরণ করতে হবে।\n\n৫। অপ্রাপ্ত বয়স্ক (১৮ বছরের কম) আবেদনকারী যার জাতীয় পরিচয়পত্র (NID) নাই, তার পিতা অথবা মাতার জাতীয় পরিচয়পত্র (NID) নম্বর অবশ্যই উল্লেখ করতে হবে।\n\n৬। জাতীয় ‍পরিচয়পত্র (NID) অথবা অনলাইন জন্মনিবন্ধন সনদ (BRC English Version) নিম্নোক্ত বয়স অনুসারে দাখিল করতে হবে-\n\n(ক) ১৮ বছরের নিম্নে হলে অনলাইন জন্মনিবন্ধন সনদ (BRC English Version).\n\n(খ) ১৮-২০ বছর হলে জাতীয় ‍পরিচয়পত্র (NID) অথবা অনলাইন জন্মনিবন্ধন সনদ (BRC English Version)\n\n(গ) ২০ বছরের উর্ধে হলে জাতীয় ‍পরিচয়পত্র (NID) আবশ্যক । তবে বিদেশস্থ বাংলাদেশ মিশন হতে আবেদনের ক্ষেত্রে অনলাইন জন্মনিবন্ধন সনদ (BRC English Version) গ্রহণযোগ্য হবে।\n\n৭। তারকা চিহ্নিত ক্রমিক নম্বরগুলো অবশ্যই পূরণীয়।\n\n৮। দত্তক/অভিভাবকত্ব গ্রহণের ক্ষেত্রে পাসপোর্টের আবেদনের সাথে সুরক্ষা সেবা বিভাগ, স্বরাষ্ট্র মন্ত্রণালয় হতে জারিকৃত আদেশ দাখিল করতে হবে।\n\n৯। আবেদন বর্তমান ঠিকানা সংশ্লিষ্ঠ বিভাগীয় পাসপোর্ট ও ভিসা অফিস/আঞ্চলিক পাসপোর্ট অফিস/বিদেশস্থ বাংলাদেশ মিশনে দাখিল করতে হবে।\n\n১০। ১৮ বছরের নিম্নের সকল আবেদনে ই-পাসপোর্টের মেয়াদ হবে ০৫ বছর এবং ৪৮ পৃষ্ঠার।\n\n১১। প্রাসঙ্গিক টেকনিক্যাল সনদসমূহ (যেমন: ডাক্তার, ইঞ্জিনিয়ার, ড্রাইভার ইত্যাদি) আপলোড/সংযোজন করতে হবে।\n\n১২। প্রযোজ্য ক্ষেত্রে প্রাসঙ্গিক জিও (GO)/এনওসি (NOC)/ প্রত্যয়নপত্র/ অবসরোত্তর ছুটির আদেশ (PRL Order)/ পেনশন বই আপলোড/সংযোজন করতে হবে যা ইস্যুকারী কর্তৃপক্ষের নিজ নিজ Website এ আপলোড থাকতে হবে।\n\n১৩। প্রযোজ্য ক্ষেত্রে বিবাহ সনদ/নিকাহনামা এবং বিবাহ বিচ্ছেদের ক্ষেত্রে তালাকনামা দাখিল করতে হবে।\n\n১৪। দেশের অভ্যন্তরে আবেদনের ক্ষেত্রে প্রযোজ্য ফি এর উপর নির্ধারিত হারে ভ্যাট (VAT) সহ অন্যান্য চার্জ (যদি থাকে) অতিরিক্ত হিসাবে প্রদেয় হবে। বিদেশে আবেদনের ক্ষেত্রেও সরকার কর্তৃক নির্ধারিত ফি প্রদেয় হবে।\n\n১৫। কূটনৈতিক পাসপোর্টের জন্য পররাষ্ট্র মন্ত্রণালয়ের কনস্যুলার ও ওয়েলফেয়ার উইং (Consular and Welfare Wing) অথবা ইমিগ্রেশন ও পাসপোর্ট অধিদপ্তরের প্রধান কার্যালয় বরাবর আবেদনপত্র দাখিল করতে হবে।\n\n১৬। বৈদেশিক মিশন হতে নতুন পাসপোর্টের জন্য আবেদন করা হলে স্থায়ী ঠিকানার কলামে বাংলাদেশের যোগাযোগের ঠিকানা উল্লেখ করতে হবে।\n\n১৭। অতি জরুরী পাসপোর্টের আবেদনের ক্ষেত্রে (নতুন ইস্যু) নিজ উদ্যোগে পুলিশ ক্লিয়ারেন্স সনদ সংগ্রহ পূর্বক আবশ্যিকভাবে আবেদনের সাথে দাখিল করতে হবে।\n\n১৮। (ক) দেশের অভ্যন্তরে অতি জরুরী পাসপোর্ট প্রাপ্তির লক্ষ্যে আবেদনের সাথে পুলিশ ক্লিয়ারেন্স দাখিল করা হলে অন্যান্য সকল তথ্য সঠিক থাকা সাপেক্ষে ২ কর্মদিবসের মধ্যে পাসপোর্ট প্রদান করা হবে।\n\n(খ) দেশের অভ্যন্তরে জরুরী পাসপোর্ট প্রাপ্তির লক্ষ্যে আবেদনের সাথে পুলিশ ক্লিয়ারেন্স দাখিল করা হলে অন্যান্য সকল তথ্য সঠিক থাকা সাপেক্ষে ৭ কর্মদিবসের মধ্যে পাসপোর্ট প্রদান করা হবে।\n\n(গ) দেশের অভ্যন্তরে রেগুলার পাসপোর্ট প্রাপ্তির লক্ষ্যে আবেদনের সাথে পুলিশ ক্লিয়ারেন্স দাখিল করা হলে অন্যান্য সকল তথ্য সঠিক থাকা সাপেক্ষে ১৫ কর্মদিবসের মধ্যে পাসপোর্ট প্রদান করা হবে।\n\n১৯। আবেদনের সময় মূল জাতীয় ‍পরিচয়পত্র (NID), অনলাইন জন্মনিবন্ধন সনদ (BRC English Version) এবং প্রযোজ্য ক্ষেত্রে টেকনিক্যাল সনদ, সরকারি আদেশ (GO)/অনাপত্তি (NOC) প্রদর্শন/দাখিল করতে হবে।\n\n২০। পাসপোর্ট রি-ইস্যুর ক্ষেত্রে মূল পাসপোর্ট প্রদর্শন করতে হবে।\n\n২১। হারানো পাসপোর্টের ক্ষেত্রে মূল জিডির কপি প্রদর্শন/দাখিল করতে হবে। পাসপোর্ট হারিয়ে গেলে অথবা চুরি হলে দ্রুত নিকটস্থ থানায় জিডি করতে হবে। পুনরায় পাসপোর্টের জন্য আবেদনের সময় পুরাতন পাসপোর্টের ফটোকপি এবং জিডি কপিসহ আবেদনপত্র দাখিল করতে হবে ।\n\n২২। ০৬ বছর বয়সের নিম্নের আবেদনের ক্ষেত্রে ৩ আর (3R Size) সাইজের ( ল্যাব প্রিন্ট গ্রে ব্যাকগ্রউন্ড ) ছবি দাখিল করতে হবে।',
    html: '',
    metadata: { title: 'E‑Passport Online Registration Portal' }
  },
  {
    url: 'https://www.epassport.gov.bd/landing/faqs',
    markdown: 'Welcome to Bangladesh e-Passport Portal\n\n[Sign in](https://www.epassport.gov.bd/authorization/login)\n\nEnglishবাংলা\n\nA+A-\n\nWelcome to Bangladesh e-Passport Portal\n\n# Frequently Asked Questions\n\nAccount & Account Settings\n\n- [I forgot the password of my online application account – what should I do?](https://www.epassport.gov.bd/landing/faqs/12)\n- [Can I change the mobile number registered in my online application account?](https://www.epassport.gov.bd/landing/faqs/14)\n- [Can I change the email address for my online application account?](https://www.epassport.gov.bd/landing/faqs/13)\n- [I did not receive the account activation email when using online application – what should I do?](https://www.epassport.gov.bd/landing/faqs/11)\n\nAppointments\n\nPayment\n\nApplication\n\nGeneral Queries\n\nOthers',
    html: '',
    metadata: { title: 'E‑Passport Online Registration Portal' }
  },
  {
    url: 'https://www.epassport.gov.bd/instructions/urgent-applications',
    markdown: 'Welcome to Bangladesh e-Passport Portal\n\n[Sign in](https://www.epassport.gov.bd/authorization/login)\n\nEnglishবাংলা\n\nA+A-\n\nWelcome to Bangladesh e-Passport Portal\n\n# Urgent Applications\n\nLast updated: 1 June 2025\n\n## **What is Super Express passport delivery service?**\n\nThere are occasions when a citizen needs passport urgently. In such situation, citizens can apply for **Super Express** delivery (specific conditions and fees apply). Passport will be issued within 2 (two) working days for Super Express delivery.\n\n## **Who can apply for Super Express delivery?**\n\nAny citizen of Bangladesh can apply for Super Express delivery.\n\n## **Where can I apply for Super Express passport?**\n\nSuper Express service is applicable for citizens applying from Bangladesh. This service is not available outside Bangladesh i.e. Bangladesh Missions abroad. Applications for Super Express delivery can be made through the Online Application Portal and it can be processed through any passport office of Bangladesh.\n\n## **What is the Super Express passport delivery process?**\n\nSuper Express passports are delivered only from the Divisional Passport and Visa Office, Agargaon, Dhaka-1207. Citizens will have to collect Super Express passport from there. Shipment to other passport offices is not possible.\n\n## **Address for passport pickup (Super Express delivery):**\n\nDivisional Passport and Visa Office, Building # 2\n\nE-7, Sher-E-Bangla Nagor, Agargaon, Dhaka-1207\n\nContact No: +880 2-8123788',
    html: '',
    metadata: { title: 'E‑Passport Online Registration Portal' }
  },
  {
    url: 'https://www.epassport.gov.bd/landing/notices/160',
    markdown: 'Welcome to Bangladesh e-Passport Portal\n\n[Sign in](https://www.epassport.gov.bd/authorization/login)\n\nEnglishবাংলা\n\nA+A-\n\nWelcome to Bangladesh e-Passport Portal\n\n# Documents Checklist for e-Passport Enrollment\n\n# পাসপোর্টের আবেদন জমা নেওয়ার ক্ষেত্রে চেকলিস্ট\n\nLast updated: 21 October 2024\n\nপাসপোর্টের আবেদন জমা নেওয়ার ক্ষেত্রে চেকলিস্ট\n\n১. আবেদনকারী কর্তৃক অনলাইনে আবেদনকৃত (পিডিএফ) ফরম প্রিন্টেড কপি।\n\n২. পাসপোর্টের ফি জমা প্রদানের চালান রশিদ (অফলাইন পেমেন্টের ক্ষেত্রে)।\n\n৩. অনলাইন জন্ম নিবন্ধন সনদ (ইংরেজী ভার্সন) মূলকপি এবং ফটোকপি।\n\n৪. জাতীয় পরিচয় পত্রের মূল ও ফটোকপি (২০ বছরের উর্ধ্বের নাগরিকদের জন্য)।\n\n৫. বর্তমান ঠিকানা প্রমাণের স্বপক্ষে Job ID/Student ID/গ্যাস বিলের কপি/ বিদ্যুৎ বিলের কপি/ টেলিফোন বিলের কপি/পানির বিলের কপি যেটি প্রযোজ্য সেটার মূলকপি প্রদর্শন করা।\n\n৬. দত্তক/অভিভাবকত্ব গ্রহণের ক্ষেত্রে সুরক্ষা সেবা বিভাগ, স্বরাষ্ট মন্ত্রণালয় হতে জারীকৃত আদেশের কপি।\n\n৭. টেকনিক্যাল পেশা প্রমাণের স্বপক্ষে (ডাক্তার, ইঞ্জিনিয়ার, ড্রাইভার ইত্যাদি) টেকনিক্যাল সনদের কপি।\n\n৮. রি-ইস্যু আবেদনের ক্ষেত্রে মূল পাসপোর্ট (Original Passport) এবং পাসপোর্টের ফটোকপি\n\n৯. ধূসর ব্যাকগ্রাউন্ডের 3R সাইজের ফটো (০৬ বছরের নিচে শিশুদের ক্ষেত্রে)।\n\n১০. অপ্রাপ্ত বয়স্ক আবেদনকারীর ক্ষেত্রে পিতা/মাতার জাতীয় পরিচয়পত্রের কপি।\n\n১১. মেডিকেল সনদ (চোখের আইরিশ, ফিঙ্গারপ্রিন্ট মিসিং হবার ক্ষেত্রে)।\n\n১২. সরকারী আদেশ (GO)/অনাপত্তি সনদ (NOC)/প্রত্যয়নপত্র এর কপি যা ইস্যুকারী কর্তৃপক্ষের নিজ নিজ Website এ আপলোড থাকতে হবে। (প্রযোজ্য ক্ষেত্রে)\n\n১৩. PRL এর আদেশ/পেনশন বই এর কপি। (প্রযোজ্য ক্ষেত্রে)\n\n১৪. বৈবাহিক অবস্থার পরিবর্তন হলে বিবাহ সনদ/কাবিন নামার কপি।\n\n১৫. বিবাহ বিচ্ছেদ হলে বিচ্ছেদের সনদ/তালাক নামার কপি।\n\n১৬. হারানো পাসপোর্টের ক্ষেত্রে সাধারণ ডায়েরী (GD) এর মূল কপি।\n\n১৭. পূর্বের পাসপোর্ট এবং NID/BRC-তে তথ্য গড়মিল থাকলে নির্ধারিত ফরম্যাটে পূরণকৃত অঙ্গীকারনামা।\n\n১৮. Multiple Active পাসপোর্টের ক্ষেত্রে নির্ধারিত ফরম্যাটে পূরণকৃত অঙ্গীকারনামা।\n\n১৯. তথ্য সংশোধনের জন্য অপ্রাপ্তবয়স্কদের ক্ষেত্রে শিক্ষাগত সনদ (JSC/SSC/HSC/সমমান)।\n\n২০. সরকারী চাকুরীজীবীদের তথ্য সংশোধনের ক্ষেত্রে NID, শিক্ষাগত সনদ ও সার্ভিস রেকর্ড অনুযায়ী অফিসের প্রত্যয়নপত্র এবং সার্ভিস রেকর্ডের ফটোকপি।\n\n২১. দ্বৈত নাগরিকত্বের ক্ষেত্রে স্বরাষ্ট্র মন্ত্রণালয়ের Dual Citizenship সনদ (প্রযোজ্য ক্ষেত্রে)।\n\n২২. অপ্রাপ্ত বয়স্কদের ক্ষেত্রে পিতা-মাতার অনুমতিপত্র এবং পিতা-মাতার উভয় বা যেকোন একজন উপস্থিত থাকা।',
    html: '',
    metadata: { title: 'E‑Passport Online Registration Portal' }
  },
  {
    url: 'https://www.epassport.gov.bd/landing/notices/34',
    markdown: 'Welcome to Bangladesh e-Passport Portal\n\n[Sign in](https://www.epassport.gov.bd/authorization/login)\n\nEnglishবাংলা\n\nA+A-\n\nWelcome to Bangladesh e-Passport Portal\n\n# Documents need to be carried while enrolment at Passport offices.\n\n# পাসপোর্ট অফিসে আবেদনপত্র জমা দেওয়ার সময় যে সকল প্রয়োজনীয় কাগজপত্র নিয়ে যেতে হবে :\n\nLast updated: 7 May 2025\n\n### **Required documents:**\n\n1. Printed application summary including appointment (if any).\n2. Identification documents (NID card / Birth certificate - Original)\n3. Payment Slip for Offline Payment only.\n4. Previous Passport (if any).\n5. GO/NOC for government service holder (as applicable).\n6. Printed application form.\n7. Further necessity of documents depends on nature of application/corrections (if any).',
    html: '',
    metadata: { title: 'E‑Passport Online Registration Portal' }
  },
  {
    url: 'https://www.epassport.gov.bd/authorization/application-status',
    markdown: 'Welcome to Bangladesh e-Passport Portal\n\n[Sign in](https://www.epassport.gov.bd/authorization/login)\n\nEnglishবাংলা\n\nA+A-\n\nWelcome to Bangladesh e-Passport Portal\n\n# Check application status\n\nCheck the status of your application by entering either\n\n**Application ID** (e.g. 4000-100000000) you find on the Delivery Slip you received from the Passport Office\n\nOr **Online Registration ID** (OID) from your online application (e.g. OID1000001234)',
    html: '',
    metadata: { title: 'E‑Passport Online Registration Portal' }
  },
  {
    url: 'https://www.epassport.gov.bd',
    markdown: 'Welcome to Bangladesh e-Passport Portal\n\n[Sign in](https://www.epassport.gov.bd/authorization/login)\n\nEnglishবাংলা\n\nA+A-\n\nWelcome to Bangladesh e-Passport Portal\n\nApply Online for e‑Passport / Re‑Issue\n\n[Directly to online application \\\\\n![arrow-key](https://www.epassport.gov.bd/assets/icons/keyboard-arrow-right-blue.svg)](https://www.epassport.gov.bd/onboarding)\n\n5 steps to e‑Passport\n\n[Information about all application steps \\\\\n![arrow-key](https://www.epassport.gov.bd/assets/icons/keyboard-arrow-right-blue.svg)](https://www.epassport.gov.bd/instructions/five-step-to-your-epassport)\n\nUrgent applications\n\n[Need a passport quickly? \\\\\n![arrow-key](https://www.epassport.gov.bd/assets/icons/keyboard-arrow-right-blue.svg)](https://www.epassport.gov.bd/instructions/urgent-applications)\n\nPassport fees\n\n[Payment information and options \\\\\n![arrow-key](https://www.epassport.gov.bd/assets/icons/keyboard-arrow-right-blue.svg)](https://www.epassport.gov.bd/instructions/passport-fees)\n\nInstructions\n\n[Have a look before applying \\\\\n![arrow-key](https://www.epassport.gov.bd/assets/icons/keyboard-arrow-right-blue.svg)](https://www.epassport.gov.bd/instructions/instructions)\n\nApplication at RPO Bangladesh Secretariat and Dhaka Cantonment\n\n[More information \\\\\n![arrow-key](https://www.epassport.gov.bd/assets/icons/keyboard-arrow-right-blue.svg)](https://www.epassport.gov.bd/instructions/application-form)',
    html: '',
    metadata: { title: 'E‑Passport Online Registration Portal' }
  },
  {
    url: 'https://www.epassport.gov.bd/landing/faqs/7',
    markdown: 'Welcome to Bangladesh e-Passport Portal\n\n[Sign in](https://www.epassport.gov.bd/authorization/login)\n\nEnglishবাংলা\n\nA+A-\n\nWelcome to Bangladesh e-Passport Portal\n\n# How can I check the status of my passport application?\n\n# আমার পাসপোর্ট আবেদনের অগ্রগতি কিভাবে দেখতে পারব ?\n\nLast updated: 28 August 2020\n\n## Online Check\n\nGo to the **Status Check** on the ePassport portal home page. Enter your **Application ID** or **Online Registration ID** and **date of birth** of the applicant to see the current status of your passport application. The Application ID can be found on the delivery slip you received after enrolment at the passport office.\n\nYou also see the status of all your applications in your online portal account.',
    html: '',
    metadata: { title: 'E‑Passport Online Registration Portal' }
  }
];

// Initialize run stats
const runStats = {
  startedAt: startTime,
  status: 'completed',
  config: {
    seedSource: 'public_services_seeds',
    category: 'public_services',
    maxDepth: 3,
    maxPages: 30,
    requireFirecrawl: true,
    allowHttpDocDownload: true,
  },
  domainsCrawled: 1,
  pagesTotal: scrapedPages.length,
  pagesKept: 0,
  pagesExcluded: 0,
  pagesUnchanged: 0,
  docsDownloaded: 0,
  documentsFetchedViaFirecrawl: 0,
  documentsFetchedViaHttpFallback: 0,
  claimsExtracted: 0,
  errors: [],
  domainDetails: [],
};

const domainStats = {
  domain,
  label: 'e-Passport Portal',
  pagesDiscovered: 22,
  pagesProcessed: 0,
  pagesSaved: 0,
  pagesExcluded: 0,
  pagesUnchanged: 0,
  docsFound: 0,
  claimsExtracted: 0,
  errors: [],
};

console.log(`Processing ${scrapedPages.length} scraped pages...\n`);

// Process each page
for (const page of scrapedPages) {
  try {
    const url = page.url;
    const markdown = page.markdown || '';
    const html = page.html || '';
    const title = page.metadata?.title || url;
    
    // Skip if no content
    if (!markdown || markdown.trim().length === 0 || markdown === 'No content') {
      console.log(`  ⏭️  Skipping (no content): ${url}`);
      domainStats.pagesExcluded++;
      runStats.pagesExcluded++;
      runStats.errors.push({ url, error: 'No content received' });
      continue;
    }
    
    const sourcePageId = generateSourcePageId(url);
    const contentHash = generateHash(markdown);
    
    // Save snapshot
    const { snapshotRef } = crawlModule.saveSnapshot(sourcePageId, url, html, markdown);
    state.pageHashes[sourcePageId] = contentHash;
    
    // Extract structured data
    const structuredData = crawlModule.extractStructuredData(markdown, url);
    
    // Add to KB
    crawlModule.addOrUpdateSourcePage(kb, {
      url: url,
      domain: domain,
      title: title,
      markdown: markdown,
      contentHash: contentHash,
      snapshotRef: snapshotRef,
    });
    
    // Extract and add claims
    const claims = crawlModule.extractClaims(markdown, sourcePageId, url, structuredData);
    const addedClaims = crawlModule.addClaimsToKB(kb, claims);
    domainStats.claimsExtracted += addedClaims;
    runStats.claimsExtracted += addedClaims;
    
    // Track documents
    if (structuredData.documentList.length > 0) {
      domainStats.docsFound += structuredData.documentList.length;
      console.log(`    📎 Found ${structuredData.documentList.length} documents`);
    }
    
    domainStats.pagesProcessed++;
    domainStats.pagesSaved++;
    runStats.pagesKept++;
    
    console.log(`  ✓ Processed: ${url} (${addedClaims} claims)`);
    
  } catch (e) {
    console.log(`  ❌ Error processing ${page.url}: ${e.message}`);
    domainStats.errors.push(`${page.url}: ${e.message}`);
    runStats.errors.push({ url: page.url, error: e.message });
  }
}

// Update domain state
domainState.lastCrawled = new Date().toISOString();
domainState.pagesCrawled = domainStats.pagesProcessed;
domainState.processedUrls = scrapedPages.map(p => p.url);

// Update run stats
runStats.domainDetails.push(domainStats);

// Save KB and state
crawlModule.saveKB(kb);
crawlModule.saveCrawlState(state);

// Generate crawl report
const report = crawlModule.generateRunReport(runStats);

console.log('\n' + '='.repeat(70));
console.log('PILOT CRAWL SUMMARY');
console.log('='.repeat(70));
console.log(`
  Domain: ${domain}
  Pages Discovered: ${domainStats.pagesDiscovered}
  Pages Processed: ${domainStats.pagesProcessed}
  Pages Saved: ${domainStats.pagesSaved}
  Pages Excluded: ${domainStats.pagesExcluded}
  Claims Extracted: ${domainStats.claimsExtracted}
  Documents Found: ${domainStats.docsFound}
  Errors: ${domainStats.errors.length}
`);

console.log(`\n📊 KB Updated: ${kb.source_pages.length} pages, ${kb.claims.length} claims`);
console.log(`📁 Report: ${path.join(crawlModule.PATHS.runsDir, getDateString(), 'crawl_report.json')}`);
console.log('='.repeat(70) + '\n');

