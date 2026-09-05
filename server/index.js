import './loadEnv.js';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSchema } from './db.js';
import { browseMeshFiles } from './routes/browseMeshFiles.js';
import { fetchDriveObjFile } from './routes/fetchDriveObjFile.js';
import { syncDriveLibrary } from './routes/syncDriveLibrary.js';
import { outfitCatalog } from './routes/outfitCatalog.js';
import { getOutfitIconImage } from './routes/getOutfitIconImage.js';
import { exportMeshFbx, blenderStatus } from './routes/exportMeshFbx.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
// Raw mesh geometry (vertices/uvs/indices as JSON number arrays) can run well
// past Express's 100kb default for a detailed character mesh.
app.use(express.json({ limit: '50mb' }));

app.post('/api/functions/browseMeshFiles', browseMeshFiles);
app.post('/api/functions/fetchDriveObjFile', fetchDriveObjFile);
app.post('/api/functions/syncDriveLibrary', syncDriveLibrary);
app.post('/api/functions/outfitCatalog', outfitCatalog);
app.get('/api/functions/getOutfitIconImage', getOutfitIconImage);
app.post('/api/functions/exportMeshFbx', exportMeshFbx);
app.get('/api/functions/blenderStatus', blenderStatus);

if (process.env.NODE_ENV === 'production') {
  const distDir = path.join(__dirname, '..', 'dist');
  app.use(express.static(distDir));
  app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

await ensureSchema();

app.listen(PORT, () => {
  console.log(`Sky Mesh Explorer server listening on http://localhost:${PORT}`);
});
