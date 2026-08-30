// Mesh + icon naming utilities for syncOutfitMeshes.
// outfitNaming.js is left UNTOUCHED — its icon functions are correct.
// Only the mesh side was wrong; this module owns the corrected mesh/icon extraction.

// Folder name -> canonical category. This map IS the folder allowlist:
// a subfolder not listed here is never scanned.
export const FOLDER_CATEGORY = {
  Body: 'Body', Feet: 'Feet', Hair: 'Hair', Face: 'Face', Horn: 'Horn',
  Mask: 'Mask', Neck: 'Neck', Props: 'Props', Hat: 'Hat',
  Wing: 'Cape', // HYPOTHESIS: Wing folder meshes pair with Cape icons. Validated by dry run.
};

// Category token inside an icon filename -> canonical category.
export const ICON_CATEGORY_ALIAS = { Prop: 'Props', Wing: 'Cape' }; // others map to themselves
export const ICON_CATEGORY_TOKENS = ['Prop', 'Hair', 'Cape', 'Mask', 'Body', 'Horn',
  'Hat', 'Feet', 'Neck', 'Face', 'Tail', 'Wing', 'None'];

// Per-folder leading token on the .obj filename. Explicit, never guessed.
// Props accepts both 'P_' and 'Prop_' (no file matches both — checked).
export const FOLDER_MESH_PREFIX = {
  Body: 'Body_', Feet: 'Feet_', Hair: 'Hair_', Face: 'Face_', Horn: 'Horn_',
  Mask: 'Mask_', Neck: 'Neck_', Hat: 'Hat_', Wing: 'Wing_', Props: ['Prop_', 'P_'],
};

/**
 * .obj only. Strip the exact FOLDER_MESH_PREFIX[folderName] — if the file does not
 * start with it, return null (no fallback, no guessing). Then strip from the first
 * suffix token onward: _Strip*, _Comp*, _Zip*, _Copy* (covers StripUv13,
 * CopyFrameDelay, etc.) — NOT an end-anchored allowlist that halts on unknown tokens.
 * Return the remainder, or null if empty.
 */
export function meshBase(filename, folderName) {
  if (!filename || !/\.obj$/i.test(filename)) return null;
  const prefixes = FOLDER_MESH_PREFIX[folderName];
  if (!prefixes) return null;
  let stem = filename.replace(/\.obj$/i, '');
  const list = Array.isArray(prefixes) ? prefixes : [prefixes];
  const matched = list.find((p) => stem.startsWith(p));
  if (!matched) return null;
  stem = stem.slice(matched.length);
  stem = stem.replace(/_(Strip|Comp|Zip|Copy).*$/i, '');
  return stem.length ? stem : null;
}

/**
 * 'UiOutfitHairAP02Bhutan.png' -> { category: 'Hair', base: 'AP02Bhutan' }
 * Strip 'UiOutfit', match the longest token in ICON_CATEGORY_TOKENS at the start.
 * No token match => null. Apply ICON_CATEGORY_ALIAS.
 */
export function iconParts(filename) {
  if (!filename) return null;
  const stem = filename.replace(/^UiOutfit/i, '').replace(/\.png$/i, '');
  let matched = null;
  for (const token of ICON_CATEGORY_TOKENS) {
    if (stem.startsWith(token) && (!matched || token.length > matched.length)) matched = token;
  }
  if (!matched) return null;
  let base = stem.slice(matched.length);
  base = base.replace(/_(Strip|Comp|Zip|Copy).*$/i, '');
  if (!base) return null;
  const category = ICON_CATEGORY_ALIAS[matched] || matched;
  return { category, base };
}

export const pairKey = (s) => (s || '').toLowerCase();

/**
 * Insert a space between a lowercase/digit and a following uppercase:
 * 'ShortBob' -> 'Short Bob', 'AP04CozyPants' -> 'AP04 Cozy Pants'.
 */
export function prettifyName(base) {
  return (base || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}
