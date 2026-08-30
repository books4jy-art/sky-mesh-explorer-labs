import { pool } from '../db.js';
import { driveAuth } from '../drive.js';
import { DRIVE_FOLDER_ID } from '../config.js';

async function getOrCreateStatusId() {
  const { rows } = await pool.query(`select id from library_sync_status order by id desc limit 1`);
  if (rows.length) return rows[0].id;
  const inserted = await pool.query(
    `insert into library_sync_status (status, file_count, last_synced_at) values ('syncing', 0, now()) returning id`
  );
  return inserted.rows[0].id;
}

export async function syncDriveLibrary(req, res) {
  let statusId = null;
  try {
    const auth = await driveAuth();
    statusId = await getOrCreateStatusId();
    await pool.query(`update library_sync_status set status = 'syncing' where id = $1`, [statusId]);

    // Recursive walk, tracks folderPath
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
        let driveRes = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, { headers: auth });
        if (driveRes.status === 429) {
          await new Promise((r) => setTimeout(r, 600));
          driveRes = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, { headers: auth });
        }
        if (!driveRes.ok) throw new Error(`Drive list error ${driveRes.status}: ${await driveRes.text()}`);
        const data = await driveRes.json();
        for (const f of data.files || []) {
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
        await Promise.all(
          subfolders.slice(i, i + CONCURRENCY).map((sf) => listFolder(sf.id, path ? path + '/' + sf.name : sf.name))
        );
      }
    }
    await listFolder(DRIVE_FOLDER_ID, '');

    // Upsert everything we found — idempotent, no need to diff against existing rows first.
    const BATCH = 500;
    let synced = 0;
    for (let i = 0; i < objFiles.length; i += BATCH) {
      const batch = objFiles.slice(i, i + BATCH);
      const values = [];
      const params = [];
      batch.forEach((f, idx) => {
        const base = idx * 4;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
        params.push(f.driveFileId, f.name, f.size, f.folderPath);
      });
      const result = await pool.query(
        `insert into mesh_files (drive_file_id, name, size, folder_path)
         values ${values.join(',')}
         on conflict (drive_file_id) do update set name = excluded.name, size = excluded.size, folder_path = excluded.folder_path
         returning (xmax = 0) as inserted`,
        params
      );
      synced += result.rows.filter((r) => r.inserted).length;
    }

    const { rows: countRows } = await pool.query(`select count(*)::int as total from mesh_files`);
    const total = countRows[0].total;

    await pool.query(
      `update library_sync_status set status = 'done', file_count = $2, last_synced_at = now() where id = $1`,
      [statusId, total]
    );

    res.json({ status: 'done', synced, total: objFiles.length, existing: total - synced });
  } catch (error) {
    if (statusId) {
      try {
        await pool.query(`update library_sync_status set status = 'error' where id = $1`, [statusId]);
      } catch {}
    }
    res.status(500).json({ error: error.message });
  }
}
