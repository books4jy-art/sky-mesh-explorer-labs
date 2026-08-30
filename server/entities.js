// A tiny shim over Postgres that mimics the subset of the Base44 SDK's
// `asServiceRole.entities.X` surface the original functions used
// (list/filter/create/update/bulkCreate/bulkUpdate/delete), so the migration
// scripts under server/scripts/ can stay close to their original logic.
import { pool } from './db.js';

const toSnake = (s) => s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const toCamel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

function rowToCamel(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out;
}

function makeEntity(table) {
  return {
    async list(sortField, limit) {
      let sql = `select * from ${table}`;
      const params = [];
      if (sortField) sql += ` order by ${toSnake(sortField)}`;
      if (limit) {
        params.push(limit);
        sql += ` limit $${params.length}`;
      }
      const { rows } = await pool.query(sql, params);
      return rows.map(rowToCamel);
    },

    async filter(where = {}, sortField, limit) {
      const conditions = [];
      const params = [];
      for (const [key, val] of Object.entries(where)) {
        const col = toSnake(key);
        if (val && typeof val === 'object' && '$gt' in val) {
          params.push(val.$gt);
          conditions.push(`${col} > $${params.length}`);
        } else {
          params.push(val);
          conditions.push(`${col} = $${params.length}`);
        }
      }
      let sql = `select * from ${table}`;
      if (conditions.length) sql += ` where ${conditions.join(' and ')}`;
      if (sortField) sql += ` order by ${toSnake(sortField)}`;
      if (limit) {
        params.push(limit);
        sql += ` limit $${params.length}`;
      }
      const { rows } = await pool.query(sql, params);
      return rows.map(rowToCamel);
    },

    async create(fields) {
      const keys = Object.keys(fields);
      const cols = keys.map(toSnake);
      const params = keys.map((k) => fields[k]);
      const placeholders = params.map((_, i) => `$${i + 1}`);
      const { rows } = await pool.query(
        `insert into ${table} (${cols.join(',')}) values (${placeholders.join(',')}) returning *`,
        params
      );
      return rowToCamel(rows[0]);
    },

    async bulkCreate(records) {
      const out = [];
      for (const rec of records) out.push(await this.create(rec));
      return out;
    },

    async update(id, patch) {
      const keys = Object.keys(patch);
      if (!keys.length) return null;
      const sets = keys.map((k, i) => `${toSnake(k)} = $${i + 1}`);
      const params = keys.map((k) => patch[k]);
      params.push(id);
      const { rows } = await pool.query(
        `update ${table} set ${sets.join(', ')} where id = $${params.length} returning *`,
        params
      );
      return rows[0] ? rowToCamel(rows[0]) : null;
    },

    async bulkUpdate(records) {
      let count = 0;
      for (const rec of records) {
        const { id, ...patch } = rec;
        await this.update(id, patch);
        count++;
      }
      return count;
    },

    async delete(id) {
      await pool.query(`delete from ${table} where id = $1`, [id]);
    },
  };
}

export const MeshFile = makeEntity('mesh_files');
export const OutfitIcon = makeEntity('outfit_icons');
export const LibrarySyncStatus = makeEntity('library_sync_status');
