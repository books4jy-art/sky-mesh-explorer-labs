// The core mesh<->icon matcher. Walks the mesh Drive folder by category
// subfolder, derives a (category, base) key from each .obj filename, and
// merges it onto the matching OutfitIcon row (or creates a mesh-only
// placeholder row). Run AFTER syncOutfitIcons.
//
//   node server/scripts/syncOutfitMeshes.js --dry-run          (report only, default)
//   node server/scripts/syncOutfitMeshes.js --dry-run=false    (write; loops until done)
import '../loadEnv.js';
import { driveAuth } from '../drive.js';
import { OutfitIcon } from '../entities.js';
import { OUTFIT_MESH_FOLDER_ID, PLACEHOLDER_DRIVE_FILE_ID } from '../outfitNaming.js';
import { FOLDER_CATEGORY, meshBase, prettifyName, iconParts, pairKey } from '../outfitMeshNaming.js';
import { listChildren, parseArgs } from '../driveList.js';

const PLACEHOLDER_URL = `https://lh3.googleusercontent.com/d/${PLACEHOLDER_DRIVE_FILE_ID}`;
const CHUNK = 250;

async function runOnce(auth, dryRun, cursor) {
  const rootChildren = await listChildren(OUTFIT_MESH_FOLDER_ID, auth);
  const subfolders = rootChildren.filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
  const ALLOWED_PARENT_IDS = new Set();
  for (const sf of subfolders) if (FOLDER_CATEGORY[sf.name]) ALLOWED_PARENT_IDS.add(sf.id);

  const allowedFileMap = new Map();
  for (const sf of subfolders) {
    const isAllowed = !!FOLDER_CATEGORY[sf.name];
    const children = await listChildren(sf.id, auth, 'files(id,name,mimeType,parents),nextPageToken');
    for (const f of children) {
      if (f.mimeType === 'application/vnd.google-apps.folder') continue;
      if (f.name && f.name.toLowerCase().endsWith('.obj') && isAllowed && !allowedFileMap.has(f.id)) {
        allowedFileMap.set(f.id, { id: f.id, name: f.name, folderName: sf.name, parents: f.parents || [] });
      }
    }
  }

  const all = await OutfitIcon.list('id', 5000);
  if (all.length === 5000) throw new Error('OutfitIcon returned 5000 rows — pagination now required');

  const iconIndex = new Map();
  const byObjId = new Map();
  for (const rec of all) {
    if (rec.objDriveFileId) byObjId.set(rec.objDriveFileId, rec);
    if (rec.driveFileId && !rec.objDriveFileId && rec.iconFileName) {
      const parts = iconParts(rec.iconFileName);
      if (parts) {
        const key = pairKey(parts.category + '|' + parts.base);
        if (!iconIndex.has(key)) iconIndex.set(key, rec);
      }
    }
  }

  const allMeshes = [...allowedFileMap.values()];
  allMeshes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let startIdx = 0;
  if (cursor) {
    startIdx = allMeshes.findIndex((m) => m.id > cursor);
    if (startIdx === -1) startIdx = allMeshes.length;
  }
  const chunk = allMeshes.slice(startIdx, startIdx + CHUNK);
  const nextCursor = chunk.length ? chunk[chunk.length - 1].id : cursor || null;
  const done = startIdx + chunk.length >= allMeshes.length;

  const plannedWrites = [];
  let mergedCount = 0;
  let meshOnlyCount = 0;

  for (const mf of chunk) {
    if (!(mf.parents || []).some((p) => ALLOWED_PARENT_IDS.has(p))) continue;
    const folderName = mf.folderName;
    const category = FOLDER_CATEGORY[folderName];
    const base = meshBase(mf.name, folderName);
    if (!base) continue;

    const key = pairKey(category + '|' + base);
    const iconRec = iconIndex.get(key);

    if (iconRec) {
      plannedWrites.push({ op: 'merge', iconRec, meshId: mf.id, objFileName: mf.name, category, name: prettifyName(base) });
      mergedCount++;
      iconIndex.delete(key);
    } else {
      const byObjRec = byObjId.get(mf.id);
      if (byObjRec) {
        const setPlaceholder = !byObjRec.driveFileId && !byObjRec.imageUrl;
        plannedWrites.push({ op: 'update', iconRec: byObjRec, meshId: mf.id, objFileName: mf.name, category, name: prettifyName(base), setPlaceholder });
      } else {
        plannedWrites.push({ op: 'create', meshId: mf.id, objFileName: mf.name, category, name: prettifyName(base) });
      }
      meshOnlyCount++;
    }
  }

  let writeResult = null;
  if (!dryRun && plannedWrites.length > 0) {
    const errors = [];
    let updated = 0, created = 0, merged = 0;
    for (const op of plannedWrites) {
      try {
        if (op.op === 'merge') {
          await OutfitIcon.update(op.iconRec.id, { category: op.category, name: op.name, objDriveFileId: op.meshId, objFileName: op.objFileName });
          merged++;
        } else if (op.op === 'update') {
          const patch = { category: op.category, name: op.name, objFileName: op.objFileName, objDriveFileId: op.meshId };
          if (op.setPlaceholder) patch.imageUrl = PLACEHOLDER_URL;
          await OutfitIcon.update(op.iconRec.id, patch);
          updated++;
        } else {
          await OutfitIcon.create({ category: op.category, name: op.name, objFileName: op.objFileName, objDriveFileId: op.meshId, imageUrl: PLACEHOLDER_URL, driveFileId: '', iconFileName: '' });
          created++;
        }
        await new Promise((r) => setTimeout(r, 200));
      } catch (e) {
        errors.push({ objFileName: op.objFileName, error: e?.message || String(e) });
      }
    }
    writeResult = { updated, created, merged, errors };
  }

  let iconsBackfilled = 0;
  let duplicateReport = null;
  if (done && !dryRun) {
    const allUpdated = await OutfitIcon.list('id', 5000);
    for (const rec of allUpdated) {
      if (rec.driveFileId && !rec.category && !rec.objDriveFileId && rec.iconFileName) {
        const parts = iconParts(rec.iconFileName);
        if (parts) {
          await OutfitIcon.update(rec.id, { category: parts.category, name: prettifyName(parts.base) });
          iconsBackfilled++;
        }
      }
    }

    const mergedCategoryNames = new Set();
    for (const rec of allUpdated) {
      if (rec.driveFileId && rec.objDriveFileId && rec.category && rec.name) {
        mergedCategoryNames.add(pairKey(rec.category + '|' + rec.name));
      }
    }
    const duplicates = [];
    for (const rec of allUpdated) {
      if (!rec.driveFileId && rec.objDriveFileId && rec.category && rec.name) {
        if (mergedCategoryNames.has(pairKey(rec.category + '|' + rec.name))) {
          duplicates.push({ id: rec.id, objFileName: rec.objFileName, category: rec.category, name: rec.name });
        }
      }
    }
    duplicateReport = { count: duplicates.length, examples: duplicates.slice(0, 10) };
  }

  return {
    dryRun, processedThisRun: chunk.length,
    totalMerged: dryRun ? mergedCount : (writeResult?.merged ?? 0),
    meshOnlyPlaceholders: meshOnlyCount, iconsBackfilled, redundantDuplicatesFound: duplicateReport,
    errorCount: (writeResult?.errors ?? []).length,
    failedWrites: (writeResult?.errors ?? []).slice(0, 6),
    nextCursor, done,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args['dry-run'] !== 'false';
  let cursor = args.cursor || null;

  const auth = await driveAuth();
  let result;
  do {
    result = await runOnce(auth, dryRun, cursor);
    console.log(JSON.stringify(result, null, 2));
    cursor = result.nextCursor;
  } while (!dryRun && !result.done);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
