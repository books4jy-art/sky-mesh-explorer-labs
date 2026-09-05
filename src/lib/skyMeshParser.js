// Browser port of ThatMeshStudio's src/meshParser.js (the SCOTL project's mesh
// decoder). Same byte-level format logic; Node's Buffer/fs/path are replaced
// with Uint8Array/DataView so it runs client-side. Keep in sync by hand if the
// source parser changes — there is no shared package between the two repos.
const UV_CHANNEL_ORDER = [0, 2, 1, 3];

const viewCache = new WeakMap();
function viewOf(buf) {
  let view = viewCache.get(buf);
  if (!view) {
    view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    viewCache.set(buf, view);
  }
  return view;
}

function readI32(buf, off) { return viewOf(buf).getInt32(off, true); }
function readU32(buf, off) { return viewOf(buf).getUint32(off, true); }
function readU16(buf, off) { return viewOf(buf).getUint16(off, true); }
function readF32(buf, off) { return viewOf(buf).getFloat32(off, true); }
function readI8(buf, off) { return viewOf(buf).getInt8(off); }

function readHalf(buf, off) {
  const h = readU16(buf, off);
  const sign = (h & 0x8000) ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x03ff;
  if (exp === 0) return sign * Math.pow(2, -14) * (frac / 1024);
  if (exp === 31) return frac ? NaN : sign * Infinity;
  return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

function bytesToLatin1(bytes) {
  let out = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return out;
}

function basename(fileName, ext) {
  const base = String(fileName || '').split(/[/\\]/).pop() || '';
  if (ext && base.toLowerCase().endsWith(ext.toLowerCase())) return base.slice(0, -ext.length);
  return base;
}

function lz4Decompress(src, uncompressedSize) {
  let i = 0;
  const out = [];

  function readLen(base) {
    let len = base;
    if (len === 15) {
      while (true) {
        if (i >= src.length) throw new Error('LZ4: truncated length');
        const s = src[i++];
        len += s;
        if (s !== 255) break;
      }
    }
    return len;
  }

  while (i < src.length) {
    const token = src[i++];
    const litLen = readLen(token >> 4);
    if (i + litLen > src.length) throw new Error('LZ4: literal out of range');
    for (let n = 0; n < litLen; n += 1) out.push(src[i++]);
    if (i >= src.length) break;
    if (i + 2 > src.length) throw new Error('LZ4: missing match offset');
    const offset = src[i] | (src[i + 1] << 8);
    i += 2;
    if (offset === 0) throw new Error('LZ4: invalid offset=0');
    let start = out.length - offset;
    if (start < 0) throw new Error('LZ4: offset beyond buffer');
    const matchLen = readLen(token & 0x0f) + 4;
    for (let n = 0; n < matchLen; n += 1) out.push(out[start++]);
  }

  if (out.length !== uncompressedSize) {
    throw new Error(`LZ4: size mismatch: got ${out.length}, expected ${uncompressedSize}`);
  }
  return Uint8Array.from(out);
}

function readName(buf) {
  const raw = buf.subarray(4, 68);
  const nul = raw.indexOf(0);
  return bytesToLatin1(raw.subarray(0, nul >= 0 ? nul : raw.length));
}

function statsForUvSet(name, uvs, indices) {
  const areas = [];
  let degenerateFaces = 0;
  let invalidValues = 0;
  let outOfRangeValues = 0;
  const us = [];
  const vs = [];

  for (let i = 0; i + 1 < uvs.length; i += 2) {
    const u = uvs[i];
    const v = uvs[i + 1];
    if (!Number.isFinite(u) || !Number.isFinite(v)) invalidValues += 1;
    if (u < -0.02 || u > 1.02 || v < -0.02 || v > 1.02) outOfRangeValues += 1;
    us.push(u);
    vs.push(v);
  }

  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i] * 2;
    const b = indices[i + 1] * 2;
    const c = indices[i + 2] * 2;
    const ax = uvs[a], ay = uvs[a + 1];
    const bx = uvs[b], by = uvs[b + 1];
    const cx = uvs[c], cy = uvs[c + 1];
    if (!Number.isFinite(ax + ay + bx + by + cx + cy)) {
      invalidValues += 1;
      continue;
    }
    const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
    areas.push(area);
    if (area < 1e-7) degenerateFaces += 1;
  }

  areas.sort((a, b) => a - b);
  const uniqueU = new Set(us.map((value) => Number.isFinite(value) ? value.toFixed(4) : 'bad')).size;
  const uniqueV = new Set(vs.map((value) => Number.isFinite(value) ? value.toFixed(4) : 'bad')).size;
  const p90Area = areas[Math.floor(areas.length * 0.9)] || 0;
  const medianArea = areas[Math.floor(areas.length * 0.5)] || 0;
  const score =
    invalidValues * 100000 +
    outOfRangeValues * 10000 +
    degenerateFaces * 100 -
    Math.log10(Math.max(p90Area, 1e-12)) * 6 -
    Math.min(uniqueU, uniqueV);

  return {
    name,
    degenerateFaces,
    invalidValues,
    outOfRangeValues,
    uniqueU,
    uniqueV,
    medianArea,
    p90Area,
    minU: us.reduce((a, b) => Math.min(a, b), Infinity),
    maxU: us.reduce((a, b) => Math.max(a, b), -Infinity),
    minV: vs.reduce((a, b) => Math.min(a, b), Infinity),
    maxV: vs.reduce((a, b) => Math.max(a, b), -Infinity),
    score,
  };
}

function chooseUvSet(uvSets, indices) {
  const scored = uvSets
    .filter((set) => set?.uvs?.length)
    .map((set) => ({ ...set, stats: statsForUvSet(set.name, set.uvs, indices) }));
  return { chosen: scored.find((set) => !set.stats.invalidValues) || null, scored };
}

function parseUncompressed(raw, version) {
  const fileSize = raw.length;
  let vertexCountOff;
  let indexCountOff;
  let vertexStart;

  if (version <= 0x19) {
    indexCountOff = 0x75;
    vertexStart = 0x9d;
    let pos01 = -1;
    for (let i = 0; i < Math.min(fileSize, 256); i += 1) {
      if (raw[i] === 0x01) {
        pos01 = i;
        break;
      }
    }
    vertexCountOff = pos01 >= 0 ? pos01 + 45 : -1;
  } else {
    vertexCountOff = 0x66;
    indexCountOff = 0x6a;
    vertexStart = 0x92;
  }

  if (vertexCountOff < 0 || vertexCountOff + 4 > fileSize || indexCountOff + 4 > fileSize) {
    throw new Error('Cannot locate uncompressed mesh counts');
  }

  const sharedVerts = readU32(raw, vertexCountOff);
  const totalVerts = readU32(raw, indexCountOff);
  const vertices = [];
  for (let i = 0; i < sharedVerts; i += 1) {
    const off = vertexStart + i * 16;
    vertices.push(readF32(raw, off), readF32(raw, off + 4), readF32(raw, off + 8));
  }

  const normalStart = vertexStart + sharedVerts * 16;
  const normals = [];
  const normalSigns = [];
  for (let i = 0; i < sharedVerts; i += 1) {
    const off = normalStart + i * 4;
    const x = Math.max(-1, readI8(raw, off) / 127);
    const y = Math.max(-1, readI8(raw, off + 1) / 127);
    const z = Math.max(-1, readI8(raw, off + 2) / 127);
    const length = Math.hypot(x, y, z) || 1;
    normals.push(x / length, y / length, z / length);
    normalSigns.push(Math.max(-1, readI8(raw, off + 3) / 127));
  }
  const uvStart = normalStart + sharedVerts * 4;
  const uvs = [];
  for (let i = 0; i < sharedVerts; i += 1) {
    const off = uvStart + i * 16;
    if (off + 8 <= fileSize) {
      uvs.push(readF32(raw, off), readF32(raw, off + 4));
    } else {
      uvs.push(0, 0);
    }
  }

  const indices = [];
  const indexStart = uvStart + sharedVerts * 16;
  for (let p = indexStart; p + 12 <= Math.min(indexStart + totalVerts * 4, fileSize); p += 12) {
    indices.push(readU32(raw, p), readU32(raw, p + 4), readU32(raw, p + 8));
  }

  const uvSets = [{ name: 'UV0', uvs, stats: statsForUvSet('UV0', uvs, indices) }];
  return { vertices, normals, normalSigns, uvs, uvSets, primaryUvSet: 'UV0', indices, boneWeights: [], skeleton: null, animated: false,
    debug: { uvDecode: 'raw-f32', normalDecode: 'snorm8-xyz' } };
}

function parseCompressed(raw, version) {
  const animated = raw[0x48] !== 0;
  let markerCount = 0;
  let payloadOff = 0x4a;
  if (version >= 0x20) {
    markerCount = readU32(raw, 0x4a);
    payloadOff = 0x4e + markerCount * 112;
  }
  if (payloadOff + 12 > raw.length) throw new Error('File too small for compression header');

  const isCompressed = readI32(raw, payloadOff);
  const compressedSize = readI32(raw, payloadOff + 4);
  const uncompressedSize = readI32(raw, payloadOff + 8);
  if (compressedSize <= 0 || uncompressedSize <= 0) throw new Error('Invalid compression sizes');
  if (payloadOff + 12 + compressedSize > raw.length) throw new Error('Compressed data out of range');

  const src = raw.subarray(payloadOff + 12, payloadOff + 12 + compressedSize);
  const skeletonRaw = raw.subarray(payloadOff + 12 + compressedSize);
  const dest = isCompressed ? lz4Decompress(src, uncompressedSize) : Uint8Array.from(src);

  let p = 4;
  const aabbA = [readF32(dest, p), readF32(dest, p + 4), readF32(dest, p + 8)]; p += 12;
  const aabbB = [readF32(dest, p), readF32(dest, p + 4), readF32(dest, p + 8)]; p += 12;
  const aabbA2 = [readF32(dest, p), readF32(dest, p + 4), readF32(dest, p + 8)]; p += 12;
  const aabbB2 = [readF32(dest, p), readF32(dest, p + 4), readF32(dest, p + 8)]; p += 12;
  const quantMin = Array.from({ length: 8 }, (_, i) => readF32(dest, p + i * 4)); p += 32;
  const quantMax = Array.from({ length: 8 }, (_, i) => readF32(dest, p + i * 4)); p += 32;

  const sharedVerts = readU32(dest, p); p += 4;
  const totalVerts = readU32(dest, p); p += 4;
  const isIdx32 = readU32(dest, p) !== 0; p += 4;
  const numPoints = readU32(dest, p); p += 4;
  const prop11 = readU32(dest, p); p += 4;
  const prop12 = readU32(dest, p); p += 4;
  const prop13 = readU32(dest, p); p += 4;
  const prop14 = readU32(dest, p); p += 4;

  const loadNorms = dest[p] !== 0; p += 1;
  const loadInfo2 = dest[p] !== 0; p += 1;
  p += 1;

  const skipPos = readU32(dest, p); p += 4;
  const skipUvs = readU32(dest, p); p += 4;
  const flag3 = readU32(dest, p); p += 4;
  p += 0x10;

  const vertices = [];
  if (skipPos === 0) {
    for (let i = 0; i < sharedVerts; i += 1) {
      const off = p + i * 16;
      vertices.push(readF32(dest, off), readF32(dest, off + 4), readF32(dest, off + 8));
    }
    p += sharedVerts * 16;
  }

  const normals = [];
  const normalSigns = [];
  if (loadNorms) {
    for (let i = 0; i < sharedVerts; i += 1) {
      const off = p + i * 4;
      const x = Math.max(-1, readI8(dest, off) / 127);
      const y = Math.max(-1, readI8(dest, off + 1) / 127);
      const z = Math.max(-1, readI8(dest, off + 2) / 127);
      const length = Math.hypot(x, y, z) || 1;
      normals.push(x / length, y / length, z / length);
      normalSigns.push(Math.max(-1, readI8(dest, off + 3) / 127));
    }
    p += sharedVerts * 4;
  }

  let uvs = [];
  let uvSets = [];
  if (skipUvs === 0) {
    const channels = UV_CHANNEL_ORDER.map((index, pair) => ({ name: `UV${index}`, uvs: [], decode: 'float16',
      source: { buffer: 'decompressed payload', offset: p + pair * 4, stride: 16, bits: 16 },
    }));
    for (let i = 0; i < sharedVerts; i += 1) {
      const off = p + i * 16;
      for (let ch = 0; ch < 4; ch += 1) {
        channels[ch].uvs.push(readHalf(dest, off + ch * 4), readHalf(dest, off + ch * 4 + 2));
      }
    }
    uvSets = channels;
    p += sharedVerts * 16;
  }

  const boneWeights = [];
  if (animated) {
    for (let i = 0; i < sharedVerts; i += 1) {
      const off = p + i * 8;
      const weights = [];
      for (let j = 0; j < 4; j += 1) {
        const boneIndex = dest[off + j];
        const weight = dest[off + 4 + j];
        if (boneIndex > 0 && weight > 0) weights.push([boneIndex - 1, weight / 255]);
      }
      boneWeights.push(weights);
    }
    p += sharedVerts * 8;
  }

  const indices = [];
  const faceCount = Math.floor(totalVerts / 3);
  const idxUnit = isIdx32 ? 4 : 2;
  for (let i = 0; i < faceCount; i += 1) {
    if (isIdx32) {
      indices.push(readI32(dest, p), readI32(dest, p + 4), readI32(dest, p + 8));
      p += 12;
    } else {
      indices.push(readU16(dest, p), readU16(dest, p + 2), readU16(dest, p + 4));
      p += 6;
    }
  }

  if (loadInfo2) p += totalVerts * idxUnit;
  if (numPoints > 0) p += sharedVerts * idxUnit;
  if (prop11 > 0) p += sharedVerts * idxUnit;
  if (prop12 > 0) p += prop12 * idxUnit;
  if (prop13 > 0) p += prop13 * 4;
  if (prop14 > 0) p += prop14 * (isIdx32 ? 8 : 4);
  p += faceCount * 4;

  if (skipPos > 0) {
    const sx = aabbB2[0] - aabbA2[0];
    const sy = aabbB2[1] - aabbA2[1];
    const sz = aabbB2[2] - aabbA2[2];
    for (let i = 0; i < sharedVerts; i += 1) {
      const packed = readU32(dest, p + i * 4);
      const qz = packed & 0x3ff;
      const qy = (packed >> 10) & 0x3ff;
      const qx = (packed >> 20) & 0x3ff;
      vertices.push(
        aabbA2[0] + (qx / 1023) * sx,
        aabbA2[1] + (qy / 1023) * sy,
        aabbA2[2] + (qz / 1023) * sz
      );
    }
    p += sharedVerts * 4;
    p += sharedVerts;
  }

  if (skipUvs > 0) {
    for (const [stream, size] of [skipUvs, flag3].entries()) {
      if (!size) continue;
      if (size !== sharedVerts * 4 || p + size > dest.length) {
        throw new Error(`Unsupported UV stream size: ${size} for ${sharedVerts} vertices`);
      }
      for (let pair = 0; pair < 2; pair += 1) {
        const axis = stream * 4 + pair * 2;
        const set = { name: `UV${UV_CHANNEL_ORDER[axis / 2]}`, uvs: [], decode: 'unorm8',
          source: { buffer: 'decompressed payload', offset: p + pair * 2, stride: 4, bits: 8,
            min: quantMin.slice(axis, axis + 2), max: quantMax.slice(axis, axis + 2) },
        };
        for (let i = 0; i < sharedVerts; i += 1) {
          for (let component = 0; component < 2; component += 1) {
            const a = axis + component;
            const value = dest[p + i * 4 + pair * 2 + component] / 255;
            set.uvs.push(quantMin[a] + value * (quantMax[a] - quantMin[a]));
          }
        }
        uvSets.push(set);
      }
      p += size;
    }
  }

  const selectedUv = chooseUvSet(uvSets, indices);
  uvSets = selectedUv.scored;
  uvs = selectedUv.chosen?.uvs || [];

  return {
    vertices,
    normals,
    normalSigns,
    uvs,
    uvSets,
    primaryUvSet: selectedUv.chosen?.name || null,
    indices,
    boneWeights,
    skeleton: animated && skeletonRaw.length >= 85 ? parseSkeleton(skeletonRaw) : null,
    animated,
    debug: {
      markerCount,
      payloadOff,
      compressed: Boolean(isCompressed),
      compressedSize,
      uncompressedSize,
      sharedVerts,
      totalVerts,
      isIdx32,
      loadNorms,
      normalDecode: loadNorms ? 'snorm8-xyz' : null,
      loadInfo2,
      skipPos,
      skipUvs,
      uvDecode: selectedUv.chosen?.decode || (skipUvs > 0 ? 'compressed' : 'half'),
      primaryUvSet: selectedUv.chosen?.name || null,
      flag3,
      quantMin,
      quantMax,
      aabbA,
      aabbB,
      aabbA2,
      aabbB2,
      payloadBytesConsumed: p,
      payloadBytesRemaining: Math.max(0, dest.length - p),
      skeletonBytes: skeletonRaw.length,
    },
  };
}

function parseSkeleton(raw) {
  try {
    let p = 0;
    p += 4;
    p += 64;
    const numBones = readU32(raw, p); p += 4;
    p += 12;
    p += 1;
    if (numBones > 1000 || p + numBones * 132 > raw.length) return null;
    const bones = [];
    for (let i = 0; i < numBones; i += 1) {
      const nameBytes = raw.subarray(p, p + 64);
      const nul = nameBytes.indexOf(0);
      const name = bytesToLatin1(nameBytes.subarray(0, nul >= 0 ? nul : 64));
      p += 64;
      const invBindMatrix = Array.from({ length: 16 }, (_, j) => readF32(raw, p + j * 4));
      p += 64;
      const parent1 = readU32(raw, p);
      p += 4;
      bones.push({ name, parentIndex: parent1 > 0 ? parent1 - 1 : -1, invBindMatrix });
    }
    return bones;
  } catch {
    return null;
  }
}

function extractEmbeddedReferences(raw) {
  const text = bytesToLatin1(raw);
  const matches = text.match(/[A-Za-z0-9_./\\ -]{4,}\.(?:ktx|png|jpg|jpeg|dds|tga|lua|fbx|anim|skel)/gi) || [];
  return Array.from(new Set(matches.map((s) => s.replace(/\0/g, '').trim()))).slice(0, 80);
}

export function fileFlags(fileName) {
  const stem = basename(fileName, '.mesh');
  return {
    stripAnimation: /StripAnim/i.test(stem),
    computeOcclusions: /CompOcc/i.test(stem),
    compressedPositions: /ZipPos/i.test(stem),
    compressedUvs: /ZipUvs/i.test(stem),
    strippedUv13: /StripUv13/i.test(stem),
    strippedNormals: /StripNorm/i.test(stem),
    copyFrameDelay: /CopyFrameDelay/i.test(stem),
  };
}

function parseRawMesh(raw, meta = {}) {
  if (raw.length < 0x58) throw new Error(`File too small (${raw.length} bytes)`);
  const version = readI32(raw, 0);
  const modelName = readName(raw);
  const parsed = version < 0x1e ? parseUncompressed(raw, version) : parseCompressed(raw, version);

  return {
    fileName: meta.fileName || 'Dropped mesh',
    modelName,
    version,
    bytes: raw.length,
    flags: fileFlags(meta.fileName || ''),
    embeddedReferences: extractEmbeddedReferences(raw),
    ...parsed,
  };
}

export function parseMeshBuffer(buffer, meta = {}) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return parseRawMesh(bytes, meta);
}

// Same "v / vt / f" line format as the previous skyMeshToObj.js exporter,
// adapted for this parser's flat vertex/uv/index arrays.
export function buildObjText(parsed, filename) {
  const { vertices, uvs, indices } = parsed;
  const vertexCount = vertices.length / 3;
  const triangleCount = indices.length / 3;
  const lines = [
    `# converted from ${filename}`,
    `# ${vertexCount} vertices, ${triangleCount} triangles`,
  ];
  for (let i = 0; i < vertices.length; i += 3) {
    lines.push(`v ${vertices[i].toFixed(6)} ${vertices[i + 1].toFixed(6)} ${vertices[i + 2].toFixed(6)}`);
  }
  const hasUvs = uvs && uvs.length === vertexCount * 2;
  if (hasUvs) {
    for (let i = 0; i < uvs.length; i += 2) {
      lines.push(`vt ${uvs[i].toFixed(6)} ${uvs[i + 1].toFixed(6)}`);
    }
  }
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] + 1, b = indices[i + 1] + 1, c = indices[i + 2] + 1;
    lines.push(hasUvs ? `f ${a}/${a} ${b}/${b} ${c}/${c}` : `f ${a} ${b} ${c}`);
  }
  return lines.join('\n');
}
