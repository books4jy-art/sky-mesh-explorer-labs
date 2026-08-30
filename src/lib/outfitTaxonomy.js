export const CATEGORY_ORDER = ['Body', 'Feet', 'Hair', 'Face', 'Horn', 'Mask', 'Neck', 'Cape', 'Props'];

/**
 * `found` is the distinct set of categories actually present in the data.
 * Returns the CATEGORY_ORDER entries that appear in `found` (in that exact order),
 * followed by any category in `found` NOT in CATEGORY_ORDER, alphabetically.
 * Never drops one.
 */
export function orderCategories(found) {
  const foundSet = new Set(found);
  const ordered = CATEGORY_ORDER.filter((c) => foundSet.has(c));
  const extras = [...foundSet].filter((c) => !CATEGORY_ORDER.includes(c)).sort();
  return [...ordered, ...extras];
}

/** Returns just the categories in `found` that are NOT in CATEGORY_ORDER, alphabetically. */
export function extraCategories(found) {
  const foundSet = new Set(found);
  return [...foundSet].filter((c) => !CATEGORY_ORDER.includes(c)).sort();
}
