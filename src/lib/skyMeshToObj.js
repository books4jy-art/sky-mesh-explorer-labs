'use strict';
/**
 * skyMeshToObj.js
 *
 * General Sky: Children of the Light .mesh (header v0x20) -> Wavefront .obj
 * converter. Handles BOTH the ZipPos/ZipUvs compressed-vertex variant
 * (validated bit-exact against a Python reference in earlier work) and the
 * plain/uncompressed variant (raw float32 positions, 4-layer half-float
 * UVs), using the more general stream ordering found in a broader Rust
 * reference parser (tgc_mesh_v20_rs / "lib2.rs").
 */

// ===========================================================================
// LZ4 block decompression
// ===========================================================================
function lz4BlockDecompress(src, uncompressedSize) {
  let i = 0;
  const out = new Uint8Array(uncompressedSize);
  let outPos = 0;
  const srcLen = src.length;
  function readLen(base) {
    let ln = base;
    if (ln === 15) {
      while (true) {
        const s = src[i]; i += 1;
        ln += s;
        if (s !== 255) break;
      }
    }
    return ln;
  }
  while (i < srcLen) {
    const token = src[i]; i += 1;
    const litLen = readLen(token >> 4);
    for (let k = 0; k < litLen; k++) out[outPos++] = src[i + k];
    i += litLen;
    if (i >= srcLen) break;
    const offset = src[i] | (src[i + 1] << 8);
    i += 2;
    const matchLen = readLen(token & 0x0F) + 4;
    let start = outPos - offset;
    for (let k = 0; k < matchLen; k++) out[outPos++] = out[start++];
  }
  return out.subarray(0, outPos);
}

// ===========================================================================
// half-precision float decode (for the plain/uncompressed UV stream)
// ===========================================================================
function f16ToF32(bits) {
  const s = (bits & 0x8000) >> 15;
  const e = (bits & 0x7C00) >> 10;
  const f = bits & 0x03FF;
  let val;
  if (e === 0) {
    val = (f / 1024) * Math.pow(2, -14);
  } else if (e === 0x1F) {
    val = f ? NaN : Infinity;
  } else {
    val = (1 + f / 1024) * Math.pow(2, e - 15);
  }
  return s ? -val : val;
}

class Reader {
  constructor(data) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.ofs = 0;
  }
  seek(pos) { this.ofs = pos; }
  readBytes(n) { const b = this.data.subarray(this.ofs, this.ofs + n); this.ofs += n; return b; }
  readU8() { const v = this.data[this.ofs]; this.ofs += 1; return v; }
  readU16() { const v = this.view.getUint16(this.ofs, true); this.ofs += 2; return v; }
  readU32() { const v = this.view.getUint32(this.ofs, true); this.ofs += 4; return v; }
  readF32() { const v = this.view.getFloat32(this.ofs, true); this.ofs += 4; return v; }
  readF32Array(n) { const out = new Array(n); for (let k = 0; k < n; k++) out[k] = this.readF32(); return out; }
}

const VSTR = 16, UVSTR = 16;

// ===========================================================================
// Container: outer header + LZ4 payload
// ===========================================================================
function checkVersionMarker(fileBytes) {
  if (!(fileBytes[0] === 0x20 && fileBytes[1] === 0 && fileBytes[2] === 0 && fileBytes[3] === 0)) {
    throw new Error('Not a recognized .mesh file (expected header version 0x20).');
  }
}

function decompress20Payload(data) {
  if (data.length < 90) throw new Error('file too small');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const compressedSize = view.getUint32(82, true);
  const uncompressedSize = view.getUint32(86, true);
  const compressedStart = 90;
  const compressedEnd = compressedStart + compressedSize;
  if (compressedEnd > data.length) throw new Error('LZ4 block out of bounds');
  const payload = lz4BlockDecompress(data.subarray(compressedStart, compressedEnd), uncompressedSize);
  return { payload, compressedEnd };
}

function decompress20SectionedMarkerPayload(data) {
  if (data.length < 0x4E) throw new Error('too small for marker section');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const markerCount = view.getUint32(0x4A, true);
  if (!(markerCount >= 1 && markerCount <= 64)) throw new Error('not a marker-sectioned file');
  const markerStart = 0x4E;
  const wrapper = markerStart + markerCount * 112;
  if (wrapper + 12 > data.length) throw new Error('marker section out of bounds');
  const nameRaw = data.subarray(markerStart, Math.min(markerStart + 64, data.length));
  const nul = nameRaw.indexOf(0);
  const text = nameRaw.subarray(0, nul === -1 ? nameRaw.length : nul);
  const printable = text.length > 0 && Array.from(text).every((b) => (b >= 32 && b <= 126));
  if (!printable) throw new Error('marker record name not printable');
  const compressionMode = view.getUint32(wrapper, true);
  if (compressionMode !== 1) throw new Error('unexpected marker wrapper compression mode');
  const compressedSize = view.getUint32(wrapper + 4, true);
  const uncompressedSize = view.getUint32(wrapper + 8, true);
  if (compressedSize === 0 || uncompressedSize === 0 || uncompressedSize > 128 * 1024 * 1024) {
    throw new Error('bad marker-sectioned LZ4 sizes');
  }
  const compressedStart = wrapper + 12;
  const compressedEnd = compressedStart + compressedSize;
  if (compressedEnd > data.length) throw new Error('marker LZ4 block out of bounds');
  const payload = lz4BlockDecompress(data.subarray(compressedStart, compressedEnd), uncompressedSize);
  return { payload, compressedEnd };
}

// ===========================================================================
// Header fields (fixed offsets within the decompressed payload)
// ===========================================================================
function parseHeaderFields(payload) {
  const r = new Reader(payload);
  r.seek(4);
  const aabbA = r.readF32Array(3);
  const aabbB = r.readF32Array(3);
  const aabbA2 = r.readF32Array(3);
  const aabbB2 = r.readF32Array(3);
  const quantMin = r.readF32Array(8);
  const quantMax = r.readF32Array(8);
  if (r.ofs !== 116) throw new Error(`header parse landed at ${r.ofs}, expected 116`);
  const vc = r.readU32();
  const ic = r.readU32();
  const isIdx32 = r.readU32();
  const unum = r.readU32();
  const prop11 = r.readU32();
  const prop12 = r.readU32();
  const prop13 = r.readU32();
  const prop14 = r.readU32();
  const loadMeshNorms = r.readU8();
  const loadInfo2 = r.readU8();
  const loadInfo3 = r.readU8();
  const skipMeshPosBytes = r.readU32();
  const skipUvsBytes = r.readU32();
  const flag3Bytes = r.readU32();
  return {
    vc, ic, isIdx32, unum, prop11, prop12, prop13, prop14,
    loadMeshNorms, loadInfo2, loadInfo3, skipMeshPosBytes, skipUvsBytes, flag3Bytes,
    aabbA, aabbB, aabbA2, aabbB2, quantMin, quantMax,
  };
}

function looksLike20FlaggedBody(data) {
  if (data.length < 0xA3) return false;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const vc = view.getUint32(0x74, true), ic = view.getUint32(0x78, true);
  if (vc === 0 || ic === 0 || vc > 20_000_000 || ic > 120_000_000) return false;
  if (data[0x94] > 1 || data[0x95] > 1 || data[0x96] > 1) return false;
  const skip0 = view.getUint32(0x97, true), skip2 = view.getUint32(0x9B, true), extra = view.getUint32(0x9F, true);
  return skip0 <= data.length && skip2 <= data.length && extra <= data.length;
}

// ===========================================================================
// Geometry decode: packed 10-10-10 position and byte-packed UV formats
// ===========================================================================
function decodeZipPositions(payloadView, packedPositionRaw, vc, aabbA2, aabbB2) {
  const ax = aabbA2[0], ay = aabbA2[1], az = aabbA2[2];
  const sx = aabbB2[0] - ax, sy = aabbB2[1] - ay, sz = aabbB2[2] - az;
  const view = new DataView(packedPositionRaw.buffer, packedPositionRaw.byteOffset, packedPositionRaw.byteLength);
  const verts = new Array(vc);
  for (let i = 0; i < vc; i++) {
    const packed = view.getUint32(i * 4, true);
    const qz = packed & 0x3FF, qy = (packed >> 10) & 0x3FF, qx = (packed >> 20) & 0x3FF;
    verts[i] = [
      ax + (qx / 1023) * sx,
      ay + (qy / 1023) * sy,
      az + (qz / 1023) * sz,
    ];
  }
  return verts;
}

function decodeZipUvLayer(packedUvRaw, vc, quantMin, quantMax, flipV) {
  const uvMinU = quantMin[0], uvMinV = quantMin[1];
  const uvSizeU = quantMax[0] - uvMinU, uvSizeV = quantMax[1] - uvMinV;
  const uvs = new Array(vc);
  for (let i = 0; i < vc; i++) {
    const off = i * 4;
    const uHi = packedUvRaw[off], vHi = packedUvRaw[off + 1], uLo = packedUvRaw[off + 2], vLo = packedUvRaw[off + 3];
    const uNorm = ((uHi << 8) | uLo) / 65535;
    const vNorm = ((vHi << 8) | vLo) / 65535;
    const u = uvMinU + uNorm * uvSizeU;
    const v = uvMinV + vNorm * uvSizeV;
    uvs[i] = [u, flipV ? 1 - v : v];
  }
  return uvs;
}

// ===========================================================================
// General geometry parser
// ===========================================================================
function payload_f32(payload, off) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return view.getFloat32(off, true);
}

function parseMeshGeometry(payload, header, topFlags, flipV) {
  const { vc, ic, isIdx32, unum, prop11, prop12, prop13, prop14,
    loadMeshNorms, loadInfo2, loadInfo3, skipMeshPosBytes, skipUvsBytes,
    aabbA2, aabbB2, quantMin, quantMax } = header;

  if (vc === 0 || vc > 20_000_000) throw new Error(`bad vertex_count ${vc}`);
  if (ic === 0 || ic > 120_000_000) throw new Error(`bad index_count ${ic}`);

  const indexWidth = isIdx32 ? 4 : 2;
  const readStream1 = loadMeshNorms !== 0;
  const readIndex1 = loadInfo2 !== 0;
  const readFaceAux = loadInfo3 !== 0;

  const r = new Reader(payload);
  r.seek(0xB3);

  let vertices = null;
  if (skipMeshPosBytes === 0) {
    const size = vc * VSTR;
    const base = r.ofs;
    vertices = new Array(vc);
    for (let i = 0; i < vc; i++) {
      const o = base + i * VSTR;
      vertices[i] = [payload_f32(payload, o), payload_f32(payload, o + 4), payload_f32(payload, o + 8)];
    }
    r.seek(base + size);
  }

  if (readStream1) r.readBytes(vc * 4);

  let uvLayers = [null, null, null, null];
  if (skipUvsBytes === 0) {
    const base = r.ofs;
    const layer0 = new Array(vc);
    for (let i = 0; i < vc; i++) {
      const o = base + i * UVSTR;
      const u = f16ToF32(payload[o] | (payload[o + 1] << 8));
      const v = f16ToF32(payload[o + 2] | (payload[o + 3] << 8));
      layer0[i] = [u, v];
    }
    uvLayers[0] = layer0;
    r.seek(base + vc * UVSTR);
  }

  const hasSkin = (topFlags & 1) !== 0;
  if (hasSkin) r.readBytes(vc * 8);

  const indexStart = r.ofs;
  const indexBytes = ic * indexWidth;
  const indicesRaw = r.readBytes(indexBytes);
  const idxView = new DataView(indicesRaw.buffer, indicesRaw.byteOffset, indicesRaw.byteLength);
  const readIdx = indexWidth === 2
    ? (o) => idxView.getUint16(o, true)
    : (o) => idxView.getUint32(o, true);
  const triCount = Math.floor(ic / 3);
  const triangles = [];
  for (let t = 0; t < triCount; t++) {
    const o = t * 3 * indexWidth;
    const a = readIdx(o), b = readIdx(o + indexWidth), c = readIdx(o + indexWidth * 2);
    if (a < vc && b < vc && c < vc) triangles.push([a, b, c]);
  }
  if (triangles.length === 0) throw new Error('no valid triangles found');

  if (readIndex1) r.readBytes(ic * indexWidth);

  const compactWidth = indexWidth;
  for (const count of [unum, prop11]) {
    if (count >= 1) r.readBytes(vc * compactWidth);
  }
  r.readBytes(prop12 * compactWidth);
  r.readBytes(prop13 * 4);
  r.readBytes(prop14 * 2 * compactWidth);
  if (readFaceAux) r.readBytes(triCount * 4);

  if (skipMeshPosBytes !== 0) {
    const packed = r.readBytes(skipMeshPosBytes);
    if (skipMeshPosBytes === vc * 4) {
      vertices = decodeZipPositions(payload, packed, vc, aabbA2, aabbB2);
    }
    if (r.ofs + vc <= payload.length) r.readBytes(vc);
  }

  if (skipUvsBytes !== 0) {
    const packed = r.readBytes(skipUvsBytes);
    if (skipUvsBytes === vc * 4) {
      uvLayers[0] = decodeZipUvLayer(packed, vc, quantMin, quantMax, flipV);
    }
  }

  if (!vertices) throw new Error('vertex stream not decoded (unexpected byte size for compressed stream)');

  return { vertices, uvLayer0: uvLayers[0], triangles, vertexCount: vc, indexCount: ic };
}

// ===========================================================================
// Entry point
// ===========================================================================
export function parseMeshV20(fileBytes, filename = '<memory>', options = {}) {
  const flipV = options.flipV !== false;
  const warnings = [];

  checkVersionMarker(fileBytes);
  const topFlags = fileBytes.length > 0x48 ? fileBytes[0x48] : 0;

  let payload;
  try {
    payload = decompress20SectionedMarkerPayload(fileBytes).payload;
    warnings.push('used marker-sectioned payload layout');
  } catch (e) {
    payload = decompress20Payload(fileBytes).payload;
  }

  const header = parseHeaderFields(payload);
  const geometry = parseMeshGeometry(payload, header, topFlags, flipV);

  return {
    filename,
    vertexCount: geometry.vertexCount,
    indexCount: geometry.indexCount,
    vertices: geometry.vertices,
    uvs: geometry.uvLayer0,
    triangles: geometry.triangles,
    header,
    warnings,
  };
}

export function meshToObj(fileBytes, filename = '<memory>', options = {}) {
  const mesh = parseMeshV20(fileBytes, filename, options);
  const lines = [];
  lines.push(`# converted from ${filename}`);
  lines.push(`# ${mesh.vertexCount} vertices, ${mesh.triangles.length} triangles`);
  for (const v of mesh.vertices) lines.push(`v ${v[0].toFixed(6)} ${v[1].toFixed(6)} ${v[2].toFixed(6)}`);
  if (mesh.uvs) {
    for (const uv of mesh.uvs) lines.push(`vt ${uv[0].toFixed(6)} ${uv[1].toFixed(6)}`);
  }
  for (const [a, b, c] of mesh.triangles) {
    const ai = a + 1, bi = b + 1, ci = c + 1;
    lines.push(mesh.uvs ? `f ${ai}/${ai} ${bi}/${bi} ${ci}/${ci}` : `f ${ai} ${bi} ${ci}`);
  }
  return { obj: lines.join('\n'), mesh, warnings: mesh.warnings };
}
