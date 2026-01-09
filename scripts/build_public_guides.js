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
 * For ePassport variants, fees should be derived from the canonical fee set
 */
function buildPublicVariant(variant, claimsMap, sourcePagesMap, canonicalFees = null) {
  const fees = [];
  const processingTimes = [];

  // For ePassport, use canonical fees if provided, otherwise fall back to variant claims
  if (canonicalFees && variant.variant_id) {
    // Match canonical fees to this variant based on delivery type
    const variantFees = canonicalFees.filter(canonicalFee => {
      const deliveryType = extractFeeStructuredData(canonicalFee).delivery_type;
      return deliveryType === variant.variant_id ||
             (variant.variant_id === 'super_express' && deliveryType === 'super_express') ||
             (variant.variant_id === 'express' && deliveryType === 'express') ||
             (variant.variant_id === 'regular' && deliveryType === 'regular');
    });

    for (const canonicalFee of variantFees) {
      fees.push({
        text: canonicalFee.label,
        structured_data: {
          amount_bdt: extractAmountFromLabel(canonicalFee.label),
          delivery_type: variant.variant_id,
          ...extractFeeStructuredData(canonicalFee)
        },
        citations: canonicalFee.citations
      });
    }
  } else {
    // Default behavior for non-ePassport guides
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
 * Extract amount from fee label
 */
function extractAmountFromLabel(label) {
  if (!label) return null;
  const match = label.match(/(\d{1,3}(?:,\d{3})*)/);
  return match ? parseInt(match[1].replace(/,/g, '')) : null;
}

/**
 * Canonical fee selector for ePassport at publish time
 *
 * Implements the requirements:
 * - Gather ALL fee entries/claims that will feed the published guide for epassport
 * - Group fees by stable key: delivery_type + pages + validity_years
 * - Prefer fees with citations from "/instructions/passport-fees" URL
 * - Prefer newest retrieved_at across citations
 * - If VAT-inclusive schedule exists, drop legacy working-days schedule entirely
 * - Output deterministic stable sort order: pages asc, validity_years asc, delivery_type order [regular, express, super_express]
 */
function canonicalEpassportFeeSelector(fees) {
  if (!fees || fees.length === 0) return fees;

  // Step 1: Group fees by stable key (delivery_type + pages + validity_years)
  const feeGroups = new Map();

  for (const fee of fees) {
    if (!fee.citations || fee.citations.length === 0) continue;

    // Extract structured data from fee label or description
    const structured = extractFeeStructuredData(fee);
    const key = `${structured.delivery_type || 'unknown'}_${structured.pages || 'unknown'}_${structured.validity_years || 'unknown'}`;

    if (!feeGroups.has(key)) {
      feeGroups.set(key, []);
    }
    feeGroups.get(key).push({ fee, structured });
  }

  // Step 2: For each group, select the best fee based on priority
  const canonicalFees = [];

  for (const [groupKey, groupFees] of feeGroups) {
    // Sort by priority within group
    const sortedFees = groupFees.sort((a, b) => {
      // Priority 1: Prefer citations from "/instructions/passport-fees"
      const aHasPassportFees = a.fee.citations.some(c => c.canonical_url?.includes('/instructions/passport-fees'));
      const bHasPassportFees = b.fee.citations.some(c => c.canonical_url?.includes('/instructions/passport-fees'));

      if (aHasPassportFees && !bHasPassportFees) return -1;
      if (!aHasPassportFees && bHasPassportFees) return 1;

      // Priority 2: Prefer newest retrieved_at
      const aMaxDate = Math.max(...a.fee.citations.map(c => new Date(c.retrieved_at).getTime()));
      const bMaxDate = Math.max(...b.fee.citations.map(c => new Date(c.retrieved_at).getTime()));

      return bMaxDate - aMaxDate;
    });

    canonicalFees.push(sortedFees[0]);
  }

  // Step 3: Check if VAT-inclusive schedule exists using broader detection
  const hasVatInclusive = canonicalFees.some(({ fee }) =>
    fee.citations.some(c =>
      // Check locator for VAT indicators
      c.locator?.toLowerCase().includes('including 15% vat') ||
      c.locator?.toLowerCase().includes('15% vat') ||
      c.locator?.toLowerCase().includes('vat') && (c.locator?.toLowerCase().includes('inside bangladesh') || c.locator?.toLowerCase().includes('for inside bangladesh')) ||
      // Check quoted_text for VAT indicators
      c.quoted_text?.toLowerCase().includes('including 15% vat') ||
      c.quoted_text?.toLowerCase().includes('15% vat') ||
      c.quoted_text?.toLowerCase().includes('vat') && (c.quoted_text?.toLowerCase().includes('inside bangladesh') || c.quoted_text?.toLowerCase().includes('for inside bangladesh'))
    )
  );

  // Step 4: If VAT-inclusive exists, drop legacy working-days schedule entirely
  let finalFees = canonicalFees;
  if (hasVatInclusive) {
    finalFees = canonicalFees.filter(({ fee }) => {
      // Check if this fee is from VAT-inclusive schedule
      const hasVatCitation = fee.citations.some(c =>
        // Check locator for VAT indicators
        c.locator?.toLowerCase().includes('including 15% vat') ||
        c.locator?.toLowerCase().includes('15% vat') ||
        c.locator?.toLowerCase().includes('vat') && (c.locator?.toLowerCase().includes('inside bangladesh') || c.locator?.toLowerCase().includes('for inside bangladesh')) ||
        // Check quoted_text for VAT indicators
        c.quoted_text?.toLowerCase().includes('including 15% vat') ||
        c.quoted_text?.toLowerCase().includes('15% vat') ||
        c.quoted_text?.toLowerCase().includes('vat') && (c.quoted_text?.toLowerCase().includes('inside bangladesh') || c.quoted_text?.toLowerCase().includes('for inside bangladesh'))
      );

      // Check if this is a legacy working-days schedule entry to be dropped
      const isLegacyWorkingDays = fee.citations.some(c =>
        // Legacy locator pattern
        c.locator?.toLowerCase().includes('passport fees > e-passport fees') ||
        // Working days in text
        c.quoted_text?.toLowerCase().includes('working days') ||
        // Specific working days patterns
        /\(\d+\s*working\s*days?\)/i.test(c.quoted_text || '') ||
        /\(15 working days\)/i.test(c.quoted_text || '') ||
        /\(7 working days\)/i.test(c.quoted_text || '') ||
        /\(2 working days\)/i.test(c.quoted_text || '')
      );

      // Keep VAT-inclusive fees, drop legacy working-days fees
      return hasVatCitation && !isLegacyWorkingDays;
    });
  }

  // Step 5: Sort deterministically and format
  return finalFees
    .sort((a, b) => {
      // Pages ascending
      const pagesA = a.structured.pages || 0;
      const pagesB = b.structured.pages || 0;
      if (pagesA !== pagesB) return pagesA - pagesB;

      // Validity years ascending
      const validityA = a.structured.validity_years || 0;
      const validityB = b.structured.validity_years || 0;
      if (validityA !== validityB) return validityA - validityB;

      // Delivery type order: regular, express, super_express
      const typeOrder = { 'regular': 0, 'express': 1, 'super_express': 2 };
      const typeA = typeOrder[a.structured.delivery_type] ?? 3;
      const typeB = typeOrder[b.structured.delivery_type] ?? 3;
      return typeA - typeB;
    })
    .map(({ fee }) => {
      // Normalize currency tokens at publish time
      let normalizedLabel = fee.label || '';
      let normalizedDescription = fee.description || '';

      // Replace standalone "TK" or "Taka" with "BDT" (case-insensitive)
      normalizedLabel = normalizedLabel.replace(/\bTK\b/gi, 'BDT').replace(/\bTaka\b/gi, 'BDT');
      normalizedDescription = normalizedDescription.replace(/\bTK\b/gi, 'BDT').replace(/\bTaka\b/gi, 'BDT');

      return {
        ...fee,
        label: normalizedLabel,
        description: normalizedDescription,
        // Keep only the most relevant citations (prefer passport-fees, newest)
        citations: fee.citations
          .filter(c => c.canonical_url?.includes('/instructions/passport-fees'))
          .sort((a, b) => new Date(b.retrieved_at) - new Date(a.retrieved_at))
          .slice(0, 1) // Keep only the newest one
      };
    })
    .filter(fee => fee.citations.length > 0); // Ensure we have at least one citation
}

/**
 * Extract structured data from fee label/description
 */
function extractFeeStructuredData(fee) {
  const text = `${fee.label || ''} ${fee.description || ''}`.toLowerCase();

  let delivery_type = null;
  let pages = null;
  let validity_years = null;

  // Extract delivery type
  if (text.includes('regular')) delivery_type = 'regular';
  else if (text.includes('super express') || text.includes('super_express')) delivery_type = 'super_express';
  else if (text.includes('express')) delivery_type = 'express';

  // Extract pages (look for patterns like "48 pages", "48-page")
  const pagesMatch = text.match(/(\d+)\s*(?:page|pages|পৃষ্ঠা)/i);
  if (pagesMatch) pages = parseInt(pagesMatch[1]);

  // Extract validity years (look for patterns like "5 years", "10 years")
  const validityMatch = text.match(/(\d+)\s*(?:year|years|বছর)/i);
  if (validityMatch) validity_years = parseInt(validityMatch[1]);

  return { delivery_type, pages, validity_years };
}

/**
 * Format epassport fee labels to be user-friendly
 */
function formatEpassportFeeLabel(label) {
  if (!label) return label;

  // Remove "TK" currency and ensure "BDT"
  let formatted = label.replace(/\bTK\b/gi, 'BDT');

  // Try to standardize the format: "Delivery Type - Amount BDT"
  // Examples:
  // "Regular delivery Taka 4,025" -> "Regular Delivery - 4,025 BDT"
  // "Express delivery Taka 6,325" -> "Express Delivery - 6,325 BDT"

  const patterns = [
    { regex: /Regular delivery.*?(?:Taka\s*)?([\d,]+)/i, replacement: 'Regular Delivery - $1 BDT' },
    { regex: /Express delivery.*?(?:Taka\s*)?([\d,]+)/i, replacement: 'Express Delivery - $1 BDT' },
    { regex: /Super Express delivery.*?(?:Taka\s*)?([\d,]+)/i, replacement: 'Super Express Delivery - $1 BDT' },
    { regex: /Super express delivery.*?(?:Taka\s*)?([\d,]+)/i, replacement: 'Super Express Delivery - $1 BDT' }
  ];

  for (const pattern of patterns) {
    if (pattern.regex.test(formatted)) {
      formatted = formatted.replace(pattern.regex, pattern.replacement);
      break;
    }
  }

  return formatted;
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

  // Build public required_documents
  const requiredDocuments = (guide.required_documents || []).map(item =>
    buildPublicItem(item, claimsMap, sourcePagesMap)
  );

  // Build public fees with canonical selection for epassport
  let fees = (guide.fees || []).map(item =>
    buildPublicItem(item, claimsMap, sourcePagesMap)
  );

  // Special canonical fee selection for epassport
  let canonicalFees = null;
  if (guide.guide_id === 'guide.epassport' && fees.length > 0) {
    const originalCount = fees.length;
    canonicalFees = canonicalEpassportFeeSelector(fees);
    fees = canonicalFees;
    console.log(`  ✓ Canonical ePassport fees selected: ${originalCount} → ${fees.length}`);
  }

  // Build public sections
  const sections = {};
  if (guide.sections) {
    for (const [key, items] of Object.entries(guide.sections)) {
      if (key === 'application_steps') {
        sections[key] = items.map(step => buildPublicStep(step, claimsMap, sourcePagesMap));
      } else if (key === 'fees' && guide.guide_id === 'guide.epassport' && fees && fees.length > 0) {
        // For ePassport sections.fees, use canonical fees (which are already processed)
        sections[key] = fees;
      } else if (Array.isArray(items)) {
        sections[key] = items.map(item => buildPublicItem(item, claimsMap, sourcePagesMap));
      }
    }
  }

  // Build public variants (pass canonical fees for ePassport consistency)
  const variants = (guide.variants || []).map(v => buildPublicVariant(v, claimsMap, sourcePagesMap, canonicalFees));

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

