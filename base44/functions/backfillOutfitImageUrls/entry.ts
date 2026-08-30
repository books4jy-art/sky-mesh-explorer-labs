import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { PLACEHOLDER_DRIVE_FILE_ID } from '../../shared/outfitNaming.ts';

const PLACEHOLDER_URL = `https://lh3.googleusercontent.com/d/${PLACEHOLDER_DRIVE_FILE_ID}`;
const BACKOFFS = [1000, 2000, 4000, 8000, 16000, 32000, 60000];
const MAX_ELAPSED_MS = 280000;

const isRateLimit = (e) => {
  const msg = (typeof e === 'string' ? e : (e?.message || '')) + '';
  return /rate limit|429|too many/i.test(msg);
};

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const startIdx = body?.cursor ? parseInt(body.cursor, 10) || 0 : 0;

    const startTime = Date.now();

    // --- 1. Load all rows at once (Base44 SDK does not support $gt on id) ---
    const all = await base44.asServiceRole.entities.OutfitIcon.list('id', 5000);
    if (all.length === 5000) {
      return Response.json({ error: 'OutfitIcon returned 5000 rows — pagination now required' }, { status: 500 });
    }

    // --- 2. Classify rows ---
    const totals = { scanned: all.length, updated: 0, skippedNoDriveFileId: 0, skippedAlreadySet: 0, errors: [] };
    const toUpdate = [];

    for (const rec of all) {
      if (!rec.driveFileId || !rec.driveFileId.trim()) {
        totals.skippedNoDriveFileId++;
        continue;
      }
      const isEmpty = !rec.imageUrl || !rec.imageUrl.trim();
      const isPlaceholder = rec.imageUrl === PLACEHOLDER_URL;
      if (!isEmpty && !isPlaceholder) {
        totals.skippedAlreadySet++;
        continue;
      }
      toUpdate.push(rec);
    }

    // --- 3. Sequential writes with backoff, starting from startIdx ---
    for (let i = startIdx; i < toUpdate.length; i++) {
      if (Date.now() - startTime > MAX_ELAPSED_MS) {
        return Response.json({
          scanned: totals.scanned,
          updated: totals.updated,
          skippedNoDriveFileId: totals.skippedNoDriveFileId,
          skippedAlreadySet: totals.skippedAlreadySet,
          errors: totals.errors,
          pagesProcessed: Math.ceil((i + 1) / 250),
          cursor: String(i),
          done: false,
        });
      }

      const rec = toUpdate[i];
      const newImageUrl = `https://lh3.googleusercontent.com/d/${rec.driveFileId}`;
      let success = false;
      let lastError = null;
      for (let attempt = 0; attempt < BACKOFFS.length; attempt++) {
        try {
          await base44.asServiceRole.entities.OutfitIcon.update(rec.id, { imageUrl: newImageUrl });
          success = true;
          break;
        } catch (e) {
          lastError = e;
          if (isRateLimit(e) && attempt < BACKOFFS.length - 1) {
            await new Promise(r => setTimeout(r, BACKOFFS[attempt]));
            continue;
          }
          break;
        }
      }
      if (success) {
        totals.updated++;
      } else {
        totals.errors.push({ id: rec.id, driveFileId: rec.driveFileId, error: lastError?.message || String(lastError) });
      }
      await new Promise(r => setTimeout(r, 150));
    }

    return Response.json({
      scanned: totals.scanned,
      updated: totals.updated,
      skippedNoDriveFileId: totals.skippedNoDriveFileId,
      skippedAlreadySet: totals.skippedAlreadySet,
      errors: totals.errors,
      pagesProcessed: Math.ceil(toUpdate.length / 250),
      cursor: null,
      done: true,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
