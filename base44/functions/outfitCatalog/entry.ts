import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

let CACHE = null;
let CACHE_AT = 0;
const TTL = 5 * 60 * 1000;

export default async function (req) {
  try {
    const body = await req.json().catch(() => ({}));
    const refresh = !!(body && body.refresh);
    if (CACHE && !refresh && Date.now() - CACHE_AT < TTL) {
      return Response.json({ items: CACHE.items, categories: CACHE.categories, count: CACHE.count, cachedAt: CACHE_AT });
    }
    const base44 = createClientFromRequest(req);
    // ONE entity read, sorted by category. Stops the client hammering the read limit.
    const rows = await base44.asServiceRole.entities.OutfitIcon.list('category', 5000);
    if (rows.length === 5000) {
      return Response.json({ error: 'OutfitIcon returned 5000 rows — pagination required', rowsAtLimit: true }, { status: 500 });
    }
    const items = rows
      .filter((r) => r.category && r.category.trim() !== '')
      .map((r) => ({ id: r.id, name: r.name, category: r.category, driveFileId: r.driveFileId, imageUrl: r.imageUrl, objDriveFileId: r.objDriveFileId, objFileName: r.objFileName }))
      .sort((a, b) => {
        const c = (a.category || '').localeCompare(b.category || '');
        return c !== 0 ? c : (a.name || '').localeCompare(b.name || '');
      });
    const catMap = new Map();
    for (const r of rows) {
      if (r.category && r.category.trim() !== '') {
        catMap.set(r.category, (catMap.get(r.category) || 0) + 1);
      }
    }
    const categories = [...catMap.entries()].map(([category, count]) => ({ category, count }));
    CACHE = { items, categories, count: items.length };
    CACHE_AT = Date.now();
    return Response.json({ items, categories, count: items.length, cachedAt: CACHE_AT });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
