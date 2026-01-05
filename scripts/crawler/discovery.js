/**
 * URL Discovery Module
 * 
 * Handles seed extraction and URL discovery from sources like bdgovlinks.com.
 * 
 * @module crawler/discovery
 */

const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// ============================================================================
// SEED EXTRACTION FROM BDGOVLINKS
// ============================================================================

/**
 * Parse bdgovlinks.com markdown content to extract Public Services links
 * @param {string} markdown - The markdown content from bdgovlinks.com
 * @returns {Array<{label: string, url: string}>} - Array of extracted services
 */
function parsePublicServicesFromMarkdown(markdown) {
  const services = [];
  
  if (!markdown) return services;
  
  // Find the "Public Services" section in the markdown
  const publicServicesMatch = markdown.match(/#{2,3}\s*Public Services\s*\n([\s\S]*?)(?=\n#{2,3}\s|$)/i);
  
  if (publicServicesMatch) {
    const sectionContent = publicServicesMatch[1];
    
    // Extract markdown links: [Label](URL)
    const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
    let match;
    
    while ((match = linkPattern.exec(sectionContent)) !== null) {
      const label = match[1].replace(/!\[site icon\][^)]*\)/g, '').trim();
      const url = match[2];
      
      // Only include .gov.bd or .com.bd domains
      if (url.includes('.gov.bd') || url.includes('.com.bd')) {
        services.push({ label, url });
      }
    }
  }
  
  // If no section found, try to find links near "Public Services" text
  if (services.length === 0) {
    const lines = markdown.split('\n');
    let inPublicServices = false;
    
    for (const line of lines) {
      if (/Public Services/i.test(line)) {
        inPublicServices = true;
        continue;
      }
      
      // Stop at next section header
      if (inPublicServices && /^#{2,3}\s/.test(line) && !/Public Services/i.test(line)) {
        break;
      }
      
      if (inPublicServices) {
        const linkMatch = line.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
        if (linkMatch) {
          const label = linkMatch[1].replace(/!\[site icon\][^)]*\)/g, '').trim();
          const url = linkMatch[2];
          if (url.includes('.gov.bd') || url.includes('.com.bd')) {
            services.push({ label, url });
          }
        }
      }
    }
  }
  
  return services;
}

/**
 * Get domain from URL
 * @param {string} urlStr - URL string
 * @returns {string|null} - Domain or null if invalid
 */
function getDomain(urlStr) {
  try {
    return new URL(urlStr).hostname.toLowerCase();
  } catch (e) {
    return null;
  }
}

/**
 * Known Public Services from bdgovlinks.com (fallback list)
 */
const KNOWN_PUBLIC_SERVICES = [
  { label: 'Passport Office', domain: 'passport.gov.bd', start_urls: ['https://passport.gov.bd/'], source_page_url: 'https://bdgovlinks.com/' },
  { label: 'e-Passport Portal', domain: 'epassport.gov.bd', start_urls: ['https://www.epassport.gov.bd/'], source_page_url: 'https://bdgovlinks.com/' },
  { label: 'National ID Wing', domain: 'nidw.gov.bd', start_urls: ['https://nidw.gov.bd/', 'https://services.nidw.gov.bd/'], source_page_url: 'https://bdgovlinks.com/' },
  { label: 'NBR e-Tax', domain: 'etaxnbr.gov.bd', start_urls: ['https://etaxnbr.gov.bd/'], source_page_url: 'https://bdgovlinks.com/' },
  { label: 'BRTA Service Portal', domain: 'bsp.brta.gov.bd', start_urls: ['https://bsp.brta.gov.bd/', 'https://brta.gov.bd/'], source_page_url: 'https://bdgovlinks.com/' },
  { label: 'Bangladesh Post Office', domain: 'bdpost.gov.bd', start_urls: ['https://bdpost.gov.bd/'], source_page_url: 'https://bdgovlinks.com/' },
  { label: 'Land Administration', domain: 'landadministration.gov.bd', start_urls: ['https://landadministration.gov.bd/'], source_page_url: 'https://bdgovlinks.com/' },
  { label: 'Teletalk Bangladesh', domain: 'teletalk.com.bd', start_urls: ['https://teletalk.com.bd/'], source_page_url: 'https://bdgovlinks.com/' },
  { label: 'Department of Immigration & Passports', domain: 'dip.gov.bd', start_urls: ['https://dip.gov.bd/'], source_page_url: 'https://bdgovlinks.com/' },
  { label: 'Online Visa Portal', domain: 'visa.gov.bd', start_urls: ['https://visa.gov.bd/'], source_page_url: 'https://bdgovlinks.com/' },
  { label: 'Bangladesh Customs', domain: 'customs.gov.bd', start_urls: ['https://customs.gov.bd/'], source_page_url: 'https://bdgovlinks.com/' },
  { label: 'Birth & Death Registration', domain: 'bdris.gov.bd', start_urls: ['https://bdris.gov.bd/'], source_page_url: 'https://bdgovlinks.com/' },
  { label: 'Bangladesh Police', domain: 'police.gov.bd', start_urls: ['https://police.gov.bd/', 'https://www.police.gov.bd/'], source_page_url: 'https://bdgovlinks.com/' },
];

/**
 * Extract Public Services seeds from bdgovlinks.com
 * 
 * @param {Object|null} scrapeResult - Result from Firecrawl scrape of bdgovlinks.com
 * @param {string} seedsDir - Directory to save seeds file
 * @returns {Promise<Array>} - Array of seed objects
 */
async function extractPublicServicesSeeds(scrapeResult, seedsDir) {
  console.log('🌱 Extracting Public Services seeds from bdgovlinks.com...\n');
  
  let publicServices = [...KNOWN_PUBLIC_SERVICES];
  
  // If scrapeResult is provided, try to extract dynamically
  if (scrapeResult && scrapeResult.markdown) {
    console.log('  📥 Processing live data from bdgovlinks.com...');
    
    const extractedServices = parsePublicServicesFromMarkdown(scrapeResult.markdown);
    console.log(`  Found ${extractedServices.length} Public Services links`);
    
    // Add any new services not in our known list
    for (const svc of extractedServices) {
      const domain = getDomain(svc.url);
      if (!domain) continue;
      
      const cleanDomain = domain.replace(/^www\./, '');
      const existing = publicServices.find(s => 
        s.domain === cleanDomain || 
        s.domain === domain ||
        s.start_urls.some(u => u.includes(cleanDomain))
      );
      
      if (!existing) {
        console.log(`  ➕ New service discovered: ${svc.label} (${domain})`);
        publicServices.push({
          label: svc.label,
          domain: cleanDomain,
          start_urls: [svc.url],
          source_page_url: 'https://bdgovlinks.com/',
        });
      }
    }
  } else {
    console.log('  Using predefined seed list (no live data provided)');
  }
  
  // Normalize and dedupe by domain
  const seenDomains = new Set();
  const deduped = publicServices.filter(s => {
    const domain = s.domain.replace(/^www\./, '');
    if (seenDomains.has(domain)) return false;
    seenDomains.add(domain);
    return true;
  });
  
  // Save seeds file
  if (seedsDir) {
    if (!fs.existsSync(seedsDir)) {
      fs.mkdirSync(seedsDir, { recursive: true });
    }
    const seedsPath = path.join(seedsDir, 'public_services_seeds.json');
    const seedsData = {
      $generated_at: new Date().toISOString(),
      $source: 'bdgovlinks.com',
      $category: 'public_services',
      $extraction_method: scrapeResult ? 'live_firecrawl' : 'fallback_known_list',
      seeds: deduped,
    };
    fs.writeFileSync(seedsPath, JSON.stringify(seedsData, null, 2), 'utf-8');
    console.log(`  ✅ Saved ${deduped.length} seeds to: ${seedsPath}\n`);
  }
  
  for (const seed of deduped) {
    console.log(`     • ${seed.label}: ${seed.domain}`);
  }
  console.log('');
  
  return deduped;
}

/**
 * Load existing seeds from file
 * @param {string} seedsDir - Directory containing seeds file
 * @returns {Array|null} - Seeds array or null if file doesn't exist
 */
function loadExistingSeeds(seedsDir) {
  const seedsPath = path.join(seedsDir, 'public_services_seeds.json');
  if (fs.existsSync(seedsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(seedsPath, 'utf-8'));
      return data.seeds || null;
    } catch (e) {
      return null;
    }
  }
  return null;
}

module.exports = {
  parsePublicServicesFromMarkdown,
  extractPublicServicesSeeds,
  loadExistingSeeds,
  getDomain,
  KNOWN_PUBLIC_SERVICES,
};

