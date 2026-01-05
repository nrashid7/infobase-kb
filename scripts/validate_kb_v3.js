/**
 * Bangladesh Government Services KB v3.0 - Guide-First Validation
 * 
 * Extends v2 validation with:
 * - service_guides entity validation
 * - Guide references claim_ids that must exist
 * - Guide references service_id that must exist
 * - Guide must have at least one official_link
 * - Guide step ordering validation
 * 
 * Usage: node scripts/validate_kb_v3.js [path-to-kb-v3.json]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

// Import v2 validator for base validation
const v2ValidatorPath = path.join(__dirname, '..', 'kb', 'validate_kb_v2.js');
let StrictProvenanceValidator;
try {
  const v2Module = require(v2ValidatorPath);
  StrictProvenanceValidator = v2Module.StrictProvenanceValidator;
} catch (e) {
  console.error('⚠️  Could not load v2 validator, using standalone validation');
  StrictProvenanceValidator = null;
}

/**
 * Valid guide statuses
 */
const VALID_GUIDE_STATUS = ['draft', 'published', 'archived'];

/**
 * V3 Guide Validator - extends v2 validation
 */
class GuideValidator {
  constructor(kbData) {
    this.kbData = kbData;
    this.errors = [];
    this.warnings = [];
    this.guideIds = new Set();
    this.claimIds = new Set();
    this.serviceIds = new Set();
    this.agencyIds = new Set();
    this.sourcePageIds = new Set();
  }

  /**
   * Build lookup sets for cross-reference validation
   */
  buildIndexes() {
    // Build claim IDs set
    if (Array.isArray(this.kbData.claims)) {
      for (const claim of this.kbData.claims) {
        if (claim.claim_id) {
          this.claimIds.add(claim.claim_id);
        }
      }
    }
    
    // Build service IDs set
    if (Array.isArray(this.kbData.services)) {
      for (const service of this.kbData.services) {
        if (service.service_id) {
          this.serviceIds.add(service.service_id);
        }
      }
    }
    
    // Build agency IDs set
    if (Array.isArray(this.kbData.agencies)) {
      for (const agency of this.kbData.agencies) {
        if (agency.agency_id) {
          this.agencyIds.add(agency.agency_id);
        }
      }
    }
    
    // Build source_page IDs set
    if (Array.isArray(this.kbData.source_pages)) {
      for (const page of this.kbData.source_pages) {
        if (page.source_page_id) {
          this.sourcePageIds.add(page.source_page_id);
        }
      }
    }
  }

  /**
   * Run full v3 validation
   */
  validate() {
    console.log('🔍 Starting v3 guide-first validation...\n');
    
    this.validateSchemaVersion();
    this.buildIndexes();
    this.validateServiceGuides();
    
    this.reportResults();
    return this.errors.length === 0;
  }

  /**
   * Validate schema version
   */
  validateSchemaVersion() {
    if (!this.kbData.$schema_version) {
      this.addError('Missing $schema_version');
      return;
    }
    
    if (this.kbData.$schema_version !== '3.0.0') {
      this.addError(`Invalid schema version: ${this.kbData.$schema_version}. Must be 3.0.0 for v3 validation`);
    }
    
    // Check service_guides array exists
    if (!Array.isArray(this.kbData.service_guides)) {
      this.addError('Missing or invalid service_guides array (required for v3)');
    }
  }

  /**
   * Validate all service_guides
   */
  validateServiceGuides() {
    console.log('  Validating service_guides...');
    
    if (!Array.isArray(this.kbData.service_guides)) {
      return;
    }
    
    let stepsTotal = 0;
    let citationsTotal = 0;
    
    this.kbData.service_guides.forEach((guide, idx) => {
      const guideLabel = guide.guide_id || `service_guides[${idx}]`;
      
      // Required fields
      const required = ['guide_id', 'service_id', 'agency_id', 'title', 'official_links'];
      for (const field of required) {
        if (!(field in guide) || (Array.isArray(guide[field]) && guide[field].length === 0)) {
          if (field === 'official_links') {
            this.addError(`${guideLabel} missing or empty required field: ${field}. Every guide must have at least one official link.`);
          } else {
            this.addError(`${guideLabel} missing required field: ${field}`);
          }
        }
      }
      
      // Validate guide_id format
      if (guide.guide_id) {
        if (!/^guide\.[a-z0-9_]+$/.test(guide.guide_id)) {
          this.addError(`${guideLabel}.guide_id has invalid format. Expected: guide.<slug>`);
        }
        
        if (this.guideIds.has(guide.guide_id)) {
          this.addError(`Duplicate guide_id: ${guide.guide_id}`);
        }
        this.guideIds.add(guide.guide_id);
      }
      
      // Validate service_id exists
      if (guide.service_id && !this.serviceIds.has(guide.service_id)) {
        this.addError(`${guideLabel}.service_id references unknown service: ${guide.service_id}`);
      }
      
      // Validate agency_id exists
      if (guide.agency_id && !this.agencyIds.has(guide.agency_id)) {
        this.addError(`${guideLabel}.agency_id references unknown agency: ${guide.agency_id}`);
      }
      
      // Validate title is non-empty
      if (guide.title && guide.title.trim().length === 0) {
        this.addError(`${guideLabel}.title is empty`);
      }
      
      // Validate steps
      if (guide.steps && Array.isArray(guide.steps)) {
        stepsTotal += guide.steps.length;
        this.validateGuideSteps(guide.steps, guideLabel);
      }
      
      // Validate sections
      if (guide.sections) {
        const { steps: sectionSteps, citations: sectionCitations } = this.validateGuideSections(guide.sections, guideLabel);
        stepsTotal += sectionSteps;
        citationsTotal += sectionCitations;
      }
      
      // Validate variants
      if (guide.variants && Array.isArray(guide.variants)) {
        this.validateGuideVariants(guide.variants, guideLabel);
      }
      
      // Validate official_links
      if (guide.official_links && Array.isArray(guide.official_links)) {
        this.validateOfficialLinks(guide.official_links, guideLabel);
      }
      
      // Validate status if present
      if (guide.status && !VALID_GUIDE_STATUS.includes(guide.status)) {
        this.addError(`${guideLabel}.status is invalid: '${guide.status}'. Must be one of: ${VALID_GUIDE_STATUS.join(', ')}`);
      }
      
      // Count citations from steps
      if (guide.steps) {
        for (const step of guide.steps) {
          citationsTotal += (step.claim_ids || []).length;
        }
      }
    });
    
    console.log(`    ✓ ${this.kbData.service_guides.length} guides validated`);
    console.log(`    ✓ ${stepsTotal} total steps`);
    console.log(`    ✓ ${citationsTotal} claim references`);
  }

  /**
   * Validate guide steps array
   */
  validateGuideSteps(steps, guideLabel) {
    const seenNumbers = new Set();
    
    steps.forEach((step, idx) => {
      const stepLabel = `${guideLabel}.steps[${idx}]`;
      
      // Required fields
      if (!('step_number' in step)) {
        this.addError(`${stepLabel} missing required field: step_number`);
      } else {
        if (typeof step.step_number !== 'number' || step.step_number < 1) {
          this.addError(`${stepLabel}.step_number must be a positive integer`);
        }
        
        if (seenNumbers.has(step.step_number)) {
          this.addWarning(`${stepLabel}.step_number ${step.step_number} is duplicated`);
        }
        seenNumbers.add(step.step_number);
      }
      
      if (!('title' in step) || !step.title || step.title.trim().length === 0) {
        this.addError(`${stepLabel} missing or empty required field: title`);
      }
      
      // Validate claim_ids references
      if (step.claim_ids && Array.isArray(step.claim_ids)) {
        for (const claimId of step.claim_ids) {
          if (!this.claimIds.has(claimId)) {
            this.addError(`${stepLabel}.claim_ids references unknown claim: ${claimId}`);
          }
        }
      }
    });
    
    // Check step ordering
    const numbers = steps.map(s => s.step_number).filter(n => typeof n === 'number');
    const sorted = [...numbers].sort((a, b) => a - b);
    const isSequential = sorted.every((n, i) => n === i + 1);
    
    if (!isSequential && numbers.length > 0) {
      this.addWarning(`${guideLabel}.steps are not sequentially numbered (1, 2, 3, ...)`);
    }
  }

  /**
   * Validate guide sections
   */
  validateGuideSections(sections, guideLabel) {
    let stepsCount = 0;
    let citationsCount = 0;
    
    const validSectionKeys = [
      'application_steps',
      'required_documents',
      'fees',
      'processing_time',
      'eligibility',
      'portal_links',
      'service_info'
    ];
    
    for (const [key, items] of Object.entries(sections)) {
      if (!validSectionKeys.includes(key)) {
        this.addWarning(`${guideLabel}.sections.${key} is not a recognized section key`);
      }
      
      if (!Array.isArray(items)) {
        this.addError(`${guideLabel}.sections.${key} must be an array`);
        continue;
      }
      
      if (key === 'application_steps') {
        stepsCount += items.length;
        this.validateGuideSteps(items, `${guideLabel}.sections.application_steps`);
      } else {
        // Validate guide items
        items.forEach((item, idx) => {
          const itemLabel = `${guideLabel}.sections.${key}[${idx}]`;
          
          if (!item.label || item.label.trim().length === 0) {
            this.addError(`${itemLabel} missing or empty required field: label`);
          }
          
          if (item.claim_ids && Array.isArray(item.claim_ids)) {
            citationsCount += item.claim_ids.length;
            for (const claimId of item.claim_ids) {
              if (!this.claimIds.has(claimId)) {
                this.addError(`${itemLabel}.claim_ids references unknown claim: ${claimId}`);
              }
            }
          }
        });
      }
    }
    
    return { steps: stepsCount, citations: citationsCount };
  }

  /**
   * Validate guide variants
   */
  validateGuideVariants(variants, guideLabel) {
    const seenVariantIds = new Set();
    
    variants.forEach((variant, idx) => {
      const variantLabel = `${guideLabel}.variants[${idx}]`;
      
      if (!variant.variant_id) {
        this.addError(`${variantLabel} missing required field: variant_id`);
      } else {
        if (seenVariantIds.has(variant.variant_id)) {
          this.addError(`${variantLabel}.variant_id is duplicated: ${variant.variant_id}`);
        }
        seenVariantIds.add(variant.variant_id);
      }
      
      if (!variant.label || variant.label.trim().length === 0) {
        this.addError(`${variantLabel} missing or empty required field: label`);
      }
      
      // Validate fee_claim_ids
      if (variant.fee_claim_ids && Array.isArray(variant.fee_claim_ids)) {
        for (const claimId of variant.fee_claim_ids) {
          if (!this.claimIds.has(claimId)) {
            this.addError(`${variantLabel}.fee_claim_ids references unknown claim: ${claimId}`);
          }
        }
      }
      
      // Validate processing_time_claim_ids
      if (variant.processing_time_claim_ids && Array.isArray(variant.processing_time_claim_ids)) {
        for (const claimId of variant.processing_time_claim_ids) {
          if (!this.claimIds.has(claimId)) {
            this.addError(`${variantLabel}.processing_time_claim_ids references unknown claim: ${claimId}`);
          }
        }
      }
    });
  }

  /**
   * Validate official_links
   */
  validateOfficialLinks(links, guideLabel) {
    if (links.length === 0) {
      this.addError(`${guideLabel}.official_links must have at least one entry`);
      return;
    }
    
    links.forEach((link, idx) => {
      const linkLabel = `${guideLabel}.official_links[${idx}]`;
      
      if (!link.label || link.label.trim().length === 0) {
        this.addError(`${linkLabel} missing or empty required field: label`);
      }
      
      if (!link.url) {
        this.addError(`${linkLabel} missing required field: url`);
      } else {
        try {
          const url = new URL(link.url);
          if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            this.addError(`${linkLabel}.url must be http or https: ${link.url}`);
          }
        } catch (e) {
          this.addError(`${linkLabel}.url is not a valid URL: ${link.url}`);
        }
      }
      
      // Validate source_page_id if present
      if (link.source_page_id && !this.sourcePageIds.has(link.source_page_id)) {
        this.addWarning(`${linkLabel}.source_page_id references unknown source_page: ${link.source_page_id}`);
      }
    });
  }

  addError(message) {
    this.errors.push(message);
  }

  addWarning(message) {
    this.warnings.push(message);
  }

  reportResults() {
    console.log('\n' + '='.repeat(60));
    console.log('V3 GUIDE VALIDATION RESULTS');
    console.log('='.repeat(60));
    
    if (this.errors.length === 0) {
      console.log('✅ V3 VALIDATION PASSED - All guide rules satisfied\n');
    } else {
      console.log(`❌ V3 VALIDATION FAILED - ${this.errors.length} error(s) found\n`);
      console.log('ERRORS:');
      this.errors.forEach((err, idx) => {
        console.log(`  ${idx + 1}. ${err}`);
      });
      console.log('');
    }
    
    if (this.warnings.length > 0) {
      console.log('WARNINGS:');
      this.warnings.forEach((warn, idx) => {
        console.log(`  ${idx + 1}. ${warn}`);
      });
      console.log('');
    }
    
    console.log('Summary:');
    console.log(`  Service Guides: ${this.guideIds.size}`);
    console.log(`  Claims Available: ${this.claimIds.size}`);
    console.log(`  Services Available: ${this.serviceIds.size}`);
    console.log(`  Agencies Available: ${this.agencyIds.size}`);
    console.log('');
  }
}

/**
 * Run v2 base validation first, then v3 guide validation
 */
function runFullValidation(kbData) {
  let v2Valid = true;
  
  // Run v2 validation for base entities (but allow 3.0.0 version)
  if (StrictProvenanceValidator) {
    // Temporarily set version to 2.0.0 for v2 validator
    const originalVersion = kbData.$schema_version;
    const v2KbData = { ...kbData, $schema_version: '2.0.0' };
    
    console.log('📋 Running v2 base validation (claims, sources, services)...\n');
    const v2Validator = new StrictProvenanceValidator(v2KbData);
    v2Valid = v2Validator.validate();
    console.log('');
  } else {
    console.log('⚠️  Skipping v2 base validation (validator not found)\n');
  }
  
  // Run v3 guide validation
  console.log('📋 Running v3 guide validation...\n');
  const v3Validator = new GuideValidator(kbData);
  const v3Valid = v3Validator.validate();
  
  return v2Valid && v3Valid;
}

// Main execution
function main() {
  const args = process.argv.slice(2);
  
  // Default path
  let kbFile = path.join(__dirname, '..', 'kb', 'bangladesh_government_services_kb_v3.json');
  
  if (args.length >= 1) {
    kbFile = args[0];
  }
  
  console.log(`📁 Validating: ${kbFile}\n`);
  
  if (!fs.existsSync(kbFile)) {
    console.error(`❌ ERROR: KB file not found: ${kbFile}`);
    console.error('Usage: node scripts/validate_kb_v3.js [path-to-kb-v3.json]');
    process.exit(1);
  }
  
  let kbData;
  try {
    const rawContent = fs.readFileSync(kbFile, 'utf-8');
    kbData = JSON.parse(rawContent);
  } catch (err) {
    console.error(`❌ ERROR: Failed to parse JSON: ${err.message}`);
    process.exit(1);
  }
  
  const isValid = runFullValidation(kbData);
  process.exit(isValid ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { GuideValidator, runFullValidation };

