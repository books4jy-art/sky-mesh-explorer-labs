// Read-only: recursively lists every .obj file under DRIVE_FOLDER_ID.
// Mostly superseded by syncDriveLibrary (which persists to Postgres) — useful
// for a quick sanity check of what's actually in Drive.
//   node server/scripts/listDriveObjFiles.js
import 'dotenv/config';
import { driveAuth } from '../drive.js';
import { DRIVE_FOLDER_ID } from '../config.js';
import { listChildren } from '../driveList.js';

async function main() {
  const auth = await driveAuth();
  const objFiles = [];
  const seen = new Set();

  async function walk(folderId) {
    if (seen.has(folderId)) return;
    seen.add(folderId);
    const children = await listChildren(folderId, auth, 'files(id,name,mimeType,size),nextPageToken');
    const subfolders = [];
    for (const f of children) {
      if (f.mimeType === 'application/vnd.google-apps.folder') subfolders.push(f.id);
      else if (f.name?.toLowerCase().endsWith('.obj')) objFiles.push({ id: f.id, name: f.name, size: f.size ? Number(f.size) : null });
    }
    const CONCURRENCY = 10;
    for (let i = 0; i < subfolders.length; i += CONCURRENCY) {
      await Promise.all(subfolders.slice(i, i + CONCURRENCY).map(walk));
    }
  }

  await walk(DRIVE_FOLDER_ID);
  objFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  console.log(JSON.stringify({ files: objFiles, count: objFiles.length }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
