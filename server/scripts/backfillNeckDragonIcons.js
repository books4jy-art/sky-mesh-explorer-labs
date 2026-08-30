// One-off: link AP## pendant / Dragon-costume Neck items to their hardcoded
// icon filenames (these don't follow the standard UiOutfit<Category><Base>
// naming pattern, so the main matcher never finds them).
//   node server/scripts/backfillNeckDragonIcons.js --dry-run          (default)
//   node server/scripts/backfillNeckDragonIcons.js --dry-run=false
import '../loadEnv.js';
import { driveAuth } from '../drive.js';
import { OutfitIcon } from '../entities.js';
import { OUTFIT_ICON_FOLDER_ID } from '../outfitNaming.js';
import { parseArgs } from '../driveList.js';

const DRAGON_PNG_NAME = 'UiSocialJoinDragonDance.png';
const DRAGON_TARGETS = [
  { name: 'Dragon Body White', category: 'Neck' }, { name: 'Dragon Tail Black', category: 'Neck' },
  { name: 'Dragon Head Black', category: 'Neck' }, { name: 'Dragon Body Black', category: 'Neck' },
  { name: 'Dragon Head White', category: 'Neck' }, { name: 'Dragon Tail White', category: 'Neck' },
];

async function collectPngs(folderId, auth, depth = 0) {
  if (depth > 5) return [];
  let pageToken = null;
  const children = [];
  do {
    let url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed%3Dfalse&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
    const res = await fetch(url, { headers: auth });
    const data = await res.json();
    if (data.files) children.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);
  let pngs = [];
  for (const c of children) {
    if (c.mimeType === 'image/png') pngs.push({ id: c.id, name: c.name });
    else if (c.mimeType === 'application/vnd.google-apps.folder') pngs = pngs.concat(await collectPngs(c.id, auth, depth + 1));
  }
  return pngs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args['dry-run'] !== 'false';

  const auth = await driveAuth();
  const all = await OutfitIcon.list('id', 5000);
  if (all.length === 5000) throw new Error('OutfitIcon returned 5000 rows — pagination required');

  const pngs = await collectPngs(OUTFIT_ICON_FOLDER_ID, auth);
  const apFlatMap = new Map();
  for (const p of pngs) if (/^UiMenuAP\d+Flat\.png$/i.test(p.name)) apFlatMap.set(p.name, p.id);
  const dragonPngId = pngs.find((p) => p.name === DRAGON_PNG_NAME)?.id || null;

  const apRegex = /\bAP\d+\b/i;
  const setA = [];
  const setA_noMatch = [];
  for (const row of all) {
    if (row.driveFileId?.trim()) continue;
    if ((row.category || '') !== 'Neck') continue;
    const m = (row.name || '').match(apRegex);
    if (!m) continue;
    const targetPng = `UiMenu${m[0]}Flat.png`;
    const pngId = apFlatMap.get(targetPng);
    if (pngId) setA.push({ id: row.id, name: row.name, category: row.category, pngName: targetPng, driveFileId: pngId });
    else setA_noMatch.push({ name: row.name, apNum: m[0], targetPng });
  }

  const setB = [];
  const setB_noMatch = [];
  for (const target of DRAGON_TARGETS) {
    const row = all.find((r) => r.name === target.name && r.category === target.category && !r.driveFileId?.trim());
    if (!row) { setB_noMatch.push({ ...target, reason: 'not found or already has driveFileId' }); continue; }
    if (!dragonPngId) { setB_noMatch.push({ ...target, reason: 'UiSocialJoinDragonDance.png not found in Drive' }); continue; }
    setB.push({ id: row.id, name: row.name, category: row.category, pngName: DRAGON_PNG_NAME, driveFileId: dragonPngId });
  }

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, setA_count: setA.length, setB_count: setB.length, setA_noMatch, setB_noMatch, setA_preview: setA.slice(0, 5), setB_preview: setB, dragonPngFound: !!dragonPngId }, null, 2));
    return;
  }

  const results = { updated: 0, errors: [] };
  for (const row of [...setA, ...setB]) {
    try {
      await OutfitIcon.update(row.id, { driveFileId: row.driveFileId, imageUrl: `https://lh3.googleusercontent.com/d/${row.driveFileId}`, iconFileName: row.pngName });
      results.updated++;
    } catch (e) {
      results.errors.push({ id: row.id, name: row.name, error: e?.message || String(e) });
    }
    await new Promise((r) => setTimeout(r, 180));
  }
  console.log(JSON.stringify({ dryRun: false, setA_written: setA.length, setB_written: setB.length, ...results }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
