const helper = require('./agent_crawl_pilot.js');

const mapResult = [
  "https://www.epassport.gov.bd/instructions/passport-fees",
  "https://epassport.gov.bd/not-found",
  "https://www.epassport.gov.bd/onboarding",
  "https://www.epassport.gov.bd",
  "https://www.epassport.gov.bd/contact",
  "https://www.epassport.gov.bd/instructions/instructions",
  "https://www.epassport.gov.bd/landing/csca",
  "https://www.epassport.gov.bd/landing/notices",
  "https://www.epassport.gov.bd/instructions/feedback",
  "https://www.epassport.gov.bd/landing/faqs",
  "https://www.epassport.gov.bd/authorization/login",
  "https://www.epassport.gov.bd/landing/notices/33",
  "https://www.epassport.gov.bd/landing/notices/160",
  "https://www.epassport.gov.bd/landing/faqs/20",
  "https://www.epassport.gov.bd/landing/notices/34",
  "https://www.epassport.gov.bd/landing/faqs/4",
  "https://www.epassport.gov.bd/instructions/urgent-applications",
  "https://www.epassport.gov.bd/authorization/application-status",
  "https://www.epassport.gov.bd/landing/notices/161",
  "https://www.epassport.gov.bd/landing/faqs/72",
  "https://www.epassport.gov.bd/landing/faqs/271",
  "https://www.epassport.gov.bd/landing/faqs/7",
  "https://www.epassport.gov.bd/landing/faqs/11",
  "https://www.epassport.gov.bd/landing/notices/151",
  "https://www.epassport.gov.bd/landing/faqs/24",
  "https://www.epassport.gov.bd/instructions/application-form",
  "https://www.epassport.gov.bd/authorization/registration-confirm",
  "https://www.epassport.gov.bd/landing/faqs/285"
];

const filtered = helper.filterAndPrioritizeUrls(mapResult, 'epassport.gov.bd', 3, 30);
console.log(JSON.stringify(filtered, null, 2));

