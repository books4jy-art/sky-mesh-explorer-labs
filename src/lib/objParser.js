/**
 * parseObj.js — minimal Wavefront .obj parser → typed arrays for the 3D viewer.
 * Handles v, vt, f (with optional vt indices), fan-triangulates n-gons,
 * and dedupes (vertex,uv) index pairs into a single indexed buffer.
 */
export function parseObj(text) {
  const lines = text.split('\n');
  const vLines = [];
  const vtLines = [];
  const faces = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] === '#') continue;
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0];
    if (cmd === 'v') {
      vLines.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
    } else if (cmd === 'vt') {
      vtLines.push([parseFloat(parts[1]), parseFloat(parts[2])]);
    } else if (cmd === 'f') {
      const face = [];
      for (let i = 1; i < parts.length; i++) {
        const tok = parts[i].split('/');
        const vi = parseInt(tok[0], 10);
        if (!vi) continue;
        const ti = tok[1] ? parseInt(tok[1], 10) : null;
        face.push([vi, ti]);
      }
      if (face.length >= 3) faces.push(face);
    }
  }

  const hasUvs = vtLines.length > 0;
  const positionsArr = [];
  const uvsArr = [];
  const indicesArr = [];
  const vertexMap = new Map();

  function getVert(vi, ti) {
    const key = vi + ',' + (ti == null ? '' : ti);
    let idx = vertexMap.get(key);
    if (idx !== undefined) return idx;
    const pv = vLines[vi - 1];
    if (!pv) return -1;
    idx = positionsArr.length / 3;
    positionsArr.push(pv[0], pv[1], pv[2]);
    if (hasUvs) {
      const vt = (ti != null && ti > 0) ? vtLines[ti - 1] : null;
      uvsArr.push(vt ? vt[0] : 0, vt ? vt[1] : 0);
    }
    vertexMap.set(key, idx);
    return idx;
  }

  let triCount = 0;
  for (const face of faces) {
    for (let i = 1; i < face.length - 1; i++) {
      const a = getVert(face[0][0], face[0][1]);
      const b = getVert(face[i][0], face[i][1]);
      const c = getVert(face[i + 1][0], face[i + 1][1]);
      if (a >= 0 && b >= 0 && c >= 0) { indicesArr.push(a, b, c); triCount++; }
    }
  }

  const positions = new Float32Array(positionsArr);
  const uvs = hasUvs ? new Float32Array(uvsArr) : null;
  const IndexCtor = (positions.length / 3) > 65535 ? Uint32Array : Uint16Array;
  const indices = new IndexCtor(indicesArr);
  return { positions, uvs, indices, vertexCount: positions.length / 3, triangleCount: triCount };
}
