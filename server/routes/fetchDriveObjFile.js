import { driveAuth } from '../drive.js';

export async function fetchDriveObjFile(req, res) {
  try {
    const fileId = req.body?.fileId;
    if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(String(fileId))) {
      return res.status(400).json({ error: 'Invalid fileId' });
    }
    const auth = await driveAuth();
    const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: auth });
    if (!driveRes.ok) {
      const t = await driveRes.text();
      throw new Error(`Drive download error ${driveRes.status}: ${t}`);
    }
    const text = await driveRes.text();
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(text);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
