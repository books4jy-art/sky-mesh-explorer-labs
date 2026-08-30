import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { driveAuth } from '../../shared/drive.ts';

const ICON_ROOT_FOLDER_ID = '1zphd4EeUovcVKQ7BfY4yqMu8NcUU3LN9';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const auth = await driveAuth(base44);

    // --- 1. Recursively walk the icon folder tree, collecting all PNG files ---
    async function listChildren(folderId) {
      const children = [];
      let pageToken = null;
      do {
        const params = new URLSearchParams({
          q: `'${folderId}' in parents and trashed=false`,
          fields: 'files(id,name,mimeType),nextPageToken', pageSize: '1000',
        });
        if (pageToken) params.set('pageToken', pageToken);
        let res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: auth });
        if (res.status === 429) { await new Promise(r => setTimeout(r, 1000)); res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: auth }); }
        if (!res.ok) throw new Error(`Drive ${res.status}: ${await res.text()}`);
        const data = await res.json();
        for (const f of (data.files || [])) children.push(f);
        pageToken = data.nextPageToken;
      } while (pageToken);
      return children;
    }

    const allPngs = []; // { id, name }
    const queue = [ICON_ROOT_FOLDER_ID];
    const visited = new Set([ICON_ROOT_FOLDER_ID]);
    while (queue.length > 0) {
      const folderId = queue.shift();
      const children = await listChildren(folderId);
      for (const f of children) {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          if (!visited.has(f.id)) { visited.add(f.id); queue.push(f.id); }
        } else if (f.name && /\.png$/i.test(f.name)) {
          allPngs.push({ id: f.id, name: f.name });
        }
      }
    }

    // --- 2. Categorize by prefix ---
    const EXCLUDED_PREFIXES = ['UiSocial', 'UiPersonality', 'UiSharedSpace', 'UiRadial'];
    let driveOutfitIcons = 0;
    const excludedByPrefixMap = new Map(); // prefix -> count
    let excludedOther = 0; // PNGs not starting with UiOutfit and not matching a known excluded prefix

    const outfitPngs = []; // { id, name } for UiOutfit* PNGs
    for (const png of allPngs) {
      if (png.name.startsWith('UiOutfit')) {
        driveOutfitIcons++;
        outfitPngs.push(png);
      } else {
        const matched = EXCLUDED_PREFIXES.find(p => png.name.startsWith(p));
        if (matched) {
          excludedByPrefixMap.set(matched, (excludedByPrefixMap.get(matched) || 0) + 1);
        } else {
          // Capture the distinct prefix (first capitalized run, e.g. "UiXYZ" or first word)
          const m = png.name.match(/^([A-Z][a-z]+)/);
          const prefix = m ? m[1] : png.name.slice(0, 8);
          if (!excludedByPrefixMap.has(prefix)) excludedByPrefixMap.set(prefix, 0);
          excludedByPrefixMap.set(prefix, excludedByPrefixMap.get(prefix) + 1);
          excludedOther++;
        }
      }
    }

    // --- 3. Load OutfitIcon rows, build driveFileId set ---
    const all = await base44.asServiceRole.entities.OutfitIcon.list('id', 5000);
    if (all.length === 5000) {
      return Response.json({ error: 'OutfitIcon returned 5000 rows — pagination now required' }, { status: 500 });
    }

    const entityDriveIds = new Set();
    const entityRowsWithDriveId = [];
    for (const rec of all) {
      if (rec.driveFileId && rec.driveFileId.trim()) {
        entityDriveIds.add(rec.driveFileId);
        entityRowsWithDriveId.push(rec);
      }
    }

    // --- 4. Reconcile ---
    const driveIdsSet = new Set(outfitPngs.map(p => p.id));
    const inDriveNotInEntity = outfitPngs.filter(p => !entityDriveIds.has(p.id));
    const inEntityNotInDrive = entityRowsWithDriveId.filter(r => !driveIdsSet.has(r.driveFileId));

    return Response.json({
      driveIconsTotal: allPngs.length,
      driveOutfitIcons: driveOutfitIcons,
      excludedByPrefixCount: allPngs.length - driveOutfitIcons,
      excludedByPrefixBreakdown: Object.fromEntries([...excludedByPrefixMap.entries()].sort((a, b) => b[1] - a[1])),
      entityIconRows: entityRowsWithDriveId.length,
      inDriveNotInEntityCount: inDriveNotInEntity.length,
      inDriveNotInEntityExamples: inDriveNotInEntity.slice(0, 15).map(p => p.name),
      inEntityNotInDriveCount: inEntityNotInDrive.length,
      inEntityNotInDriveExamples: inEntityNotInDrive.slice(0, 10).map(r => ({ driveFileId: r.driveFileId, name: r.name || r.iconFileName || '' })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
