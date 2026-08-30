import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { driveAuth } from '../../shared/drive.ts';
import { OUTFIT_MESH_FOLDER_ID, PLACEHOLDER_DRIVE_FILE_ID } from '../../shared/outfitNaming.ts';
import { FOLDER_CATEGORY, meshBase, prettifyName, iconParts, pairKey } from '../../shared/outfitMeshNaming.ts';

const PLACEHOLDER_URL = `https://lh3.googleusercontent.com/d/${PLACEHOLDER_DRIVE_FILE_ID}`;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dryRun !== false;
    const cursor = body?.cursor || null;
    const auth = await driveAuth(base44);

    // --- 1. List root children, build ALLOWED_PARENTS ---
    const rootChildren = [];
    {
      let pageToken = null;
      do {
        const params = new URLSearchParams({
          q: `'${OUTFIT_MESH_FOLDER_ID}' in parents and trashed=false`,
          fields: 'files(id,name,mimeType),nextPageToken', pageSize: '1000',
        });
        if (pageToken) params.set('pageToken', pageToken);
        let res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: auth });
        if (res.status === 429) { await new Promise(r => setTimeout(r, 600)); res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: auth }); }
        if (!res.ok) throw new Error(`Drive root ${res.status}: ${await res.text()}`);
        const data = await res.json();
        for (const f of (data.files || [])) rootChildren.push(f);
        pageToken = data.nextPageToken;
      } while (pageToken);
    }
    const subfolders = rootChildren.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
    const ALLOWED_PARENT_IDS = new Set();
    for (const sf of subfolders) {
      if (FOLDER_CATEGORY[sf.name]) ALLOWED_PARENT_IDS.add(sf.id);
    }

    // --- 2. Walk one level into every subfolder ---
    async function listOneLevel(folderId) {
      const children = [];
      let pageToken = null;
      do {
        const params = new URLSearchParams({
          q: `'${folderId}' in parents and trashed=false`,
          fields: 'files(id,name,mimeType,parents),nextPageToken', pageSize: '1000',
        });
        if (pageToken) params.set('pageToken', pageToken);
        let res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: auth });
        if (res.status === 429) { await new Promise(r => setTimeout(r, 600)); res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: auth }); }
        if (!res.ok) throw new Error(`Drive ${res.status}: ${await res.text()}`);
        const data = await res.json();
        for (const f of (data.files || [])) children.push(f);
        pageToken = data.nextPageToken;
      } while (pageToken);
      return children;
    }

    const allowedFileMap = new Map();
    for (const sf of subfolders) {
      const isAllowed = !!FOLDER_CATEGORY[sf.name];
      const children = await listOneLevel(sf.id);
      for (const f of children) {
        if (f.mimeType === 'application/vnd.google-apps.folder') continue;
        if (f.name && f.name.toLowerCase().endsWith('.obj') && isAllowed && !allowedFileMap.has(f.id)) {
          allowedFileMap.set(f.id, { id: f.id, name: f.name, folderName: sf.name, parents: f.parents || [] });
        }
      }
    }

    // --- 3. Load all OutfitIcon rows ---
    const all = await base44.asServiceRole.entities.OutfitIcon.list('id', 5000);
    if (all.length === 5000) {
      return Response.json({ error: 'OutfitIcon returned 5000 rows — pagination now required' }, { status: 500 });
    }

    // --- 3b. Build icon index + byObjId index ---
    // iconIndex: (category|base) -> icon row, for UNMERGED real icons only (driveFileId, no objDriveFileId)
    // byObjId: objDriveFileId -> row, for all rows with objDriveFileId (existing mesh rows + merged)
    const iconIndex = new Map();
    const byObjId = new Map();
    for (const rec of all) {
      if (rec.objDriveFileId) {
        byObjId.set(rec.objDriveFileId, rec);
      }
      if (rec.driveFileId && !rec.objDriveFileId && rec.iconFileName) {
        const parts = iconParts(rec.iconFileName);
        if (parts) {
          const key = pairKey(parts.category + '|' + parts.base);
          if (!iconIndex.has(key)) iconIndex.set(key, rec);
        }
      }
    }

    // --- 4. Chunk meshes by objDriveFileId (stable sort), filter by cursor ---
    const allMeshes = [...allowedFileMap.values()];
    allMeshes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    let startIdx = 0;
    if (cursor) {
      startIdx = allMeshes.findIndex(m => m.id > cursor);
      if (startIdx === -1) startIdx = allMeshes.length;
    }
    const CHUNK = 250;
    const chunk = allMeshes.slice(startIdx, startIdx + CHUNK);
    const nextCursor = chunk.length ? chunk[chunk.length - 1].id : (cursor || null);
    const done = startIdx + chunk.length >= allMeshes.length;

    // --- 4b. Match: merge mesh→icon, or update/create mesh row ---
    const plannedWrites = [];
    let mergedCount = 0;
    let meshOnlyCount = 0;

    for (const mf of chunk) {
      if (!(mf.parents || []).some(p => ALLOWED_PARENT_IDS.has(p))) continue;
      const folderName = mf.folderName;
      const category = FOLDER_CATEGORY[folderName];
      const base = meshBase(mf.name, folderName);
      if (!base) continue;

      const key = pairKey(category + '|' + base);
      const iconRec = iconIndex.get(key);

      if (iconRec) {
        // MERGE: set category/name/objDriveFileId/objFileName on the icon row.
        // PRESERVE driveFileId, iconFileName, imageUrl.
        plannedWrites.push({ op: 'merge', iconRec, meshId: mf.id, objFileName: mf.name, category, name: prettifyName(base) });
        mergedCount++;
        iconIndex.delete(key); // prevent re-match within this chunk
      } else {
        // No icon match: update existing mesh row (byObjId) or create placeholder.
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

    // --- 5. Write path: sequential (concurrency 1), 200ms spacing, backoff ---
    let writeResult = null;
    if (!dryRun && plannedWrites.length > 0) {
      const errors = [];
      let updated = 0, created = 0, merged = 0;
      let idx = 0;
      const BACKOFFS = [1000, 2000, 4000, 8000, 16000];
      const isRateLimit = (e) => {
        const msg = (typeof e === 'string' ? e : (e?.message || '')) + '';
        return /rate limit|429|too many/i.test(msg);
      };
      async function writeWithRetry(op) {
        if (op.op === 'merge') {
          const patch = { category: op.category, name: op.name, objDriveFileId: op.meshId, objFileName: op.objFileName };
          for (let attempt = 0; ; attempt++) {
            try { await base44.asServiceRole.entities.OutfitIcon.update(op.iconRec.id, patch); return; }
            catch (e) { if (isRateLimit(e) && attempt < BACKOFFS.length) { await new Promise(r => setTimeout(r, BACKOFFS[attempt])); continue; } throw e; }
          }
        } else if (op.op === 'update') {
          const patch = { category: op.category, name: op.name, objFileName: op.objFileName, objDriveFileId: op.meshId };
          if (op.setPlaceholder) patch.imageUrl = PLACEHOLDER_URL;
          for (let attempt = 0; ; attempt++) {
            try { await base44.asServiceRole.entities.OutfitIcon.update(op.iconRec.id, patch); return; }
            catch (e) { if (isRateLimit(e) && attempt < BACKOFFS.length) { await new Promise(r => setTimeout(r, BACKOFFS[attempt])); continue; } throw e; }
          }
        } else {
          const rec = { category: op.category, name: op.name, objFileName: op.objFileName, objDriveFileId: op.meshId, imageUrl: PLACEHOLDER_URL, driveFileId: '', iconFileName: '' };
          for (let attempt = 0; ; attempt++) {
            try { await base44.asServiceRole.entities.OutfitIcon.create(rec); return; }
            catch (e) { if (isRateLimit(e) && attempt < BACKOFFS.length) { await new Promise(r => setTimeout(r, BACKOFFS[attempt])); continue; } throw e; }
          }
        }
      }
      async function worker() {
        while (idx < plannedWrites.length) {
          const op = plannedWrites[idx++];
          try {
            await writeWithRetry(op);
            if (op.op === 'merge') merged++; else if (op.op === 'update') updated++; else created++;
            await new Promise(r => setTimeout(r, 200));
          } catch (e) {
            errors.push({ objFileName: op.objFileName, error: e?.message || String(e) });
          }
        }
      }
      await Promise.all(Array.from({ length: 1 }, () => worker()));
      writeResult = { updated, created, merged, errors };
    }

    // --- 6. On done: backfill unpaired icons + duplicate detection ---
    let iconsBackfilled = 0;
    let duplicateReport = null;

    if (done && !dryRun) {
      const allUpdated = await base44.asServiceRole.entities.OutfitIcon.list('id', 5000);

      // Backfill: icon rows with driveFileId, empty category, empty objDriveFileId → derive from iconFileName
      const backfillWrites = [];
      for (const rec of allUpdated) {
        if (rec.driveFileId && !rec.category && !rec.objDriveFileId && rec.iconFileName) {
          const parts = iconParts(rec.iconFileName);
          if (parts) backfillWrites.push({ id: rec.id, category: parts.category, name: prettifyName(parts.base) });
        }
      }
      if (backfillWrites.length > 0) {
        const BATCH = 100;
        for (let i = 0; i < backfillWrites.length; i += BATCH) {
          const batch = backfillWrites.slice(i, i + BATCH);
          await base44.asServiceRole.entities.OutfitIcon.bulkUpdate(batch);
          iconsBackfilled += batch.length;
        }
      }

      // Duplicate detection: mesh-only rows (no driveFileId) whose (category|name) matches a merged icon row
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

    return Response.json({
      dryRun,
      processedThisRun: chunk.length,
      totalMerged: dryRun ? mergedCount : (writeResult?.merged ?? 0),
      meshOnlyPlaceholders: meshOnlyCount,
      iconsBackfilled,
      redundantDuplicatesFound: duplicateReport,
      errorCount: (writeResult?.errors ?? []).length,
      failedWrites: (writeResult?.errors ?? []).slice(0, 6).map(e => ({ objFileName: e.objFileName, error: e.error })),
      nextCursor,
      done,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
