// Read-only reconciliation: Drive PNG counts vs. OutfitIcon rows.
//   node server/scripts/auditIconSource.js
import '../loadEnv.js';
import { driveAuth } from '../drive.js';
import { OutfitIcon } from '../entities.js';
import { OUTFIT_ICON_FOLDER_ID } from '../outfitNaming.js';
import { listChildren } from '../driveList.js';

async function main() {
  const auth = await driveAuth();

  const allPngs = [];
  const queue = [OUTFIT_ICON_FOLDER_ID];
  const visited = new Set([OUTFIT_ICON_FOLDER_ID]);
  while (queue.length > 0) {
    const folderId = queue.shift();
    const children = await listChildren(folderId, auth);
    for (const f of children) {
      if (f.mimeType === 'application/vnd.google-apps.folder') {
        if (!visited.has(f.id)) { visited.add(f.id); queue.push(f.id); }
      } else if (f.name && /\.png$/i.test(f.name)) {
        allPngs.push({ id: f.id, name: f.name });
      }
    }
  }

  const EXCLUDED_PREFIXES = ['UiSocial', 'UiPersonality', 'UiSharedSpace', 'UiRadial'];
  let driveOutfitIcons = 0;
  const excludedByPrefixMap = new Map();
  const outfitPngs = [];
  for (const png of allPngs) {
    if (png.name.startsWith('UiOutfit')) {
      driveOutfitIcons++;
      outfitPngs.push(png);
    } else {
      const matched = EXCLUDED_PREFIXES.find((p) => png.name.startsWith(p));
      const prefix = matched || (png.name.match(/^([A-Z][a-z]+)/) || [null, png.name.slice(0, 8)])[1];
      excludedByPrefixMap.set(prefix, (excludedByPrefixMap.get(prefix) || 0) + 1);
    }
  }

  const all = await OutfitIcon.list('id', 5000);
  if (all.length === 5000) throw new Error('OutfitIcon returned 5000 rows — pagination now required');

  const entityDriveIds = new Set();
  const entityRowsWithDriveId = [];
  for (const rec of all) {
    if (rec.driveFileId && rec.driveFileId.trim()) {
      entityDriveIds.add(rec.driveFileId);
      entityRowsWithDriveId.push(rec);
    }
  }

  const driveIdsSet = new Set(outfitPngs.map((p) => p.id));
  const inDriveNotInEntity = outfitPngs.filter((p) => !entityDriveIds.has(p.id));
  const inEntityNotInDrive = entityRowsWithDriveId.filter((r) => !driveIdsSet.has(r.driveFileId));

  console.log(JSON.stringify({
    driveIconsTotal: allPngs.length,
    driveOutfitIcons,
    excludedByPrefixCount: allPngs.length - driveOutfitIcons,
    excludedByPrefixBreakdown: Object.fromEntries([...excludedByPrefixMap.entries()].sort((a, b) => b[1] - a[1])),
    entityIconRows: entityRowsWithDriveId.length,
    inDriveNotInEntityCount: inDriveNotInEntity.length,
    inDriveNotInEntityExamples: inDriveNotInEntity.slice(0, 15).map((p) => p.name),
    inEntityNotInDriveCount: inEntityNotInDrive.length,
    inEntityNotInDriveExamples: inEntityNotInDrive.slice(0, 10).map((r) => ({ driveFileId: r.driveFileId, name: r.name || r.iconFileName || '' })),
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
