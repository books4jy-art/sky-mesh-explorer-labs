// Companion to mergeOutfitDuplicates.js: that one only catches EXACT
// (category, name) duplicates. This one catches the sneakier case — an
// icon-only row and an obj-only row for the SAME item that never merged
// because their name text differs slightly (singular vs plural, "Arm_01" vs
// "Arm01", etc. — the icon-naming and mesh-naming conventions in the source
// dump don't always agree). Each such pair is two broken rows (one shows a
// WIP placeholder with no name behind it, the other has no icon) that
// should be one complete row.
//
// Matches by a normalized name (lowercase, strip non-alphanumerics, strip a
// trailing "s") within the same category, and ONLY merges a pair where one
// side has an icon-and-no-obj and the other has an obj-and-no-icon — i.e.
// combining them can only ever complete a row, never overwrite real data.
// Any bucket that isn't exactly one icon-only + one obj-only row is left
// alone and reported, not guessed at.
//
//   node server/scripts/mergeOutfitNearDuplicates.js --dry-run          (report only, default)
//   node server/scripts/mergeOutfitNearDuplicates.js --dry-run=false    (write)
import '../loadEnv.js';
import { pool } from '../db.js';
import { parseArgs } from '../driveList.js';

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args['dry-run'] !== 'false';

  const { rows } = await pool.query(`
    select id, name, category, drive_file_id, icon_file_name,
           obj_drive_file_id, obj_file_name, alt_obj_drive_file_id, alt_obj_file_name
    from outfit_icons
    where category is not null and trim(category) <> '' and name <> ''
  `);

  const buckets = new Map();
  for (const r of rows) {
    const hasIcon = !!r.drive_file_id;
    const hasObj = !!r.obj_drive_file_id;
    if (hasIcon && hasObj) continue; // only incomplete rows are candidates
    const key = r.category + '|' + norm(r.name);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ ...r, hasIcon, hasObj });
  }

  const plan = [];
  const skippedAmbiguous = [];
  for (const [key, list] of buckets) {
    if (list.length !== 2) continue;
    const iconRow = list.find((r) => r.hasIcon && !r.hasObj);
    const objRow = list.find((r) => r.hasObj && !r.hasIcon);
    if (!iconRow || !objRow) { if (list.length > 1) skippedAmbiguous.push({ key, ids: list.map((r) => r.id) }); continue; }

    plan.push({
      category: iconRow.category,
      canonicalName: iconRow.name,
      canonicalId: iconRow.id,
      deleteId: objRow.id,
      deleteName: objRow.name,
      patch: {
        obj_drive_file_id: objRow.obj_drive_file_id,
        obj_file_name: objRow.obj_file_name,
        ...(objRow.alt_obj_drive_file_id ? { alt_obj_drive_file_id: objRow.alt_obj_drive_file_id, alt_obj_file_name: objRow.alt_obj_file_name } : {}),
      },
    });
  }

  console.log(JSON.stringify({ dryRun, pairs: plan.length, skippedAmbiguous, plan }, null, 2));

  if (!dryRun) {
    for (const p of plan) {
      const sets = Object.keys(p.patch).map((f, i) => `${f} = $${i + 1}`);
      const params = [...Object.values(p.patch), p.canonicalId];
      await pool.query(`update outfit_icons set ${sets.join(', ')} where id = $${params.length}`, params);
      await pool.query('delete from outfit_icons where id = $1', [p.deleteId]);
    }
    console.log(`Merged ${plan.length} near-duplicate pair(s).`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
