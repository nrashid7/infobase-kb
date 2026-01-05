/**
 * Structured Data Extraction Module
 * 
 * Extracts structured data (steps, fees, documents, FAQs) from page content.
 * Enhanced for Bengali content and various page formats.
 * 
 * @module crawler/extraction
 */

const path = require('path');
const { URL } = require('url');

// Import shared utilities
const { getDomain, makeDeterministicClaimId } = require('./utils');

// Import service mapping
const { getServiceIdOrDerive, getServiceKeyFromId } = require('./service_map');

// Document extensions to harvest
const DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'];

// Bengali numerals mapping
const BENGALI_NUMERALS = {
  '০': 0, '১': 1, '২': 2, '৩': 3, '৪': 4,
  '৫': 5, '৬': 6, '৭': 7, '৮': 8, '৯': 9,
};

// Bengali step/instruction markers
const BENGALI_STEP_MARKERS = [
  /^ধাপ\s*[-:\s]*(\d+|[০-৯]+)/i,       // "ধাপ 1" or "ধাপ ১"
  /^পর্যায়\s*[-:\s]*(\d+|[০-৯]+)/i,    // "পর্যায় 1"
  /^পদ্ধতি\s*[-:\s]*(\d+|[০-৯]+)/i,    // "পদ্ধতি 1"
  /^([০-৯]+)[.)।:]\s*/,                 // Bengali numeral at start: ১) or ১.
  /^প্রথমে\b/i,                         // "প্রথমে" (first)
  /^এরপর\b/i,                           // "এরপর" (then)
  /^অতঃপর\b/i,                          // "অতঃপর" (afterwards)
  /^শেষে\b/i,                           // "শেষে" (finally)
];

// Bengali imperative verb patterns (instructions)
const BENGALI_IMPERATIVE_PATTERNS = [
  /করুন\s*[।\.]*$/,                     // "করুন" (do)
  /যান\s*[।\.]*$/,                      // "যান" (go)
  /দিন\s*[।\.]*$/,                      // "দিন" (give)
  /নিন\s*[।\.]*$/,                      // "নিন" (take)
  /আবেদন\s*করুন/,                       // "আবেদন করুন" (apply)
  /পূরণ\s*করুন/,                        // "পূরণ করুন" (fill out)
  /জমা\s*দিন/,                          // "জমা দিন" (submit)
  /সংগ্রহ\s*করুন/,                      // "সংগ্রহ করুন" (collect)
  /প্রদান\s*করুন/,                      // "প্রদান করুন" (provide/pay)
  /যাচাই\s*করুন/,                       // "যাচাই করুন" (verify)
  /ক্লিক\s*করুন/,                       // "ক্লিক করুন" (click)
  /নির্বাচন\s*করুন/,                    // "নির্বাচন করুন" (select)
  /আপলোড\s*করুন/,                       // "আপলোড করুন" (upload)
  /ডাউনলোড\s*করুন/,                     // "ডাউনলোড করুন" (download)
];

// English imperative/action patterns
const ENGLISH_ACTION_PATTERNS = [
  /\b(apply|submit|visit|collect|pay|fill|upload|click|download|select|enter|verify|check|go\s+to|log\s*in|sign\s*in|register|create|complete|provide|attach)\b/i,
];

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert Bengali numeral string to number
 * @param {string} str - String possibly containing Bengali numerals
 * @returns {number} - Converted number or NaN
 */
function parseBengaliNumber(str) {
  if (!str) return NaN;
  
  // Convert Bengali numerals to Arabic
  let converted = str.replace(/[০-৯]/g, (d) => BENGALI_NUMERALS[d] ?? d);
  
  // Remove commas and parse
  converted = converted.replace(/,/g, '');
  return parseFloat(converted);
}

/**
 * Check if text contains Bengali script
 * @param {string} text - Text to check
 * @returns {boolean}
 */
function containsBengali(text) {
  return /[\u0980-\u09FF]/.test(text);
}

/**
 * Detect if a line looks like an instruction/step
 * @param {string} line - Line to check
 * @returns {{isStep: boolean, order: number|null, marker: string|null}}
 */
function detectStepLine(line) {
  const trimmed = line.trim();
  
  // Check numbered lists: 1. 2. 3. or 1) 2) 3)
  const orderedMatch = trimmed.match(/^(\d+)[.):]\s*(.+)/);
  if (orderedMatch && parseInt(orderedMatch[1]) > 0) {
    return { isStep: true, order: parseInt(orderedMatch[1]), marker: 'ordered_list' };
  }
  
  // Check Bengali numeral lists: ১. ২. ৩.
  const bengaliOrderedMatch = trimmed.match(/^([০-৯]+)[.)।:]\s*(.+)/);
  if (bengaliOrderedMatch) {
    const order = parseBengaliNumber(bengaliOrderedMatch[1]);
    if (!isNaN(order) && order > 0) {
      return { isStep: true, order: order, marker: 'bengali_ordered' };
    }
  }
  
  // Check Bengali step markers: ধাপ, পর্যায়
  for (const pattern of BENGALI_STEP_MARKERS) {
    if (pattern.test(trimmed)) {
      const numMatch = trimmed.match(/(\d+|[০-৯]+)/);
      const order = numMatch ? parseBengaliNumber(numMatch[1]) : null;
      return { isStep: true, order: order, marker: 'bengali_step_marker' };
    }
  }
  
  // Check bullet points with imperative content
  const bulletMatch = trimmed.match(/^[-•–*]\s*(.+)/);
  if (bulletMatch) {
    const content = bulletMatch[1];
    // Check for imperative verbs (Bengali or English)
    const hasImperative = BENGALI_IMPERATIVE_PATTERNS.some(p => p.test(content)) ||
                          ENGLISH_ACTION_PATTERNS.some(p => p.test(content));
    if (hasImperative) {
      return { isStep: true, order: null, marker: 'bullet_imperative' };
    }
  }
  
  // Check for imperative sentences without markers (Bengali)
  if (containsBengali(trimmed) && BENGALI_IMPERATIVE_PATTERNS.some(p => p.test(trimmed))) {
    return { isStep: true, order: null, marker: 'bengali_imperative' };
  }
  
  return { isStep: false, order: null, marker: null };
}

// ============================================================================
// PAGE CLASSIFICATION
// ============================================================================

const PAGE_TYPES = {
  tutorial: /tutorial|guide|how[-_]?to|instruction|step[-_]?by[-_]?step/i,
  procedure: /procedure|process|apply|application|steps?/i,
  faq: /faq|frequently[-_]?asked|questions?|help/i,
  requirements: /requirement|document|eligibility|criterion|criteria/i,
  fees: /fees?|payment|charge|cost|price|tariff/i,
  processing_time: /processing[-_]?time|duration|delivery|turnaround/i,
  portal: /portal|login|register|account|dashboard/i,
  office: /office|location|address|branch|center|centre/i,
  contact: /contact|helpline|hotline|support|customer[-_]?service/i,
  form: /form|download|template/i,
};

/**
 * Classify a page based on URL, title, and content
 * @param {string} url - Page URL
 * @param {string} [title=''] - Page title
 * @param {string} [content=''] - Page content
 * @returns {string[]} - Array of page type classifications
 */
function classifyPage(url, title = '', content = '') {
  const combined = `${url} ${title} ${content}`.toLowerCase();
  const types = [];
  
  for (const [type, pattern] of Object.entries(PAGE_TYPES)) {
    if (pattern.test(combined)) {
      types.push(type);
    }
  }
  
  if (types.length === 0) {
    types.push('general');
  }
  
  return types;
}

// ============================================================================
// STRUCTURED DATA EXTRACTION
// ============================================================================

/**
 * Resolve a relative URL against a base URL
 * @param {string} baseUrl - Base URL
 * @param {string} relativeUrl - Relative URL
 * @returns {string} - Resolved absolute URL
 */
function resolveUrl(baseUrl, relativeUrl) {
  try {
    return new URL(relativeUrl, baseUrl).href;
  } catch (e) {
    return relativeUrl;
  }
}

/**
 * Extract steps from markdown using enhanced detection
 * @param {string[]} lines - Array of lines
 * @param {string[]} currentHeadingPath - Current heading context
 * @param {string} url - Page URL for citations
 * @returns {Array<{order: number, title: string, description: string, headingPath: string[], lineNumber: number}>}
 */
function extractSteps(lines, currentHeadingPathFn, url) {
  const steps = [];
  let autoOrder = 1;
  let currentHeading = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Track headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].replace(/\*\*/g, '').trim();
      currentHeading = currentHeading.slice(0, level - 1);
      currentHeading.push(text);
      continue;
    }
    
    // Detect step lines
    const stepInfo = detectStepLine(line);
    if (stepInfo.isStep && line.length > 5) {
      // Extract the text content without the marker
      let text = line;
      // Remove numbered prefix
      text = text.replace(/^\d+[.):]?\s*/, '');
      // Remove Bengali numbered prefix
      text = text.replace(/^[০-৯]+[.)।:]?\s*/, '');
      // Remove bullet markers
      text = text.replace(/^[-•–*]\s*/, '');
      // Remove step word markers
      text = text.replace(/^(ধাপ|পর্যায়|পদ্ধতি)\s*[-:\s]*(\d+|[০-৯]+)?\s*/i, '');
      text = text.trim();
      
      if (text.length < 5) continue;
      
      // Determine title and description
      const firstSentenceMatch = text.match(/^([^।.!?]+[।.!?]?)/);
      const title = firstSentenceMatch ? firstSentenceMatch[1].trim() : text.slice(0, 100);
      const description = text.length > title.length ? text : '';
      
      steps.push({
        order: stepInfo.order || autoOrder++,
        title: title.slice(0, 150),
        description: description.slice(0, 500),
        text: text,
        headingPath: [...currentHeading],
        lineNumber: i + 1,
        marker: stepInfo.marker,
      });
    }
  }
  
  // Re-order steps if we have gaps (e.g., 1, 2, 5 -> 1, 2, 3)
  steps.sort((a, b) => a.order - b.order);
  for (let i = 0; i < steps.length; i++) {
    steps[i].order = i + 1;
  }
  
  return steps;
}

/**
 * Extract fees from markdown with BDT pattern detection
 * @param {string[]} lines - Array of lines
 * @param {string[]} currentHeadingPath - Current heading context
 * @returns {Array<{amount_bdt: number, label: string, variant: string|null, text: string, headingPath: string[]}>}
 */
function extractFees(lines, currentHeadingPathFn) {
  const fees = [];
  let currentHeading = [];
  let currentVariant = null;
  
  // Variant detection patterns (simple, non-global)
  // Order matters: check more specific patterns first
  const variantPatterns = [
    ['super_express', /\bsuper[-\s]?express\b|\bসুপার\s*এক্সপ্রেস\b/i],
    ['emergency', /\b(emergency|urgent|জরুরি|তাৎক্ষণিক)\b/i],
    ['express', /\b(express|এক্সপ্রেস)\b/i],
    ['regular', /\b(regular|নিয়মিত|সাধারণ)\b/i],
  ];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Track headings and detect variant from headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].replace(/\*\*/g, '').trim();
      currentHeading = currentHeading.slice(0, level - 1);
      currentHeading.push(text);
      
      // Check if heading indicates a fee variant
      for (const [variant, pattern] of variantPatterns) {
        if (pattern.test(text)) {
          currentVariant = variant;
          break;
        }
      }
      continue;
    }
    
    // Detect variant from line content
    let lineVariant = currentVariant;
    for (const [variant, pattern] of variantPatterns) {
      if (pattern.test(line)) {
        lineVariant = variant;
        break;
      }
    }
    
    // Extract fees using simple patterns (avoid global regex with exec loop)
    const extractedAmounts = [];
    
    // Pattern 1: "1,000 BDT" or "1000 BDT" or "1,000 Taka" or "TK 4,025"
    const match1 = line.match(/(\d{1,7}(?:,\d{3})*)\s*(BDT|Taka|টাকা|TK)/i);
    if (match1) {
      extractedAmounts.push(match1[1]);
    }
    
    // Pattern 2: "৳1,000" or "৳ 1000"
    const match2 = line.match(/৳\s*(\d{1,7}(?:,\d{3})*)/);
    if (match2) {
      extractedAmounts.push(match2[1]);
    }
    
    // Pattern 3: "BDT 1,000" or "TK 4,025"
    const match3 = line.match(/\b(?:BDT|Taka|টাকা|TK)\s*(\d{1,7}(?:,\d{3})*)/i);
    if (match3 && !match1) {  // Avoid duplicate
      extractedAmounts.push(match3[1]);
    }
    
    // Pattern 4: Bengali numbers "৳৩,৪৫০" 
    const match4 = line.match(/৳\s*([০-৯]{1,7}(?:,[০-৯]{3})*)/);
    if (match4) {
      extractedAmounts.push(match4[1]);
    }
    
    // Pattern 5: "৩৪৫০ টাকা"
    const match5 = line.match(/([০-৯]{1,7}(?:,[০-৯]{3})*)\s*টাকা/);
    if (match5) {
      extractedAmounts.push(match5[1]);
    }
    
    // Process extracted amounts
    for (const amountStr of extractedAmounts) {
      const amount = parseBengaliNumber(amountStr);
      
      // Skip invalid amounts
      if (isNaN(amount) || amount <= 0 || amount > 10000000) continue;
      
      // Avoid duplicates in this line
      if (fees.some(f => f.lineNumber === i + 1 && f.amount_bdt === amount)) continue;
      
      // Try to extract a label from the line
      let label = line
        .replace(/[\d,০-৯]+\s*(BDT|Taka|টাকা|৳)/gi, '')
        .replace(/৳\s*[\d,০-৯]+/g, '')
        .replace(/[:\-–|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);
      
      if (label.length < 3) {
        // Use heading as label
        label = currentHeading.length > 0 ? currentHeading[currentHeading.length - 1] : 'Fee';
      }
      
      fees.push({
        amount_bdt: amount,
        label: label,
        variant: lineVariant,
        currency: 'BDT',
        text: line.slice(0, 200),
        headingPath: [...currentHeading],
        lineNumber: i + 1,
      });
    }
  }
  
  return fees;
}

/**
 * Extract FAQ pairs from markdown
 * @param {string[]} lines - Array of lines
 * @returns {Array<{question: string, answer: string, headingPath: string[]}>}
 */
function extractFAQs(lines) {
  const faqs = [];
  let currentHeading = [];
  
  // Q/A format patterns
  const qPatterns = [
    /^Q[.:]?\s*/i,
    /^Question[.:]?\s*/i,
    /^প্রশ্ন[.:]?\s*/,
  ];
  
  const aPatterns = [
    /^A[.:]?\s*/i,
    /^Answer[.:]?\s*/i,
    /^উত্তর[.:]?\s*/,
  ];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Track headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].replace(/\*\*/g, '').trim();
      currentHeading = currentHeading.slice(0, level - 1);
      currentHeading.push(text);
      
      // Check if heading is a question (ends with ?)
      if (text.endsWith('?') || text.endsWith('?')) {
        // Look for answer in following paragraphs
        let answer = '';
        for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
          const answerLine = lines[j].trim();
          // Stop at next heading
          if (/^#{1,6}\s/.test(answerLine)) break;
          // Stop at empty line after we have some content
          if (!answerLine && answer.length > 50) break;
          if (answerLine) {
            answer += (answer ? ' ' : '') + answerLine;
          }
        }
        
        if (answer.length > 10) {
          faqs.push({
            question: text,
            answer: answer.slice(0, 1000),
            headingPath: currentHeading.slice(0, -1),
            lineNumber: i + 1,
          });
        }
      }
      continue;
    }
    
    // Check for Q: / A: format
    for (const qPattern of qPatterns) {
      if (qPattern.test(line)) {
        const question = line.replace(qPattern, '').trim();
        
        // Look for answer
        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
          const answerLine = lines[j].trim();
          for (const aPattern of aPatterns) {
            if (aPattern.test(answerLine)) {
              const answer = answerLine.replace(aPattern, '').trim();
              if (question.length > 5 && answer.length > 5) {
                faqs.push({
                  question: question,
                  answer: answer.slice(0, 1000),
                  headingPath: [...currentHeading],
                  lineNumber: i + 1,
                });
              }
              break;
            }
          }
        }
        break;
      }
    }
    
    // Check for Bengali question markers in list items
    if (/^[-•*]\s*/.test(line)) {
      const content = line.replace(/^[-•*]\s*/, '').trim();
      // If it's a link to an FAQ
      const linkMatch = content.match(/\[([^\]]+\?[^\]]*)\]\(([^)]+)\)/);
      if (linkMatch) {
        faqs.push({
          question: linkMatch[1],
          answer: null, // Answer is on linked page
          link: linkMatch[2],
          headingPath: [...currentHeading],
          lineNumber: i + 1,
        });
      }
    }
  }
  
  return faqs;
}

/**
 * Extract document links with enhanced detection
 * @param {string} markdown - Page markdown
 * @param {string} html - Page HTML (optional)
 * @param {string} url - Page URL for resolving relative links
 * @returns {Array<{text: string, url: string, extension: string, discoveryMethod: string}>}
 */
function extractDocumentLinks(markdown, html, url) {
  const documents = [];
  const seenUrls = new Set();
  
  function addDocument(text, docUrl, method) {
    const normalizedUrl = resolveUrl(url, docUrl);
    if (seenUrls.has(normalizedUrl)) return;
    
    // Get extension
    let ext = '';
    try {
      const urlPath = new URL(normalizedUrl).pathname;
      ext = path.extname(urlPath).toLowerCase();
    } catch (e) {
      // URL parse failed, try to extract from string
      const extMatch = docUrl.match(/\.(pdf|docx?|xlsx?|pptx?)(\?|$)/i);
      if (extMatch) ext = '.' + extMatch[1].toLowerCase();
    }
    
    // Check if it's a document extension or a download pattern
    const isDocExt = DOCUMENT_EXTENSIONS.includes(ext);
    const isDownloadPattern = /download|attachment|file|document/i.test(normalizedUrl) ||
                              /[?&](id|file|doc|attachment)=/i.test(normalizedUrl);
    
    if (isDocExt || (isDownloadPattern && !ext)) {
      seenUrls.add(normalizedUrl);
      documents.push({
        text: text.slice(0, 200),
        url: normalizedUrl,
        extension: ext || '.unknown',
        discoveryMethod: method,
      });
    }
  }
  
  // 1. Extract markdown links: [text](url)
  const mdLinkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = mdLinkPattern.exec(markdown)) !== null) {
    addDocument(match[1], match[2], 'markdown_link');
  }
  
  // 2. Extract bare URLs ending in document extensions
  const bareUrlPattern = /(https?:\/\/[^\s<>"]+\.(pdf|docx?|xlsx?|pptx?)(\?[^\s<>"]*)?)/gi;
  while ((match = bareUrlPattern.exec(markdown)) !== null) {
    addDocument(match[0], match[1], 'bare_url');
  }
  
  // 3. Extract from HTML if provided
  if (html) {
    // Extract href attributes
    const hrefPattern = /href=["']([^"']+\.(pdf|docx?|xlsx?|pptx?)(\?[^"']*)?)/gi;
    while ((match = hrefPattern.exec(html)) !== null) {
      addDocument('Document link', match[1], 'html_href');
    }
    
    // Extract download patterns from HTML
    const downloadPattern = /href=["']([^"']*(?:download|attachment|file)[^"']*)["']/gi;
    while ((match = downloadPattern.exec(html)) !== null) {
      if (!match[1].endsWith('.js') && !match[1].endsWith('.css')) {
        addDocument('Download link', match[1], 'html_download');
      }
    }
    
    // Extract PHP download links
    const phpDownloadPattern = /href=["']([^"']*\.php\?[^"']*(?:id|file|doc)=[^"']*)["']/gi;
    while ((match = phpDownloadPattern.exec(html)) !== null) {
      addDocument('Download', match[1], 'php_download');
    }
  }
  
  return documents;
}

/**
 * Extract structured data from markdown content (main entry point)
 * @param {string} markdown - Page markdown content
 * @param {string} url - Page URL for resolving relative links
 * @param {string} [html=''] - Page HTML for enhanced document detection
 * @returns {{steps: Array, feeTable: Array, documentList: Array, faqPairs: Array, headings: Array, stats: Object}}
 */
function extractStructuredData(markdown, url, html = '') {
  const result = {
    steps: [],
    feeTable: [],
    documentList: [],
    faqPairs: [],
    headings: [],
    stats: {
      steps_extracted: 0,
      fees_extracted: 0,
      faq_pairs_extracted: 0,
      doc_links_found: 0,
    },
  };
  
  if (!markdown) return result;
  
  const lines = markdown.split('\n');
  let currentHeading = [];
  
  // Track all headings
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].replace(/\*\*/g, '').trim();
      currentHeading = currentHeading.slice(0, level - 1);
      currentHeading.push(text);
      result.headings.push({ level, text, path: [...currentHeading], lineNumber: i + 1 });
    }
  }
  
  // Extract steps
  result.steps = extractSteps(lines, () => currentHeading, url);
  result.stats.steps_extracted = result.steps.length;
  
  // Extract fees
  result.feeTable = extractFees(lines, () => currentHeading);
  result.stats.fees_extracted = result.feeTable.length;
  
  // Extract FAQs
  result.faqPairs = extractFAQs(lines);
  result.stats.faq_pairs_extracted = result.faqPairs.length;
  
  // Extract documents
  result.documentList = extractDocumentLinks(markdown, html, url);
  result.stats.doc_links_found = result.documentList.length;
  
  return result;
}

/**
 * Create a citation object
 * @param {string} sourcePageId - Source page ID
 * @param {string} url - Page URL
 * @param {string} quotedText - Text being cited
 * @param {string[]} headingPath - Heading context
 * @param {string} language - 'en' or 'bn'
 * @returns {Object} - Citation object
 */
function createCitation(sourcePageId, url, quotedText, headingPath, language) {
  return {
    source_page_id: sourcePageId,
    canonical_url: url,
    quoted_text: (quotedText || '').slice(0, 300),
    locator: {
      type: 'heading_path',
      heading_path: headingPath.length > 0 ? headingPath : ['Page Content'],
    },
    retrieved_at: new Date().toISOString(),
    language: language || (/[\u0980-\u09FF]/.test(quotedText || '') ? 'bn' : 'en'),
  };
}

/**
 * Extract claims from page content
 * @param {string} markdown - Page markdown
 * @param {string} sourcePageId - Source page ID
 * @param {string} url - Page URL
 * @param {Object} structuredData - Extracted structured data
 * @param {Object} [options] - Optional extraction options
 * @param {string} [options.serviceId] - Override service ID (e.g., 'svc.epassport')
 * @returns {Array} - Array of claim objects
 */
function extractClaims(markdown, sourcePageId, url, structuredData, options = {}) {
  const claims = [];
  const domain = getDomain(url);
  
  // Determine service ID: use provided option, or derive from domain using canonical map
  const serviceId = options.serviceId || getServiceIdOrDerive(domain);
  const servicePrefix = getServiceKeyFromId(serviceId);
  
  // Extract fee claims
  for (const fee of structuredData.feeTable) {
    const payload = {
      amount_bdt: fee.amount_bdt,
      currency: 'BDT',
      variant: fee.variant,
      label: fee.label,
    };
    
    // Create locator from heading path and line number for determinism
    const locator = (fee.headingPath || []).join(' > ') + (fee.lineNumber ? `:${fee.lineNumber}` : '');
    
    claims.push({
      claim_id: makeDeterministicClaimId({
        type: 'fee',
        serviceKey: servicePrefix,
        canonicalUrl: url,
        locator: locator,
        payload: payload,
      }),
      entity_ref: { type: 'service', id: serviceId },
      claim_type: 'fee',
      text: fee.label,
      status: 'unverified',
      structured_data: payload,
      citations: [createCitation(sourcePageId, url, fee.text, fee.headingPath)],
      last_verified_at: new Date().toISOString(),
      tags: ['fee', 'auto_extracted', fee.variant].filter(Boolean),
    });
  }
  
  // Extract step claims - create individual claims for each step
  for (const step of structuredData.steps) {
    const payload = {
      order: step.order,
      title: step.title,
      description: step.description,
      marker_type: step.marker,
    };
    
    // Create locator from heading path and line number for determinism
    const locator = (step.headingPath || []).join(' > ') + (step.lineNumber ? `:${step.lineNumber}` : '');
    
    claims.push({
      claim_id: makeDeterministicClaimId({
        type: 'step',
        serviceKey: servicePrefix,
        canonicalUrl: url,
        locator: locator,
        payload: payload,
      }),
      entity_ref: { type: 'service', id: serviceId },
      claim_type: 'step',
      text: step.title,
      status: 'unverified',
      structured_data: payload,
      citations: [createCitation(sourcePageId, url, step.text, step.headingPath)],
      last_verified_at: new Date().toISOString(),
      tags: ['step', 'auto_extracted', containsBengali(step.text) ? 'bengali' : 'english'],
    });
  }
  
  // Extract document requirement claims
  for (const doc of structuredData.documentList) {
    const payload = {
      url: doc.url,
      text: doc.text,
      extension: doc.extension,
      discovery_method: doc.discoveryMethod,
    };
    
    claims.push({
      claim_id: makeDeterministicClaimId({
        type: 'document_requirement',
        serviceKey: servicePrefix,
        canonicalUrl: url,
        locator: '',
        payload: payload,
      }),
      entity_ref: { type: 'service', id: serviceId },
      claim_type: 'document_requirement',
      text: doc.text,
      status: 'unverified',
      structured_data: {
        url: doc.url,
        extension: doc.extension,
        discovery_method: doc.discoveryMethod,
      },
      citations: [createCitation(sourcePageId, url, doc.text, ['Page Content'])],
      last_verified_at: new Date().toISOString(),
      tags: ['document', 'download', 'auto_extracted'],
    });
  }
  
  // Extract FAQ claims
  for (const faq of structuredData.faqPairs) {
    const payload = {
      question: faq.question,
      answer: faq.answer,
      link: faq.link,
    };
    
    // Create locator from heading path and line number for determinism
    const locator = (faq.headingPath || []).join(' > ') + (faq.lineNumber ? `:${faq.lineNumber}` : '');
    
    claims.push({
      claim_id: makeDeterministicClaimId({
        type: 'faq',
        serviceKey: servicePrefix,
        canonicalUrl: url,
        locator: locator,
        payload: payload,
      }),
      entity_ref: { type: 'service', id: serviceId },
      claim_type: 'faq',
      text: faq.question,
      status: 'unverified',
      structured_data: payload,
      citations: [createCitation(sourcePageId, url, faq.question, faq.headingPath)],
      last_verified_at: new Date().toISOString(),
      tags: ['faq', 'auto_extracted', containsBengali(faq.question) ? 'bengali' : 'english'],
    });
  }
  
  return claims;
}

module.exports = {
  PAGE_TYPES,
  DOCUMENT_EXTENSIONS,
  BENGALI_NUMERALS,
  BENGALI_STEP_MARKERS,
  BENGALI_IMPERATIVE_PATTERNS,
  classifyPage,
  extractStructuredData,
  extractClaims,
  resolveUrl,
  getDomain,
  // Utility exports for testing
  parseBengaliNumber,
  containsBengali,
  detectStepLine,
  extractSteps,
  extractFees,
  extractFAQs,
  extractDocumentLinks,
  createCitation,
};
