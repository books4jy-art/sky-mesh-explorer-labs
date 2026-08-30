import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { driveAuth } from '../../shared/drive.ts';

export default async function(req) {
  try {
    // Accept driveFileId from query param or JSON body
    const url = new URL(req.url);
    let driveFileId = url.searchParams.get('driveFileId');

    if (!driveFileId) {
      try {
        const body = await req.json();
        driveFileId = body?.driveFileId;
      } catch (e) {}
    }

    if (!driveFileId || !/^[a-zA-Z0-9_-]+$/.test(String(driveFileId))) {
      return new Response('Not Found', { status: 404 });
    }

    const base44 = createClientFromRequest(req);
    const auth = await driveAuth(base44);

    // Retry with backoff on 429 from Drive (500ms, 1s — max 2 retries)
    const BACKOFFS = [500, 1000];
    let res;
    for (let attempt = 0; attempt <= BACKOFFS.length; attempt++) {
      res = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, { headers: auth });
      if (res.ok || res.status !== 429) break;
      if (attempt < BACKOFFS.length) {
        await new Promise(r => setTimeout(r, BACKOFFS[attempt]));
      }
    }

    if (!res.ok) {
      return new Response('Not Found', { status: 404 });
    }

    const contentType = res.headers.get('Content-Type') || 'image/png';
    const imageBytes = await res.arrayBuffer();

    return new Response(imageBytes, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    return new Response('Not Found', { status: 404 });
  }
}
