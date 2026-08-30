import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { driveAuth } from '../../shared/drive.ts';

const ROOT_FOLDER_ID = '1svaARuxnWMBTYhnx3GhRjNaNEfzZ6kOE';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const all = await base44.asServiceRole.entities.OutfitIcon.list('id', 5000);
    if (all.length === 5000) {
      return Response.json({ error: 'OutfitIcon returned 5000 rows — pagination now required' }, { status: 500 });
    }

    // ---- PART A: Reconciliation counts ----
    const total = all.length;
    let hasRealIcon = 0;
    let placeholderMesh = 0;
    let iconOnly = 0;
    let fullyMerged = 0;

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
      if (rec.iconFileName && rec.iconFileName.trim() && rec.objDriveFileId && rec.objDriveFileId.trim()) {
        objIdsWithIcon.add(rec.objDriveFileId);
      }
    }

    const dupPlaceholderIds = [];
    for (const rec of all) {
      const hasIcon = !!(rec.iconFileName && rec.iconFileName.trim());
      const hasObj = !!(rec.objDriveFileId && rec.objDriveFileId.trim());
      if (hasObj && !hasIcon && objIdsWithIcon.has(rec.objDriveFileId)) {
        dupPlaceholderIds.push(rec.objDriveFileId);
      }
    }

    let orphanPlaceholders = 0;
    for (const rec of all) {
      const hasIcon = !!(rec.iconFileName && rec.iconFileName.trim());
      const hasObj = !!(rec.objDriveFileId && rec.objDriveFileId.trim());
      if (hasObj && !hasIcon && !objIdsWithIcon.has(rec.objDriveFileId)) {
        orphanPlaceholders++;
      }
    }

    const multiRow = [];
    for (const [objId, rows] of objIdMap) {
      if (rows.length > 2) multiRow.push({ objDriveFileId: objId, count: rows.length });
    }
    multiRow.sort((a, b) => b.count - a.count);

    const partA = {
      totalRows: total,
      rowsWithRealIcon: hasRealIcon,
      placeholderMeshRows: placeholderMesh,
      iconOnlyRows: iconOnly,
      fullyMergedRows: fullyMerged,
      duplicatePlaceholderCount: dupPlaceholderIds.length,
      duplicatePlaceholderExamples: dupPlaceholderIds.slice(0, 10),
      orphanPlaceholderCount: orphanPlaceholders,
      multiRowObjIds: multiRow.slice(0, 10),
      multiRowCount: multiRow.length,
    };

    // ---- PART B: Source-folder provenance (ALL distinct objDriveFileIds, concurrency 3) ----
    const auth = await driveAuth(base44);
    const allDistinctObjIds = [...objIdMap.keys()];

    // folder parent cache: folderId -> parents array (null = lookup failed, undefined = not fetched)
    const parentCache = new Map();

    async function fetchWithRetry(url) {
      for (let attempt = 0; attempt < 5; attempt++) {
        let res = await fetch(url, { headers: auth });
        if (res.status === 429) {
          const wait = 1000 * Math.pow(2, Math.min(attempt, 4));
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        return res;
      }
      return null;
    }

    // Resolve whether a fileId is under the allowed root, walking the cached parent chain.
    async function resolveUnderRoot(fileParents) {
      const resolveQueue = [...(fileParents || [])];
      const visited = new Set();
      while (resolveQueue.length > 0) {
        const folderId = resolveQueue.shift();
        if (folderId === ROOT_FOLDER_ID) return true;
        if (visited.has(folderId)) continue;
        visited.add(folderId);

        if (parentCache.has(folderId)) {
          const cachedParents = parentCache.get(folderId);
          if (cachedParents !== null) {
            for (const cp of cachedParents) resolveQueue.push(cp);
          }
          continue;
        }

        // Fetch this folder's parents
        const folderUrl = `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,parents`;
        const fRes = await fetchWithRetry(folderUrl);
        if (!fRes || !fRes.ok) { parentCache.set(folderId, null); continue; }
        let fData;
        try { fData = await fRes.json(); } catch { parentCache.set(folderId, null); continue; }
        const fParents = fData.parents || [];
        parentCache.set(folderId, fParents);
        for (const fp of fParents) resolveQueue.push(fp);
      }
      return false;
    }

    let underRootCount = 0;
    let notUnderRootCount = 0;
    let unresolvableCount = 0;
    const notUnderRootExamples = [];
    const CONCURRENCY = 3;
    let idx = 0;

    async function worker() {
      while (idx < allDistinctObjIds.length) {
        const objId = allDistinctObjIds[idx++];
        const fileUrl = `https://www.googleapis.com/drive/v3/files/${objId}?fields=id,name,parents`;
        const res = await fetchWithRetry(fileUrl);
        if (!res || !res.ok) { unresolvableCount++; continue; }
        let data;
        try { data = await res.json(); } catch { unresolvableCount++; continue; }
        const fileParents = data.parents || [];

        const under = await resolveUnderRoot(fileParents);

        if (under) {
          underRootCount++;
        } else {
          notUnderRootCount++;
          if (notUnderRootExamples.length < 10) {
            notUnderRootExamples.push({ objDriveFileId: objId, name: data.name || '', parents: fileParents });
          }
        }
        // small pause to be gentle on rate limits
        await new Promise(r => setTimeout(r, 30));
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    const partB = {
      distinctObjIdsTotal: allDistinctObjIds.length,
      distinctObjIdsChecked: 'all ' + allDistinctObjIds.length,
      countUnderAllowedRoot: underRootCount,
      countNOTUnderRoot: notUnderRootCount,
      notUnderRootExamples: notUnderRootExamples,
      countUnresolvable: unresolvableCount,
    };

    return Response.json({ partA, partB });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
