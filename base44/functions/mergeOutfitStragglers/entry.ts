import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { driveAuth } from '../../shared/drive.ts';
import { OUTFIT_MESH_FOLDER_ID } from '../../shared/outfitNaming.ts';
import { FOLDER_CATEGORY, meshBase, prettifyName, iconParts, pairKey } from '../../shared/outfitMeshNaming.ts';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const targets = body?.objFileNames || [];

    if (!targets.length) {
      return Response.json({ error: 'No objFileNames provided' }, { status: 400 });
    }

    const auth = await driveAuth(base44);

    // --- 1. Walk Drive to find target files by exact name ---
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

    const targetSet = new Set(targets);
    const ALLOWED_PARENT_IDS = new Set();
    for (const sf of subfolders) {
      if (FOLDER_CATEGORY[sf.name]) ALLOWED_PARENT_IDS.add(sf.id);
    }

    const foundFiles = [];
    for (const sf of subfolders) {
      if (!FOLDER_CATEGORY[sf.name]) continue;
      const children = await listOneLevel(sf.id);
      for (const f of children) {
        if (f.mimeType === 'application/vnd.google-apps.folder') continue;
        if (targetSet.has(f.name)) {
          foundFiles.push({ id: f.id, name: f.name, folderName: sf.name, parents: f.parents || [] });
        }
      }
    }

    // --- 2. Load all OutfitIcon rows, build iconIndex + byObjId ---
    const all = await base44.asServiceRole.entities.OutfitIcon.list('id', 5000);
    if (all.length === 5000) {
      return Response.json({ error: 'OutfitIcon returned 5000 rows — pagination now required' }, { status: 500 });
    }
    const iconIndex = new Map();
    const mergedByObjId = new Map();
    for (const rec of all) {
      if (rec.driveFileId && rec.objDriveFileId) {
        mergedByObjId.set(rec.objDriveFileId, rec);
      }
      if (rec.driveFileId && !rec.objDriveFileId && rec.iconFileName) {
        const parts = iconParts(rec.iconFileName);
        if (parts) {
          const key = pairKey(parts.category + '|' + parts.base);
          if (!iconIndex.has(key)) iconIndex.set(key, rec);
        }
      }
    }

    // --- 3. For each target, find icon match and plan merge ---
    const results = [];
    const plannedMerges = [];

    for (const target of targets) {
      if (!foundFiles.some(f => f.name === target)) {
        results.push({ objFileName: target, status: 'not_found_in_drive' });
      }
    }

    for (const tf of foundFiles) {
      if (!(tf.parents || []).some(p => ALLOWED_PARENT_IDS.has(p))) {
        results.push({ objFileName: tf.name, status: 'skipped', reason: 'not in allowed parent' });
        continue;
      }
      const category = FOLDER_CATEGORY[tf.folderName];
      const base = meshBase(tf.name, tf.folderName);
      if (!base) {
        results.push({ objFileName: tf.name, status: 'skipped', reason: 'could not derive base name' });
        continue;
      }

      const key = pairKey(category + '|' + base);
      const iconRec = iconIndex.get(key);

      if (!iconRec) {
        const mergedRow = mergedByObjId.get(tf.id);
        if (mergedRow) {
          results.push({ objFileName: tf.name, status: 'already_merged', iconName: mergedRow.name, category: mergedRow.category });
        } else {
          results.push({ objFileName: tf.name, status: 'no_icon', category, base });
        }
        continue;
      }

      plannedMerges.push({ iconRec, meshId: tf.id, objFileName: tf.name, category, name: prettifyName(base) });
    }

    // --- 4. Sequential writes with 7-attempt backoff, 1s pause between ---
    const BACKOFFS = [1000, 2000, 4000, 8000, 16000, 32000, 60000];
    const isRateLimit = (e) => {
      const msg = (typeof e === 'string' ? e : (e?.message || '')) + '';
      return /rate limit|429|too many/i.test(msg);
    };

    let errorCount = 0;
    for (let i = 0; i < plannedMerges.length; i++) {
      const op = plannedMerges[i];
      const patch = { category: op.category, name: op.name, objDriveFileId: op.meshId, objFileName: op.objFileName };
      let merged = false;
      let lastError = null;
      for (let attempt = 0; attempt < BACKOFFS.length; attempt++) {
        try {
          await base44.asServiceRole.entities.OutfitIcon.update(op.iconRec.id, patch);
          merged = true;
          break;
        } catch (e) {
          lastError = e;
          if (isRateLimit(e) && attempt < BACKOFFS.length - 1) {
            await new Promise(r => setTimeout(r, BACKOFFS[attempt]));
            continue;
          }
          break;
        }
      }
      if (merged) {
        results.push({ objFileName: op.objFileName, status: 'merged', iconName: op.name, category: op.category });
      } else {
        errorCount++;
        results.push({ objFileName: op.objFileName, status: 'failed', error: lastError?.message || String(lastError) });
      }
      if (i < plannedMerges.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    return Response.json({ results, errorCount });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
