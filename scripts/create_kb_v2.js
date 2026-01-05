// Script to create the KB v2 JSON file
// This reads from stdin and saves to the KB file

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const outputFile = path.join(__dirname, '..', 'bangladesh_government_services_kb_v2.json');

console.log('Paste the JSON content and press Ctrl+D (or Ctrl+Z on Windows) when done:');

let input = '';
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  input += line + '\n';
});

rl.on('close', () => {
  try {
    // Validate JSON
    const parsed = JSON.parse(input);
    console.log('✓ Valid JSON');
    console.log('  Schema version:', parsed.$schema_version);
    console.log('  Data version:', parsed.data_version);
    
    // Save to file
    fs.writeFileSync(outputFile, JSON.stringify(parsed, null, 2), 'utf-8');
    console.log('✓ Saved to', outputFile);
    console.log('  File size:', fs.statSync(outputFile).size, 'bytes');
  } catch (err) {
    console.error('✗ Error:', err.message);
    process.exit(1);
  }
});

