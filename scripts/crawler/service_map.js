/**
 * Service Mapping Helper
 * 
 * Maps seed domains to canonical service IDs.
 * Ensures consistent service_id derivation across the crawl pipeline.
 * 
 * @module crawler/service_map
 */

'use strict';

// ============================================================================
// DOMAIN TO SERVICE ID MAPPING
// ============================================================================

/**
 * Canonical mapping from seed domains (stripped of www.) to service IDs.
 * 
 * Service IDs follow the pattern: svc.<service_slug>
 * The service slug is the canonical name without www. or domain suffix.
 */
const DOMAIN_TO_SERVICE_MAP = {
  // ePassport services
  'epassport.gov.bd': 'svc.epassport',
  
  // NID services (Election Commission)
  'nidw.gov.bd': 'svc.nid',
  'services.nidw.gov.bd': 'svc.nid',
  
  // Passport services (DIP)
  'passport.gov.bd': 'svc.passport',
  'dip.gov.bd': 'svc.passport',
  'visa.gov.bd': 'svc.visa',
  
  // Tax services (NBR)
  'etaxnbr.gov.bd': 'svc.etax',
  'nbr.gov.bd': 'svc.nbr',
  'customs.gov.bd': 'svc.customs',
  
  // Transport services (BRTA)
  'bsp.brta.gov.bd': 'svc.brta',
  'brta.gov.bd': 'svc.brta',
  
  // Post Office
  'bdpost.gov.bd': 'svc.bdpost',
  
  // Land services
  'landadministration.gov.bd': 'svc.land',
  'land.gov.bd': 'svc.land',
  
  // Teletalk
  'teletalk.com.bd': 'svc.teletalk',
  
  // Birth/Death registration
  'bdris.gov.bd': 'svc.bdris',
  
  // Police
  'police.gov.bd': 'svc.police',
};

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Get the canonical service ID for a given seed domain.
 * 
 * @param {string} domain - Domain to look up (e.g., 'www.epassport.gov.bd' or 'epassport.gov.bd')
 * @returns {string|null} - Canonical service ID (e.g., 'svc.epassport') or null if not found
 * 
 * @example
 * getServiceIdForSeedDomain('www.epassport.gov.bd')  // => 'svc.epassport'
 * getServiceIdForSeedDomain('epassport.gov.bd')      // => 'svc.epassport'
 * getServiceIdForSeedDomain('unknown.gov.bd')        // => null
 */
function getServiceIdForSeedDomain(domain) {
  if (!domain || typeof domain !== 'string') {
    return null;
  }
  
  // Normalize: lowercase and strip leading www.
  const normalized = domain.toLowerCase().replace(/^www\./, '');
  
  // Direct lookup
  if (DOMAIN_TO_SERVICE_MAP[normalized]) {
    return DOMAIN_TO_SERVICE_MAP[normalized];
  }
  
  // Not found in map
  return null;
}

/**
 * Derive a service key (slug) from a domain for use in claim IDs.
 * 
 * This is used when a domain is not in the canonical map.
 * Falls back to stripping the gov.bd/com.bd suffix and replacing dots with underscores.
 * 
 * @param {string} domain - Domain to derive key from
 * @returns {string} - Service key suitable for claim IDs
 * 
 * @example
 * deriveServiceKeyFromDomain('www.epassport.gov.bd')  // => 'epassport'
 * deriveServiceKeyFromDomain('unknown.gov.bd')        // => 'unknown'
 */
function deriveServiceKeyFromDomain(domain) {
  if (!domain || typeof domain !== 'string') {
    return 'unknown';
  }
  
  // Normalize: lowercase and strip leading www.
  const normalized = domain.toLowerCase().replace(/^www\./, '');
  
  // Strip gov.bd / com.bd suffix
  const stripped = normalized
    .replace(/\.gov\.bd$/i, '')
    .replace(/\.com\.bd$/i, '')
    .replace(/\.org\.bd$/i, '');
  
  // Replace dots with underscores (for subdomains)
  return stripped.replace(/\./g, '_');
}

/**
 * Get service ID from domain, falling back to derived ID if not in map.
 * 
 * @param {string} domain - Domain to look up
 * @returns {string} - Service ID (canonical if found, otherwise derived)
 * 
 * @example
 * getServiceIdOrDerive('www.epassport.gov.bd')  // => 'svc.epassport' (from map)
 * getServiceIdOrDerive('unknown.gov.bd')        // => 'svc.unknown' (derived)
 */
function getServiceIdOrDerive(domain) {
  const canonical = getServiceIdForSeedDomain(domain);
  if (canonical) {
    return canonical;
  }
  
  // Derive from domain
  const key = deriveServiceKeyFromDomain(domain);
  return `svc.${key}`;
}

/**
 * Extract the service key (slug) from a service ID.
 * 
 * @param {string} serviceId - Service ID (e.g., 'svc.epassport')
 * @returns {string} - Service key (e.g., 'epassport')
 */
function getServiceKeyFromId(serviceId) {
  if (!serviceId || typeof serviceId !== 'string') {
    return 'unknown';
  }
  
  // Strip svc. prefix
  if (serviceId.startsWith('svc.')) {
    return serviceId.substring(4);
  }
  
  return serviceId;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Core functions
  getServiceIdForSeedDomain,
  deriveServiceKeyFromDomain,
  getServiceIdOrDerive,
  getServiceKeyFromId,
  
  // Export the map for inspection/testing
  DOMAIN_TO_SERVICE_MAP,
};

