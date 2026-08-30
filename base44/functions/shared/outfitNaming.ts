export const OUTFIT_ICON_FOLDER_ID = '1zphd4EeUovcVKQ7BfY4yqMu8NcUU3LN9';
export const OUTFIT_MESH_FOLDER_ID = '1svaARuxnWMBTYhnx3GhRjNaNEfzZ6kOE';
export const PLACEHOLDER_DRIVE_FILE_ID = '1Or3YuWpZjH4WOqVLgp812Q0hRmzSonUP';

// The ONLY place these prefixes are defined.
export const ICON_PREFIX = 'UiOutfit';
export const MESH_PREFIX = 'Outfit';

/** 'UiOutfitPropFortunePony.png' -> 'PropFortunePony'; null if not ours. */
export function iconBaseName(filename) {
  if (!filename || !/\.png$/i.test(filename)) return null;
  const stem = filename.replace(/\.png$/i, '');
  if (!stem.startsWith(ICON_PREFIX)) return null;
  const base = stem.slice(ICON_PREFIX.length);
  return base.length ? base : null;
}

/** 'OutfitPropFortunePony.obj' -> 'PropFortunePony'; null if not ours. */
export function meshBaseName(filename) {
  if (!filename || !/\.obj$/i.test(filename)) return null;
  const stem = filename.replace(/\.obj$/i, '');
  if (!stem.startsWith(MESH_PREFIX)) return null;
  const base = stem.slice(MESH_PREFIX.length);
  return base.length ? base : null;
}

/** Pairing key: prefix already stripped, case-insensitive. */
export const pairKey = (base) => (base || '').toLowerCase();

/**
 * 'PropFortunePony' -> { category: 'Prop', name: 'Fortune Pony' }
 * Category is the first capitalised run; name is the remainder, camelCase-split
 * and space-joined. Returns null if either half is missing or the string has
 * stray characters — callers must skip and report, never guess.
 */
export function parseCategoryAndName(base) {
  const words = (base || '').match(/[A-Z][a-z0-9]*/g);
  if (!words || words.length < 2) return null;
  if (words.join('') !== base) return null;
  const [category, ...rest] = words;
  const name = rest.join(' ');
  if (!category || !name) return null;
  return { category, name };
}
