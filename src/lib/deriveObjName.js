// Derives a display name from an OutfitIcon row's objFileName (.obj filename).
// Appearance-only — used for the Outfit Maker list labels.
const STRIP_TOKENS = [
  'StripAnim', 'CompOcc', 'ZipPos', 'ZipUvs', 'ZipUv', 'StripUv13', 'StripNorm',
  'CopyFrameDelay',
];
// matches optional leading underscore + one listed token (or a numbered ZipUv<n>/StripUv<n>),
// anchored to the end of the string.
const TOKEN_RE = new RegExp(
  '_?(?:' + STRIP_TOKENS.join('|') + '|StripUv\\d+|ZipUv\\d+)\\s*$'
);

export function deriveObjDisplayName(objFileName, category, fallback) {
  if (!objFileName || !objFileName.trim()) return fallback || '';
  let s = objFileName.trim();
  if (s.endsWith('.obj')) s = s.slice(0, -4);
  // repeatedly strip any trailing token from the set until none remain
  let prev;
  do {
    prev = s;
    s = s.replace(TOKEN_RE, '');
  } while (s !== prev && s.length > 0);
  if (category === 'Props') {
    if (s.endsWith('_CompOcc')) s = s.slice(0, -8);
    if (s.startsWith('Prop_')) s = s.slice(5);
    else if (s.startsWith('P_')) s = s.slice(2);
  }
  return s.trim() || fallback || '';
}
