import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSchema } from './db.js';
import { browseMeshFiles } from './routes/browseMeshFiles.js';
import { fetchDriveObjFile } from './routes/fetchDriveObjFile.js';
import { syncDriveLibrary } from './routes/syncDriveLibrary.js';
import { outfitCatalog } from './routes/outfitCatalog.js';
import { getOutfitIconImage } from './routes/getOutfitIconImage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
app.use(express.json());

app.post('/api/functions/browseMeshFiles', browseMeshFiles);
app.post('/api/functions/fetchDriveObjFile', fetchDriveObjFile);
app.post('/api/functions/syncDriveLibrary', syncDriveLibrary);
app.post('/api/functions/outfitCatalog', outfitCatalog);
app.get('/api/functions/getOutfitIconImage', getOutfitIconImage);

if (process.env.NODE_ENV === 'production') {
  const distDir = path.join(__dirname, '..', 'dist');
  app.use(express.static(distDir));
  app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

await ensureSchema();

app.listen(PORT, () => {
  console.log(`Sky Mesh Explorer server listening on http://localhost:${PORT}`);
});
