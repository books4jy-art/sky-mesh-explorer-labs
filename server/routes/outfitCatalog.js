import { pool } from '../db.js';

const TTL = 5 * 60 * 1000;
let CACHE = null;
let CACHE_AT = 0;

export async function outfitCatalog(req, res) {
  try {
    const refresh = !!(req.body && req.body.refresh);
    if (CACHE && !refresh && Date.now() - CACHE_AT < TTL) {
      return res.json({ items: CACHE.items, categories: CACHE.categories, count: CACHE.count, cachedAt: CACHE_AT });
    }

    const { rows } = await pool.query(`
      select id, name, category, drive_file_id as "driveFileId", image_url as "imageUrl",
             obj_drive_file_id as "objDriveFileId", obj_file_name as "objFileName",
             alt_obj_drive_file_id as "altObjDriveFileId", alt_obj_file_name as "altObjFileName"
      from outfit_icons
      where category is not null and trim(category) <> ''
      order by category, name
    `);

    const catMap = new Map();
    for (const r of rows) catMap.set(r.category, (catMap.get(r.category) || 0) + 1);
    const categories = [...catMap.entries()].map(([category, count]) => ({ category, count }));

    CACHE = { items: rows, categories, count: rows.length };
    CACHE_AT = Date.now();
    res.json({ items: rows, categories, count: rows.length, cachedAt: CACHE_AT });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
