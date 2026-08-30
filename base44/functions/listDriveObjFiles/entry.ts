import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { DRIVE_FOLDER_ID, driveAuth } from '../../shared/drive.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    const auth = await driveAuth(base44);
    const objFiles = [];
    const seen = new Set();

    async function listFolder(folderId) {
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
        let res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, { headers: auth });
        if (res.status === 429) { await new Promise((r) => setTimeout(r, 600)); res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, { headers: auth }); }
        if (!res.ok) {
          const t = await res.text();
          throw new Error(`Drive list error ${res.status}: ${t}`);
        }
        const data = await res.json();
        for (const f of (data.files || [])) {
          if (f.mimeType === 'application/vnd.google-apps.folder') subfolders.push(f.id);
          else if (f.name && f.name.toLowerCase().endsWith('.obj')) objFiles.push({ id: f.id, name: f.name, size: f.size ? Number(f.size) : null });
        }
        pageToken = data.nextPageToken;
      } while (pageToken);
      const CONCURRENCY = 10;
      for (let i = 0; i < subfolders.length; i += CONCURRENCY) {
        await Promise.all(subfolders.slice(i, i + CONCURRENCY).map((id) => listFolder(id)));
      }
    }

    await listFolder(DRIVE_FOLDER_ID);
    objFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return Response.json({ files: objFiles });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
