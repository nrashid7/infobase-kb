/**
 * Bangladesh Government Services KB v2.0 - Strict Provenance-First Validation
 * 
 * Enforces production-grade validation:
 * - Deterministic IDs (SHA1-based source_page_id, pattern-based claim_id)
 * - Domain allowlist enforcement
 * - No uncited claims
 * - No free text in services/documents
 * - Structured_data required for numeric facts
 * - Strict locator schema validation
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

/**
 * Standardized claim status enum.
 * These are the ONLY valid status values for claims.
 * Validation will HARD FAIL on any other value.
 */
const VALID_CLAIM_STATUS_ENUM = ['verified', 'unverified', 'stale', 'deprecated', 'contradicted'];

/**
 * Valid status values for services and documents.
 * Includes 'partial' which is a derived status (some claims verified, some not).
 */
const VALID_ENTITY_STATUS_ENUM = ['verified', 'partial', 'unverified', 'stale', 'deprecated', 'contradicted'];

// For backward compatibility, export the claim status enum as VALID_STATUS_ENUM
const VALID_STATUS_ENUM = VALID_CLAIM_STATUS_ENUM;

class StrictProvenanceValidator {
  constructor(kbData) {
    this.kbData = kbData;
    this.errors = [];
    this.warnings = [];
    this.sourcePageIds = new Set();
    this.claimIds = new Set();
    this.agencyIds = new Set();
    this.documentIds = new Set();
    this.serviceIds = new Set();
    this.agencyDomainAllowlists = new Map(); // Map<agency_id, Set<normalized_domain>>
    this.domainValidationResults = []; // For detailed output
    // Track specific validation failure counts
    this.sourcePageIdMismatches = 0;
  }

  /**
   * Normalizes a URL for domain comparison:
   * - Strips protocol (http:// or https://)
   * - Lowercases the hostname
   * - Returns just the hostname
   * @param {string} urlString - URL to normalize
   * @returns {{ host: string, original: string } | null} - Normalized host or null if invalid
   */
  static normalizeUrl(urlString) {
    try {
      const url = new URL(urlString);
      return {
        host: url.hostname.toLowerCase(),
        original: urlString
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Normalizes a domain for allowlist comparison:
   * - Lowercases
   * - Strips leading dots
   * - Strips trailing slashes/paths
   * @param {string} domain - Domain to normalize
   * @returns {string} - Normalized domain
   */
  static normalizeDomain(domain) {
    if (!domain) return '';
    let normalized = domain.toLowerCase().trim();
    // Remove leading dots
    while (normalized.startsWith('.')) {
      normalized = normalized.slice(1);
    }
    // Remove trailing dots
    while (normalized.endsWith('.')) {
      normalized = normalized.slice(0, -1);
    }
    // Remove any path/query components if someone mistakenly included them
    const slashIdx = normalized.indexOf('/');
    if (slashIdx !== -1) {
      normalized = normalized.slice(0, slashIdx);
    }
    return normalized;
  }

  /**
   * Checks if a host matches an allowlisted domain.
   * Supports exact match and subdomain matching.
   * @param {string} host - The host from the URL (already normalized)
   * @param {string} allowedDomain - The domain from the allowlist (already normalized)
   * @returns {boolean}
   */
  static domainMatches(host, allowedDomain) {
    if (!host || !allowedDomain) return false;
    // Exact match
    if (host === allowedDomain) {
      return true;
    }
    // Subdomain match: host ends with ".allowedDomain"
    // e.g., www.epassport.gov.bd matches epassport.gov.bd
    // e.g., sub.portal.gov.bd matches portal.gov.bd
    if (host.endsWith('.' + allowedDomain)) {
      return true;
    }
    return false;
  }

  validate() {
    console.log('🔍 Starting strict provenance-first validation...\n');

    this.validateTopLevel();
    this.validateAgencies();
    this.validateSourcePages();
    this.validateClaims();
    this.validateDocuments();
    this.validateServices();
    this.validateCrossReferences();
    this.validateProvenanceRules();
    this.validateDomainAllowlists();
    this.validateDerivedStatusConsistency();

    this.reportResults();
    return this.errors.length === 0;
  }

  validateTopLevel() {
    if (!this.kbData.$schema_version) {
      this.addError('Missing $schema_version');
      return;
    }

    if (this.kbData.$schema_version !== '2.0.0') {
      this.addError(`Invalid schema version: ${this.kbData.$schema_version}. Must be 2.0.0`);
    }

    const required = ['source_pages', 'claims', 'agencies', 'documents', 'services'];
    for (const field of required) {
      if (!Array.isArray(this.kbData[field])) {
        this.addError(`Missing or invalid ${field} array`);
      }
    }
  }

  validateAgencies() {
    console.log('  Validating agencies...');

    if (!Array.isArray(this.kbData.agencies)) {
      return;
    }

    this.kbData.agencies.forEach((agency, idx) => {
      if (!agency.agency_id) {
        this.addError(`agencies[${idx}] missing agency_id`);
        return;
      }

      if (!/^agency\.[a-z0-9_]+$/.test(agency.agency_id)) {
        this.addError(`agencies[${idx}].agency_id has invalid format: ${agency.agency_id}`);
      }

      if (this.agencyIds.has(agency.agency_id)) {
        this.addError(`Duplicate agency_id: ${agency.agency_id}`);
      }
      this.agencyIds.add(agency.agency_id);

      // Validate domain_allowlist (REQUIRED)
      if (!agency.domain_allowlist || !Array.isArray(agency.domain_allowlist) || agency.domain_allowlist.length === 0) {
        this.addError(`agencies[${idx}].domain_allowlist is required and must be non-empty`);
      } else {
        // Normalize all domains in the allowlist
        const normalizedDomains = new Set();
        agency.domain_allowlist.forEach(domain => {
          const normalized = StrictProvenanceValidator.normalizeDomain(domain);
          if (normalized) {
            normalizedDomains.add(normalized);
          } else {
            this.addWarning(`agencies[${idx}].domain_allowlist contains invalid domain: '${domain}'`);
          }
        });
        this.agencyDomainAllowlists.set(agency.agency_id, normalizedDomains);
      }

      // Validate claim references if present
      if (agency.claims) {
        if (!Array.isArray(agency.claims)) {
          this.addError(`agencies[${idx}].claims must be an array`);
        } else {
          agency.claims.forEach(claimId => {
            if (!this.claimIds.has(claimId)) {
              // Will be validated later in validateCrossReferences
            }
          });
        }
      }
    });

    console.log(`    ✓ ${this.kbData.agencies.length} agencies validated`);
  }

  validateSourcePages() {
    console.log('  Validating source_pages registry (STRICT deterministic ID enforcement)...');

    if (!Array.isArray(this.kbData.source_pages)) {
      return;
    }

    const urls = new Set();
    const ids = new Set();

    this.kbData.source_pages.forEach((source, idx) => {
      // Required fields
      const required = ['source_page_id', 'canonical_url', 'agency_id', 'page_type', 'language', 'content_hash', 'last_crawled_at'];
      for (const field of required) {
        if (!(field in source)) {
          this.addError(`source_pages[${idx}] missing required field: ${field}`);
        }
      }

      // STRICT ENFORCEMENT: Deterministic source_page_id = "source." + SHA1(canonical_url)
      // This is a hard validation requirement - no exceptions
      if (source.source_page_id && source.canonical_url) {
        // Recompute SHA1 from canonical_url
        const expectedId = StrictProvenanceValidator.generateSourcePageId(source.canonical_url);
        
        // Hard-fail if IDs don't match
        if (source.source_page_id !== expectedId) {
          this.sourcePageIdMismatches++;
          this.addError(
            `source_pages[${idx}] - DETERMINISTIC ID MISMATCH (HARD FAIL):\n` +
            `    canonical_url: ${source.canonical_url}\n` +
            `    Expected source_page_id: ${expectedId}\n` +
            `    Actual source_page_id:   ${source.source_page_id}\n` +
            `    Rule: source_page_id MUST equal "source." + SHA1(canonical_url)`
          );
        }
        
        // Validate format pattern: source. + 40 hex chars (SHA1)
        if (!/^source\.[a-f0-9]{40}$/.test(source.source_page_id)) {
          this.addError(
            `source_pages[${idx}].source_page_id has invalid format (HARD FAIL):\n` +
            `    Got: ${source.source_page_id}\n` +
            `    Expected format: source.<40-char-sha1-hex>\n` +
            `    Example: source.a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2`
          );
        }
        
        if (ids.has(source.source_page_id)) {
          this.addError(`Duplicate source_page_id: ${source.source_page_id}`);
        }
        ids.add(source.source_page_id);
        this.sourcePageIds.add(source.source_page_id);
      } else if (!source.source_page_id && source.canonical_url) {
        // Missing source_page_id but has canonical_url - show what it should be
        const expectedId = StrictProvenanceValidator.generateSourcePageId(source.canonical_url);
        this.addError(
          `source_pages[${idx}] missing source_page_id (HARD FAIL):\n` +
          `    canonical_url: ${source.canonical_url}\n` +
          `    Required source_page_id: ${expectedId}`
        );
      }

      // URL format and uniqueness
      if (source.canonical_url) {
        try {
          const url = new URL(source.canonical_url);
          if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            this.addError(`source_pages[${idx}].canonical_url must be http or https: ${source.canonical_url}`);
          }
        } catch (e) {
          this.addError(`source_pages[${idx}].canonical_url is not a valid URL: ${source.canonical_url}`);
        }
        if (urls.has(source.canonical_url)) {
          this.addWarning(`Duplicate canonical_url: ${source.canonical_url}`);
        }
        urls.add(source.canonical_url);
      }

      // Content hash format (SHA-256)
      if (source.content_hash && !/^[a-f0-9]{64}$/.test(source.content_hash)) {
        this.addError(`source_pages[${idx}].content_hash is not a valid SHA-256 hash: ${source.content_hash}`);
      }

      // Agency reference format
      if (source.agency_id && !/^agency\.[a-z0-9_]+$/.test(source.agency_id)) {
        this.addError(`source_pages[${idx}].agency_id has invalid format: ${source.agency_id}`);
      }

      // Language validation
      if (source.language) {
        if (!Array.isArray(source.language) || source.language.length === 0) {
          this.addError(`source_pages[${idx}].language must be non-empty array`);
        } else {
          for (const lang of source.language) {
            if (!['bn', 'en'].includes(lang)) {
              this.addError(`source_pages[${idx}].language contains invalid value: ${lang}`);
            }
          }
        }
      }

      // page_type validation
      if (source.page_type) {
        const validTypes = ['main_portal', 'instruction', 'fee_schedule', 'form', 'notice', 'regulation', 'other'];
        if (!validTypes.includes(source.page_type)) {
          this.addError(`source_pages[${idx}].page_type is invalid: ${source.page_type}`);
        }
      }
    });

    console.log(`    ✓ ${this.kbData.source_pages.length} source pages validated`);
  }

  validateClaims() {
    console.log('  Validating claims (strict provenance rules)...');

    if (!Array.isArray(this.kbData.claims)) {
      return;
    }

    this.kbData.claims.forEach((claim, idx) => {
      const claimLabel = claim.claim_id || `claims[${idx}]`;

      // Required fields
      const required = ['claim_id', 'entity_ref', 'claim_type', 'text', 'citations', 'status'];
      for (const field of required) {
        if (!(field in claim)) {
          this.addError(`claims[${idx}] missing required field: ${field}`);
        }
      }

      // Validate claim_id pattern
      if (claim.claim_id) {
        const validPatterns = [
          /^claim\.fee\.[a-z0-9_]+\.[a-z0-9_]+/,
          /^claim\.step\.[a-z0-9_]+\.[0-9]+/,
          /^claim\.doc\.[a-z0-9_]+\.[a-z0-9_]+/,
          /^claim\.portal\.[a-z0-9_]+\.[a-z0-9_]+/,
          /^claim\.(eligibility|processing_time|rule|condition|definition|location|contact_info|other)\.[a-z0-9_]+/
        ];
        
        const matchesPattern = validPatterns.some(pattern => pattern.test(claim.claim_id));
        if (!matchesPattern) {
          this.addError(
            `claims[${idx}].claim_id does not match deterministic pattern: ${claim.claim_id}. ` +
            `Patterns: claim.fee.<service_id>.<variant>, claim.step.<service_id>.<order>, ` +
            `claim.doc.<document_id>.<purpose>, claim.portal.<service_id>.<action>, etc.`
          );
        }

        if (this.claimIds.has(claim.claim_id)) {
          this.addError(`Duplicate claim_id: ${claim.claim_id}`);
        }
        this.claimIds.add(claim.claim_id);
      }

      // Validate entity_ref
      if (claim.entity_ref) {
        if (!claim.entity_ref.type || !['service', 'document'].includes(claim.entity_ref.type)) {
          this.addError(`claims[${idx}].entity_ref.type must be 'service' or 'document'`);
        }
        if (!claim.entity_ref.id) {
          this.addError(`claims[${idx}].entity_ref.id is required`);
        }
      }

      // ========================================================================
      // STRICT CITATION VALIDATION - Every claim MUST have at least one citation
      // ========================================================================

      // Rule 1: citations field must exist
      if (!('citations' in claim)) {
        this.addError(
          `PROVENANCE VIOLATION: ${claimLabel} is missing 'citations' field. ` +
          `Every claim MUST have a citations array.`
        );
        return; // Skip further citation validation
      }

      // Rule 2: citations must be an array
      if (!Array.isArray(claim.citations)) {
        this.addError(
          `PROVENANCE VIOLATION: ${claimLabel} has invalid citations (must be an array, got ${typeof claim.citations}). ` +
          `Every claim MUST have a citations array.`
        );
        return; // Skip further citation validation
      }

      // Rule 3: citations array must be non-empty
      if (claim.citations.length === 0) {
        this.addError(
          `PROVENANCE VIOLATION: ${claimLabel} has an empty citations array. ` +
          `Every claim MUST have at least one citation linking it to an official source.`
        );
        return; // Skip further citation validation
      }

      // Validate each citation
      claim.citations.forEach((citation, citIdx) => {
        const citationLabel = `${claimLabel}.citations[${citIdx}]`;

        // ====================================================================
        // Rule 4: source_page_id is required and must reference existing source
        // ====================================================================
        if (!('source_page_id' in citation) || citation.source_page_id === null || citation.source_page_id === undefined) {
          this.addError(
            `PROVENANCE VIOLATION: ${citationLabel} is missing 'source_page_id'. ` +
            `Every citation MUST reference an official source page.`
          );
        } else if (typeof citation.source_page_id !== 'string' || citation.source_page_id.trim().length === 0) {
          this.addError(
            `PROVENANCE VIOLATION: ${citationLabel}.source_page_id is empty or invalid. ` +
            `Every citation MUST reference an official source page.`
          );
        } else {
          // Validate format
          if (!/^source\.[a-f0-9]{40}$/.test(citation.source_page_id)) {
            this.addError(
              `${citationLabel}.source_page_id has invalid format: '${citation.source_page_id}'. ` +
              `Must match pattern: source.<40-char-sha1-hash>`
            );
          }
          // Validate reference exists in source_pages registry
          if (!this.sourcePageIds.has(citation.source_page_id)) {
            this.addError(
              `PROVENANCE VIOLATION: ${citationLabel}.source_page_id '${citation.source_page_id}' ` +
              `does not exist in source_pages registry. ` +
              `Every citation MUST reference a registered source page.`
            );
          }
        }

        // ====================================================================
        // Rule 5: quoted_text is required and must be non-empty
        // ====================================================================
        if (!('quoted_text' in citation) || citation.quoted_text === null || citation.quoted_text === undefined) {
          this.addError(
            `PROVENANCE VIOLATION: ${citationLabel} is missing 'quoted_text'. ` +
            `Every citation MUST include the exact quoted text from the source.`
          );
        } else if (typeof citation.quoted_text !== 'string') {
          this.addError(
            `PROVENANCE VIOLATION: ${citationLabel}.quoted_text must be a string (got ${typeof citation.quoted_text}). ` +
            `Every citation MUST include the exact quoted text from the source.`
          );
        } else if (citation.quoted_text.trim().length === 0) {
          this.addError(
            `PROVENANCE VIOLATION: ${citationLabel}.quoted_text is empty. ` +
            `Every citation MUST include non-empty quoted text from the source.`
          );
        }

        // Validate retrieved_at is present
        if (!('retrieved_at' in citation)) {
          this.addError(`${citationLabel} missing required field: retrieved_at`);
        }

        // Validate strict locator schema
        if (citation.locator) {
          this.validateLocator(citation.locator, `${citationLabel}.locator`);
        }
      });

      // Text must not be empty
      if (claim.text && claim.text.trim().length === 0) {
        this.addError(`claims[${idx}].text is empty`);
      }

      // Validate structured_data for numeric facts
      if (['fee', 'processing_time'].includes(claim.claim_type)) {
        if (!claim.structured_data || typeof claim.structured_data !== 'object') {
          this.addError(
            `claims[${idx}] (${claim.claim_id}) is of type '${claim.claim_type}' but missing required structured_data`
          );
        } else {
          // For fees, must have amount_bdt
          if (claim.claim_type === 'fee' && typeof claim.structured_data.amount_bdt !== 'number') {
            this.addError(
              `claims[${idx}] (${claim.claim_id}) is a fee claim but structured_data.amount_bdt is missing or not a number`
            );
          }
        }
      }

      // Validate status - HARD FAIL on unknown status
      if (!claim.status) {
        this.addError(`claims[${idx}].status is missing - HARD FAIL. Must be one of: ${VALID_CLAIM_STATUS_ENUM.join(', ')}`);
      } else if (!VALID_CLAIM_STATUS_ENUM.includes(claim.status)) {
        this.addError(`claims[${idx}].status is invalid: '${claim.status}' - HARD FAIL. Must be one of: ${VALID_CLAIM_STATUS_ENUM.join(', ')}`);
      }
    });

    console.log(`    ✓ ${this.kbData.claims.length} claims validated (all have citations)`);
  }

  validateLocator(locator, path) {
    if (!locator.type) {
      this.addError(`${path} missing required 'type' field`);
      return;
    }

    const validTypes = ['heading_path', 'css_selector', 'xpath', 'url_fragment', 'pdf_page'];
    if (!validTypes.includes(locator.type)) {
      this.addError(`${path}.type is invalid: ${locator.type}. Must be one of: ${validTypes.join(', ')}`);
      return;
    }

    // Validate type-specific fields
    switch (locator.type) {
      case 'heading_path':
        if (!locator.heading_path || !Array.isArray(locator.heading_path) || locator.heading_path.length === 0) {
          this.addError(`${path}.heading_path must be a non-empty array`);
        }
        break;
      case 'css_selector':
        if (!locator.css_selector || typeof locator.css_selector !== 'string') {
          this.addError(`${path}.css_selector must be a string`);
        }
        break;
      case 'xpath':
        if (!locator.xpath || typeof locator.xpath !== 'string') {
          this.addError(`${path}.xpath must be a string`);
        }
        break;
      case 'url_fragment':
        if (!locator.url_fragment || typeof locator.url_fragment !== 'string') {
          this.addError(`${path}.url_fragment must be a string`);
        }
        break;
      case 'pdf_page':
        if (typeof locator.pdf_page !== 'number' || locator.pdf_page < 1) {
          this.addError(`${path}.pdf_page must be a positive integer`);
        }
        break;
    }

    // Ensure no extra fields (strict union type)
    const allowedFields = {
      heading_path: ['type', 'heading_path'],
      css_selector: ['type', 'css_selector'],
      xpath: ['type', 'xpath'],
      url_fragment: ['type', 'url_fragment'],
      pdf_page: ['type', 'pdf_page']
    };

    const fields = Object.keys(locator);
    const allowed = allowedFields[locator.type] || [];
    const extraFields = fields.filter(f => !allowed.includes(f));
    if (extraFields.length > 0) {
      this.addError(`${path} has extra fields: ${extraFields.join(', ')}. Strict union type only allows: ${allowed.join(', ')}`);
    }
  }

  validateDocuments() {
    console.log('  Validating documents (referential only, no free text)...');

    if (!Array.isArray(this.kbData.documents)) {
      return;
    }

    this.kbData.documents.forEach((doc, idx) => {
      const required = ['document_id', 'document_name', 'claims'];
      for (const field of required) {
        if (!(field in doc)) {
          this.addError(`documents[${idx}] missing required field: ${field}`);
        }
      }

      if (doc.document_id) {
        if (!/^doc\.[a-z0-9_]+$/.test(doc.document_id)) {
          this.addError(`documents[${idx}].document_id has invalid format: ${doc.document_id}`);
        }
        if (this.documentIds.has(doc.document_id)) {
          this.addError(`Duplicate document_id: ${doc.document_id}`);
        }
        this.documentIds.add(doc.document_id);
      }

      // CORE RULE: Documents must reference claims, not contain free text
      if (doc.claims) {
        if (!Array.isArray(doc.claims) || doc.claims.length === 0) {
          this.addError(`documents[${idx}].claims must be non-empty array`);
        } else {
          doc.claims.forEach(claimId => {
            if (!this.claimIds.has(claimId)) {
              // Will be validated in validateCrossReferences
            }
          });
        }
      }

      // HARD FAIL: No free text fields allowed
      const freeTextFields = ['definition', 'how_to_get', 'description', 'instructions', 'eligibility', 'steps'];
      for (const field of freeTextFields) {
        if (doc[field] !== undefined) {
          if (typeof doc[field] === 'string' && doc[field].trim().length > 0) {
            this.addError(
              `documents[${idx}].${field} contains free text - HARD FAIL. All facts must be in claims with citations.`
            );
          } else if (Array.isArray(doc[field])) {
            doc[field].forEach((item, itemIdx) => {
              if (typeof item === 'string' && item.trim().length > 0) {
                this.addError(
                  `documents[${idx}].${field}[${itemIdx}] contains free text - HARD FAIL. Must be a claim reference.`
                );
              }
            });
          }
        }
      }

      // Validate agency reference
      if (doc.issued_by && !this.agencyIds.has(doc.issued_by)) {
        // Will be validated in validateCrossReferences
      }

      // Validate status - HARD FAIL on unknown status
      if (doc.status && !VALID_ENTITY_STATUS_ENUM.includes(doc.status)) {
        this.addError(`documents[${idx}].status is invalid: '${doc.status}' - HARD FAIL. Must be one of: ${VALID_ENTITY_STATUS_ENUM.join(', ')}`);
      }
    });

    console.log(`    ✓ ${this.kbData.documents.length} documents validated`);
  }

  validateServices() {
    console.log('  Validating services (referential only, no free text)...');

    if (!Array.isArray(this.kbData.services)) {
      return;
    }

    this.kbData.services.forEach((svc, idx) => {
      const required = ['service_id', 'service_name', 'agency_id', 'claims', 'portal_mapping', 'official_entrypoints'];
      for (const field of required) {
        if (!(field in svc)) {
          this.addError(`services[${idx}] missing required field: ${field}`);
        }
      }

      if (svc.service_id) {
        if (!/^svc\.[a-z0-9_]+$/.test(svc.service_id)) {
          this.addError(`services[${idx}].service_id has invalid format: ${svc.service_id}`);
        }
        if (this.serviceIds.has(svc.service_id)) {
          this.addError(`Duplicate service_id: ${svc.service_id}`);
        }
        this.serviceIds.add(svc.service_id);
      }

      // CORE RULE: Services must reference claims, not contain free text
      if (svc.claims) {
        if (!Array.isArray(svc.claims) || svc.claims.length === 0) {
          this.addError(`services[${idx}].claims must be non-empty array`);
        } else {
          svc.claims.forEach(claimId => {
            if (!this.claimIds.has(claimId)) {
              // Will be validated in validateCrossReferences
            }
          });
        }
      }

      // HARD FAIL: No free text fields allowed
      const freeTextFields = ['eligibility', 'description', 'instructions', 'steps', 'fees', 'processing_time'];
      for (const field of freeTextFields) {
        if (svc[field] !== undefined) {
          if (typeof svc[field] === 'string' && svc[field].trim().length > 0) {
            this.addError(
              `services[${idx}].${field} contains free text - HARD FAIL. All facts must be in claims with citations.`
            );
          } else if (Array.isArray(svc[field])) {
            svc[field].forEach((item, itemIdx) => {
              if (typeof item === 'string' && item.trim().length > 0) {
                this.addError(
                  `services[${idx}].${field}[${itemIdx}] contains free text - HARD FAIL. Must be a claim reference.`
                );
              }
            });
          }
        }
      }

      // Validate portal_mapping
      if (svc.portal_mapping) {
        if (!svc.portal_mapping.entry_urls || !Array.isArray(svc.portal_mapping.entry_urls) || svc.portal_mapping.entry_urls.length === 0) {
          this.addError(`services[${idx}].portal_mapping.entry_urls must be non-empty array`);
        } else {
          svc.portal_mapping.entry_urls.forEach((entry, entryIdx) => {
            if (!entry.url || !entry.source_page_id) {
              this.addError(`services[${idx}].portal_mapping.entry_urls[${entryIdx}] missing url or source_page_id`);
            }
            if (entry.source_page_id && !this.sourcePageIds.has(entry.source_page_id)) {
              // Will be validated in validateCrossReferences
            }
          });
        }

        // Validate portal_steps if present
        if (svc.portal_mapping.portal_steps) {
          if (Array.isArray(svc.portal_mapping.portal_steps)) {
            svc.portal_mapping.portal_steps.forEach((step, stepIdx) => {
              if (step.claim_id && !this.claimIds.has(step.claim_id)) {
                // Will be validated in validateCrossReferences
              }
            });
          }
        }
      }

      // Validate official_entrypoints
      if (svc.official_entrypoints) {
        if (!Array.isArray(svc.official_entrypoints) || svc.official_entrypoints.length === 0) {
          this.addError(`services[${idx}].official_entrypoints must be non-empty array`);
        } else {
          svc.official_entrypoints.forEach((entry, entryIdx) => {
            if (!entry.source_page_id) {
              this.addError(`services[${idx}].official_entrypoints[${entryIdx}] missing source_page_id`);
            }
            if (entry.source_page_id && !this.sourcePageIds.has(entry.source_page_id)) {
              // Will be validated in validateCrossReferences
            }
          });
        }
      }

      // Validate document_requirements if present
      if (svc.document_requirements) {
        if (Array.isArray(svc.document_requirements)) {
          svc.document_requirements.forEach((req, reqIdx) => {
            if (req.document_id && !this.documentIds.has(req.document_id)) {
              // Will be validated in validateCrossReferences
            }
            if (req.condition_claim_id && !this.claimIds.has(req.condition_claim_id)) {
              // Will be validated in validateCrossReferences
            }
          });
        }
      }

      // Validate agency reference
      if (svc.agency_id && !this.agencyIds.has(svc.agency_id)) {
        // Will be validated in validateCrossReferences
      }

      // Validate status - HARD FAIL on unknown status
      if (svc.status && !VALID_ENTITY_STATUS_ENUM.includes(svc.status)) {
        this.addError(`services[${idx}].status is invalid: '${svc.status}' - HARD FAIL. Must be one of: ${VALID_ENTITY_STATUS_ENUM.join(', ')}`);
      }
    });

    console.log(`    ✓ ${this.kbData.services.length} services validated`);
  }

  validateCrossReferences() {
    console.log('  Validating cross-references...');

    // All source_page.agency_id references must exist
    if (Array.isArray(this.kbData.source_pages)) {
      this.kbData.source_pages.forEach((source, idx) => {
        if (source.agency_id && !this.agencyIds.has(source.agency_id)) {
          this.addError(`source_pages[${idx}].agency_id references unknown agency: ${source.agency_id}`);
        }
      });
    }

    // All claim.entity_ref references must exist
    if (Array.isArray(this.kbData.claims)) {
      this.kbData.claims.forEach((claim, idx) => {
        if (claim.entity_ref) {
          if (claim.entity_ref.type === 'service' && !this.serviceIds.has(claim.entity_ref.id)) {
            this.addError(`claims[${idx}].entity_ref.id references unknown service: ${claim.entity_ref.id}`);
          } else if (claim.entity_ref.type === 'document' && !this.documentIds.has(claim.entity_ref.id)) {
            this.addError(`claims[${idx}].entity_ref.id references unknown document: ${claim.entity_ref.id}`);
          }
        }
      });
    }

    // All document/service claim references must exist
    if (Array.isArray(this.kbData.documents)) {
      this.kbData.documents.forEach((doc, idx) => {
        if (Array.isArray(doc.claims)) {
          doc.claims.forEach(claimId => {
            if (!this.claimIds.has(claimId)) {
              this.addError(`documents[${idx}].claims references unknown claim_id: ${claimId}`);
            }
          });
        }
      });
    }

    if (Array.isArray(this.kbData.services)) {
      this.kbData.services.forEach((svc, idx) => {
        if (Array.isArray(svc.claims)) {
          svc.claims.forEach(claimId => {
            if (!this.claimIds.has(claimId)) {
              this.addError(`services[${idx}].claims references unknown claim_id: ${claimId}`);
            }
          });
        }
      });
    }

    console.log('    ✓ Cross-references validated');
  }

  validateProvenanceRules() {
    console.log('  Validating core provenance rules...');

    // Rule 1: Every claim must have at least one citation (already checked in validateClaims)

    // Rule 2: Every citation must reference a valid source_page_id (already checked)

    // Rule 3: No free text in documents/services (already checked)

    // Rule 4: All source pages should be referenced
    const referencedSourceIds = new Set();
    if (Array.isArray(this.kbData.claims)) {
      this.kbData.claims.forEach(claim => {
        if (Array.isArray(claim.citations)) {
          claim.citations.forEach(citation => {
            if (citation.source_page_id) {
              referencedSourceIds.add(citation.source_page_id);
            }
          });
        }
      });
    }

    if (Array.isArray(this.kbData.services)) {
      this.kbData.services.forEach(svc => {
        if (svc.portal_mapping?.entry_urls) {
          svc.portal_mapping.entry_urls.forEach(entry => {
            if (entry.source_page_id) {
              referencedSourceIds.add(entry.source_page_id);
            }
          });
        }
        if (svc.official_entrypoints) {
          svc.official_entrypoints.forEach(entry => {
            if (entry.source_page_id) {
              referencedSourceIds.add(entry.source_page_id);
            }
          });
        }
      });
    }

    const orphanedSources = Array.from(this.sourcePageIds).filter(id => !referencedSourceIds.has(id));
    if (orphanedSources.length > 0) {
      this.addWarning(
        `Found ${orphanedSources.length} source pages not referenced by any claim or entry point: ${orphanedSources.slice(0, 5).join(', ')}...`
      );
    }

    console.log('    ✓ Provenance rules validated');
  }

  validateDomainAllowlists() {
    console.log('  Validating domain allowlists (strict mode)...');

    if (!Array.isArray(this.kbData.source_pages)) {
      return;
    }

    let passCount = 0;
    let failCount = 0;

    this.kbData.source_pages.forEach((source, idx) => {
      if (!source.canonical_url || !source.agency_id) {
        return;
      }

      // Normalize the URL
      const normalized = StrictProvenanceValidator.normalizeUrl(source.canonical_url);
      if (!normalized) {
        // URL parsing error - already caught in validateSourcePages
        return;
      }

      const host = normalized.host;
      const allowlistSet = this.agencyDomainAllowlists.get(source.agency_id);

      if (!allowlistSet || allowlistSet.size === 0) {
        this.addError(`source_pages[${idx}].agency_id ${source.agency_id} has no domain_allowlist defined`);
        failCount++;
        this.domainValidationResults.push({
          index: idx,
          url: source.canonical_url,
          host,
          agency_id: source.agency_id,
          allowlist: [],
          status: 'FAIL',
          reason: 'No domain_allowlist defined for agency'
        });
        return;
      }

      // Convert Set to Array for iteration and display
      const allowlistArray = Array.from(allowlistSet);

      // Check if normalized host matches any allowlisted domain
      let matchedDomain = null;
      let matchType = null;

      for (const allowedDomain of allowlistArray) {
        if (StrictProvenanceValidator.domainMatches(host, allowedDomain)) {
          matchedDomain = allowedDomain;
          matchType = (host === allowedDomain) ? 'exact' : 'subdomain';
          break;
        }
      }

      if (matchedDomain) {
        passCount++;
        this.domainValidationResults.push({
          index: idx,
          url: source.canonical_url,
          host,
          agency_id: source.agency_id,
          allowlist: allowlistArray,
          status: 'PASS',
          matchedDomain,
          matchType
        });
      } else {
        failCount++;
        this.addError(
          `source_pages[${idx}].canonical_url domain mismatch: ` +
          `host '${host}' (from ${source.canonical_url}) is NOT in agency ${source.agency_id} allowlist [${allowlistArray.join(', ')}]`
        );
        this.domainValidationResults.push({
          index: idx,
          url: source.canonical_url,
          host,
          agency_id: source.agency_id,
          allowlist: allowlistArray,
          status: 'FAIL',
          reason: 'Domain not in allowlist'
        });
      }
    });

    // Summary output
    console.log(`    ✓ Domain allowlist validation complete: ${passCount} passed, ${failCount} failed`);
    
    // If there are failures, show detailed breakdown
    if (failCount > 0) {
      console.log('\n    Domain validation failures:');
      this.domainValidationResults
        .filter(r => r.status === 'FAIL')
        .forEach(r => {
          console.log(`      [${r.index}] ${r.host} ✗ (agency: ${r.agency_id})`);
          console.log(`          URL: ${r.url}`);
          console.log(`          Allowlist: [${r.allowlist.join(', ')}]`);
          console.log(`          Reason: ${r.reason}`);
        });
    }
  }

  /**
   * Compute the expected derived status for an entity based on its referenced claims.
   * 
   * Rules:
   * - 'verified' only if ALL referenced claims are 'verified'
   * - 'partial' if claims have mixed statuses (some verified, some not)
   * - Otherwise, inherit the "worst" status from claims:
   *   - Priority: deprecated > contradicted > stale > unverified > verified
   * 
   * @param {string[]} claimIds - Array of claim IDs referenced by the entity
   * @param {Map} claimStatusMap - Map of claim_id -> status
   * @returns {string} The expected derived status
   */
  static computeDerivedStatus(claimIds, claimStatusMap) {
    if (!claimIds || claimIds.length === 0) {
      return 'unverified'; // No claims means unknown status
    }

    const statuses = claimIds.map(id => claimStatusMap.get(id)).filter(s => s);
    
    if (statuses.length === 0) {
      return 'unverified'; // No valid claims found
    }

    // Count by status
    const counts = {
      verified: 0,
      unverified: 0,
      stale: 0,
      deprecated: 0,
      contradicted: 0
    };
    
    for (const status of statuses) {
      if (counts.hasOwnProperty(status)) {
        counts[status]++;
      }
    }

    const total = statuses.length;

    // All verified -> verified
    if (counts.verified === total) {
      return 'verified';
    }

    // Any deprecated -> deprecated (terminal/worst state)
    if (counts.deprecated > 0) {
      return 'deprecated';
    }

    // Any contradicted -> contradicted
    if (counts.contradicted > 0) {
      return 'contradicted';
    }

    // Any stale -> stale
    if (counts.stale > 0) {
      return 'stale';
    }

    // Mix of verified and unverified -> partial
    if (counts.verified > 0 && counts.unverified > 0) {
      return 'partial';
    }

    // All unverified -> unverified
    return 'unverified';
  }

  validateDerivedStatusConsistency() {
    console.log('  Validating derived status consistency...');

    // Build claim status map
    const claimStatusMap = new Map();
    if (Array.isArray(this.kbData.claims)) {
      this.kbData.claims.forEach(claim => {
        if (claim.claim_id && claim.status) {
          claimStatusMap.set(claim.claim_id, claim.status);
        }
      });
    }

    let inconsistencies = 0;

    // Validate documents
    if (Array.isArray(this.kbData.documents)) {
      this.kbData.documents.forEach((doc, idx) => {
        if (!doc.status || !Array.isArray(doc.claims)) return;
        
        const expectedStatus = StrictProvenanceValidator.computeDerivedStatus(doc.claims, claimStatusMap);
        
        // 'verified' is not allowed if any claim is not verified
        if (doc.status === 'verified' && expectedStatus !== 'verified') {
          this.addError(
            `DERIVED STATUS VIOLATION: documents[${idx}] (${doc.document_id}) has status='verified' ` +
            `but not all referenced claims are verified. Expected status: '${expectedStatus}'`
          );
          inconsistencies++;
        }
      });
    }

    // Validate services
    if (Array.isArray(this.kbData.services)) {
      this.kbData.services.forEach((svc, idx) => {
        if (!svc.status || !Array.isArray(svc.claims)) return;
        
        const expectedStatus = StrictProvenanceValidator.computeDerivedStatus(svc.claims, claimStatusMap);
        
        // 'verified' is not allowed if any claim is not verified
        if (svc.status === 'verified' && expectedStatus !== 'verified') {
          this.addError(
            `DERIVED STATUS VIOLATION: services[${idx}] (${svc.service_id}) has status='verified' ` +
            `but not all referenced claims are verified. Expected status: '${expectedStatus}'`
          );
          inconsistencies++;
        }
      });
    }

    if (inconsistencies === 0) {
      console.log('    ✓ Derived status consistency validated');
    } else {
      console.log(`    ✗ ${inconsistencies} derived status inconsistencies found`);
    }
  }

  static generateSourcePageId(canonicalUrl) {
    // Deterministic: source. + SHA1(canonical_url)
    const hash = crypto.createHash('sha1').update(canonicalUrl, 'utf8').digest('hex');
    return `source.${hash}`;
  }

  addError(message) {
    this.errors.push(message);
  }

  addWarning(message) {
    this.warnings.push(message);
  }

  reportResults() {
    console.log('\n' + '='.repeat(60));
    console.log('VALIDATION RESULTS');
    console.log('='.repeat(60));

    if (this.errors.length === 0) {
      console.log('✅ VALIDATION PASSED - All provenance rules satisfied\n');
    } else {
      console.log(`❌ VALIDATION FAILED - ${this.errors.length} error(s) found\n`);
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
    console.log(`  Source Pages: ${this.sourcePageIds.size}`);
    console.log(`  Claims: ${this.claimIds.size}`);
    console.log(`  Agencies: ${this.agencyIds.size}`);
    console.log(`  Documents: ${this.documentIds.size}`);
    console.log(`  Services: ${this.serviceIds.size}`);
    
    // Highlight deterministic ID validation failures
    if (this.sourcePageIdMismatches > 0) {
      console.log('');
      console.log(`  ⚠️  DETERMINISTIC ID FAILURES: ${this.sourcePageIdMismatches} source_page_id mismatch(es)`);
      console.log('     Rule: source_page_id MUST equal "source." + SHA1(canonical_url)');
      console.log('     Fix: Regenerate IDs using the correct SHA1 hash of each canonical_url');
    }
    console.log('');
  }
}

// Main execution
function main() {
  const args = process.argv.slice(2);
  const kbFile = args[0] || path.join(__dirname, 'kb_v2.json');

  if (!fs.existsSync(kbFile)) {
    console.error(`ERROR: KB file not found: ${kbFile}`);
    console.error('Usage: node validate_kb_v2.js [path-to-kb-file.json]');
    process.exit(1);
  }

  let kbData;
  try {
    const rawContent = fs.readFileSync(kbFile, 'utf-8');
    kbData = JSON.parse(rawContent);
  } catch (err) {
    console.error('ERROR: Failed to parse JSON:', err.message);
    process.exit(1);
  }

  const validator = new StrictProvenanceValidator(kbData);
  const isValid = validator.validate();

  process.exit(isValid ? 0 : 1);
}

/**
 * Run self-tests for domain validation logic
 */
function runDomainValidationTests() {
  console.log('\n🧪 Running domain validation unit tests...\n');
  
  const tests = [];
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
      tests.push({ name, status: 'passed' });
    } catch (e) {
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${e.message}`);
      failed++;
      tests.push({ name, status: 'failed', error: e.message });
    }
  }

  function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error(`${msg || 'Assertion failed'}: expected '${expected}', got '${actual}'`);
    }
  }

  function assertTrue(value, msg) {
    if (!value) {
      throw new Error(msg || 'Expected true but got false');
    }
  }

  function assertFalse(value, msg) {
    if (value) {
      throw new Error(msg || 'Expected false but got true');
    }
  }

  // Test normalizeUrl
  console.log('  normalizeUrl():');
  
  test('strips http protocol and lowercases host', () => {
    const result = StrictProvenanceValidator.normalizeUrl('http://EPassport.GOV.BD/page');
    assertEqual(result.host, 'epassport.gov.bd', 'Host should be lowercase');
  });

  test('strips https protocol and lowercases host', () => {
    const result = StrictProvenanceValidator.normalizeUrl('https://WWW.Example.COM/path?query=1');
    assertEqual(result.host, 'www.example.com', 'Host should be lowercase');
  });

  test('handles subdomain correctly', () => {
    const result = StrictProvenanceValidator.normalizeUrl('https://portal.services.gov.bd/');
    assertEqual(result.host, 'portal.services.gov.bd', 'Subdomain should be preserved');
  });

  test('returns null for invalid URL', () => {
    const result = StrictProvenanceValidator.normalizeUrl('not-a-url');
    assertEqual(result, null, 'Should return null for invalid URL');
  });

  test('returns null for empty string', () => {
    const result = StrictProvenanceValidator.normalizeUrl('');
    assertEqual(result, null, 'Should return null for empty string');
  });

  // Test normalizeDomain
  console.log('\n  normalizeDomain():');

  test('lowercases domain', () => {
    const result = StrictProvenanceValidator.normalizeDomain('EPassport.GOV.BD');
    assertEqual(result, 'epassport.gov.bd', 'Domain should be lowercase');
  });

  test('strips leading dots', () => {
    const result = StrictProvenanceValidator.normalizeDomain('.epassport.gov.bd');
    assertEqual(result, 'epassport.gov.bd', 'Leading dot should be removed');
  });

  test('strips trailing dots', () => {
    const result = StrictProvenanceValidator.normalizeDomain('epassport.gov.bd.');
    assertEqual(result, 'epassport.gov.bd', 'Trailing dot should be removed');
  });

  test('strips path if included by mistake', () => {
    const result = StrictProvenanceValidator.normalizeDomain('epassport.gov.bd/some/path');
    assertEqual(result, 'epassport.gov.bd', 'Path should be stripped');
  });

  test('handles empty string', () => {
    const result = StrictProvenanceValidator.normalizeDomain('');
    assertEqual(result, '', 'Empty string should return empty');
  });

  test('trims whitespace', () => {
    const result = StrictProvenanceValidator.normalizeDomain('  epassport.gov.bd  ');
    assertEqual(result, 'epassport.gov.bd', 'Whitespace should be trimmed');
  });

  // Test domainMatches
  console.log('\n  domainMatches():');

  test('exact match returns true', () => {
    const result = StrictProvenanceValidator.domainMatches('epassport.gov.bd', 'epassport.gov.bd');
    assertTrue(result, 'Exact match should return true');
  });

  test('subdomain of allowlisted domain returns true', () => {
    const result = StrictProvenanceValidator.domainMatches('www.epassport.gov.bd', 'epassport.gov.bd');
    assertTrue(result, 'www subdomain should match parent');
  });

  test('deep subdomain of allowlisted domain returns true', () => {
    const result = StrictProvenanceValidator.domainMatches('portal.services.epassport.gov.bd', 'epassport.gov.bd');
    assertTrue(result, 'Deep subdomain should match parent');
  });

  test('different domain returns false', () => {
    const result = StrictProvenanceValidator.domainMatches('example.com', 'epassport.gov.bd');
    assertFalse(result, 'Different domain should not match');
  });

  test('partial match without dot boundary returns false', () => {
    // e.g., 'malicious-epassport.gov.bd' should NOT match 'epassport.gov.bd'
    const result = StrictProvenanceValidator.domainMatches('malicious-epassport.gov.bd', 'epassport.gov.bd');
    assertFalse(result, 'Partial match without dot boundary should fail');
  });

  test('suffix attack returns false', () => {
    // e.g., 'evil.com/epassport.gov.bd' parsed would give host 'evil.com'
    const result = StrictProvenanceValidator.domainMatches('evil.com', 'epassport.gov.bd');
    assertFalse(result, 'Suffix attack should fail');
  });

  test('parent domain does not match subdomain in allowlist', () => {
    // If allowlist has 'www.epassport.gov.bd', then 'epassport.gov.bd' should NOT match
    const result = StrictProvenanceValidator.domainMatches('epassport.gov.bd', 'www.epassport.gov.bd');
    assertFalse(result, 'Parent should not match subdomain allowlist entry');
  });

  test('empty host returns false', () => {
    const result = StrictProvenanceValidator.domainMatches('', 'epassport.gov.bd');
    assertFalse(result, 'Empty host should return false');
  });

  test('empty allowedDomain returns false', () => {
    const result = StrictProvenanceValidator.domainMatches('epassport.gov.bd', '');
    assertFalse(result, 'Empty allowedDomain should return false');
  });

  // Integration test: Protocol difference should not bypass validation
  console.log('\n  Protocol-agnostic validation:');

  test('http and https URLs with same host are treated equally', () => {
    const http = StrictProvenanceValidator.normalizeUrl('http://epassport.gov.bd/page');
    const https = StrictProvenanceValidator.normalizeUrl('https://epassport.gov.bd/page');
    assertEqual(http.host, https.host, 'Protocol should not affect host extraction');
  });

  test('mismatched domain fails regardless of protocol', () => {
    const url1 = StrictProvenanceValidator.normalizeUrl('http://malicious.com/epassport.gov.bd');
    const url2 = StrictProvenanceValidator.normalizeUrl('https://malicious.com/epassport.gov.bd');
    assertFalse(
      StrictProvenanceValidator.domainMatches(url1.host, 'epassport.gov.bd'),
      'HTTP URL with wrong domain should fail'
    );
    assertFalse(
      StrictProvenanceValidator.domainMatches(url2.host, 'epassport.gov.bd'),
      'HTTPS URL with wrong domain should fail'
    );
  });

  // Full validator integration test
  console.log('\n  Full validator integration:');

  test('validator rejects source_page with domain not in agency allowlist', () => {
    const testKb = {
      $schema_version: '2.0.0',
      data_version: 1,
      last_updated_at: new Date().toISOString(),
      agencies: [{
        agency_id: 'agency.test',
        name: 'Test Agency',
        domain_allowlist: ['official.gov.bd']
      }],
      source_pages: [{
        source_page_id: 'source.' + 'a'.repeat(40),
        canonical_url: 'https://malicious.com/fake-page',
        agency_id: 'agency.test',
        page_type: 'main_portal',
        language: ['en'],
        content_hash: 'a'.repeat(64),
        last_crawled_at: new Date().toISOString()
      }],
      claims: [],
      documents: [],
      services: []
    };

    const validator = new StrictProvenanceValidator(testKb);
    validator.validateAgencies();
    validator.validateSourcePages();
    validator.validateDomainAllowlists();

    const hasDomainError = validator.errors.some(e => 
      e.includes('domain mismatch') && e.includes('malicious.com')
    );
    assertTrue(hasDomainError, 'Should have domain mismatch error for malicious.com');
  });

  test('validator accepts subdomain when parent is in allowlist', () => {
    const testKb = {
      $schema_version: '2.0.0',
      data_version: 1,
      last_updated_at: new Date().toISOString(),
      agencies: [{
        agency_id: 'agency.test',
        name: 'Test Agency',
        domain_allowlist: ['epassport.gov.bd']
      }],
      source_pages: [{
        source_page_id: 'source.' + 'b'.repeat(40),
        canonical_url: 'https://www.epassport.gov.bd/apply',
        agency_id: 'agency.test',
        page_type: 'main_portal',
        language: ['en'],
        content_hash: 'b'.repeat(64),
        last_crawled_at: new Date().toISOString()
      }],
      claims: [],
      documents: [],
      services: []
    };

    const validator = new StrictProvenanceValidator(testKb);
    validator.validateAgencies();
    validator.validateSourcePages();
    validator.validateDomainAllowlists();

    const hasDomainError = validator.errors.some(e => e.includes('domain mismatch'));
    assertFalse(hasDomainError, 'Subdomain www.epassport.gov.bd should match epassport.gov.bd');
  });

  test('validator rejects similar-looking domain (typosquatting)', () => {
    const testKb = {
      $schema_version: '2.0.0',
      data_version: 1,
      last_updated_at: new Date().toISOString(),
      agencies: [{
        agency_id: 'agency.test',
        name: 'Test Agency',
        domain_allowlist: ['epassport.gov.bd']
      }],
      source_pages: [{
        source_page_id: 'source.' + 'c'.repeat(40),
        canonical_url: 'https://epassport-gov.bd/apply',  // Note: hyphen instead of dot
        agency_id: 'agency.test',
        page_type: 'main_portal',
        language: ['en'],
        content_hash: 'c'.repeat(64),
        last_crawled_at: new Date().toISOString()
      }],
      claims: [],
      documents: [],
      services: []
    };

    const validator = new StrictProvenanceValidator(testKb);
    validator.validateAgencies();
    validator.validateSourcePages();
    validator.validateDomainAllowlists();

    const hasDomainError = validator.errors.some(e => 
      e.includes('domain mismatch') && e.includes('epassport-gov.bd')
    );
    assertTrue(hasDomainError, 'Typosquatting domain should be rejected');
  });

  test('case-insensitive domain matching works', () => {
    const testKb = {
      $schema_version: '2.0.0',
      data_version: 1,
      last_updated_at: new Date().toISOString(),
      agencies: [{
        agency_id: 'agency.test',
        name: 'Test Agency',
        domain_allowlist: ['EPASSPORT.GOV.BD']  // Uppercase in allowlist
      }],
      source_pages: [{
        source_page_id: 'source.' + 'd'.repeat(40),
        canonical_url: 'https://epassport.gov.bd/apply',  // Lowercase in URL
        agency_id: 'agency.test',
        page_type: 'main_portal',
        language: ['en'],
        content_hash: 'd'.repeat(64),
        last_crawled_at: new Date().toISOString()
      }],
      claims: [],
      documents: [],
      services: []
    };

    const validator = new StrictProvenanceValidator(testKb);
    validator.validateAgencies();
    validator.validateSourcePages();
    validator.validateDomainAllowlists();

    const hasDomainError = validator.errors.some(e => e.includes('domain mismatch'));
    assertFalse(hasDomainError, 'Case-insensitive matching should work');
  });

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`TEST RESULTS: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  return failed === 0;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  
  // Check for --test flag
  if (args.includes('--test')) {
    const success = runDomainValidationTests();
    process.exit(success ? 0 : 1);
  }
  
  main();
}

module.exports = { 
  StrictProvenanceValidator, 
  VALID_STATUS_ENUM,
  VALID_CLAIM_STATUS_ENUM,
  VALID_ENTITY_STATUS_ENUM,
  runDomainValidationTests
};
