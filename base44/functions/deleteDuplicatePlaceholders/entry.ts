import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { PLACEHOLDER_DRIVE_FILE_ID } from '../../shared/outfitNaming.ts';

const PLACEHOLDER_URL = `https://lh3.googleusercontent.com/d/${PLACEHOLDER_DRIVE_FILE_ID}`;
const BACKOFFS = [1000, 2000, 4000, 8000, 16000, 32000, 60000];

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const dryRunOnly = body?.dryRunOnly === true;

    // --- 1. Load all OutfitIcon rows ---
    const all = await base44.asServiceRole.entities.OutfitIcon.list('id', 5000);
    if (all.length === 5000) {
      return Response.json({ error: 'OutfitIcon returned 5000 rows — pagination now required' }, { status: 500 });
    }

    // --- 2. Group by objDriveFileId ---
    const byObjId = new Map(); // objDriveFileId -> [rows]
    for (const rec of all) {
      if (!rec.objDriveFileId) continue;
      if (!byObjId.has(rec.objDriveFileId)) byObjId.set(rec.objDriveFileId, []);
      byObjId.get(rec.objDriveFileId).push(rec);
    }

    // --- 3. Identify qualifying duplicates ---
    const isPlaceholderRow = (rec) =>
      (!rec.iconFileName || !rec.iconFileName.trim()) &&
      (!rec.driveFileId || !rec.driveFileId.trim()) &&
      (rec.imageUrl === PLACEHOLDER_URL);

    const qualifying = [];
    for (const [objId, rows] of byObjId) {
      const hasRealIcon = rows.some(r => r.iconFileName && r.iconFileName.trim());
      if (!hasRealIcon) continue; // orphan placeholder — KEEP
      for (const r of rows) {
        if (isPlaceholderRow(r)) {
          qualifying.push(r);
        }
      }
    }

    const dryRunQualifyingCount = qualifying.length;
    const dryRunExamples = qualifying.slice(0, 10).map(r => r.objDriveFileId);

    if (dryRunOnly) {
      return Response.json({ dryRunOnly: true, dryRunQualifyingCount, dryRunExamples });
    }

    // --- 4. Delete sequentially with backoff ---
    let deletedCount = 0;
    let errorCount = 0;
    const errors = [];
    const isRateLimit = (e) => {
      const msg = (typeof e === 'string' ? e : (e?.message || '')) + '';
      return /rate limit|429|too many/i.test(msg);
    };

    for (let i = 0; i < qualifying.length; i++) {
      const rec = qualifying[i];
      let deleted = false;
      let lastError = null;
      for (let attempt = 0; attempt < BACKOFFS.length; attempt++) {
        try {
          await base44.asServiceRole.entities.OutfitIcon.delete(rec.id);
          deleted = true;
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
      if (deleted) {
        deletedCount++;
      } else {
        errorCount++;
        if (errors.length < 6) errors.push({ objDriveFileId: rec.objDriveFileId, error: lastError?.message || String(lastError) });
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    return Response.json({
      dryRunQualifyingCount,
      deletedCount,
      errorCount,
      failures: errors,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
