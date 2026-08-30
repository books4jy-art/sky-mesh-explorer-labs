import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { driveAuth } from '../../shared/drive.ts';

const MAX_IDS = 60;

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      try { results[cur] = await fn(items[cur]); }
      catch (e) { results[cur] = { _error: e.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function toBase64(bytes) {
  let bin = '';
  const CH = 8192;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray(body.fileIds) ? body.fileIds.slice(0, MAX_IDS) : [];
    if (!ids.length) return Response.json({ images: {}, errors: [] });

    const auth = await driveAuth(base44);
    const images = {};
    const errors = [];

    const results = await mapPool(ids, 8, async (id) => {
      if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) throw new Error('invalid file id');
      let res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers: auth });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 600));
        res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers: auth });
      }
      if (!res.ok) throw new Error(`Drive ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      return { id, dataUrl: `data:image/png;base64,${toBase64(bytes)}` };
    });

    results.forEach((r, i) => {
      if (r && r._error) errors.push(`${ids[i]}: ${r._error}`);
      else images[r.id] = r.dataUrl;
    });

    return Response.json({ images, errors });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
