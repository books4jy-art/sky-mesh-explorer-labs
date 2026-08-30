/**
 * Display-only grouping sort for Outfit Maker grid tiles.
 * Variants collapse to a base "group key" so similar names sit together.
 * @param {Array} items - OutfitIcon rows for a single category
 * @returns {Array} new sorted array (input is not mutated)
 */
export function sortItemsByGroupKey(items) {
  const COLOR_WORDS = ['white', 'black', 'red', 'blue', 'green', 'gold', 'silver', 'rainbow', 'dark', 'light'];
  const SIZE_WORDS = ['small', 'large', 'big'];

  const stripTrailingVariant = (name) => {
    let s = name.toLowerCase().trim();
    // strip trailing _01, _02, (B), "02", trailing numbers
    s = s.replace(/[_\s]*\(b\)/g, '');
    s = s.replace(/[_\s]*\d+$/g, '');
    s = s.replace(/[_\s]+$/g, '');
    s = s.trim();
    // strip trailing color words
    s = s.replace(/\s+(white|black|red|blue|green|gold|silver|rainbow|dark|light)\s*$/i, '');
    s = s.replace(/\s+(white|black|red|blue|green|gold|silver|rainbow|dark|light)\s*$/i, '');
    // strip trailing size words
    s = s.replace(/\s+(small|large|big)\s*$/i, '');
    s = s.trim();
    // strip trailing _01/_02 after color removal
    s = s.replace(/[_\s]*\d+$/g, '');
    s = s.replace(/[_\s]+$/g, '');
    return s.trim();
  };

  // Detect a leading AP<number> token (case-insensitive): "AP2", "AP02", "AP31".
  const AP_RE = /^(ap)(\d+)\b/i;
  const apInfo = (name) => {
    const m = (name || '').match(AP_RE);
    if (!m) return null;
    const num = parseInt(m[2], 10);
    const rest = (name || '').slice(m[0].length).replace(/^[_\s-]+/, '').toLowerCase();
    return { num, rest };
  };

  // Non-AP group key (existing similar-name grouping for non-AP rows only).
  const nonApGroupKey = (name) => {
    const base = stripTrailingVariant((name || '').toLowerCase());
    return base;
  };

  return [...items].sort((a, b) => {
    const ia = apInfo(a.name);
    const ib = apInfo(b.name);
    const na = (a.name || '').toLowerCase();
    const nb = (b.name || '').toLowerCase();

    if (ia && ib) {
      // AP block, ordered by AP number numerically, then by remaining name.
      if (ia.num !== ib.num) return ia.num - ib.num;
      if (ia.rest < ib.rest) return -1;
      if (ia.rest > ib.rest) return 1;
      if (na < nb) return -1;
      if (na > nb) return 1;
      return 0;
    }
    if (ia && !ib) return -1; // AP rows form one contiguous block before non-AP rows.
    if (!ia && ib) return 1;
    // Both non-AP: keep existing similar-name grouping, stable.
    const ka = nonApGroupKey(a.name);
    const kb = nonApGroupKey(b.name);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    if (na < nb) return -1;
    if (na > nb) return 1;
    return 0;
  });
}
