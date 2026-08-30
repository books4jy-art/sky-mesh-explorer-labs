// Scans the outfit-icon Drive folder and creates/updates OutfitIcon rows for
// every UiOutfit*.png found. Run this once (and whenever new icons are added
// to Drive) before syncOutfitMeshes.
//
//   node server/scripts/syncOutfitIcons.js
import 'dotenv/config';
import { driveAuth } from '../drive.js';
import { OutfitIcon } from '../entities.js';
import { OUTFIT_ICON_FOLDER_ID, iconBaseName } from '../outfitNaming.js';
import { listChildren } from '../driveList.js';

async function main() {
  const auth = await driveAuth();

  const files = (await listChildren(OUTFIT_ICON_FOLDER_ID, auth))
    .filter((f) => f.mimeType !== 'application/vnd.google-apps.folder')
    .map((f) => ({ id: f.id, name: f.name }));

  const skipped = [];
  const matching = files.filter((f) => {
    if (iconBaseName(f.name)) return true;
    skipped.push(f.name);
    return false;
  });

  const existing = new Map();
  for (const rec of await OutfitIcon.list('driveFileId', 5000)) existing.set(rec.driveFileId, rec);

  const toCreate = [];
  const toUpdate = [];
  for (const png of matching) {
    const rec = existing.get(png.id);
    if (rec) {
      const patch = {};
      if (!rec.iconFileName) patch.iconFileName = png.name;
      if (Object.keys(patch).length) toUpdate.push({ rec, patch });
      continue;
    }
    toCreate.push(png);
  }

  let created = 0;
  let updated = 0;
  for (const { rec, patch } of toUpdate) {
    await OutfitIcon.update(rec.id, patch);
    updated++;
  }
  for (const png of toCreate) {
    await OutfitIcon.create({ driveFileId: png.id, iconFileName: png.name });
    created++;
  }

  console.log(
    JSON.stringify(
      { folder: OUTFIT_ICON_FOLDER_ID, scanned: files.length, matchedPrefix: matching.length, created, updated, skippedNonOutfit: skipped },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
