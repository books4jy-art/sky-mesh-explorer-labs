import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { DRIVE_FOLDER_ID, driveAuth } from '../../shared/drive.ts';

export default async function(req) {
  let base44 = null;
  let statusId = null;
  try {
    base44 = createClientFromRequest(req);
    const auth = await driveAuth(base44);

    // Mark syncing (singleton LibrarySyncStatus)
    try {
      const existing = await base44.asServiceRole.entities.LibrarySyncStatus.list();
      if (existing.length > 0) {
        statusId = existing[0].id;
        await base44.asServiceRole.entities.LibrarySyncStatus.update(statusId, { status: 'syncing' });
      } else {
        const created = await base44.asServiceRole.entities.LibrarySyncStatus.create({ status: 'syncing', fileCount: 0, lastSyncedAt: new Date().toISOString() });
        statusId = created.id;
      }
    } catch (e) { /* best-effort */ }

    // Recursive walk — same shape as listDriveObjFiles, tracks folderPath
    const objFiles = [];
    const seen = new Set();
    const fileSeen = new Set();
    async function listFolder(folderId, path) {
      if (seen.has(folderId)) return;
      seen.add(folderId);
      const subfolders = [];
      let pageToken = null;
      do {
        const params = new URLSearchParams({
          q: `'${folderId}' in parents and trashed=false`,
          fields: 'files(id,name,mimeType,size),nextPageToken',
          pageSize: '1000',
        });
        if (pageToken) params.set('pageToken', pageToken);
        let res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, { headers: auth });
        if (res.status === 429) { await new Promise((r) => setTimeout(r, 600)); res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, { headers: auth }); }
        if (!res.ok) {
          const t = await res.text();
          throw new Error(`Drive list error ${res.status}: ${t}`);
        }
        const data = await res.json();
        for (const f of (data.files || [])) {
          if (f.mimeType === 'application/vnd.google-apps.folder') subfolders.push({ id: f.id, name: f.name });
          else if (f.name && f.name.toLowerCase().endsWith('.obj')) {
            if (!fileSeen.has(f.id)) {
              fileSeen.add(f.id);
              objFiles.push({ driveFileId: f.id, name: f.name, size: f.size ? Number(f.size) : 0, folderPath: path });
            }
          }
        }
        pageToken = data.nextPageToken;
      } while (pageToken);
      const CONCURRENCY = 10;
      for (let i = 0; i < subfolders.length; i += CONCURRENCY) {
        await Promise.all(subfolders.slice(i, i + CONCURRENCY).map((sf) => listFolder(sf.id, path ? path + '/' + sf.name : sf.name)));
      }
    }
    await listFolder(DRIVE_FOLDER_ID, '');

    // Fetch already-synced driveFileIds from the cache file (avoids reading all entity records)
    const existingIds = new Set();
    try {
      const statusRec = await base44.asServiceRole.entities.LibrarySyncStatus.list();
      const oldCacheUrl = statusRec[0]?.cacheFileUrl;
      if (oldCacheUrl) {
        const cacheRes = await fetch(oldCacheUrl);
        if (cacheRes.ok) {
          const cacheJson = await cacheRes.json();
          for (const f of (cacheJson.files || [])) existingIds.add(f.driveFileId);
        }
      }
    } catch (e) { /* best-effort */ }
    // Fallback: read from entity if no cache file available
    if (existingIds.size === 0) {
      let lastId = null;
      while (true) {
        const recs = lastId
          ? await base44.asServiceRole.entities.MeshFile.filter({ driveFileId: { $gt: lastId } }, 'driveFileId', 5000)
          : await base44.asServiceRole.entities.MeshFile.filter({}, 'driveFileId', 5000);
        if (recs.length === 0) break;
        for (const r of recs) existingIds.add(r.driveFileId);
        const newLast = recs[recs.length - 1].driveFileId;
        if (recs.length < 5000 || newLast === lastId) break;
        lastId = newLast;
      }
    }

    const newFiles = objFiles.filter((f) => !existingIds.has(f.driveFileId));

    // Insert new records in batches, paced to stay under the app's per-minute write-volume limit
    const BATCH = 500;
    for (let i = 0; i < newFiles.length; i += BATCH) {
      const batch = newFiles.slice(i, i + BATCH);
      await base44.asServiceRole.entities.MeshFile.bulkCreate(batch);
      if (i + BATCH < newFiles.length) await new Promise((r) => setTimeout(r, 3000));
    }

    // Build and upload a cache file (so browseMeshFiles never reads all entity records)
    let cacheFileUrl = null;
    try {
      const sortedFiles = objFiles.slice().sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      const cacheData = JSON.stringify({ files: sortedFiles, builtAt: Date.now() });
      const blob = new Blob([cacheData], { type: 'application/json' });
      const file = new File([blob], 'mesh-cache.json', { type: 'application/json' });
      const uploaded = await base44.asServiceRole.integrations.Core.UploadFile({ file });
      cacheFileUrl = uploaded.file_url;
    } catch (e) { /* best-effort — browseMeshFiles will return needsSync */ }

    // Mark done
    try {
      const fileCount = existingIds.size + newFiles.length;
      await base44.asServiceRole.entities.LibrarySyncStatus.update(statusId, { status: 'done', fileCount, lastSyncedAt: new Date().toISOString(), cacheFileUrl });
    } catch (e) { /* best-effort */ }

    return Response.json({ status: 'done', synced: newFiles.length, total: objFiles.length, existing: existingIds.size });
  } catch (error) {
    try { if (base44 && statusId) await base44.asServiceRole.entities.LibrarySyncStatus.update(statusId, { status: 'error' }); } catch (e) {}
    return Response.json({ error: error.message }, { status: 500 });
  }
}
