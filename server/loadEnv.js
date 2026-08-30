// dotenv's default config() only loads `.env`; this project's convention
// (matching Vite's for the frontend half) is `.env.local`. Import this once,
// before any other server/ import that reads process.env.
import dotenv from 'dotenv';
import fs from 'node:fs';

dotenv.config({ path: fs.existsSync('.env.local') ? '.env.local' : '.env' });
