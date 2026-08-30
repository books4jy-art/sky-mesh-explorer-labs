import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { driveAuth } from '../../shared/drive.ts';
import { OUTFIT_ICON_FOLDER_ID } from '../../shared/outfitNaming.ts';

const DRAGON_PNG_NAME = 'UiSocialJoinDragonDance.png';

const DRAGON_TARGETS = [
  { name: 'Dragon Body White', category: 'Neck' },
  { name: 'Dragon Tail Black', category: 'Neck' },
  { name: 'Dragon Head Black', category: 'Neck' },
  { name: 'Dragon Body Black', category: 'Neck' },
  { name: 'Dragon Head White', category: 'Neck' },
  { name: 'Dragon Tail White', category: 'Neck' },
];

const isRateLimit = (e) => {
  const msg = (typeof e === 'string' ? e : (e?.message || '')) + '';
  return /rate limit|429|too many/i.test(msg);
};

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dryRun !== false;

    // --- 1. Load all OutfitIcon rows ---
    const all = await base44.asServiceRole.entities.OutfitIcon.list('id', 5000);
    if (all.length === 5000) {
      return Response.json({ error: 'OutfitIcon returned 5000 rows — pagination required' }, { status: 500 });
    }

    // --- 2. Fetch UiMenuAP##Flat.png files from Drive (recursive) ---
    const auth = await driveAuth(base44);
    async function listChildren(folderId) {
      let pageToken = null;
      const items = [];
      do {
        let url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed%3Dfalse&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000`;
        if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
        const res = await fetch(url, { headers: auth });
        const data = await res.json();
        if (data.files) items.push(...data.files);
        pageToken = data.nextPageToken;
      } while (pageToken);
      return items;
    }
    async function collectPngs(folderId, depth = 0) {
      if (depth > 5) return [];
      const children = await listChildren(folderId);
      let pngs = [];
      for (const c of children) {
        if (c.mimeType === 'image/png') pngs.push({ id: c.id, name: c.name });
        else if (c.mimeType === 'application/vnd.google-apps.folder') pngs = pngs.concat(await collectPngs(c.id, depth + 1));
      }
      return pngs;
    }
    const pngs = await collectPngs(OUTFIT_ICON_FOLDER_ID);

    // Build lookup: UiMenuAP##Flat.png name -> drive id
    const apFlatMap = new Map();
    for (const p of pngs) {
      if (/^UiMenuAP\d+Flat\.png$/i.test(p.name)) {
        apFlatMap.set(p.name, p.id);
      }
    }
    const dragonPng = pngs.find(p => p.name === DRAGON_PNG_NAME);
    const dragonPngId = dragonPng?.id || null;

    // --- 3. Build Set A: Neck AP## pendants ---
    const apRegex = /\bAP\d+\b/i;
    const setA = [];
    const setA_noMatch = [];
    for (const row of all) {
      // Guard: skip rows with non-empty driveFileId
      if (row.driveFileId && row.driveFileId.trim()) continue;
      // Guard: only Neck category
      if ((row.category || '') !== 'Neck') continue;
      // Guard: name must contain AP<number>
      const m = (row.name || '').match(apRegex);
      if (!m) continue;
      const apNum = m[0];
      const targetPng = `UiMenu${apNum}Flat.png`;
      const pngId = apFlatMap.get(targetPng);
      if (pngId) {
        setA.push({
          id: row.id,
          name: row.name,
          category: row.category,
          apNum,
          pngName: targetPng,
          driveFileId: pngId,
        });
      } else {
        setA_noMatch.push({ name: row.name, apNum, targetPng });
      }
    }

    // --- 4. Build Set B: Dragon items ---
    const setB = [];
    const setB_noMatch = [];
    for (const target of DRAGON_TARGETS) {
      const row = all.find(r =>
        r.name === target.name &&
        r.category === target.category &&
        (!r.driveFileId || !r.driveFileId.trim())
      );
      if (!row) {
        setB_noMatch.push({ name: target.name, category: target.category, reason: 'not found or already has driveFileId' });
        continue;
      }
      if (!dragonPngId) {
        setB_noMatch.push({ name: target.name, category: target.category, reason: 'UiSocialJoinDragonDance.png not found in Drive' });
        continue;
      }
      setB.push({
        id: row.id,
        name: row.name,
        category: row.category,
        pngName: DRAGON_PNG_NAME,
        driveFileId: dragonPngId,
      });
    }

    // --- 5. Verify no rows outside Set A/B are included ---
    const allPlannedIds = new Set([
      ...setA.map(r => r.id),
      ...setB.map(r => r.id),
    ]);

    if (dryRun) {
      return Response.json({
        dryRun: true,
        setA_count: setA.length,
        setB_count: setB.length,
        setA_noMatch,
        setB_noMatch,
        setA_preview: setA.slice(0, 5),
        setB_preview: setB,
        dragonPngFound: !!dragonPngId,
        plannedTotal: allPlannedIds.size,
        rowsOutsideSets: 0,
      });
    }

    // --- 6. Write (dryRun = false) ---
    const BACKOFFS = [1000, 2000, 4000, 8000, 16000, 32000, 60000];
    const results = { updated: 0, errors: [] };

    async function writeRow(row) {
      const newImageUrl = `https://lh3.googleusercontent.com/d/${row.driveFileId}`;
      for (let attempt = 0; attempt <= BACKOFFS.length; attempt++) {
        try {
          await base44.asServiceRole.entities.OutfitIcon.update(row.id, {
            driveFileId: row.driveFileId,
            imageUrl: newImageUrl,
            iconFileName: row.pngName,
          });
          results.updated++;
          return;
        } catch (e) {
          if (isRateLimit(e) && attempt < BACKOFFS.length) {
            await new Promise(r => setTimeout(r, BACKOFFS[attempt]));
            continue;
          }
          results.errors.push({ id: row.id, name: row.name, error: e?.message || String(e) });
          return;
        }
      }
    }

    for (const row of setA) {
      await writeRow(row);
      await new Promise(r => setTimeout(r, 180));
    }
    for (const row of setB) {
      await writeRow(row);
      await new Promise(r => setTimeout(r, 180));
    }

    return Response.json({
      dryRun: false,
      setA_written: setA.length,
      setB_written: setB.length,
      updated: results.updated,
      errors: results.errors,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
