// Dedicated backfill: link the Tail .obj meshes (in the Drive mesh root's
// "Misc" subfolder, Tail_ prefix) to their Tail OutfitIcon rows. Tail is
// intentionally absent from outfitMeshNaming.js's folder allowlist, so
// syncOutfitMeshes never touches these — this script handles them inline.
//   node server/scripts/backfillTailMeshes.js --dry-run          (default)
//   node server/scripts/backfillTailMeshes.js --dry-run=false
import '../loadEnv.js';
import { driveAuth } from '../drive.js';
import { OutfitIcon } from '../entities.js';
import { OUTFIT_MESH_FOLDER_ID } from '../outfitNaming.js';
import { iconParts, prettifyName, pairKey } from '../outfitMeshNaming.js';
import { listChildren, parseArgs } from '../driveList.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args['dry-run'] !== 'false';
  const auth = await driveAuth();

  const rootChildren = await listChildren(OUTFIT_MESH_FOLDER_ID, auth, 'files(id,name,mimeType),nextPageToken');
  const misc = rootChildren.find((f) => f.mimeType === 'application/vnd.google-apps.folder' && /^misc$/i.test(f.name));
  if (!misc) throw new Error('Misc subfolder not found in mesh root');

  const tailMeshes = (await listChildren(misc.id, auth, 'files(id,name),nextPageToken'))
    .filter((f) => f.name && /^tail_.*\.obj$/i.test(f.name))
    .map((f) => ({ id: f.id, name: f.name }));

  const meshPlans = tailMeshes.map((mf) => {
    const base = mf.name.replace(/\.obj$/i, '').replace(/^tail_/i, '').replace(/_(Strip|Comp|Zip|Copy).*$/i, '');
    return { meshId: mf.id, objFileName: mf.name, base, category: 'Tail', name: prettifyName(base), pairKey: pairKey('Tail|' + base) };
  });

  const all = await OutfitIcon.list('id', 5000);
  const tailIconIndex = new Map();
  const alreadyLinked = [];
  for (const rec of all) {
    const parts = rec.iconFileName ? iconParts(rec.iconFileName) : null;
    if (!parts || parts.category !== 'Tail') continue;
    const k = pairKey(parts.category + '|' + parts.base);
    if (rec.objDriveFileId) { alreadyLinked.push({ id: rec.id, name: rec.name, pairKey: k }); continue; }
    if (!tailIconIndex.has(k)) tailIconIndex.set(k, rec);
  }

  const plannedMerges = [];
  const unmatchedMeshes = [];
  for (const mp of meshPlans) {
    const iconRec = tailIconIndex.get(mp.pairKey);
    if (iconRec) {
      plannedMerges.push({ iconRowId: iconRec.id, iconRowName: iconRec.name, matchedMeshObjFileName: mp.objFileName, matchedMeshDriveFileId: mp.meshId, wouldSet: { category: 'Tail', name: mp.name, objDriveFileId: mp.meshId, objFileName: mp.objFileName } });
    } else {
      unmatchedMeshes.push({ objFileName: mp.objFileName, meshId: mp.meshId, pairKey: mp.pairKey });
    }
  }

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, tailMeshCount: tailMeshes.length, tailIconRowCount: tailIconIndex.size + alreadyLinked.length, plannedMerges, unmatchedMeshes, alreadyLinkedTailIcons: alreadyLinked }, null, 2));
    return;
  }

  let merged = 0;
  const errors = [];
  for (const m of plannedMerges) {
    try {
      await OutfitIcon.update(m.iconRowId, m.wouldSet);
      merged++;
    } catch (e) {
      errors.push({ iconRowId: m.iconRowId, iconRowName: m.iconRowName, error: e?.message || String(e) });
    }
  }
  console.log(JSON.stringify({ dryRun: false, merged, errors }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
