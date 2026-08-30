// Read-only: OutfitIcon row-shape reconciliation + Drive-parent provenance check.
//   node server/scripts/auditOutfitIcons.js
import 'dotenv/config';
import { driveAuth } from '../drive.js';
import { OutfitIcon } from '../entities.js';
import { OUTFIT_MESH_FOLDER_ID as ROOT_FOLDER_ID } from '../outfitNaming.js';

async function main() {
  const all = await OutfitIcon.list('id', 5000);
  if (all.length === 5000) throw new Error('OutfitIcon returned 5000 rows — pagination now required');

  let hasRealIcon = 0, placeholderMesh = 0, iconOnly = 0, fullyMerged = 0;
  const objIdMap = new Map();
  for (const rec of all) {
    const hasIcon = !!(rec.iconFileName && rec.iconFileName.trim());
    const hasObj = !!(rec.objDriveFileId && rec.objDriveFileId.trim());
    if (hasIcon) hasRealIcon++;
    if (hasObj && !hasIcon) placeholderMesh++;
    if (hasIcon && !hasObj) iconOnly++;
    if (hasIcon && hasObj) fullyMerged++;
    if (hasObj) {
      if (!objIdMap.has(rec.objDriveFileId)) objIdMap.set(rec.objDriveFileId, []);
      objIdMap.get(rec.objDriveFileId).push(rec);
    }
  }

  const objIdsWithIcon = new Set();
  for (const rec of all) {
    if (rec.iconFileName?.trim() && rec.objDriveFileId?.trim()) objIdsWithIcon.add(rec.objDriveFileId);
  }

  const dupPlaceholderIds = [];
  let orphanPlaceholders = 0;
  for (const rec of all) {
    const hasIcon = !!(rec.iconFileName && rec.iconFileName.trim());
    const hasObj = !!(rec.objDriveFileId && rec.objDriveFileId.trim());
    if (hasObj && !hasIcon) {
      if (objIdsWithIcon.has(rec.objDriveFileId)) dupPlaceholderIds.push(rec.objDriveFileId);
      else orphanPlaceholders++;
    }
  }

  const multiRow = [...objIdMap.entries()]
    .filter(([, rows]) => rows.length > 2)
    .map(([objId, rows]) => ({ objDriveFileId: objId, count: rows.length }))
    .sort((a, b) => b.count - a.count);

  const partA = {
    totalRows: all.length, rowsWithRealIcon: hasRealIcon, placeholderMeshRows: placeholderMesh,
    iconOnlyRows: iconOnly, fullyMergedRows: fullyMerged,
    duplicatePlaceholderCount: dupPlaceholderIds.length, duplicatePlaceholderExamples: dupPlaceholderIds.slice(0, 10),
    orphanPlaceholderCount: orphanPlaceholders, multiRowObjIds: multiRow.slice(0, 10), multiRowCount: multiRow.length,
  };

  // Part B: source-folder provenance
  const auth = await driveAuth();
  const allDistinctObjIds = [...objIdMap.keys()];
  const parentCache = new Map();

  async function fetchWithRetry(url) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(url, { headers: auth });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, Math.min(attempt, 4))));
        continue;
      }
      return res;
    }
    return null;
  }

  async function resolveUnderRoot(fileParents) {
    const queue = [...(fileParents || [])];
    const visited = new Set();
    while (queue.length > 0) {
      const folderId = queue.shift();
      if (folderId === ROOT_FOLDER_ID) return true;
      if (visited.has(folderId)) continue;
      visited.add(folderId);
      if (parentCache.has(folderId)) {
        const cached = parentCache.get(folderId);
        if (cached !== null) queue.push(...cached);
        continue;
      }
      const res = await fetchWithRetry(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,parents`);
      if (!res || !res.ok) { parentCache.set(folderId, null); continue; }
      let data;
      try { data = await res.json(); } catch { parentCache.set(folderId, null); continue; }
      const parents = data.parents || [];
      parentCache.set(folderId, parents);
      queue.push(...parents);
    }
    return false;
  }

  let underRootCount = 0, notUnderRootCount = 0, unresolvableCount = 0;
  const notUnderRootExamples = [];
  const CONCURRENCY = 3;
  let idx = 0;
  async function worker() {
    while (idx < allDistinctObjIds.length) {
      const objId = allDistinctObjIds[idx++];
      const res = await fetchWithRetry(`https://www.googleapis.com/drive/v3/files/${objId}?fields=id,name,parents`);
      if (!res || !res.ok) { unresolvableCount++; continue; }
      let data;
      try { data = await res.json(); } catch { unresolvableCount++; continue; }
      const under = await resolveUnderRoot(data.parents || []);
      if (under) underRootCount++;
      else {
        notUnderRootCount++;
        if (notUnderRootExamples.length < 10) notUnderRootExamples.push({ objDriveFileId: objId, name: data.name || '', parents: data.parents || [] });
      }
      await new Promise((r) => setTimeout(r, 30));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const partB = {
    distinctObjIdsTotal: allDistinctObjIds.length,
    countUnderAllowedRoot: underRootCount, countNOTUnderRoot: notUnderRootCount,
    notUnderRootExamples, countUnresolvable: unresolvableCount,
  };

  console.log(JSON.stringify({ partA, partB }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
