const fs = require('fs');
const path = require('path');

// Import required modules
const { extractStructuredData } = require('./scripts/crawler/extraction');
const { loadOrCreateKB, saveKB, addOrUpdateSourcePage, addClaimsToKB } = require('./scripts/crawler/kb-writer');
const { generateSourcePageId, getDateString } = require('./scripts/crawler/utils');
const { classifyPage } = require('./scripts/crawler/page-classifier');

// Pilot data - scraped pages so far
const scrapedPages = [
  {
    url: 'https://www.epassport.gov.bd/instructions/passport-fees',
    domain: 'epassport.gov.bd',
    success: true,
    markdown: fs.readFileSync('temp_epassport_markdown.md', 'utf-8'),
    html: '',
    title: 'e-Passport Fees and Payment Options'
  },
  // Add other scraped pages as needed
];

// Create pilot KB
const pilotKbPath = path.join('kb', 'pilot_kb.json');
const kb = loadOrCreateKB(pilotKbPath);

// Process scraped pages
console.log('Processing scraped pages...');
let totalClaims = 0;

for (const page of scrapedPages) {
  if (!page.success) continue;

  const sourcePageId = generateSourcePageId(page.url);
  const contentHash = require('crypto').createHash('md5').update(page.markdown).digest('hex');

  // Add/update source page
  addOrUpdateSourcePage(kb, {
    url: page.url,
    domain: page.domain,
    title: page.title,
    markdown: page.markdown,
    contentHash: contentHash,
    snapshotRef: `pilot/${getDateString()}`,
  }, classifyPage);

  // Extract structured data
  const structuredData = extractStructuredData(page.markdown, page.url, page.html);

  // Extract claims (simplified version)
  const serviceId = 'epassport'; // Simplified for pilot
  const claims = [];

  // Add fee claims
  structuredData.feeTable.forEach(fee => {
    claims.push({
      claim_id: `fee_${serviceId}_${require('crypto').createHash('md5').update(JSON.stringify(fee)).digest('hex').substring(0, 8)}`,
      claim_type: 'fee',
      service_id: serviceId,
      source_page_id: sourcePageId,
      content: fee,
      canonical_url: page.url,
      extracted_at: new Date().toISOString(),
    });
  });

  // Add claims to KB
  const claimsAdded = addClaimsToKB(kb, claims);
  totalClaims += claimsAdded;

  console.log(`Processed ${page.url}: ${claimsAdded} claims added`);
}

// Save pilot KB
saveKB(kb, pilotKbPath);
console.log(`Saved pilot KB with ${totalClaims} total claims`);

// Build published guides
console.log('Building published guides...');
const { execSync } = require('child_process');
try {
  execSync(`node scripts/build_public_guides.js "${pilotKbPath}"`, { stdio: 'inherit' });
  console.log('Build successful');

  // Validate
  execSync('npm run validate:published', { stdio: 'inherit' });
  console.log('Validation successful');

} catch (error) {
  console.error('Build/validation failed:', error.message);
}
