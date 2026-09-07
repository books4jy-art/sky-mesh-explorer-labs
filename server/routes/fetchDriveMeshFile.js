import { driveAuth } from '../drive.js';

// Binary passthrough for raw Sky .mesh files (the alt Outfit Maker's mesh
// source) — decoded client-side via src/lib/skyMeshParser.js, same as a
// locally-dropped .mesh file. Mirrors fetchDriveTextureFile.js.
export async function fetchDriveMeshFile(req, res) {
  try {
    const driveFileId = req.query.driveFileId;
    if (!driveFileId || !/^[a-zA-Z0-9_-]+$/.test(String(driveFileId))) {
      return res.status(400).send('Invalid fileId');
    }
    const auth = await driveAuth();

    const BACKOFFS = [500, 1000];
    let driveRes;
    for (let attempt = 0; attempt <= BACKOFFS.length; attempt++) {
      driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, { headers: auth });
      if (driveRes.ok || driveRes.status !== 429) break;
      if (attempt < BACKOFFS.length) await new Promise((r) => setTimeout(r, BACKOFFS[attempt]));
    }
    if (!driveRes.ok) {
      const t = await driveRes.text().catch(() => '');
      return res.status(driveRes.status).send(t || 'Drive download failed');
    }

    const bytes = Buffer.from(await driveRes.arrayBuffer());
    res.set('Content-Type', 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(bytes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
