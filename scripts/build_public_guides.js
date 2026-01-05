/**
 * Bangladesh Government Services KB - Build Public Guides
 * 
 * Generates publishable guide files from v3 KB:
 * - public_guides.json: UI-ready guides with resolved citations
 * - public_guides_index.json: Search index by title/keywords
 * 
 * Usage: node scripts/build_public_guides.js [input_kb.json] [output_dir]
 */

const fs = require('fs');
const path = require('path');
const { URL } = require('url');

/**
 * Build lookup maps from KB data
 */
function buildLookups(kbData) {
  const claims = new Map();
  const sourcePages = new Map();
  const services = new Map();
  const agencies = new Map();
  
  // Build claims map
  for (const claim of (kbData.claims || [])) {
    claims.set(claim.claim_id, claim);
  }
  
  // Build source_pages map
  for (const page of (kbData.source_pages || [])) {
    sourcePages.set(page.source_page_id, page);
  }
  
  // Build services map
  for (const service of (kbData.services || [])) {
    services.set(service.service_id, service);
  }
  
  // Build agencies map
  for (const agency of (kbData.agencies || [])) {
    agencies.set(agency.agency_id, agency);
  }
  
  return { claims, sourcePages, services, agencies };
}

/**
 * Format a locator for display
 */
function formatLocator(locator) {
  if (!locator) return null;
  
  switch (locator.type) {
    case 'heading_path':
      return locator.heading_path.join(' > ');
    case 'css_selector':
      return `CSS: ${locator.css_selector}`;
    case 'xpath':
      return `XPath: ${locator.xpath}`;
    case 'url_fragment':
      return `#${locator.url_fragment}`;
    case 'pdf_page':
      return `Page ${locator.pdf_page}`;
    default:
      return null;
  }
}

/**
 * Resolve a claim's citations to display-ready format
 */
function resolveCitations(claim, sourcePages) {
  if (!claim.citations || claim.citations.length === 0) {
    return [];
  }
  
  return claim.citations.map(citation => {
    const sourcePage = sourcePages.get(citation.source_page_id);
    
    let domain = null;
    try {
      const url = new URL(sourcePage?.canonical_url || '');
      domain = url.hostname;
    } catch (e) {
      // Invalid URL
    }
    
    return {
      source_page_id: citation.source_page_id,
      canonical_url: sourcePage?.canonical_url || null,
      domain: domain,
      page_title: sourcePage?.title || null,
      locator: formatLocator(citation.locator),
      quoted_text: citation.quoted_text,
      retrieved_at: citation.retrieved_at,
      language: citation.language || 'en'
    };
  });
}

/**
 * Compute verification summary from claims
 */
function computeVerificationSummary(claimIds, claimsMap) {
  const summary = {
    total: 0,
    verified: 0,
    unverified: 0,
    stale: 0,
    deprecated: 0,
    contradicted: 0
  };
  
  for (const claimId of claimIds) {
    const claim = claimsMap.get(claimId);
    if (claim) {
      summary.total++;
      const status = claim.status || 'unverified';
      if (summary.hasOwnProperty(status)) {
        summary[status]++;
      }
    }
  }
  
  return summary;
}

/**
 * Get all claim IDs referenced by a guide
 */
function getGuideClaimIds(guide) {
  const claimIds = new Set();
  
  // From steps
  if (guide.steps) {
    for (const step of guide.steps) {
      for (const id of (step.claim_ids || [])) {
        claimIds.add(id);
      }
    }
  }
  
  // From sections
  if (guide.sections) {
    for (const items of Object.values(guide.sections)) {
      if (Array.isArray(items)) {
        for (const item of items) {
          for (const id of (item.claim_ids || [])) {
            claimIds.add(id);
          }
        }
      }
    }
  }
  
  // From variants
  if (guide.variants) {
    for (const variant of guide.variants) {
      for (const id of (variant.fee_claim_ids || [])) {
        claimIds.add(id);
      }
      for (const id of (variant.processing_time_claim_ids || [])) {
        claimIds.add(id);
      }
    }
  }
  
  // From required_documents
  if (guide.required_documents) {
    for (const item of guide.required_documents) {
      for (const id of (item.claim_ids || [])) {
        claimIds.add(id);
      }
    }
  }
  
  // From fees
  if (guide.fees) {
    for (const item of guide.fees) {
      for (const id of (item.claim_ids || [])) {
        claimIds.add(id);
      }
    }
  }
  
  return claimIds;
}

/**
 * Get max last_crawled_at from source pages referenced by claims
 */
function getLastCrawledAt(claimIds, claimsMap, sourcePagesMap) {
  let maxDate = null;
  
  for (const claimId of claimIds) {
    const claim = claimsMap.get(claimId);
    if (!claim || !claim.citations) continue;
    
    for (const citation of claim.citations) {
      const sourcePage = sourcePagesMap.get(citation.source_page_id);
      if (sourcePage && sourcePage.last_crawled_at) {
        const date = new Date(sourcePage.last_crawled_at);
        if (!maxDate || date > maxDate) {
          maxDate = date;
        }
      }
    }
  }
  
  return maxDate ? maxDate.toISOString() : null;
}

/**
 * Get unique domains from source pages
 */
function getSourceDomains(claimIds, claimsMap, sourcePagesMap) {
  const domains = new Set();
  
  for (const claimId of claimIds) {
    const claim = claimsMap.get(claimId);
    if (!claim || !claim.citations) continue;
    
    for (const citation of claim.citations) {
      const sourcePage = sourcePagesMap.get(citation.source_page_id);
      if (sourcePage && sourcePage.canonical_url) {
        try {
          const url = new URL(sourcePage.canonical_url);
          domains.add(url.hostname);
        } catch (e) {
          // Invalid URL
        }
      }
    }
  }
  
  return Array.from(domains);
}

/**
 * Build a public step with resolved citations
 */
function buildPublicStep(step, claimsMap, sourcePagesMap) {
  const citations = [];
  
  for (const claimId of (step.claim_ids || [])) {
    const claim = claimsMap.get(claimId);
    if (claim) {
      citations.push(...resolveCitations(claim, sourcePagesMap));
    }
  }
  
  return {
    step_number: step.step_number,
    title: step.title,
    description: step.description || null,
    citations: citations
  };
}

/**
 * Build a public guide item with resolved citations
 */
function buildPublicItem(item, claimsMap, sourcePagesMap) {
  const citations = [];
  
  for (const claimId of (item.claim_ids || [])) {
    const claim = claimsMap.get(claimId);
    if (claim) {
      citations.push(...resolveCitations(claim, sourcePagesMap));
    }
  }
  
  return {
    label: item.label,
    description: item.description || null,
    citations: citations
  };
}

/**
 * Build a public variant with resolved fee/time info
 */
function buildPublicVariant(variant, claimsMap, sourcePagesMap) {
  const fees = [];
  const processingTimes = [];
  
  for (const claimId of (variant.fee_claim_ids || [])) {
    const claim = claimsMap.get(claimId);
    if (claim) {
      fees.push({
        text: claim.text,
        structured_data: claim.structured_data || null,
        citations: resolveCitations(claim, sourcePagesMap)
      });
    }
  }
  
  for (const claimId of (variant.processing_time_claim_ids || [])) {
    const claim = claimsMap.get(claimId);
    if (claim) {
      processingTimes.push({
        text: claim.text,
        structured_data: claim.structured_data || null,
        citations: resolveCitations(claim, sourcePagesMap)
      });
    }
  }
  
  return {
    variant_id: variant.variant_id,
    label: variant.label,
    fees: fees,
    processing_times: processingTimes
  };
}

/**
 * Build a complete public guide
 */
function buildPublicGuide(guide, lookups) {
  const { claims: claimsMap, sourcePages: sourcePagesMap, services: servicesMap, agencies: agenciesMap } = lookups;
  
  // Get all claim IDs for this guide
  const claimIds = getGuideClaimIds(guide);
  
  // Build public steps
  const steps = (guide.steps || []).map(step => buildPublicStep(step, claimsMap, sourcePagesMap));
  
  // Build public sections
  const sections = {};
  if (guide.sections) {
    for (const [key, items] of Object.entries(guide.sections)) {
      if (key === 'application_steps') {
        sections[key] = items.map(step => buildPublicStep(step, claimsMap, sourcePagesMap));
      } else if (Array.isArray(items)) {
        sections[key] = items.map(item => buildPublicItem(item, claimsMap, sourcePagesMap));
      }
    }
  }
  
  // Build public variants
  const variants = (guide.variants || []).map(v => buildPublicVariant(v, claimsMap, sourcePagesMap));
  
  // Build public required_documents
  const requiredDocuments = (guide.required_documents || []).map(item => 
    buildPublicItem(item, claimsMap, sourcePagesMap)
  );
  
  // Build public fees
  const fees = (guide.fees || []).map(item => 
    buildPublicItem(item, claimsMap, sourcePagesMap)
  );
  
  // Get agency info
  const agency = agenciesMap.get(guide.agency_id);
  
  // Compute metadata
  const verificationSummary = computeVerificationSummary(claimIds, claimsMap);
  const lastCrawledAt = getLastCrawledAt(claimIds, claimsMap, sourcePagesMap);
  const sourceDomains = getSourceDomains(claimIds, claimsMap, sourcePagesMap);
  
  return {
    guide_id: guide.guide_id,
    service_id: guide.service_id,
    agency_id: guide.agency_id,
    agency_name: agency?.name || null,
    title: guide.title,
    overview: guide.overview || null,
    steps: steps.length > 0 ? steps : null,
    sections: Object.keys(sections).length > 0 ? sections : null,
    variants: variants.length > 0 ? variants : null,
    required_documents: requiredDocuments.length > 0 ? requiredDocuments : null,
    fees: fees.length > 0 ? fees : null,
    official_links: guide.official_links || [],
    // Metadata
    meta: {
      total_steps: steps.length,
      total_citations: claimIds.size,
      verification_summary: verificationSummary,
      last_crawled_at: lastCrawledAt,
      source_domains: sourceDomains,
      generated_at: guide.generated_at || null,
      last_updated_at: guide.last_updated_at || null,
      status: guide.status || 'draft'
    }
  };
}

/**
 * Build search index entry for a guide
 */
function buildIndexEntry(guide, publicGuide) {
  // Extract keywords from title and steps
  const keywords = new Set();
  
  // Add words from title
  const titleWords = guide.title.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  for (const word of titleWords) {
    keywords.add(word);
  }
  
  // Add words from step titles
  if (guide.steps) {
    for (const step of guide.steps) {
      if (step.title) {
        const stepWords = step.title.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        for (const word of stepWords) {
          keywords.add(word);
        }
      }
    }
  }
  
  // Add agency name words
  if (publicGuide.agency_name) {
    const agencyWords = publicGuide.agency_name.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    for (const word of agencyWords) {
      keywords.add(word);
    }
  }
  
  return {
    guide_id: guide.guide_id,
    service_id: guide.service_id,
    agency_id: guide.agency_id,
    title: guide.title,
    agency_name: publicGuide.agency_name,
    keywords: Array.from(keywords),
    step_count: publicGuide.meta.total_steps,
    citation_count: publicGuide.meta.total_citations,
    status: publicGuide.meta.status
  };
}

/**
 * Build all public guides and index
 */
function buildPublicGuides(kbData) {
  console.log('🔧 Building public guides...\n');
  
  // Check for v3 schema
  if (kbData.$schema_version !== '3.0.0') {
    // Try to work with v2 if service_guides doesn't exist
    if (!kbData.service_guides || kbData.service_guides.length === 0) {
      console.log('⚠️  No service_guides found. Run migrate_v2_to_v3.js first.');
      return { guides: [], index: [] };
    }
  }
  
  const lookups = buildLookups(kbData);
  const guides = kbData.service_guides || [];
  
  console.log(`  Found ${guides.length} guides to process`);
  console.log(`  Found ${lookups.claims.size} claims`);
  console.log(`  Found ${lookups.sourcePages.size} source pages`);
  console.log('');
  
  const publicGuides = [];
  const indexEntries = [];
  
  for (const guide of guides) {
    const publicGuide = buildPublicGuide(guide, lookups);
    publicGuides.push(publicGuide);
    
    const indexEntry = buildIndexEntry(guide, publicGuide);
    indexEntries.push(indexEntry);
    
    console.log(`  ✓ ${guide.guide_id}: ${publicGuide.meta.total_steps} steps, ${publicGuide.meta.total_citations} citations`);
  }
  
  return {
    guides: publicGuides,
    index: indexEntries
  };
}

/**
 * Print build summary
 */
function printSummary(publicGuides, indexEntries) {
  console.log('\n' + '='.repeat(60));
  console.log('BUILD REPORT');
  console.log('='.repeat(60));
  
  const totalSteps = publicGuides.reduce((sum, g) => sum + (g.meta?.total_steps || 0), 0);
  const totalCitations = publicGuides.reduce((sum, g) => sum + (g.meta?.total_citations || 0), 0);
  
  // Collect all domains
  const allDomains = new Set();
  for (const guide of publicGuides) {
    for (const domain of (guide.meta?.source_domains || [])) {
      allDomains.add(domain);
    }
  }
  
  // Verification summary across all guides
  const overallVerification = {
    verified: 0,
    unverified: 0,
    stale: 0,
    deprecated: 0,
    contradicted: 0
  };
  
  for (const guide of publicGuides) {
    const vs = guide.meta?.verification_summary || {};
    overallVerification.verified += vs.verified || 0;
    overallVerification.unverified += vs.unverified || 0;
    overallVerification.stale += vs.stale || 0;
    overallVerification.deprecated += vs.deprecated || 0;
    overallVerification.contradicted += vs.contradicted || 0;
  }
  
  console.log(`\n  Guides Built: ${publicGuides.length}`);
  console.log(`  Total Steps: ${totalSteps}`);
  console.log(`  Total Citations: ${totalCitations}`);
  console.log(`  Domains: ${Array.from(allDomains).join(', ') || 'none'}`);
  console.log('');
  console.log('  Verification Status:');
  console.log(`    ✓ Verified: ${overallVerification.verified}`);
  console.log(`    ○ Unverified: ${overallVerification.unverified}`);
  console.log(`    ⚠ Stale: ${overallVerification.stale}`);
  console.log(`    ✗ Deprecated: ${overallVerification.deprecated}`);
  console.log(`    ⚡ Contradicted: ${overallVerification.contradicted}`);
  console.log('');
}

// Main execution
function main() {
  const args = process.argv.slice(2);
  
  // Default paths
  let inputFile = path.join(__dirname, '..', 'kb', 'bangladesh_government_services_kb_v3.json');
  let outputDir = path.join(__dirname, '..', 'kb', 'published');
  
  // Try v2 if v3 doesn't exist
  if (!fs.existsSync(inputFile)) {
    const v2File = path.join(__dirname, '..', 'kb', 'bangladesh_government_services_kb_v2.json');
    if (fs.existsSync(v2File)) {
      console.log('ℹ️  v3 KB not found, attempting to use v2...');
      inputFile = v2File;
    }
  }
  
  if (args.length >= 1) {
    inputFile = args[0];
  }
  if (args.length >= 2) {
    outputDir = args[1];
  }
  
  console.log(`📁 Input:  ${inputFile}`);
  console.log(`📁 Output: ${outputDir}\n`);
  
  // Check input file exists
  if (!fs.existsSync(inputFile)) {
    console.error(`❌ ERROR: Input file not found: ${inputFile}`);
    console.error('Usage: node scripts/build_public_guides.js [input_kb.json] [output_dir]');
    process.exit(1);
  }
  
  // Read input
  let kbData;
  try {
    const rawContent = fs.readFileSync(inputFile, 'utf-8');
    kbData = JSON.parse(rawContent);
  } catch (err) {
    console.error(`❌ ERROR: Failed to parse JSON: ${err.message}`);
    process.exit(1);
  }
  
  // Build public guides
  const { guides: publicGuides, index: indexEntries } = buildPublicGuides(kbData);
  
  if (publicGuides.length === 0) {
    console.error('❌ ERROR: No guides to publish. Run migrate_v2_to_v3.js first.');
    process.exit(1);
  }
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`\n📂 Created output directory: ${outputDir}`);
  }
  
  // Write public_guides.json
  // Use deterministic timestamp: SOURCE_TIMESTAMP env var > KB last_updated > current time
  const generatedAt = process.env.SOURCE_TIMESTAMP || 
    kbData.last_updated_at || 
    new Date().toISOString();
  
  const guidesFile = path.join(outputDir, 'public_guides.json');
  const guidesOutput = {
    $schema_version: '3.0.0',
    generated_at: generatedAt,
    source_kb_version: kbData.data_version || 1,
    guides: publicGuides
  };
  
  try {
    fs.writeFileSync(guidesFile, JSON.stringify(guidesOutput, null, 2), 'utf-8');
    console.log(`\n✅ Written: ${guidesFile}`);
  } catch (err) {
    console.error(`❌ ERROR: Failed to write guides: ${err.message}`);
    process.exit(1);
  }
  
  // Write public_guides_index.json
  const indexFile = path.join(outputDir, 'public_guides_index.json');
  const indexOutput = {
    $schema_version: '3.0.0',
    generated_at: generatedAt,
    source_kb_version: kbData.data_version || 1,
    entries: indexEntries
  };
  
  try {
    fs.writeFileSync(indexFile, JSON.stringify(indexOutput, null, 2), 'utf-8');
    console.log(`✅ Written: ${indexFile}`);
  } catch (err) {
    console.error(`❌ ERROR: Failed to write index: ${err.message}`);
    process.exit(1);
  }
  
  // Print summary
  printSummary(publicGuides, indexEntries);
}

if (require.main === module) {
  main();
}

module.exports = { buildPublicGuides, buildPublicGuide, buildLookups };

