import { pool } from '../db.js';

const PAGE_SIZE_DEFAULT = 50;

async function getStatus() {
  const { rows } = await pool.query(
    `select last_synced_at as "lastSyncedAt", file_count as "fileCount", status from library_sync_status order by id desc limit 1`
  );
  return rows[0] || null;
}

export async function browseMeshFiles(req, res) {
  try {
    const { search = '', folder = '', page = 1, pageSize = PAGE_SIZE_DEFAULT, listFolders = false } = req.body || {};

    const status = await getStatus();
    const lastSyncedAt = status?.lastSyncedAt || null;

    if (!status) {
      return res.json({ files: [], total: 0, needsSync: true, lastSyncedAt, folders: [], page: 1, pageSize });
    }

    if (listFolders) {
      const { rows } = await pool.query(
        `select distinct split_part(folder_path, '/', 1) as folder from mesh_files where folder_path <> '' order by 1`
      );
      return res.json({ folders: rows.map((r) => r.folder).filter(Boolean), lastSyncedAt, needsSync: false });
    }

    const conditions = [];
    const params = [];
    const q = (search || '').toLowerCase().trim();
    if (q) {
      params.push(`%${q}%`);
      conditions.push(`lower(name) like $${params.length}`);
    }
    if (folder) {
      params.push(folder);
      conditions.push(`split_part(folder_path, '/', 1) = $${params.length}`);
    }
    const where = conditions.length ? `where ${conditions.join(' and ')}` : '';

    const countRes = await pool.query(`select count(*)::int as total from mesh_files ${where}`, params);
    const total = countRes.rows[0].total;
    const maxPage = Math.max(1, Math.ceil(total / pageSize));
    const p = Math.max(1, Math.min(page, maxPage));
    const offset = (p - 1) * pageSize;

    const listParams = [...params, pageSize, offset];
    const { rows: files } = await pool.query(
      `select drive_file_id as "driveFileId", name, size, folder_path as "folderPath"
       from mesh_files ${where}
       order by lower(name)
       limit $${listParams.length - 1} offset $${listParams.length}`,
      listParams
    );

    res.json({ files, total, page: p, pageSize, lastSyncedAt, needsSync: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
