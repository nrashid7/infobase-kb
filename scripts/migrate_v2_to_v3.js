/**
 * Bangladesh Government Services KB - v2 to v3 Migration Script
 * 
 * Migrates a provenance-first KB v2 to guide-first KB v3 by:
 * 1. Preserving all v2 entities (claims, source_pages, services, documents, agencies)
 * 2. Auto-generating service_guides from services by grouping claims by type
 * 3. Updating schema_version to 3.0.0
 * 
 * Usage: node scripts/migrate_v2_to_v3.js [input_v2.json] [output_v3.json]
 */

const fs = require('fs');
const path = require('path');

/**
 * Claim type to guide section mapping
 */
const CLAIM_TYPE_TO_SECTION = {
  'step': 'application_steps',
  'document_requirement': 'required_documents',
  'fee': 'fees',
  'processing_time': 'processing_time',
  'eligibility_requirement': 'eligibility',
  'portal_link': 'portal_links',
  'portal_url': 'portal_links',
  'service_info': 'service_info',
  'operational_info': 'service_info',
  'rule': 'service_info',
  'condition': 'service_info',
  'definition': 'service_info',
  'location': 'service_info',
  'contact_info': 'service_info',
  'other': 'service_info'
};

/**
 * Extract step order from claim data
 */
function getStepOrder(claim) {
  // Check structured_data for order
  if (claim.structured_data && typeof claim.structured_data.order === 'number') {
    return claim.structured_data.order;
  }
  
  // Try to extract from claim_id (e.g., claim.step.svc_epassport.3)
  const match = claim.claim_id.match(/\.(\d+)$/);
  if (match) {
    return parseInt(match[1], 10);
  }
  
  // Try to extract from heading_path
  if (claim.citations && claim.citations.length > 0) {
    const citation = claim.citations[0];
    if (citation.locator && citation.locator.type === 'heading_path') {
      const headingPath = citation.locator.heading_path;
      for (const heading of headingPath) {
        const stepMatch = heading.match(/step\s*(\d+)/i);
        if (stepMatch) {
          return parseInt(stepMatch[1], 10);
        }
      }
    }
  }
  
  return null;
}

/**
 * Build a claims lookup map
 */
function buildClaimsMap(claims) {
  const map = new Map();
  for (const claim of claims) {
    map.set(claim.claim_id, claim);
  }
  return map;
}

/**
 * Build a source_pages lookup map
 */
function buildSourcePagesMap(sourcePages) {
  const map = new Map();
  for (const page of sourcePages) {
    map.set(page.source_page_id, page);
  }
  return map;
}

/**
 * Detect fee variants from structured_data
 */
function detectVariants(feeClaims) {
  const variants = new Map(); // variant_id -> { label, fee_claim_ids, processing_time_claim_ids }
  
  for (const claim of feeClaims) {
    if (!claim.structured_data) continue;
    
    const sd = claim.structured_data;
    let variantId = 'regular';
    let label = 'Regular';
    
    if (sd.delivery_type) {
      variantId = sd.delivery_type;
      label = sd.delivery_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
    
    if (!variants.has(variantId)) {
      variants.set(variantId, {
        variant_id: variantId,
        label: label,
        fee_claim_ids: [],
        processing_time_claim_ids: []
      });
    }
    
    variants.get(variantId).fee_claim_ids.push(claim.claim_id);
  }
  
  return Array.from(variants.values());
}

/**
 * Generate a service guide from a service and its claims
 */
function generateGuide(service, claimsMap, sourcePagesMap) {
  const guideId = `guide.${service.service_id.replace(/^svc\./, '')}`;
  
  // Get all claims for this service
  const serviceClaims = (service.claims || [])
    .map(id => claimsMap.get(id))
    .filter(Boolean);
  
  // Group claims by section
  const sections = {
    application_steps: [],
    required_documents: [],
    fees: [],
    processing_time: [],
    eligibility: [],
    portal_links: [],
    service_info: []
  };
  
  for (const claim of serviceClaims) {
    const sectionKey = CLAIM_TYPE_TO_SECTION[claim.claim_type] || 'service_info';
    sections[sectionKey].push(claim);
  }
  
  // Build application_steps with ordering
  const stepClaims = sections.application_steps;
  const orderedSteps = stepClaims
    .map(claim => ({
      claim,
      order: getStepOrder(claim)
    }))
    .sort((a, b) => {
      if (a.order !== null && b.order !== null) return a.order - b.order;
      if (a.order !== null) return -1;
      if (b.order !== null) return 1;
      return 0;
    });
  
  const steps = orderedSteps.map((item, idx) => {
    const claim = item.claim;
    // Extract title from claim text (before colon if present)
    const text = claim.text || '';
    const colonIdx = text.indexOf(':');
    const title = colonIdx > 0 ? text.substring(0, colonIdx).trim() : `Step ${idx + 1}`;
    const description = colonIdx > 0 ? text.substring(colonIdx + 1).trim() : text;
    
    return {
      step_number: idx + 1,
      title: title,
      description: description,
      claim_ids: [claim.claim_id]
    };
  });
  
  // Build required_documents section
  const requiredDocuments = sections.required_documents.map(claim => ({
    label: claim.text,
    claim_ids: [claim.claim_id]
  }));
  
  // Build fees section
  const fees = sections.fees.map(claim => ({
    label: claim.text,
    claim_ids: [claim.claim_id]
  }));
  
  // Build processing_time section
  const processingTime = sections.processing_time.map(claim => ({
    label: claim.text,
    claim_ids: [claim.claim_id]
  }));
  
  // Build eligibility section
  const eligibility = sections.eligibility.map(claim => ({
    label: claim.text,
    claim_ids: [claim.claim_id]
  }));
  
  // Build portal_links section
  const portalLinks = sections.portal_links.map(claim => ({
    label: claim.text,
    claim_ids: [claim.claim_id]
  }));
  
  // Build service_info section (catch-all)
  const serviceInfo = sections.service_info.map(claim => ({
    label: claim.text,
    claim_ids: [claim.claim_id]
  }));
  
  // Detect variants from fee claims
  const variants = detectVariants(sections.fees);
  
  // Build official_links from portal_mapping and portal_link claims
  const officialLinks = [];
  
  // Add from portal_mapping.entry_urls
  if (service.portal_mapping && service.portal_mapping.entry_urls) {
    for (const entry of service.portal_mapping.entry_urls) {
      officialLinks.push({
        label: entry.description || 'Official Portal',
        url: entry.url,
        source_page_id: entry.source_page_id
      });
    }
  }
  
  // Add from portal_link claims with structured_data.url
  for (const claim of sections.portal_links) {
    if (claim.structured_data && claim.structured_data.url) {
      const existingUrls = officialLinks.map(l => l.url);
      if (!existingUrls.includes(claim.structured_data.url)) {
        officialLinks.push({
          label: claim.text.replace(/^.*?available at\s*/i, '').replace(claim.structured_data.url, '').trim() || 'Portal Link',
          url: claim.structured_data.url
        });
      }
    }
  }
  
  // Ensure at least one official link
  if (officialLinks.length === 0 && service.official_entrypoints && service.official_entrypoints.length > 0) {
    const firstEntry = service.official_entrypoints[0];
    const sourcePage = sourcePagesMap.get(firstEntry.source_page_id);
    if (sourcePage) {
      officialLinks.push({
        label: 'Official Portal',
        url: sourcePage.canonical_url,
        source_page_id: firstEntry.source_page_id
      });
    }
  }
  
  // Build the guide object
  const guide = {
    guide_id: guideId,
    service_id: service.service_id,
    agency_id: service.agency_id,
    title: service.service_name,
    sections: {}
  };
  
  // Only include non-empty sections
  if (steps.length > 0) {
    guide.steps = steps;
    guide.sections.application_steps = steps;
  }
  
  if (requiredDocuments.length > 0) {
    guide.required_documents = requiredDocuments;
    guide.sections.required_documents = requiredDocuments;
  }
  
  if (fees.length > 0) {
    guide.fees = fees;
    guide.sections.fees = fees;
  }
  
  if (processingTime.length > 0) {
    guide.sections.processing_time = processingTime;
  }
  
  if (eligibility.length > 0) {
    guide.sections.eligibility = eligibility;
  }
  
  if (portalLinks.length > 0) {
    guide.sections.portal_links = portalLinks;
  }
  
  if (serviceInfo.length > 0) {
    guide.sections.service_info = serviceInfo;
  }
  
  // Add variants if detected
  if (variants.length > 0) {
    guide.variants = variants;
  }
  
  // Add official_links (required)
  guide.official_links = officialLinks.length > 0 ? officialLinks : [{
    label: 'Official Portal',
    url: 'https://bangladesh.gov.bd'
  }];
  
  // Metadata
  const now = new Date().toISOString();
  guide.generated_at = now;
  guide.last_updated_at = now;
  guide.status = 'draft';
  
  return guide;
}

/**
 * Migrate v2 KB to v3
 */
function migrateV2ToV3(v2Kb) {
  console.log('🔄 Starting v2 → v3 migration...\n');
  
  // Validate input version
  if (v2Kb.$schema_version !== '2.0.0') {
    console.warn(`⚠️  Warning: Expected $schema_version 2.0.0, got ${v2Kb.$schema_version}`);
  }
  
  // Build lookup maps
  const claimsMap = buildClaimsMap(v2Kb.claims || []);
  const sourcePagesMap = buildSourcePagesMap(v2Kb.source_pages || []);
  
  console.log(`  Found ${claimsMap.size} claims`);
  console.log(`  Found ${sourcePagesMap.size} source pages`);
  console.log(`  Found ${(v2Kb.services || []).length} services`);
  
  // Generate guides for each service
  const serviceGuides = [];
  for (const service of (v2Kb.services || [])) {
    const guide = generateGuide(service, claimsMap, sourcePagesMap);
    serviceGuides.push(guide);
    console.log(`  ✓ Generated guide: ${guide.guide_id} (${(guide.steps || []).length} steps)`);
  }
  
  // Build v3 KB
  const v3Kb = {
    $schema_version: '3.0.0',
    data_version: (v2Kb.data_version || 1) + 1,
    last_updated_at: new Date().toISOString(),
    updated_by: 'script:migrate_v2_to_v3.js',
    change_log: [
      ...(v2Kb.change_log || []),
      {
        version: (v2Kb.data_version || 1) + 1,
        date: new Date().toISOString().split('T')[0],
        changes: [
          'Migrated from v2.0.0 to v3.0.0 schema',
          `Added ${serviceGuides.length} service_guides`,
          'Guide layer provides user-friendly navigation while claims remain audit backbone'
        ]
      }
    ],
    // Preserve all v2 entities
    source_pages: v2Kb.source_pages || [],
    claims: v2Kb.claims || [],
    agencies: v2Kb.agencies || [],
    documents: v2Kb.documents || [],
    services: v2Kb.services || [],
    // Add new service_guides
    service_guides: serviceGuides
  };
  
  // Preserve audit_log if present
  if (v2Kb.audit_log) {
    v3Kb.audit_log = [
      ...v2Kb.audit_log,
      {
        event_id: `evt.migration_v2_to_v3_${Date.now()}`,
        event_type: 'migration',
        timestamp: new Date().toISOString(),
        affected_entities: {
          service_guides: serviceGuides.map(g => g.guide_id)
        },
        actor: 'script:migrate_v2_to_v3.js',
        description: `Migrated ${serviceGuides.length} services to service_guides`,
        metadata: {
          schema_version_from: '2.0.0',
          schema_version_to: '3.0.0'
        }
      }
    ];
  }
  
  return v3Kb;
}

/**
 * Print migration summary
 */
function printSummary(v3Kb) {
  console.log('\n' + '='.repeat(60));
  console.log('MIGRATION SUMMARY');
  console.log('='.repeat(60));
  
  const guides = v3Kb.service_guides || [];
  const totalSteps = guides.reduce((sum, g) => sum + (g.steps || []).length, 0);
  const totalClaims = (v3Kb.claims || []).length;
  
  // Count unique claim_ids referenced by guides
  const referencedClaimIds = new Set();
  for (const guide of guides) {
    // From steps
    for (const step of (guide.steps || [])) {
      for (const id of (step.claim_ids || [])) {
        referencedClaimIds.add(id);
      }
    }
    // From sections
    if (guide.sections) {
      for (const sectionItems of Object.values(guide.sections)) {
        if (Array.isArray(sectionItems)) {
          for (const item of sectionItems) {
            for (const id of (item.claim_ids || [])) {
              referencedClaimIds.add(id);
            }
          }
        }
      }
    }
  }
  
  // Collect domains from official_links
  const domains = new Set();
  for (const guide of guides) {
    for (const link of (guide.official_links || [])) {
      try {
        const url = new URL(link.url);
        domains.add(url.hostname);
      } catch (e) {
        // Skip invalid URLs
      }
    }
  }
  
  console.log(`\n  Schema Version: ${v3Kb.$schema_version}`);
  console.log(`  Data Version: ${v3Kb.data_version}`);
  console.log(`\n  Guides Generated: ${guides.length}`);
  console.log(`  Total Steps: ${totalSteps}`);
  console.log(`  Total Claims: ${totalClaims}`);
  console.log(`  Claims Referenced by Guides: ${referencedClaimIds.size}`);
  console.log(`  Domains: ${Array.from(domains).join(', ') || 'none'}`);
  console.log('');
}

// Main execution
function main() {
  const args = process.argv.slice(2);
  
  // Default paths
  let inputFile = path.join(__dirname, '..', 'kb', 'bangladesh_government_services_kb_v2.json');
  let outputFile = path.join(__dirname, '..', 'kb', 'bangladesh_government_services_kb_v3.json');
  
  if (args.length >= 1) {
    inputFile = args[0];
  }
  if (args.length >= 2) {
    outputFile = args[1];
  }
  
  console.log(`📁 Input:  ${inputFile}`);
  console.log(`📁 Output: ${outputFile}\n`);
  
  // Check input file exists
  if (!fs.existsSync(inputFile)) {
    console.error(`❌ ERROR: Input file not found: ${inputFile}`);
    console.error('Usage: node scripts/migrate_v2_to_v3.js [input_v2.json] [output_v3.json]');
    process.exit(1);
  }
  
  // Read input
  let v2Kb;
  try {
    const rawContent = fs.readFileSync(inputFile, 'utf-8');
    v2Kb = JSON.parse(rawContent);
  } catch (err) {
    console.error(`❌ ERROR: Failed to parse JSON: ${err.message}`);
    process.exit(1);
  }
  
  // Migrate
  const v3Kb = migrateV2ToV3(v2Kb);
  
  // Write output
  try {
    fs.writeFileSync(outputFile, JSON.stringify(v3Kb, null, 2), 'utf-8');
    console.log(`\n✅ v3 KB written to: ${outputFile}`);
  } catch (err) {
    console.error(`❌ ERROR: Failed to write output: ${err.message}`);
    process.exit(1);
  }
  
  // Print summary
  printSummary(v3Kb);
  
  console.log('📋 Next steps:');
  console.log('  1. Validate with: node scripts/validate_kb_v3.js ' + outputFile);
  console.log('  2. Build public guides: node scripts/build_public_guides.js ' + outputFile);
  console.log('');
}

if (require.main === module) {
  main();
}

module.exports = { migrateV2ToV3, generateGuide, buildClaimsMap, buildSourcePagesMap };

