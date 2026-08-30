import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { driveAuth } from '../../shared/drive.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    let body = {};
    try { body = await req.json(); } catch (e) {}
    const fileId = body && body.fileId;
    if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(String(fileId))) {
      return Response.json({ error: 'Invalid fileId' }, { status: 400 });
    }

    const auth = await driveAuth(base44);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: auth });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Drive download error ${res.status}: ${t}`);
    }
    const text = await res.text();
    return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
