import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportMeshToFbx, findBlender } from '../fbxExporter.js';

export async function exportMeshFbx(req, res) {
  const { fileName, modelName, vertices, normals, indices, uvs, primaryUvSet, skeleton, boneWeights, texturePngBase64 } = req.body || {};

  if (!Array.isArray(vertices) || !vertices.length || !Array.isArray(indices) || !indices.length) {
    return res.status(400).json({ error: 'Missing mesh geometry (vertices/indices).' });
  }
  if (!findBlender()) {
    return res.status(503).json({ error: 'Blender was not found on this server. Install Blender or set BLENDER_EXE.' });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sme-fbx-req-'));
  try {
    let texturePngPath = null;
    if (texturePngBase64) {
      texturePngPath = path.join(tmpDir, 'texture.png');
      fs.writeFileSync(texturePngPath, Buffer.from(texturePngBase64, 'base64'));
    }

    const outPath = path.join(tmpDir, 'export.fbx');
    await exportMeshToFbx({
      fileName, modelName, vertices,
      normals: Array.isArray(normals) ? normals : [],
      indices,
      uvs: Array.isArray(uvs) ? uvs : [],
      primaryUvSet: primaryUvSet || null,
      skeleton: Array.isArray(skeleton) ? skeleton : [],
      boneWeights: Array.isArray(boneWeights) ? boneWeights : [],
      texturePngPath,
    }, outPath);

    const fbxBuffer = fs.readFileSync(outPath);
    const safeName = String(modelName || fileName || 'mesh')
      .replace(/\.mesh$/i, '')
      .replace(/[^A-Za-z0-9_.-]+/g, '_');
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${safeName}.fbx"`);
    res.send(fbxBuffer);
  } catch (error) {
    res.status(500).json({ error: error.message || String(error) });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function blenderStatus(req, res) {
  res.json({ available: Boolean(findBlender()) });
}
