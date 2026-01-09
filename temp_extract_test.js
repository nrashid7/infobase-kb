const fs = require('fs');
const path = require('path');

// Import extraction functions
const { extractStructuredData } = require('./scripts/crawler/extraction');

// Read the processed markdown
const markdown = fs.readFileSync('temp_epassport_markdown.md', 'utf-8');

// Extract structured data
const result = extractStructuredData(markdown, 'https://www.epassport.gov.bd/instructions/passport-fees');

console.log('Extraction Results:');
console.log('==================');
console.log(`Fees extracted: ${result.stats.fees_extracted}`);
console.log(`Steps extracted: ${result.stats.steps_extracted}`);
console.log(`FAQs extracted: ${result.stats.faq_pairs_extracted}`);
console.log(`Documents found: ${result.stats.doc_links_found}`);

console.log('\nFee Table:');
console.log('==========');
result.feeTable.forEach((fee, i) => {
  console.log(`${i+1}. ${fee.label || 'N/A'}: ${fee.amount || 'N/A'} ${fee.currency || 'N/A'}`);
});

console.log('\nFull Fee Table Details:');
console.log('=======================');
console.log(JSON.stringify(result.feeTable, null, 2));
