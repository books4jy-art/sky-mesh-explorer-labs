import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

const PAGE_SIZE_DEFAULT = 50;
let memCache = null; // { url, data, builtAt }
let statusCache = null; // { data, builtAt }

async function getStatus(base44) {
  if (statusCache && (Date.now() - statusCache.builtAt < 60 * 1000)) {
    return statusCache.data;
  }
  const status = await base44.asServiceRole.entities.LibrarySyncStatus.list();
  const data = status[0] || {};
  statusCache = { data, builtAt: Date.now() };
  return data;
}

async function getCacheData(cacheFileUrl) {
  if (memCache && memCache.url === cacheFileUrl && (Date.now() - memCache.builtAt < 5 * 60 * 1000)) {
    return memCache.data;
  }
  const res = await fetch(cacheFileUrl);
  if (!res.ok) throw new Error(`Cache file fetch failed: ${res.status}`);
  const data = await res.json();
  if (data.files) {
    data.files.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }
  memCache = { url: cacheFileUrl, data, builtAt: Date.now() };
  return data;
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { search = '', folder = '', page = 1, pageSize = PAGE_SIZE_DEFAULT, listFolders = false, refreshCache = false } = body;

    if (refreshCache) { memCache = null; statusCache = null; }

    const status = await getStatus(base44);
    const cacheFileUrl = status.cacheFileUrl;
    const lastSyncedAt = status.lastSyncedAt || null;

    if (!cacheFileUrl) {
      return Response.json({ files: [], total: 0, needsSync: true, lastSyncedAt, folders: [], page: 1, pageSize });
    }

    let cache;
    try {
      cache = await getCacheData(cacheFileUrl);
    } catch (e) {
      return Response.json({ files: [], total: 0, needsSync: true, lastSyncedAt, folders: [], page: 1, pageSize });
    }

    const all = cache.files || [];

    if (listFolders) {
      const folders = new Set();
      for (const r of all) {
        if (r.folderPath) folders.add(r.folderPath.split('/')[0]);
      }
      return Response.json({ folders: Array.from(folders).sort(), lastSyncedAt, needsSync: false });
    }

    let filtered = all;
    const q = (search || '').toLowerCase().trim();
    if (q) filtered = filtered.filter((f) => f.name.toLowerCase().includes(q));
    if (folder) filtered = filtered.filter((f) => (f.folderPath || '').split('/')[0] === folder);

    const total = filtered.length;
    const maxPage = Math.ceil(total / pageSize) || 1;
    const p = Math.max(1, Math.min(page, maxPage));
    const start = (p - 1) * pageSize;
    const files = filtered.slice(start, start + pageSize);

    return Response.json({ files, total, page: p, pageSize, lastSyncedAt, needsSync: false });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
