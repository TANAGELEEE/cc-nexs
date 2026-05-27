#!/usr/bin/env node
// Lightweight JSON Schema validator for preset.yml / cc-nexs.config.yml / progress.md state.
// Avoid pulling in ajv to keep core dependency-free. Implements a subset of Draft-07 sufficient for our schemas.

import { readFileSync } from 'node:fs';

function validate(value, schema, path = '') {
  const errors = [];
  if (schema.type) {
    const ok = (() => {
      switch (schema.type) {
        case 'string': return typeof value === 'string';
        case 'integer': return Number.isInteger(value);
        case 'number': return typeof value === 'number';
        case 'boolean': return typeof value === 'boolean';
        case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
        case 'array': return Array.isArray(value);
        case 'null': return value === null;
        default:
          if (Array.isArray(schema.type)) {
            return schema.type.some((t) => validate(value, { type: t }, path).length === 0);
          }
          return true;
      }
    })();
    if (!ok) errors.push(`${path || '(root)'}: expected ${schema.type}, got ${Array.isArray(value) ? 'array' : typeof value}`);
  }
  if (schema.required && schema.type === 'object' && value && typeof value === 'object') {
    for (const k of schema.required) {
      if (!(k in value)) errors.push(`${path}.${k} is required`);
    }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: must be one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`);
  }
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${path}: does not match pattern ${schema.pattern}`);
  }
  if (schema.properties && typeof value === 'object' && value) {
    for (const [k, sub] of Object.entries(schema.properties)) {
      if (k in value) errors.push(...validate(value[k], sub, `${path}.${k}`));
    }
  }
  if (schema.items && Array.isArray(value)) {
    value.forEach((item, i) => errors.push(...validate(item, schema.items, `${path}[${i}]`)));
  }
  if (schema.minItems !== undefined && Array.isArray(value) && value.length < schema.minItems) {
    errors.push(`${path}: minItems ${schema.minItems}, got ${value.length}`);
  }
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , schemaPath, dataPath] = process.argv;
  if (!schemaPath || !dataPath) {
    console.error('Usage: validate-json.mjs <schema.json> <data.json>');
    process.exit(1);
  }
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  const data = JSON.parse(readFileSync(dataPath, 'utf-8'));
  const errors = validate(data, schema);
  if (errors.length === 0) {
    console.log('OK');
    process.exit(0);
  } else {
    errors.forEach((e) => console.error(e));
    process.exit(1);
  }
}

export { validate };
