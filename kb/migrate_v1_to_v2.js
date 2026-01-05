/**
 * Migration Script: v1 KB → v2 KB
 * 
 * Migrates a v1 knowledge base to the strict v2 provenance-first format:
 * - Extracts all URLs into source_pages registry with deterministic IDs
 * - Converts all facts into atomic claims with citations
 * - Preserves existing IDs where possible
 * - Generates deterministic IDs where missing
 * - Creates per-domain auto-agencies when agency cannot be inferred
 * - Never fabricates quoted_text - marks as needs_manual_citation
 * 
 * Output should pass: node validate_kb_v2.js <migrated.json>
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { 
  createMigrationEntry, 
  appendToAuditLog, 
  scriptActor 
} = require('./audit_log');

const SCRIPT_ACTOR = scriptActor('migrate_v1_to_v2.js');

class V1ToV2Migrator {
  constructor(v1Data) {
    this.v1Data = v1Data;
    this.v2Data = {
      $schema_version: '2.0.0',
      data_version: 1,
      last_updated_at: new Date().toISOString(),
      updated_by: 'migration-v1-to-v2',
      change_log: [],
      audit_log: [],
      source_pages: [],
      claims: [],
      agencies: [],
      documents: [],
      services: []
    };
    
    // Maps for tracking
    this.urlToSourcePageId = new Map();
    this.claimIdMap = new Map(); // Maps old claim IDs to new deterministic ones
    this.sourcePageIdMap = new Map();
    this.migrationWarnings = [];
    
    // Track auto-generated agencies (hostname → agency_id)
    this.autoAgencies = new Map();
    
    // Track domains encountered per agency for allowlist building
    this.agencyDomains = new Map();
    
    // Track all encountered URLs for later domain allowlist inference
    this.encounteredUrls = [];
  }

  migrate() {
    console.log('🔄 Starting migration from v1 to v2...\n');

    // Step 1: Extract all URLs first (for agency domain inference)
    this.collectAllUrls();

    // Step 2: Extract agencies and build domain allowlists
    this.migrateAgencies();

    // Step 3: Extract all URLs into source_pages registry
    this.extractSourcePages();

    // Step 4: Convert facts into atomic claims
    this.migrateClaims();

    // Step 5: Migrate documents (now referential only)
    this.migrateDocuments();

    // Step 6: Migrate services (now referential only)
    this.migrateServices();

    // Step 7: Add migration entry to change_log
    this.v2Data.change_log.push({
      version: 1,
      date: new Date().toISOString().split('T')[0],
      changes: [
        'Migrated from v1 to v2 schema',
        'Extracted all URLs into source_pages registry',
        'Converted all facts into atomic claims with citations',
        'Refactored documents and services to reference claims only'
      ]
    });

    // Step 8: Add migration audit log entry
    const migrationEntry = createMigrationEntry({
      affectedEntities: {
        source_pages: this.v2Data.source_pages.map(sp => sp.source_page_id),
        claims: this.v2Data.claims.map(c => c.claim_id),
        services: this.v2Data.services.map(s => s.service_id),
        documents: this.v2Data.documents.map(d => d.document_id),
        agencies: this.v2Data.agencies.map(a => a.agency_id)
      },
      actor: SCRIPT_ACTOR,
      schemaVersionFrom: '1.0',
      schemaVersionTo: '2.0.0',
      description: `Migrated ${this.v2Data.claims.length} claims, ${this.v2Data.services.length} services, ${this.v2Data.documents.length} documents from v1 to v2 schema`
    });
    appendToAuditLog(this.v2Data, migrationEntry);

    console.log('\n✅ Migration complete!\n');
    if (this.migrationWarnings.length > 0) {
      console.log('⚠️  Migration Warnings:');
      this.migrationWarnings.forEach(w => console.log(`  - ${w}`));
      console.log('');
    }

    console.log('📋 RECOMMENDATION: Run validation to check output:');
    console.log('   node kb/validate_kb_v2.js <output-file.json>\n');

    return this.v2Data;
  }

  /**
   * Collect all URLs from v1 data for domain inference before processing
   */
  collectAllUrls() {
    const urls = new Set();
    this.extractUrlsRecursive(this.v1Data, urls);
    this.encounteredUrls = Array.from(urls);
  }

  migrateAgencies() {
    console.log('  Migrating agencies...');

    if (!this.v1Data.agencies || !Array.isArray(this.v1Data.agencies)) {
      console.log('    ⚠️  No agencies found in v1 data');
      return;
    }

    this.v1Data.agencies.forEach(agency => {
      const agencyId = agency.agency_id || this.generateAgencyId(agency.name);
      
      // Build domain allowlist from website and any URLs associated with this agency
      const domainAllowlist = this.buildDomainAllowlist(agency, agencyId);
      
      const v2Agency = {
        agency_id: agencyId,
        name: agency.name,
        short_name: agency.short_name || '',
        website: agency.website || '',
        domain_allowlist: domainAllowlist,
        claims: []
      };

      this.v2Data.agencies.push(v2Agency);
      
      // Store domains for this agency
      this.agencyDomains.set(agencyId, new Set(domainAllowlist));
    });

    console.log(`    ✓ Migrated ${this.v2Data.agencies.length} agencies`);
  }

  buildDomainAllowlist(agency, agencyId) {
    const allowlist = new Set();

    // Extract domain from website
    if (agency.website) {
      try {
        const url = new URL(agency.website);
        const hostname = url.hostname;
        // Add both with and without www
        allowlist.add(hostname.replace(/^www\./, ''));
        if (hostname.startsWith('www.')) {
          allowlist.add(hostname);
        } else {
          allowlist.add('www.' + hostname);
        }
      } catch (e) {
        // Invalid URL
      }
    }

    // Also scan for URLs that might belong to this agency
    // (based on matching agency_id in v1 data or other heuristics)
    if (this.v1Data.services && Array.isArray(this.v1Data.services)) {
      this.v1Data.services.forEach(service => {
        if (service.agency_id === agencyId || service.agency_id === agency.agency_id) {
          // Add domains from service URLs
          const serviceUrls = [
            service.source_url,
            service.website,
            service.portal_url
          ].filter(Boolean);
          
          serviceUrls.forEach(urlStr => {
            try {
              const url = new URL(urlStr);
              allowlist.add(url.hostname.replace(/^www\./, ''));
            } catch (e) {}
          });
        }
      });
    }

    // If still empty, we'll handle it during source page creation
    // by creating auto-agencies per-domain

    return Array.from(allowlist);
  }

  extractSourcePages() {
    console.log('  Extracting source pages...');

    const urls = new Set(this.encounteredUrls);

    urls.forEach(url => {
      if (!this.urlToSourcePageId.has(url)) {
        const sourcePageId = this.generateSourcePageId(url);
        const agencyId = this.inferAgencyFromUrl(url);

        const sourcePage = {
          source_page_id: sourcePageId,
          canonical_url: url,
          agency_id: agencyId,
          page_type: this.inferPageType(url),
          language: ['en'], // Default, should be updated from v1 data if available
          crawl_method: 'html_static', // Default
          last_crawled_at: new Date().toISOString(),
          content_hash: '0000000000000000000000000000000000000000000000000000000000000000', // Placeholder hash
          change_log: [],
          status: 'active'
        };

        this.v2Data.source_pages.push(sourcePage);
        this.urlToSourcePageId.set(url, sourcePageId);
      }
    });

    console.log(`    ✓ Extracted ${this.v2Data.source_pages.length} source pages`);
  }

  extractUrlsRecursive(obj, urls) {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach(item => this.extractUrlsRecursive(item, urls));
      return;
    }

    // Check for URL-like strings
    for (const key in obj) {
      const value = obj[key];
      if (typeof value === 'string') {
        // Simple URL detection
        if (value.startsWith('http://') || value.startsWith('https://')) {
          try {
            new URL(value);
            urls.add(value);
          } catch (e) {
            // Not a valid URL
          }
        }
      } else if (typeof value === 'object') {
        this.extractUrlsRecursive(value, urls);
      }
    }
  }

  /**
   * Infer agency from URL. If no matching agency found, create an auto-agency
   * for the domain. This ensures every source_page has a valid agency_id.
   */
  inferAgencyFromUrl(url) {
    let hostname;
    let scheme;
    try {
      const urlObj = new URL(url);
      hostname = urlObj.hostname;
      scheme = urlObj.protocol.replace(':', '');
    } catch (e) {
      // Create a fallback auto-agency
      return this.createAutoAgency('unknown.invalid', 'https');
    }

    const normalizedHostname = hostname.replace(/^www\./, '');

    // Try to match URL to an existing agency
    for (const agency of this.v2Data.agencies) {
      const allowlist = this.agencyDomains.get(agency.agency_id);
      if (allowlist) {
        for (const allowed of allowlist) {
          const normalizedAllowed = allowed.replace(/^www\./, '');
          if (normalizedHostname === normalizedAllowed || 
              hostname === allowed ||
              normalizedHostname.endsWith('.' + normalizedAllowed)) {
            return agency.agency_id;
          }
        }
      }
    }

    // No match found - create auto-agency for this domain
    return this.createAutoAgency(hostname, scheme);
  }

  /**
   * Create an auto-agency for a domain when agency cannot be inferred.
   * Uses deterministic ID: agency.auto_<sha1(hostname)>
   */
  createAutoAgency(hostname, scheme = 'https') {
    const normalizedHostname = hostname.replace(/^www\./, '');
    
    // Check if we already created an auto-agency for this hostname
    if (this.autoAgencies.has(normalizedHostname)) {
      return this.autoAgencies.get(normalizedHostname);
    }

    // Generate deterministic agency ID from hostname
    const hostHash = crypto.createHash('sha1').update(normalizedHostname, 'utf8').digest('hex').substring(0, 12);
    const agencyId = `agency.auto_${hostHash}`;

    // Create domain allowlist that includes the hostname
    const domainAllowlist = [normalizedHostname];
    if (!normalizedHostname.startsWith('www.')) {
      domainAllowlist.push('www.' + normalizedHostname);
    }

    const autoAgency = {
      agency_id: agencyId,
      name: `Unknown Agency (${normalizedHostname})`,
      short_name: '',
      website: `${scheme}://${normalizedHostname}`,
      domain_allowlist: domainAllowlist,
      claims: []
    };

    this.v2Data.agencies.push(autoAgency);
    this.autoAgencies.set(normalizedHostname, agencyId);
    this.agencyDomains.set(agencyId, new Set(domainAllowlist));

    this.migrationWarnings.push(
      `Created auto-agency ${agencyId} for unknown domain: ${normalizedHostname}`
    );

    return agencyId;
  }

  inferPageType(url) {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('fee') || lowerUrl.includes('cost') || lowerUrl.includes('price')) {
      return 'fee_schedule';
    } else if (lowerUrl.includes('instruction') || lowerUrl.includes('guide') || lowerUrl.includes('how-to')) {
      return 'instruction';
    } else if (lowerUrl.includes('form')) {
      return 'form';
    } else if (lowerUrl.includes('notice')) {
      return 'notice';
    } else if (lowerUrl.includes('regulation') || lowerUrl.includes('rule')) {
      return 'regulation';
    } else if (lowerUrl.includes('/') && lowerUrl.split('/').length <= 4) {
      return 'main_portal';
    }
    return 'other';
  }

  migrateClaims() {
    console.log('  Migrating claims...');

    // This is a simplified migration - adjust based on actual v1 structure
    // The v1 structure would need to be examined to properly extract claims

    // Example: If v1 has services with steps, fees, etc., convert them to claims
    if (this.v1Data.services && Array.isArray(this.v1Data.services)) {
      this.v1Data.services.forEach((service, svcIdx) => {
        const serviceId = this.normalizeServiceId(service.service_id, svcIdx);
        
        // Migrate fees
        if (service.fees && Array.isArray(service.fees)) {
          service.fees.forEach((fee, feeIdx) => {
            const claimId = this.generateClaimId('fee', serviceId, `fee_${feeIdx}`);
            const { sourcePageId, hasRealSource } = this.findOrCreateSourcePageForService(service);

            const claim = {
              claim_id: claimId,
              entity_ref: {
                type: 'service',
                id: serviceId
              },
              claim_type: 'fee',
              text: fee.description || `Fee: ${fee.amount || 'N/A'} ${fee.currency || 'BDT'}`,
              structured_data: {
                amount_bdt: typeof fee.amount === 'number' ? fee.amount : 0,
                currency: fee.currency || 'BDT'
              },
              citations: [this.createCitation(sourcePageId, fee, hasRealSource)],
              status: 'unverified',
              tags: ['fee', serviceId, 'needs_manual_citation']
            };

            this.v2Data.claims.push(claim);
            if (service.service_id) {
              this.claimIdMap.set(`${service.service_id}.fees.${feeIdx}`, claimId);
            }
          });
        }

        // Migrate steps
        if (service.steps && Array.isArray(service.steps)) {
          service.steps.forEach((step, stepIdx) => {
            const claimId = this.generateClaimId('step', serviceId, String(stepIdx + 1));
            const { sourcePageId, hasRealSource } = this.findOrCreateSourcePageForService(service);

            const claim = {
              claim_id: claimId,
              entity_ref: {
                type: 'service',
                id: serviceId
              },
              claim_type: 'step',
              text: step.description || step.title || `Step ${stepIdx + 1}`,
              structured_data: {
                order: step.order || stepIdx + 1,
                mode: step.mode || 'online'
              },
              citations: [this.createCitation(sourcePageId, step, hasRealSource)],
              status: 'unverified',
              tags: ['step', serviceId, 'needs_manual_citation']
            };

            this.v2Data.claims.push(claim);
            if (service.service_id) {
              this.claimIdMap.set(`${service.service_id}.steps.${stepIdx}`, claimId);
            }
          });
        }
      });
    }

    console.log(`    ✓ Migrated ${this.v2Data.claims.length} claims`);
    if (this.v2Data.claims.length > 0) {
      console.log(`    ⚠️  Note: Claims tagged 'needs_manual_citation' require manual review`);
    }
  }

  /**
   * Create a citation. Never fabricate quoted_text.
   * If no real text is available, use a placeholder and mark appropriately.
   */
  createCitation(sourcePageId, sourceData, hasRealSource) {
    // Check if we have actual quoted text from the source
    const hasQuotedText = sourceData && 
                          typeof sourceData.source_text === 'string' && 
                          sourceData.source_text.trim().length > 0;

    if (hasQuotedText) {
      return {
        source_page_id: sourcePageId,
        quoted_text: sourceData.source_text.trim(),
        retrieved_at: new Date().toISOString(),
        locator: {
          type: 'heading_path',
          heading_path: ['(location needs verification)']
        }
      };
    }

    // No real quoted text available - create placeholder
    // The claim will be marked as unverified and tagged needs_manual_citation
    return {
      source_page_id: sourcePageId,
      quoted_text: '[PLACEHOLDER - Manual citation required. Do not use this claim until verified.]',
      retrieved_at: new Date().toISOString(),
      locator: {
        type: 'heading_path',
        heading_path: ['(needs manual location)']
      }
    };
  }

  /**
   * Find or create a source page for a service.
   * Returns the source_page_id and whether it's a real source.
   */
  findOrCreateSourcePageForService(service) {
    // Try to find an existing source page from service URLs
    const candidateUrls = [
      service.source_url,
      service.website,
      service.portal_url
    ].filter(url => url && typeof url === 'string' && url.startsWith('http'));

    for (const url of candidateUrls) {
      const existingId = this.urlToSourcePageId.get(url);
      if (existingId) {
        return { sourcePageId: existingId, hasRealSource: true };
      }
      
      // URL exists but wasn't extracted yet - add it now
      const sourcePageId = this.generateSourcePageId(url);
      const agencyId = this.inferAgencyFromUrl(url);
      
      const sourcePage = {
        source_page_id: sourcePageId,
        canonical_url: url,
        agency_id: agencyId,
        page_type: this.inferPageType(url),
        language: ['en'],
        crawl_method: 'html_static',
        last_crawled_at: new Date().toISOString(),
        content_hash: '0000000000000000000000000000000000000000000000000000000000000000',
        change_log: [],
        status: 'active'
      };
      
      this.v2Data.source_pages.push(sourcePage);
      this.urlToSourcePageId.set(url, sourcePageId);
      
      return { sourcePageId, hasRealSource: true };
    }

    // No URL available - we need to create a placeholder source
    // Use the agency's website if available
    const agencyId = service.agency_id;
    const agency = this.v2Data.agencies.find(a => a.agency_id === agencyId);
    
    if (agency && agency.website) {
      const existingId = this.urlToSourcePageId.get(agency.website);
      if (existingId) {
        return { sourcePageId: existingId, hasRealSource: false };
      }
      
      // Create source from agency website
      const sourcePageId = this.generateSourcePageId(agency.website);
      const sourcePage = {
        source_page_id: sourcePageId,
        canonical_url: agency.website,
        agency_id: agencyId,
        page_type: 'main_portal',
        language: ['en'],
        crawl_method: 'html_static',
        last_crawled_at: new Date().toISOString(),
        content_hash: '0000000000000000000000000000000000000000000000000000000000000000',
        change_log: [],
        status: 'active'
      };
      
      this.v2Data.source_pages.push(sourcePage);
      this.urlToSourcePageId.set(agency.website, sourcePageId);
      
      this.migrationWarnings.push(
        `Service ${service.service_id || 'unknown'} had no source URL - using agency website`
      );
      
      return { sourcePageId, hasRealSource: false };
    }

    // Last resort: we need at least one source page
    // This should not happen in well-formed v1 data
    this.migrationWarnings.push(
      `Service ${service.service_id || 'unknown'} has no source URL and no agency website`
    );
    
    // Return the first source page if any exists
    if (this.v2Data.source_pages.length > 0) {
      return { 
        sourcePageId: this.v2Data.source_pages[0].source_page_id, 
        hasRealSource: false 
      };
    }
    
    // Absolute fallback - should never happen
    throw new Error('Cannot create claims without any source pages');
  }

  migrateDocuments() {
    console.log('  Migrating documents...');

    if (!this.v1Data.documents || !Array.isArray(this.v1Data.documents)) {
      console.log('    ⚠️  No documents found in v1 data');
      return;
    }

    this.v1Data.documents.forEach((doc, idx) => {
      const documentId = this.normalizeDocumentId(doc.document_id || doc.name, idx);
      
      // Find claims related to this document
      const relatedClaims = Array.from(this.claimIdMap.values()).filter(claimId => {
        return claimId.includes(documentId) || claimId.includes(doc.document_id || '');
      });

      // If no related claims, create a placeholder claim
      if (relatedClaims.length === 0) {
        const placeholderClaimId = this.createPlaceholderClaimForDocument(doc, documentId);
        relatedClaims.push(placeholderClaimId);
      }

      const v2Doc = {
        document_id: documentId,
        document_name: doc.name || doc.document_name,
        issued_by: doc.issued_by || this.findFirstAgencyId(),
        claims: relatedClaims,
        status: 'partial', // Migration status
        last_updated_at: new Date().toISOString()
      };

      this.v2Data.documents.push(v2Doc);
    });

    console.log(`    ✓ Migrated ${this.v2Data.documents.length} documents`);
  }

  migrateServices() {
    console.log('  Migrating services...');

    if (!this.v1Data.services || !Array.isArray(this.v1Data.services)) {
      console.log('    ⚠️  No services found in v1 data');
      return;
    }

    this.v1Data.services.forEach((service, idx) => {
      const serviceId = this.normalizeServiceId(service.service_id, idx);

      // Collect all claims for this service
      const serviceClaims = this.v2Data.claims
        .filter(claim => claim.entity_ref.type === 'service' && claim.entity_ref.id === serviceId)
        .map(claim => claim.claim_id);

      // If no claims, create a placeholder
      if (serviceClaims.length === 0) {
        const placeholderClaimId = this.createPlaceholderClaimForService(service, serviceId);
        serviceClaims.push(placeholderClaimId);
      }

      // Build portal_mapping
      const portalMapping = {
        entry_urls: []
      };

      const entryUrl = service.portal_url || service.website || service.source_url;
      if (entryUrl) {
        let sourcePageId = this.urlToSourcePageId.get(entryUrl);
        if (!sourcePageId) {
          sourcePageId = this.generateSourcePageId(entryUrl);
          const agencyId = this.inferAgencyFromUrl(entryUrl);
          
          this.v2Data.source_pages.push({
            source_page_id: sourcePageId,
            canonical_url: entryUrl,
            agency_id: agencyId,
            page_type: this.inferPageType(entryUrl),
            language: ['en'],
            crawl_method: 'html_static',
            last_crawled_at: new Date().toISOString(),
            content_hash: '0000000000000000000000000000000000000000000000000000000000000000',
            change_log: [],
            status: 'active'
          });
          this.urlToSourcePageId.set(entryUrl, sourcePageId);
        }
        
        portalMapping.entry_urls.push({
          url: entryUrl,
          source_page_id: sourcePageId,
          description: 'Main service portal'
        });
      }

      // If no entry_urls, use agency website
      if (portalMapping.entry_urls.length === 0) {
        const agencyId = service.agency_id || this.findFirstAgencyId();
        const agency = this.v2Data.agencies.find(a => a.agency_id === agencyId);
        if (agency && agency.website) {
          let sourcePageId = this.urlToSourcePageId.get(agency.website);
          if (!sourcePageId) {
            sourcePageId = this.generateSourcePageId(agency.website);
            this.v2Data.source_pages.push({
              source_page_id: sourcePageId,
              canonical_url: agency.website,
              agency_id: agencyId,
              page_type: 'main_portal',
              language: ['en'],
              crawl_method: 'html_static',
              last_crawled_at: new Date().toISOString(),
              content_hash: '0000000000000000000000000000000000000000000000000000000000000000',
              change_log: [],
              status: 'active'
            });
            this.urlToSourcePageId.set(agency.website, sourcePageId);
          }
          portalMapping.entry_urls.push({
            url: agency.website,
            source_page_id: sourcePageId,
            description: 'Agency main portal'
          });
        }
      }

      const v2Service = {
        service_id: serviceId,
        service_name: service.name || service.service_name,
        service_family: service.category || service.family || '',
        agency_id: service.agency_id || this.findFirstAgencyId(),
        claims: serviceClaims,
        portal_mapping: portalMapping,
        official_entrypoints: portalMapping.entry_urls.map(e => ({
          source_page_id: e.source_page_id,
          description: e.description
        })),
        status: 'partial',
        last_updated_at: new Date().toISOString()
      };

      this.v2Data.services.push(v2Service);
    });

    console.log(`    ✓ Migrated ${this.v2Data.services.length} services`);
  }

  findFirstAgencyId() {
    if (this.v2Data.agencies.length > 0) {
      return this.v2Data.agencies[0].agency_id;
    }
    // Create a fallback auto-agency
    return this.createAutoAgency('unknown.local', 'https');
  }

  createPlaceholderClaimForDocument(doc, documentId) {
    const claimId = this.generateClaimId('definition', documentId, 'placeholder');
    
    // Find a source page
    let sourcePageId;
    if (this.v2Data.source_pages.length > 0) {
      sourcePageId = this.v2Data.source_pages[0].source_page_id;
    } else {
      // Should not happen if we have agencies
      const agencyId = this.findFirstAgencyId();
      const agency = this.v2Data.agencies.find(a => a.agency_id === agencyId);
      if (agency && agency.website) {
        sourcePageId = this.generateSourcePageId(agency.website);
        this.v2Data.source_pages.push({
          source_page_id: sourcePageId,
          canonical_url: agency.website,
          agency_id: agencyId,
          page_type: 'main_portal',
          language: ['en'],
          crawl_method: 'html_static',
          last_crawled_at: new Date().toISOString(),
          content_hash: '0000000000000000000000000000000000000000000000000000000000000000',
          change_log: [],
          status: 'active'
        });
        this.urlToSourcePageId.set(agency.website, sourcePageId);
      }
    }

    const claim = {
      claim_id: claimId,
      entity_ref: {
        type: 'document',
        id: documentId
      },
      claim_type: 'definition',
      text: `${doc.name || doc.document_name} - Placeholder claim (migration)`,
      citations: [{
        source_page_id: sourcePageId,
        quoted_text: '[PLACEHOLDER - Manual citation required. Do not use this claim until verified.]',
        retrieved_at: new Date().toISOString(),
        locator: {
          type: 'heading_path',
          heading_path: ['(needs manual location)']
        }
      }],
      status: 'unverified',
      tags: ['migration', 'placeholder', 'needs_manual_citation']
    };

    this.v2Data.claims.push(claim);
    this.migrationWarnings.push(`Created placeholder claim for document: ${documentId}`);
    return claimId;
  }

  createPlaceholderClaimForService(service, serviceId) {
    const claimId = this.generateClaimId('eligibility', serviceId, 'placeholder');
    
    // Find a source page
    let sourcePageId;
    if (this.v2Data.source_pages.length > 0) {
      sourcePageId = this.v2Data.source_pages[0].source_page_id;
    } else {
      const agencyId = this.findFirstAgencyId();
      const agency = this.v2Data.agencies.find(a => a.agency_id === agencyId);
      if (agency && agency.website) {
        sourcePageId = this.generateSourcePageId(agency.website);
        this.v2Data.source_pages.push({
          source_page_id: sourcePageId,
          canonical_url: agency.website,
          agency_id: agencyId,
          page_type: 'main_portal',
          language: ['en'],
          crawl_method: 'html_static',
          last_crawled_at: new Date().toISOString(),
          content_hash: '0000000000000000000000000000000000000000000000000000000000000000',
          change_log: [],
          status: 'active'
        });
        this.urlToSourcePageId.set(agency.website, sourcePageId);
      }
    }

    const claim = {
      claim_id: claimId,
      entity_ref: {
        type: 'service',
        id: serviceId
      },
      claim_type: 'eligibility_requirement',
      text: `${service.name || service.service_name} - Placeholder claim (migration)`,
      citations: [{
        source_page_id: sourcePageId,
        quoted_text: '[PLACEHOLDER - Manual citation required. Do not use this claim until verified.]',
        retrieved_at: new Date().toISOString(),
        locator: {
          type: 'heading_path',
          heading_path: ['(needs manual location)']
        }
      }],
      status: 'unverified',
      tags: ['migration', 'placeholder', 'needs_manual_citation']
    };

    this.v2Data.claims.push(claim);
    this.migrationWarnings.push(`Created placeholder claim for service: ${serviceId}`);
    return claimId;
  }

  // ID Normalization Functions
  
  /**
   * Normalize service_id to ensure it begins with "svc."
   */
  normalizeServiceId(originalId, index) {
    if (!originalId) {
      return `svc.service_${index}`;
    }
    
    // Already has correct prefix
    if (originalId.startsWith('svc.')) {
      return originalId.toLowerCase().replace(/[^a-z0-9_.]/g, '_');
    }
    
    // Add prefix
    const normalized = originalId.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
    return `svc.${normalized}`;
  }

  /**
   * Normalize document_id to ensure it begins with "doc."
   */
  normalizeDocumentId(originalId, index) {
    if (!originalId) {
      return `doc.document_${index}`;
    }
    
    // Already has correct prefix
    if (originalId.startsWith('doc.')) {
      return originalId.toLowerCase().replace(/[^a-z0-9_.]/g, '_');
    }
    
    // Add prefix
    const normalized = originalId.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
    return `doc.${normalized}`;
  }

  // ID Generation Functions
  generateSourcePageId(canonicalUrl) {
    const hash = crypto.createHash('sha1').update(canonicalUrl, 'utf8').digest('hex');
    return `source.${hash}`;
  }

  generateClaimId(type, entityId, suffix) {
    // Deterministic patterns that match validator expectations:
    // claim.fee.<service_id>.<variant>
    // claim.step.<service_id>.<order>
    // claim.doc.<document_id>.<purpose>
    // claim.portal.<service_id>.<action>
    // claim.<type>.<entity_id>.<suffix>

    const normalizedEntityId = (entityId || 'unknown')
      .toLowerCase()
      .replace(/^(svc\.|doc\.)/, '') // Remove prefix for the claim ID
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/^_+|_+$/g, '');
    
    const normalizedSuffix = (suffix || 'default')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/^_+|_+$/g, '');

    // Map types to valid claim type prefixes
    const typeMap = {
      'fee': 'fee',
      'step': 'step',
      'doc': 'doc',
      'portal': 'portal',
      'eligibility': 'eligibility',
      'processing_time': 'processing_time',
      'rule': 'rule',
      'condition': 'condition',
      'definition': 'definition',
      'location': 'location',
      'contact_info': 'contact_info',
      'other': 'other'
    };

    const claimType = typeMap[type] || 'other';
    return `claim.${claimType}.${normalizedEntityId}.${normalizedSuffix}`;
  }

  generateAgencyId(name) {
    const normalized = (name || 'unknown').toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return `agency.${normalized}`;
  }
}

// Self-check function
function runSelfCheck() {
  console.log('🧪 Running migration self-check...\n');

  // Create a minimal v1 test fixture
  const testV1 = {
    agencies: [
      {
        agency_id: 'agency.test',
        name: 'Test Agency',
        website: 'https://test.gov.bd'
      }
    ],
    services: [
      {
        service_id: 'test_service', // Note: missing svc. prefix - should be normalized
        name: 'Test Service',
        agency_id: 'agency.test',
        website: 'https://test.gov.bd/service',
        fees: [
          { amount: 100, currency: 'BDT', description: 'Standard fee' }
        ],
        steps: [
          { order: 1, description: 'Step one', mode: 'online' }
        ]
      }
    ],
    documents: [
      {
        document_id: 'test_doc', // Note: missing doc. prefix - should be normalized
        name: 'Test Document',
        issued_by: 'agency.test'
      }
    ]
  };

  const migrator = new V1ToV2Migrator(testV1);
  const v2 = migrator.migrate();

  // Run checks
  const checks = [];

  // Check 1: Service ID normalized
  const service = v2.services.find(s => s.service_id.includes('test'));
  checks.push({
    name: 'Service ID normalized to svc. prefix',
    pass: service && service.service_id.startsWith('svc.'),
    detail: service ? service.service_id : 'not found'
  });

  // Check 2: Document ID normalized
  const doc = v2.documents.find(d => d.document_id.includes('test'));
  checks.push({
    name: 'Document ID normalized to doc. prefix',
    pass: doc && doc.document_id.startsWith('doc.'),
    detail: doc ? doc.document_id : 'not found'
  });

  // Check 3: All source pages have valid agency_id that exists
  const agencyIds = new Set(v2.agencies.map(a => a.agency_id));
  const allSourcePagesHaveValidAgency = v2.source_pages.every(sp => agencyIds.has(sp.agency_id));
  checks.push({
    name: 'All source_pages reference existing agencies',
    pass: allSourcePagesHaveValidAgency,
    detail: `${v2.source_pages.length} source pages, ${v2.agencies.length} agencies`
  });

  // Check 4: All claims have citations with valid source_page_id
  const sourcePageIds = new Set(v2.source_pages.map(sp => sp.source_page_id));
  const allClaimsHaveValidCitations = v2.claims.every(claim => 
    claim.citations && 
    claim.citations.length > 0 && 
    claim.citations.every(c => sourcePageIds.has(c.source_page_id))
  );
  checks.push({
    name: 'All claims have citations referencing existing source pages',
    pass: allClaimsHaveValidCitations,
    detail: `${v2.claims.length} claims`
  });

  // Check 5: No example.gov.bd in domain allowlists
  const hasExampleDomain = v2.agencies.some(a => 
    a.domain_allowlist && a.domain_allowlist.some(d => d.includes('example.gov.bd'))
  );
  checks.push({
    name: 'No placeholder domains like example.gov.bd',
    pass: !hasExampleDomain,
    detail: hasExampleDomain ? 'Found example.gov.bd' : 'Clean'
  });

  // Check 6: Claims tagged needs_manual_citation are unverified
  const placeholderClaims = v2.claims.filter(c => c.tags && c.tags.includes('needs_manual_citation'));
  const allPlaceholdersUnverified = placeholderClaims.every(c => c.status === 'unverified');
  checks.push({
    name: 'Placeholder claims are marked unverified',
    pass: allPlaceholdersUnverified,
    detail: `${placeholderClaims.length} placeholder claims`
  });

  // Report results
  console.log('Self-check results:');
  let allPassed = true;
  checks.forEach(check => {
    const status = check.pass ? '✓' : '✗';
    console.log(`  ${status} ${check.name}: ${check.detail}`);
    if (!check.pass) allPassed = false;
  });

  console.log('');
  if (allPassed) {
    console.log('✅ All self-checks passed!\n');
    return true;
  } else {
    console.log('❌ Some self-checks failed!\n');
    return false;
  }
}

// Main execution
function main() {
  const args = process.argv.slice(2);
  
  // Handle --self-check flag
  if (args.includes('--self-check')) {
    const passed = runSelfCheck();
    process.exit(passed ? 0 : 1);
  }

  const v1File = args[0];
  const v2File = args[1] || path.join(__dirname, 'kb_v2.json');

  if (!v1File) {
    console.error('Usage: node migrate_v1_to_v2.js <v1-kb-file.json> [output-v2-file.json]');
    console.error('       node migrate_v1_to_v2.js --self-check');
    process.exit(1);
  }

  if (!fs.existsSync(v1File)) {
    console.error(`ERROR: v1 KB file not found: ${v1File}`);
    process.exit(1);
  }

  let v1Data;
  try {
    const rawContent = fs.readFileSync(v1File, 'utf-8');
    v1Data = JSON.parse(rawContent);
  } catch (err) {
    console.error('ERROR: Failed to parse v1 JSON:', err.message);
    process.exit(1);
  }

  const migrator = new V1ToV2Migrator(v1Data);
  const v2Data = migrator.migrate();

  // Write output
  try {
    fs.writeFileSync(v2File, JSON.stringify(v2Data, null, 2), 'utf-8');
    console.log(`✅ Wrote v2 KB to: ${v2File}`);
  } catch (err) {
    console.error('ERROR: Failed to write v2 file:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { V1ToV2Migrator, runSelfCheck };
