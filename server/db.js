import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Point it at your Postgres instance (e.g. Supabase connection string).');
}

const useSSL = !/localhost|127\.0\.0\.1/.test(connectionString) && process.env.PGSSL !== 'disable';

export const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

export async function ensureSchema() {
  await pool.query(`
    create table if not exists mesh_files (
      id bigserial primary key,
      drive_file_id text not null unique,
      name text not null,
      size bigint not null default 0,
      folder_path text not null default ''
    );
    create index if not exists mesh_files_name_idx on mesh_files (lower(name));
    create index if not exists mesh_files_folder_idx on mesh_files (folder_path);

    create table if not exists outfit_icons (
      id bigserial primary key,
      name text not null default '',
      category text not null default '',
      drive_file_id text not null default '',
      icon_file_name text not null default '',
      image_url text not null default '',
      obj_drive_file_id text not null default '',
      obj_file_name text not null default ''
    );
    create index if not exists outfit_icons_category_idx on outfit_icons (category);
    create index if not exists outfit_icons_obj_drive_file_id_idx on outfit_icons (obj_drive_file_id);
    create index if not exists outfit_icons_drive_file_id_idx on outfit_icons (drive_file_id);

    create table if not exists library_sync_status (
      id bigserial primary key,
      last_synced_at timestamptz,
      file_count integer not null default 0,
      status text not null default 'idle'
    );
  `);
}
