export function canonicalJson(value) {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return nested;
    return Object.fromEntries(Object.keys(nested).sort().map((key) => [key, nested[key]]));
  });
}

export function jsonValuesEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}
