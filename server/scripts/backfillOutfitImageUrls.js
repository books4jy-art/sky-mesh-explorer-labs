// One-off: rewrite imageUrl from a bare driveFileId into the canonical
// https://lh3.googleusercontent.com/d/{id} form, for every row missing it.
//   node server/scripts/backfillOutfitImageUrls.js
import '../loadEnv.js';
import { OutfitIcon } from '../entities.js';
import { PLACEHOLDER_DRIVE_FILE_ID } from '../outfitNaming.js';

const PLACEHOLDER_URL = `https://lh3.googleusercontent.com/d/${PLACEHOLDER_DRIVE_FILE_ID}`;

async function main() {
  const all = await OutfitIcon.list('id', 5000);
  if (all.length === 5000) throw new Error('OutfitIcon returned 5000 rows — pagination now required');

  const totals = { scanned: all.length, updated: 0, skippedNoDriveFileId: 0, skippedAlreadySet: 0, errors: [] };
  const toUpdate = [];
  for (const rec of all) {
    if (!rec.driveFileId?.trim()) { totals.skippedNoDriveFileId++; continue; }
    const isEmpty = !rec.imageUrl?.trim();
    const isPlaceholder = rec.imageUrl === PLACEHOLDER_URL;
    if (!isEmpty && !isPlaceholder) { totals.skippedAlreadySet++; continue; }
    toUpdate.push(rec);
  }

  for (const rec of toUpdate) {
    try {
      await OutfitIcon.update(rec.id, { imageUrl: `https://lh3.googleusercontent.com/d/${rec.driveFileId}` });
      totals.updated++;
    } catch (e) {
      totals.errors.push({ id: rec.id, driveFileId: rec.driveFileId, error: e?.message || String(e) });
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(JSON.stringify(totals, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
