// Merges duplicate outfit_icons rows — same (category, name) split across two
// rows instead of one, so the item shows twice in both Outfit Maker and
// Avatar Maker (one tile often just an icon-less "ghost" with no visible
// content). For each duplicate group: pick a canonical row (prefer the one
// with an icon; tie-break by lowest id, i.e. the original), copy over any
// field the canonical is missing (icon, obj mesh, alt mesh) from the other
// row(s), then delete the other row(s).
//
//   node server/scripts/mergeOutfitDuplicates.js --dry-run          (report only, default)
//   node server/scripts/mergeOutfitDuplicates.js --dry-run=false    (write)
import '../loadEnv.js';
import { pool } from '../db.js';
import { parseArgs } from '../driveList.js';

// image_url is intentionally excluded: it's not read anywhere in the
// frontend (OutfitTile/getOutfitIconImage both key off drive_file_id only),
// and the donor's value here is usually just the placeholder URL stamped on
// icon-less ghost rows — copying it over would misrepresent a canonical row
// that already has a real icon via drive_file_id.
const MERGE_FIELDS = [
  'drive_file_id', 'icon_file_name',
  'obj_drive_file_id', 'obj_file_name',
  'alt_obj_drive_file_id', 'alt_obj_file_name',
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args['dry-run'] !== 'false';

  const { rows: groups } = await pool.query(`
    select category, name
    from outfit_icons
    where category is not null and trim(category) <> '' and name <> ''
    group by category, name
    having count(*) > 1
  `);

  const plan = [];
  for (const g of groups) {
    const { rows } = await pool.query(
      'select * from outfit_icons where category = $1 and name = $2 order by id',
      [g.category, g.name]
    );
    const canonical = [...rows].sort((a, b) => {
      const aHasIcon = a.drive_file_id ? 1 : 0;
      const bHasIcon = b.drive_file_id ? 1 : 0;
      if (aHasIcon !== bHasIcon) return bHasIcon - aHasIcon;
      return a.id - b.id;
    })[0];
    const others = rows.filter((r) => r.id !== canonical.id);

    const patch = {};
    for (const field of MERGE_FIELDS) {
      if (canonical[field]) continue;
      const donor = others.find((r) => r[field]);
      if (donor) patch[field] = donor[field];
    }

    plan.push({
      category: g.category, name: g.name,
      canonicalId: canonical.id,
      deleteIds: others.map((r) => r.id),
      patch,
    });
  }

  console.log(JSON.stringify({ dryRun, groups: plan.length, plan }, null, 2));

  if (!dryRun) {
    for (const p of plan) {
      if (Object.keys(p.patch).length) {
        const sets = Object.keys(p.patch).map((f, i) => `${f} = $${i + 1}`);
        const params = [...Object.values(p.patch), p.canonicalId];
        await pool.query(`update outfit_icons set ${sets.join(', ')} where id = $${params.length}`, params);
      }
      if (p.deleteIds.length) {
        await pool.query('delete from outfit_icons where id = any($1::bigint[])', [p.deleteIds]);
      }
    }
    console.log(`Merged ${plan.length} duplicate group(s).`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
