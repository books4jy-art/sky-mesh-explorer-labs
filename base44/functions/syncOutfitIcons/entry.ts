import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { driveAuth } from '../../shared/drive.ts';
import { OUTFIT_ICON_FOLDER_ID, iconBaseName } from '../../shared/outfitNaming.ts';

// Bounded concurrency pool — preserves order so errors line up with their item.
async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      try { results[cur] = await fn(items[cur]); }
      catch (e) { results[cur] = { _error: e.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const auth = await driveAuth(base44);

    // List all files in the icon folder
    const files = [];
    let pageToken = null;
    do {
      const params = new URLSearchParams({
        q: `'${OUTFIT_ICON_FOLDER_ID}' in parents and trashed=false`,
        fields: 'files(id,name,mimeType),nextPageToken',
        pageSize: '1000',
      });
      if (pageToken) params.set('pageToken', pageToken);
      let res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, { headers: auth });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 600));
        res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, { headers: auth });
      }
      if (!res.ok) throw new Error(`Drive list error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      for (const f of data.files || []) {
        if (f.mimeType === 'application/vnd.google-apps.folder') continue;
        files.push({ id: f.id, name: f.name });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    const skipped = [];
    const matching = files.filter((f) => {
      if (iconBaseName(f.name)) return true;
      skipped.push(f.name);
      return false;
    });

    // Pre-fetch all existing OutfitIcon records into a Map (one paginated query,
    // not a per-file DB hit) — uniqueness is enforced here, not by a unique flag.
    const existing = new Map();
    let lastId = null;
    while (true) {
      const recs = lastId
        ? await base44.asServiceRole.entities.OutfitIcon.filter({ driveFileId: { $gt: lastId } }, 'driveFileId', 5000)
        : await base44.asServiceRole.entities.OutfitIcon.filter({}, 'driveFileId', 5000);
      if (recs.length === 0) break;
      for (const r of recs) existing.set(r.driveFileId, r);
      const newLast = recs[recs.length - 1].driveFileId;
      if (recs.length < 5000 || newLast === lastId) break;
      lastId = newLast;
    }

    console.log('[syncOutfitIcons] existing in Map:', existing.size, 'matching:', matching.length);

    const toCreate = [];
    const toUpdate = [];
    for (const png of matching) {
      const rec = existing.get(png.id);
      if (rec) {
        const patch = {};
        if (!rec.iconFileName) patch.iconFileName = png.name;
        if (Object.keys(patch).length) toUpdate.push({ rec, png, patch });
        continue;
      }
      toCreate.push(png);
    }

    let created = 0, updated = 0;
    const errors = [];

    // Updates: patch iconFileName only (imageUrl stays untouched on existing records)
    if (toUpdate.length) {
      for (const { rec, patch } of toUpdate) {
        await base44.asServiceRole.entities.OutfitIcon.update(rec.id, patch);
        updated++;
      }
    }

    console.log('[syncOutfitIcons] toCreate:', toCreate.length, 'toUpdate:', toUpdate.length);

    // Creates: record { driveFileId, iconFileName } directly — imageUrl left empty,
    // resolved at render time via outfitIconBatch (no integration credits used)
    if (toCreate.length) {
      const BATCH = 500;
      for (let i = 0; i < toCreate.length; i += BATCH) {
        const batch = toCreate.slice(i, i + BATCH).map((png) => ({ driveFileId: png.id, iconFileName: png.name }));
        await base44.asServiceRole.entities.OutfitIcon.bulkCreate(batch);
        created += batch.length;
        if (i + BATCH < toCreate.length) await new Promise((r) => setTimeout(r, 2000));
      }
    }

    return Response.json({
      folder: OUTFIT_ICON_FOLDER_ID,
      scanned: files.length,
      matchedPrefix: matching.length,
      created, updated,
      skippedNonOutfit: skipped,
      errors,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
