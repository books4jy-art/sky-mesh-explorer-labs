// Re-runs the mesh<->icon merge for an explicit list of filenames that fell
// through the main syncOutfitMeshes pass.
//   node server/scripts/mergeOutfitStragglers.js --files=Body_Foo.obj,Hair_Bar.obj
import '../loadEnv.js';
import { driveAuth } from '../drive.js';
import { OutfitIcon } from '../entities.js';
import { OUTFIT_MESH_FOLDER_ID } from '../outfitNaming.js';
import { FOLDER_CATEGORY, meshBase, prettifyName, iconParts, pairKey } from '../outfitMeshNaming.js';
import { listChildren, parseArgs } from '../driveList.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = (args.files || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!targets.length) throw new Error('Pass --files=Name1.obj,Name2.obj');

  const auth = await driveAuth();
  const rootChildren = await listChildren(OUTFIT_MESH_FOLDER_ID, auth);
  const subfolders = rootChildren.filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
  const targetSet = new Set(targets);
  const ALLOWED_PARENT_IDS = new Set();
  for (const sf of subfolders) if (FOLDER_CATEGORY[sf.name]) ALLOWED_PARENT_IDS.add(sf.id);

  const foundFiles = [];
  for (const sf of subfolders) {
    if (!FOLDER_CATEGORY[sf.name]) continue;
    const children = await listChildren(sf.id, auth, 'files(id,name,mimeType,parents),nextPageToken');
    for (const f of children) {
      if (f.mimeType === 'application/vnd.google-apps.folder') continue;
      if (targetSet.has(f.name)) foundFiles.push({ id: f.id, name: f.name, folderName: sf.name, parents: f.parents || [] });
    }
  }

  const all = await OutfitIcon.list('id', 5000);
  if (all.length === 5000) throw new Error('OutfitIcon returned 5000 rows — pagination now required');
  const iconIndex = new Map();
  const mergedByObjId = new Map();
  for (const rec of all) {
    if (rec.driveFileId && rec.objDriveFileId) mergedByObjId.set(rec.objDriveFileId, rec);
    if (rec.driveFileId && !rec.objDriveFileId && rec.iconFileName) {
      const parts = iconParts(rec.iconFileName);
      if (parts) {
        const key = pairKey(parts.category + '|' + parts.base);
        if (!iconIndex.has(key)) iconIndex.set(key, rec);
      }
    }
  }

  const results = [];
  for (const target of targets) if (!foundFiles.some((f) => f.name === target)) results.push({ objFileName: target, status: 'not_found_in_drive' });

  const plannedMerges = [];
  for (const tf of foundFiles) {
    if (!(tf.parents || []).some((p) => ALLOWED_PARENT_IDS.has(p))) { results.push({ objFileName: tf.name, status: 'skipped', reason: 'not in allowed parent' }); continue; }
    const category = FOLDER_CATEGORY[tf.folderName];
    const base = meshBase(tf.name, tf.folderName);
    if (!base) { results.push({ objFileName: tf.name, status: 'skipped', reason: 'could not derive base name' }); continue; }
    const key = pairKey(category + '|' + base);
    const iconRec = iconIndex.get(key);
    if (!iconRec) {
      const mergedRow = mergedByObjId.get(tf.id);
      if (mergedRow) results.push({ objFileName: tf.name, status: 'already_merged', iconName: mergedRow.name, category: mergedRow.category });
      else results.push({ objFileName: tf.name, status: 'no_icon', category, base });
      continue;
    }
    plannedMerges.push({ iconRec, meshId: tf.id, objFileName: tf.name, category, name: prettifyName(base) });
  }

  for (const op of plannedMerges) {
    try {
      await OutfitIcon.update(op.iconRec.id, { category: op.category, name: op.name, objDriveFileId: op.meshId, objFileName: op.objFileName });
      results.push({ objFileName: op.objFileName, status: 'merged', iconName: op.name, category: op.category });
    } catch (e) {
      results.push({ objFileName: op.objFileName, status: 'failed', error: e?.message || String(e) });
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(JSON.stringify({ results }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
