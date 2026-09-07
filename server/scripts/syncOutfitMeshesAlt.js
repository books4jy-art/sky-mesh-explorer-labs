// Populates the ALT mesh columns (alt_obj_drive_file_id / alt_obj_file_name)
// on outfit_icons from the second, uncurated mesh source: a flat Drive folder
// of raw Sky .mesh files (OUTFIT_MESH_FOLDER_ID_ALT). Unlike syncOutfitMeshes.js,
// this NEVER creates or updates category/name — it only merges an alt mesh
// reference onto a row that already exists from the primary sync, matched by
// the same (category, base-name) derived from the filename. Anything in the
// dump that doesn't match an existing catalog item (buildings, props not in
// the outfit catalog, environment meshes, etc.) is skipped, not imported.
//
//   node server/scripts/syncOutfitMeshesAlt.js --dry-run          (report only, default)
//   node server/scripts/syncOutfitMeshesAlt.js --dry-run=false    (write)
import '../loadEnv.js';
import { driveAuth } from '../drive.js';
import { OutfitIcon } from '../entities.js';
import { OUTFIT_MESH_FOLDER_ID_ALT } from '../config.js';
import { FOLDER_CATEGORY, FOLDER_MESH_PREFIX, prettifyName, pairKey } from '../outfitMeshNaming.js';
import { listChildren, parseArgs } from '../driveList.js';

// outfitMeshNaming.js deliberately excludes Tail (see backfillTailMeshes.js —
// the primary curated sync has its own dedicated Tail backfill, sourced from
// a "Misc" subfolder). This alt folder is flat and uncurated, so there's no
// separate backfill pass here — just extend the same prefix/category maps
// locally with the one extra entry, same "Tail_" convention as the primary
// backfill script uses.
const ALT_CATEGORY = { ...FOLDER_CATEGORY, Tail: 'Tail' };
const ALT_MESH_PREFIX = { ...FOLDER_MESH_PREFIX, Tail: 'Tail_' };

// Same stripping rule as meshBase() in outfitMeshNaming.js, but for the raw
// .mesh extension instead of the pre-converted .obj files that function expects.
function altMeshBase(filename, folderName) {
  if (!filename || !/\.mesh$/i.test(filename)) return null;
  const prefixes = ALT_MESH_PREFIX[folderName];
  if (!prefixes) return null;
  let stem = filename.replace(/\.mesh$/i, '');
  const list = Array.isArray(prefixes) ? prefixes : [prefixes];
  const matched = list.find((p) => stem.startsWith(p));
  if (!matched) return null;
  stem = stem.slice(matched.length);
  stem = stem.replace(/_(Strip|Comp|Zip|Copy).*$/i, '');
  return stem.length ? stem : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args['dry-run'] !== 'false';

  const auth = await driveAuth();
  const children = await listChildren(OUTFIT_MESH_FOLDER_ID_ALT, auth);
  const meshFiles = children.filter((f) => f.mimeType !== 'application/vnd.google-apps.folder' && /\.mesh$/i.test(f.name || ''));

  const catalog = await OutfitIcon.list('id', 5000);
  if (catalog.length === 5000) throw new Error('OutfitIcon returned 5000 rows — pagination now required');

  // If (category, name) is ever duplicated across rows (a data-quality issue
  // upstream, not expected but has happened), prefer the row with a real
  // icon over a later-id "ghost" row — otherwise a duplicate's icon-less
  // twin silently wins and the alt mesh lands on the tile nobody sees.
  const iconIndex = new Map();
  for (const rec of catalog) {
    if (!rec.category || !rec.name) continue;
    const key = pairKey(rec.category + '|' + rec.name);
    const existing = iconIndex.get(key);
    if (!existing || (!existing.driveFileId && rec.driveFileId)) iconIndex.set(key, rec);
  }

  const folderNames = Object.keys(ALT_MESH_PREFIX);
  const plannedWrites = [];
  let unmatchedNoPrefix = 0;
  let unmatchedNoIcon = 0;

  for (const mf of meshFiles) {
    let hit = null;
    for (const folderName of folderNames) {
      const base = altMeshBase(mf.name, folderName);
      if (base) {
        hit = { category: ALT_CATEGORY[folderName], base };
        break;
      }
    }
    if (!hit) { unmatchedNoPrefix++; continue; }

    const name = prettifyName(hit.base);
    const key = pairKey(hit.category + '|' + name);
    const iconRec = iconIndex.get(key);
    if (!iconRec) { unmatchedNoIcon++; continue; }

    plannedWrites.push({ iconId: iconRec.id, meshId: mf.id, objFileName: mf.name, category: hit.category, name });
  }

  let updated = 0;
  const errors = [];
  if (!dryRun) {
    for (const op of plannedWrites) {
      try {
        await OutfitIcon.update(op.iconId, { altObjDriveFileId: op.meshId, altObjFileName: op.objFileName });
        updated++;
      } catch (e) {
        errors.push({ objFileName: op.objFileName, error: e?.message || String(e) });
      }
    }
  }

  console.log(JSON.stringify({
    dryRun,
    totalMeshFiles: meshFiles.length,
    matched: plannedWrites.length,
    updated: dryRun ? null : updated,
    unmatchedNoPrefix,
    unmatchedNoIcon,
    errorCount: errors.length,
    failedWrites: errors.slice(0, 6),
    sampleMatches: plannedWrites.slice(0, 10).map((w) => ({ category: w.category, name: w.name, objFileName: w.objFileName })),
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
