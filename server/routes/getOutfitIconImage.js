import { driveAuth } from '../drive.js';

export async function getOutfitIconImage(req, res) {
  try {
    const driveFileId = req.query.driveFileId;
    if (!driveFileId || !/^[a-zA-Z0-9_-]+$/.test(String(driveFileId))) {
      return res.status(404).send('Not Found');
    }

    const auth = await driveAuth();

    const BACKOFFS = [500, 1000];
    let driveRes;
    for (let attempt = 0; attempt <= BACKOFFS.length; attempt++) {
      driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, { headers: auth });
      if (driveRes.ok || driveRes.status !== 429) break;
      if (attempt < BACKOFFS.length) await new Promise((r) => setTimeout(r, BACKOFFS[attempt]));
    }

    if (!driveRes.ok) return res.status(404).send('Not Found');

    const contentType = driveRes.headers.get('Content-Type') || 'image/png';
    const imageBytes = Buffer.from(await driveRes.arrayBuffer());

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(imageBytes);
  } catch (error) {
    res.status(404).send('Not Found');
  }
}
