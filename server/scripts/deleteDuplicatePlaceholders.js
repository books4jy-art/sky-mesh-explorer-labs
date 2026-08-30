// One-off cleanup: delete placeholder mesh-only rows that duplicate an
// already icon-merged row for the same objDriveFileId.
//   node server/scripts/deleteDuplicatePlaceholders.js --dry-run   (default, report only)
//   node server/scripts/deleteDuplicatePlaceholders.js --dry-run=false
import '../loadEnv.js';
import { OutfitIcon } from '../entities.js';
import { PLACEHOLDER_DRIVE_FILE_ID } from '../outfitNaming.js';
import { parseArgs } from '../driveList.js';

const PLACEHOLDER_URL = `https://lh3.googleusercontent.com/d/${PLACEHOLDER_DRIVE_FILE_ID}`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args['dry-run'] !== 'false';

  const all = await OutfitIcon.list('id', 5000);
  if (all.length === 5000) throw new Error('OutfitIcon returned 5000 rows — pagination now required');

  const byObjId = new Map();
  for (const rec of all) {
    if (!rec.objDriveFileId) continue;
    if (!byObjId.has(rec.objDriveFileId)) byObjId.set(rec.objDriveFileId, []);
    byObjId.get(rec.objDriveFileId).push(rec);
  }

  const isPlaceholderRow = (rec) => !rec.iconFileName?.trim() && !rec.driveFileId?.trim() && rec.imageUrl === PLACEHOLDER_URL;

  const qualifying = [];
  for (const [, rows] of byObjId) {
    const hasRealIcon = rows.some((r) => r.iconFileName?.trim());
    if (!hasRealIcon) continue; // orphan placeholder — KEEP
    for (const r of rows) if (isPlaceholderRow(r)) qualifying.push(r);
  }

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, qualifyingCount: qualifying.length, examples: qualifying.slice(0, 10).map((r) => r.objDriveFileId) }, null, 2));
    return;
  }

  let deletedCount = 0;
  const errors = [];
  for (const rec of qualifying) {
    try {
      await OutfitIcon.delete(rec.id);
      deletedCount++;
    } catch (e) {
      errors.push({ objDriveFileId: rec.objDriveFileId, error: e?.message || String(e) });
    }
  }
  console.log(JSON.stringify({ dryRun: false, qualifyingCount: qualifying.length, deletedCount, errors }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
