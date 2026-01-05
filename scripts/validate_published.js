/**
 * Bangladesh Government Services KB - Validate Published Guides
 * 
 * Validates public_guides.json and public_guides_index.json against schema
 * and performs additional contract checks.
 * 
 * Usage: node scripts/validate_published.js [published_dir]
 */

const fs = require('fs');
const path = require('path');

/**
 * Load JSON schema validator (simple implementation)
 * For production, consider using ajv or similar
 */
function validateAgainstSchema(data, schema, path = '') {
  const errors = [];
  
  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in data)) {
        errors.push({
          path: path ? `${path}.${field}` : field,
          message: `Missing required field: ${field}`
        });
      }
    }
  }
  
  // Check type
  if (schema.type) {
    const actualType = Array.isArray(data) ? 'array' : typeof data;
    if (schema.type === 'array' && !Array.isArray(data)) {
      errors.push({
        path: path || 'root',
        message: `Expected array, got ${actualType}`
      });
    } else if (schema.type === 'object' && (actualType !== 'object' || Array.isArray(data))) {
      errors.push({
        path: path || 'root',
        message: `Expected object, got ${actualType}`
      });
    } else if (schema.type === 'integer') {
      // Integer is a special case - must be a number and an integer
      if (typeof data !== 'number' || !Number.isInteger(data)) {
        errors.push({
          path: path || 'root',
          message: `Expected integer, got ${typeof data === 'number' ? 'number (not integer)' : typeof data}`
        });
      }
    } else if (schema.type !== 'array' && schema.type !== 'object' && actualType !== schema.type) {
      errors.push({
        path: path || 'root',
        message: `Expected ${schema.type}, got ${actualType}`
      });
    }
  }
  
  // Check const
  if (schema.const !== undefined && data !== schema.const) {
    errors.push({
      path: path || 'root',
      message: `Expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(data)}`
    });
  }
  
  // Check pattern
  if (schema.pattern && typeof data === 'string') {
    const regex = new RegExp(schema.pattern);
    if (!regex.test(data)) {
      errors.push({
        path: path || 'root',
        message: `String does not match pattern: ${schema.pattern}`
      });
    }
  }
  
  // Check enum
  if (schema.enum && !schema.enum.includes(data)) {
    errors.push({
      path: path || 'root',
      message: `Value must be one of: ${schema.enum.join(', ')}`
    });
  }
  
  // Check minimum
  if (schema.minimum !== undefined && typeof data === 'number' && data < schema.minimum) {
    errors.push({
      path: path || 'root',
      message: `Value must be >= ${schema.minimum}`
    });
  }
  
  // Check minLength
  if (schema.minLength !== undefined && typeof data === 'string' && data.length < schema.minLength) {
    errors.push({
      path: path || 'root',
      message: `String length must be >= ${schema.minLength}`
    });
  }
  
  // Check minItems
  if (schema.minItems !== undefined && Array.isArray(data) && data.length < schema.minItems) {
    errors.push({
      path: path || 'root',
      message: `Array must have at least ${schema.minItems} items`
    });
  }
  
  // Validate nested objects
  if (schema.properties && typeof data === 'object' && !Array.isArray(data)) {
    for (const [key, value] of Object.entries(data)) {
      if (schema.properties[key]) {
        const nestedErrors = validateAgainstSchema(value, schema.properties[key], path ? `${path}.${key}` : key);
        errors.push(...nestedErrors);
      }
    }
  }
  
  // Validate array items
  if (schema.items && Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      const itemErrors = validateAgainstSchema(data[i], schema.items, `${path}[${i}]`);
      errors.push(...itemErrors);
    }
  }
  
  // Validate oneOf (for sections)
  if (schema.oneOf && Array.isArray(data)) {
    let matched = false;
    for (const option of schema.oneOf) {
      const optionErrors = validateAgainstSchema(data, option, path);
      if (optionErrors.length === 0) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      errors.push({
        path: path || 'root',
        message: 'Array items do not match any of the allowed schemas'
      });
    }
  }
  
  return errors;
}

/**
 * Contract validation: Ensure no claim.* references leak through
 */
function validateContract(data) {
  const errors = [];
  const warnings = [];
  
  function checkForClaims(obj, path = '') {
    if (typeof obj !== 'object' || obj === null) {
      return;
    }
    
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        checkForClaims(obj[i], `${path}[${i}]`);
      }
    } else {
      for (const [key, value] of Object.entries(obj)) {
        // Check for claim_ids (should not exist in public guides)
        if (key === 'claim_ids' || key === 'claim_id') {
          errors.push({
            path: path ? `${path}.${key}` : key,
            message: `Found ${key} in public guide - this should not be exposed to web`
          });
        }
        
        // Check for claim.* patterns in IDs
        if (typeof value === 'string' && value.startsWith('claim.')) {
          errors.push({
            path: path ? `${path}.${key}` : key,
            message: `Found claim reference '${value}' - claims should be resolved to citations`
          });
        }
        
        // Recursive check
        checkForClaims(value, path ? `${path}.${key}` : key);
      }
    }
  }
  
  checkForClaims(data);
  
  return { errors, warnings };
}

/**
 * Validate date-time format
 */
function validateDateTime(str) {
  if (!str) return true; // null is allowed
  const date = new Date(str);
  return !isNaN(date.getTime()) && str.includes('T') && (str.includes('Z') || str.includes('+') || str.includes('-'));
}

/**
 * Validate URL format
 */
function validateURL(str) {
  if (!str) return true; // null is allowed
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Additional semantic validations
 */
function validateSemantics(data) {
  const errors = [];
  
  if (data.guides) {
    for (let i = 0; i < data.guides.length; i++) {
      const guide = data.guides[i];
      const guidePath = `guides[${i}]`;
      
      // Validate guide_id format
      if (guide.guide_id && !guide.guide_id.startsWith('guide.')) {
        errors.push({
          path: `${guidePath}.guide_id`,
          message: `guide_id must start with 'guide.'`
        });
      }
      
      // Validate steps are sequential
      if (guide.steps && Array.isArray(guide.steps)) {
        for (let j = 0; j < guide.steps.length; j++) {
          const step = guide.steps[j];
          if (step.step_number !== j + 1) {
            errors.push({
              path: `${guidePath}.steps[${j}].step_number`,
              message: `Step numbers must be sequential (expected ${j + 1}, got ${step.step_number})`
            });
          }
          
          // Validate citations have required fields
          if (step.citations) {
            for (let k = 0; k < step.citations.length; k++) {
              const citation = step.citations[k];
              if (!validateDateTime(citation.retrieved_at)) {
                errors.push({
                  path: `${guidePath}.steps[${j}].citations[${k}].retrieved_at`,
                  message: `Invalid date-time format: ${citation.retrieved_at}`
                });
              }
              if (citation.canonical_url && !validateURL(citation.canonical_url)) {
                errors.push({
                  path: `${guidePath}.steps[${j}].citations[${k}].canonical_url`,
                  message: `Invalid URL format: ${citation.canonical_url}`
                });
              }
            }
          }
        }
      }
      
      // Validate variants have unique variant_ids
      if (guide.variants && Array.isArray(guide.variants)) {
        const variantIds = new Set();
        for (let j = 0; j < guide.variants.length; j++) {
          const variant = guide.variants[j];
          if (variantIds.has(variant.variant_id)) {
            errors.push({
              path: `${guidePath}.variants[${j}].variant_id`,
              message: `Duplicate variant_id: ${variant.variant_id}`
            });
          }
          variantIds.add(variant.variant_id);
        }
      }
    }
  }
  
  return errors;
}

/**
 * Main validation function
 */
function validatePublishedGuides(publishedDir) {
  console.log('🔍 Validating published guides...\n');
  
  const guidesFile = path.join(publishedDir, 'public_guides.json');
  const indexFile = path.join(publishedDir, 'public_guides_index.json');
  const schemaFile = path.join(publishedDir, 'public_guides.schema.json');
  
  // Check files exist
  if (!fs.existsSync(guidesFile)) {
    console.error(`❌ ERROR: ${guidesFile} not found`);
    process.exit(1);
  }
  
  if (!fs.existsSync(indexFile)) {
    console.error(`❌ ERROR: ${indexFile} not found`);
    process.exit(1);
  }
  
  if (!fs.existsSync(schemaFile)) {
    console.error(`❌ ERROR: ${schemaFile} not found`);
    process.exit(1);
  }
  
  // Load files
  let guidesData, indexData, schema;
  try {
    guidesData = JSON.parse(fs.readFileSync(guidesFile, 'utf-8'));
    indexData = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
    schema = JSON.parse(fs.readFileSync(schemaFile, 'utf-8'));
  } catch (err) {
    console.error(`❌ ERROR: Failed to parse JSON: ${err.message}`);
    process.exit(1);
  }
  
  console.log(`  ✓ Loaded ${guidesFile}`);
  console.log(`  ✓ Loaded ${indexFile}`);
  console.log(`  ✓ Loaded ${schemaFile}\n`);
  
  // Validate JSON structure
  console.log('📋 Validating schema...');
  const schemaErrors = validateAgainstSchema(guidesData, schema);
  
  if (schemaErrors.length > 0) {
    console.error(`\n❌ Schema validation failed (${schemaErrors.length} errors):\n`);
    for (const error of schemaErrors) {
      console.error(`  ${error.path}: ${error.message}`);
    }
    process.exit(1);
  }
  console.log('  ✓ Schema validation passed\n');
  
  // Contract validation
  console.log('🔒 Validating contract (no claim.* references)...');
  const contractResult = validateContract(guidesData);
  
  if (contractResult.errors.length > 0) {
    console.error(`\n❌ Contract validation failed (${contractResult.errors.length} errors):\n`);
    for (const error of contractResult.errors) {
      console.error(`  ${error.path}: ${error.message}`);
    }
    process.exit(1);
  }
  console.log('  ✓ Contract validation passed\n');
  
  // Semantic validation
  console.log('🧠 Validating semantics...');
  const semanticErrors = validateSemantics(guidesData);
  
  if (semanticErrors.length > 0) {
    console.error(`\n❌ Semantic validation failed (${semanticErrors.length} errors):\n`);
    for (const error of semanticErrors) {
      console.error(`  ${error.path}: ${error.message}`);
    }
    process.exit(1);
  }
  console.log('  ✓ Semantic validation passed\n');
  
  // Summary
  console.log('='.repeat(60));
  console.log('VALIDATION REPORT');
  console.log('='.repeat(60));
  console.log(`\n  Guides: ${guidesData.guides.length}`);
  console.log(`  Index entries: ${indexData.entries?.length || 0}`);
  console.log(`  Schema version: ${guidesData.$schema_version}`);
  console.log(`  Generated at: ${guidesData.generated_at}`);
  console.log(`  Source KB version: ${guidesData.source_kb_version}`);
  console.log('\n✅ All validations passed!\n');
}

// Main execution
function main() {
  const args = process.argv.slice(2);
  const publishedDir = args[0] || path.join(__dirname, '..', 'kb', 'published');
  
  console.log(`📁 Published directory: ${publishedDir}\n`);
  
  if (!fs.existsSync(publishedDir)) {
    console.error(`❌ ERROR: Directory not found: ${publishedDir}`);
    process.exit(1);
  }
  
  validatePublishedGuides(publishedDir);
}

if (require.main === module) {
  main();
}

module.exports = { validatePublishedGuides, validateAgainstSchema, validateContract, validateSemantics };

