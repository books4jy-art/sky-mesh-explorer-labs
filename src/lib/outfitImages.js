export const PLACEHOLDER_IMAGE_URL = 'https://lh3.googleusercontent.com/d/1Or3YuWpZjH4WOqVLgp812Q0hRmzSonUP';

/**
 * Returns the record's imageUrl, or the placeholder if empty/missing.
 * Ensures every tile has a valid src — no broken-image icon, no empty src.
 */
export function resolveImageUrl(record) {
  const url = record?.imageUrl;
  return url && url.trim() ? url : PLACEHOLDER_IMAGE_URL;
}
