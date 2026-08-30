import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { driveAuth } from '../../shared/drive.ts';
import { OUTFIT_MESH_FOLDER_ID } from '../../shared/outfitNaming.ts';
import { iconParts, prettifyName, pairKey } from '../../shared/outfitMeshNaming.ts';

// Dedicated backfill: link the 5 Tail .obj meshes (in the Drive "Misc" subfolder,
// Tail_ prefix) to their 5 Tail OutfitIcon rows by pairKey tail|<basename>.
// Does NOT touch the shared mesh-naming allowlist (outfitMeshNaming.ts) — Tail is
// handled inline here because the allowlist omits it. dryRun=true (default) only
// reports the plan; dryRun=false executes the merges.

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dryRun !== false; // default true
    const auth = await driveAuth(base44);

    // --- 1. Find the "Misc" subfolder in the mesh root ---
    let miscFolderId = null;
    {
      const params = new URLSearchParams({
        q: `'${OUTFIT_MESH_FOLDER_ID}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'`,
        fields: 'files(id,name),nextPageToken', pageSize: '1000',
      });
      let res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: auth });
      if (res.status === 429) { await new Promise(r => setTimeout(r, 600)); res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: auth }); }
      if (!res.ok) throw new Error(`Drive root ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const sf = (data.files || []).find(f => /^misc$/i.test(f.name));
      if (!sf) throw new Error('Misc subfolder not found in mesh root');
      miscFolderId = sf.id;
    }

    // --- 2. List Tail_ .obj files in Misc ---
    const tailMeshes = [];
    {
      let pageToken = null;
      do {
        const params = new URLSearchParams({
          q: `'${miscFolderId}' in parents and trashed=false`,
          fields: 'files(id,name),nextPageToken', pageSize: '1000',
        });
        if (pageToken) params.set('pageToken', pageToken);
        let res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: auth });
        if (res.status === 429) { await new Promise(r => setTimeout(r, 600)); res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: auth }); }
        if (!res.ok) throw new Error(`Drive Misc ${res.status}: ${await res.text()}`);
        const data = await res.json();
        for (const f of (data.files || [])) {
          if (f.name && /^tail_.*\.obj$/i.test(f.name)) tailMeshes.push({ id: f.id, name: f.name });
        }
        pageToken = data.nextPageToken;
      } while (pageToken);
    }

    // --- 3. Derive base + pairKey for each Tail mesh ---
    // Tail_ prefix + same suffix strip as meshBase/iconParts. category = 'Tail'.
    const meshPlans = tailMeshes.map((mf) => {
      const base = mf.name.replace(/\.obj$/i, '').replace(/^tail_/i, '').replace(/_(Strip|Comp|Zip|Copy).*$/i, '');
      return {
        meshId: mf.id,
        objFileName: mf.name,
        base,
        category: 'Tail',
        name: prettifyName(base),
        pairKey: pairKey('Tail|' + base),
      };
    });

    // --- 4. Read OutfitIcon rows; build Tail icon index by pairKey (existing iconParts util) ---
    const all = await base44.asServiceRole.entities.OutfitIcon.list('id', 5000);
    const tailIconIndex = new Map(); // pairKey -> row (empty objDriveFileId only)
    const alreadyLinked = [];
    for (const rec of all) {
      const parts = rec.iconFileName ? iconParts(rec.iconFileName) : null;
      if (!parts || parts.category !== 'Tail') continue; // Tail icon rows only
      const k = pairKey(parts.category + '|' + parts.base);
      if (rec.objDriveFileId) {
        // Hard guard: never plan to modify a row whose objDriveFileId is already non-empty.
        alreadyLinked.push({ id: rec.id, name: rec.name, iconFileName: rec.iconFileName, objDriveFileId: rec.objDriveFileId, pairKey: k });
        continue;
      }
      if (!tailIconIndex.has(k)) tailIconIndex.set(k, rec);
    }

    // --- 5. Match meshes to icon rows + plan merges ---
    const plannedMerges = [];
    const unmatchedMeshes = [];
    for (const mp of meshPlans) {
      const iconRec = tailIconIndex.get(mp.pairKey);
      if (iconRec) {
        plannedMerges.push({
          iconRowId: iconRec.id,
          iconRowName: iconRec.name,
          iconFileName: iconRec.iconFileName,
          driveFileId: iconRec.driveFileId,
          matchedMeshObjFileName: mp.objFileName,
          matchedMeshDriveFileId: mp.meshId,
          pairKey: mp.pairKey,
          wouldSet: {
            category: 'Tail',
            name: mp.name,
            objDriveFileId: mp.meshId,
            objFileName: mp.objFileName,
          },
          preserves: { driveFileId: iconRec.driveFileId, iconFileName: iconRec.iconFileName, imageUrl: iconRec.imageUrl },
        });
      } else {
        unmatchedMeshes.push({ objFileName: mp.objFileName, meshId: mp.meshId, pairKey: mp.pairKey });
      }
    }

    // rowsOutsidePlan: every planned merge targets a Tail-category icon row (iconParts === 'Tail') -> 0.
    const rowsOutsidePlan = 0;

    // --- 6. dryRun: report only ---
    if (dryRun) {
      return Response.json({
        dryRun: true,
        tailMeshCount: tailMeshes.length,
        tailIconRowCount: tailIconIndex.size + alreadyLinked.length,
        plannedMerges,
        unmatchedMeshes,
        alreadyLinkedTailIcons: alreadyLinked,
        rowsOutsidePlan,
      });
    }

    // --- 7. Execute merges (dryRun=false) ---
    let merged = 0;
    const errors = [];
    for (const m of plannedMerges) {
      try {
        await base44.asServiceRole.entities.OutfitIcon.update(m.iconRowId, {
          category: m.wouldSet.category,
          name: m.wouldSet.name,
          objDriveFileId: m.wouldSet.objDriveFileId,
          objFileName: m.wouldSet.objFileName,
        });
        merged++;
      } catch (e) {
        errors.push({ iconRowId: m.iconRowId, iconRowName: m.iconRowName, error: e?.message || String(e) });
      }
    }
    return Response.json({ dryRun: false, merged, errors, plannedMerges });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
