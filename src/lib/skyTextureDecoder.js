'use strict';
/**
 * skyTextureDecoder.js
 *
 * Parses and decodes Sky: Children of the Light texture files (PVR2/PVR3/
 * KTX1/KTX2 containers with PVRTC/ETC1/ETC2/EAC-R11/DXT1 payloads) to RGBA8.
 * Pure JS, zero dependencies.
 */

// ===========================================================================
// Bit-exact block decoders (ETC1/ETC2/EAC-R11/DXT1/PVRTC)
// ===========================================================================

function clamp8(n) { return n < 0 ? 0 : (n > 255 ? 255 : n); }
function u8(n) { return ((n % 256) + 256) % 256; }

function applicateColor(c, m) {
  return [clamp8(c[0] + m), clamp8(c[1] + m), clamp8(c[2] + m), 255];
}
function applicateColorAlpha(c, m, transparent) {
  return [clamp8(c[0] + m), clamp8(c[1] + m), clamp8(c[2] + m), transparent ? 0 : 255];
}
function applicateColorRaw(c) { return [c[0], c[1], c[2], 255]; }

const ETC1_MODIFIER_TABLE = [[2,8],[5,17],[9,29],[13,42],[18,60],[24,80],[33,106],[47,183]];
const ETC2A_MODIFIER_TABLE = [
  [[0,8],[0,17],[0,29],[0,42],[0,60],[0,80],[0,106],[0,183]],
  [[2,8],[5,17],[9,29],[13,42],[18,60],[24,80],[33,106],[47,183]],
];
const ETC1_SUBBLOCK_TABLE = [
  [0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1],
  [0,0,1,1,0,0,1,1,0,0,1,1,0,0,1,1],
];
const ETC2_DISTANCE_TABLE = [3,6,11,16,23,32,41,64];
const ETC2_ALPHA_MOD_TABLE = [
  [-3,-6,-9,-15,2,5,8,14],[-3,-7,-10,-13,2,6,9,12],[-2,-5,-8,-13,1,4,7,12],[-2,-4,-6,-13,1,3,5,12],
  [-3,-6,-8,-12,2,5,7,11],[-3,-7,-9,-11,2,6,8,10],[-4,-7,-8,-11,3,6,7,10],[-3,-5,-8,-11,2,4,7,10],
  [-2,-6,-8,-10,1,5,7,9],[-2,-5,-8,-10,1,4,7,9],[-2,-4,-8,-10,1,3,7,9],[-2,-5,-7,-10,1,4,6,9],
  [-3,-4,-7,-10,2,3,6,9],[-1,-2,-3,-10,0,1,2,9],[-4,-6,-8,-9,3,5,7,8],[-3,-5,-7,-9,2,4,6,8],
];
const WRITE_ORDER_TABLE_REV = [15,11,7,3,14,10,6,2,13,9,5,1,12,8,4,0];

function decodeEtc1Block(data, outbuf) {
  const code = [data[3] >> 5, (data[3] >> 2) & 7];
  const table = ETC1_SUBBLOCK_TABLE[data[3] & 1];
  const c = [[0,0,0],[0,0,0]];
  if (data[3] & 2) {
    c[0][0] = data[0] & 0xf8; c[0][1] = data[1] & 0xf8; c[0][2] = data[2] & 0xf8;
    c[1][0] = u8(u8(c[0][0] + ((data[0] << 3) & 0x18)) - ((data[0] << 3) & 0x20));
    c[1][1] = u8(u8(c[0][1] + ((data[1] << 3) & 0x18)) - ((data[1] << 3) & 0x20));
    c[1][2] = u8(u8(c[0][2] + ((data[2] << 3) & 0x18)) - ((data[2] << 3) & 0x20));
    c[0][0] |= c[0][0] >> 5; c[0][1] |= c[0][1] >> 5; c[0][2] |= c[0][2] >> 5;
    c[1][0] |= c[1][0] >> 5; c[1][1] |= c[1][1] >> 5; c[1][2] |= c[1][2] >> 5;
  } else {
    c[0][0] = (data[0] & 0xf0) | (data[0] >> 4); c[1][0] = (data[0] & 0x0f) | u8(data[0] << 4);
    c[0][1] = (data[1] & 0xf0) | (data[1] >> 4); c[1][1] = (data[1] & 0x0f) | u8(data[1] << 4);
    c[0][2] = (data[2] & 0xf0) | (data[2] >> 4); c[1][2] = (data[2] & 0x0f) | u8(data[2] << 4);
  }
  let j = (data[6] << 8) | data[7];
  let k = (data[4] << 8) | data[5];
  for (let i = 0; i < 16; i++) {
    const px = i >> 2, py = i & 3;
    const s = table[i];
    const m = ETC1_MODIFIER_TABLE[code[s]][j & 1];
    outbuf[py * 4 + px] = applicateColor(c[s], (k & 1) > 0 ? -m : m);
    j >>= 1; k >>= 1;
  }
}

function decodeEtc2RgbBlock(data, outbuf) {
  let j = (data[6] << 8) | data[7];
  let k = (data[4] << 8) | data[5];
  const c = [[0,0,0],[0,0,0],[0,0,0]];

  if (data[3] & 2) {
    const r = data[0] & 0xf8, dr = ((data[0] << 3) & 0x18) - ((data[0] << 3) & 0x20);
    const g = data[1] & 0xf8, dg = ((data[1] << 3) & 0x18) - ((data[1] << 3) & 0x20);
    const b = data[2] & 0xf8, db = ((data[2] << 3) & 0x18) - ((data[2] << 3) & 0x20);

    if (r + dr < 0 || r + dr > 255) { // T
      c[0][0] = u8((data[0] << 3) & 0xc0) | u8((data[0] << 4) & 0x30) | ((data[0] >> 1) & 0xc) | (data[0] & 3);
      c[0][0] = u8(c[0][0]);
      c[0][1] = (data[1] & 0xf0) | (data[1] >> 4);
      c[0][2] = (data[1] & 0x0f) | u8(data[1] << 4);
      c[1][0] = (data[2] & 0xf0) | (data[2] >> 4);
      c[1][1] = (data[2] & 0x0f) | u8(data[2] << 4);
      c[1][2] = (data[3] & 0xf0) | (data[3] >> 4);
      const d = ETC2_DISTANCE_TABLE[((data[3] >> 1) & 6) | (data[3] & 1)];
      const colorSet = [applicateColorRaw(c[0]), applicateColor(c[1], d), applicateColorRaw(c[1]), applicateColor(c[1], -d)];
      k <<= 1;
      for (let i = 0; i < 16; i++) {
        const px = i >> 2, py = i & 3;
        outbuf[py * 4 + px] = colorSet[(k & 2) | (j & 1)].slice();
        j >>= 1; k >>= 1;
      }
    } else if (g + dg < 0 || g + dg > 255) { // H
      c[0][0] = u8((data[0] << 1) & 0xf0) | ((data[0] >> 3) & 0xf);
      c[0][1] = u8((data[0] << 5) & 0xe0) | (data[1] & 0x10);
      c[0][1] = u8(c[0][1] | (c[0][1] >> 4));
      c[0][2] = (data[1] & 8) | u8((data[1] << 1) & 6) | (data[2] >> 7);
      c[0][2] = u8(c[0][2] | u8(c[0][2] << 4));
      c[1][0] = u8((data[2] << 1) & 0xf0) | ((data[2] >> 3) & 0xf);
      c[1][1] = u8((data[2] << 5) & 0xe0) | ((data[3] >> 3) & 0x10);
      c[1][1] = u8(c[1][1] | (c[1][1] >> 4));
      c[1][2] = u8((data[3] << 1) & 0xf0) | ((data[3] >> 3) & 0xf);
      let dIdx = (data[3] & 4) | u8((data[3] << 1) & 2);
      if (c[0][0] > c[1][0] || (c[0][0] === c[1][0] && (c[0][1] > c[1][1] || (c[0][1] === c[1][1] && c[0][2] >= c[1][2])))) {
        dIdx += 1;
      }
      const d = ETC2_DISTANCE_TABLE[dIdx];
      const colorSet = [applicateColor(c[0], d), applicateColor(c[0], -d), applicateColor(c[1], d), applicateColor(c[1], -d)];
      k <<= 1;
      for (let i = 0; i < 16; i++) {
        const px = i >> 2, py = i & 3;
        outbuf[py * 4 + px] = colorSet[(k & 2) | (j & 1)].slice();
        j >>= 1; k >>= 1;
      }
    } else if (b + db < 0 || b + db > 255) { // planar
      c[0][0] = u8((data[0] << 1) & 0xfc) | ((data[0] >> 5) & 3);
      c[0][1] = u8((data[0] << 7) & 0x80) | (data[1] & 0x7e) | (data[0] & 1);
      c[0][2] = u8((data[1] << 7) & 0x80) | ((data[2] << 2) & 0x60) | u8((data[2] << 3) & 0x18) | ((data[3] >> 5) & 4);
      c[0][2] = u8(c[0][2] | (c[0][2] >> 6));
      c[1][0] = u8((data[3] << 1) & 0xf8) | ((data[3] << 2) & 4) | ((data[3] >> 5) & 3);
      c[1][0] = u8(c[1][0]);
      c[1][1] = (data[4] & 0xfe) | (data[4] >> 7);
      c[1][2] = u8((data[4] << 7) & 0x80) | ((data[5] >> 1) & 0x7c);
      c[1][2] = u8(c[1][2] | (c[1][2] >> 6));
      c[2][0] = u8((data[5] << 5) & 0xe0) | ((data[6] >> 3) & 0x1c) | ((data[5] >> 1) & 3);
      c[2][1] = u8((data[6] << 3) & 0xf8) | ((data[7] >> 5) & 0x6) | ((data[6] >> 4) & 1);
      c[2][2] = u8(data[7] << 2) | ((data[7] >> 4) & 3);
      let idx = 0;
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const r2 = clamp8((x * (c[1][0] - c[0][0]) + y * (c[2][0] - c[0][0]) + 4 * c[0][0] + 2) >> 2);
          const g2 = clamp8((x * (c[1][1] - c[0][1]) + y * (c[2][1] - c[0][1]) + 4 * c[0][1] + 2) >> 2);
          const b2 = clamp8((x * (c[1][2] - c[0][2]) + y * (c[2][2] - c[0][2]) + 4 * c[0][2] + 2) >> 2);
          outbuf[idx] = [r2, g2, b2, 255];
          idx += 1;
        }
      }
    } else { // differential
      const code = [data[3] >> 5, (data[3] >> 2) & 7];
      const table = ETC1_SUBBLOCK_TABLE[data[3] & 1];
      c[0][0] = (r | (r >> 5)) & 0xFF; c[0][1] = (g | (g >> 5)) & 0xFF; c[0][2] = (b | (b >> 5)) & 0xFF;
      c[1][0] = u8(r + dr); c[1][1] = u8(g + dg); c[1][2] = u8(b + db);
      c[1][0] |= c[1][0] >> 5; c[1][1] |= c[1][1] >> 5; c[1][2] |= c[1][2] >> 5;
      for (let i = 0; i < 16; i++) {
        const px = i >> 2, py = i & 3;
        const s = table[i];
        const m = ETC1_MODIFIER_TABLE[code[s]][j & 1];
        outbuf[py * 4 + px] = applicateColor(c[s], (k & 1) > 0 ? -m : m);
        j >>= 1; k >>= 1;
      }
    }
  } else { // individual
    const code = [data[3] >> 5, (data[3] >> 2) & 7];
    const table = ETC1_SUBBLOCK_TABLE[data[3] & 1];
    c[0][0] = (data[0] & 0xf0) | (data[0] >> 4); c[1][0] = (data[0] & 0x0f) | u8(data[0] << 4);
    c[0][1] = (data[1] & 0xf0) | (data[1] >> 4); c[1][1] = (data[1] & 0x0f) | u8(data[1] << 4);
    c[0][2] = (data[2] & 0xf0) | (data[2] >> 4); c[1][2] = (data[2] & 0x0f) | u8(data[2] << 4);
    for (let i = 0; i < 16; i++) {
      const px = i >> 2, py = i & 3;
      const s = table[i];
      const m = ETC1_MODIFIER_TABLE[code[s]][j & 1];
      outbuf[py * 4 + px] = applicateColor(c[s], (k & 1) > 0 ? -m : m);
      j >>= 1; k >>= 1;
    }
  }
}

function decodeEtc2Rgba1Block(data, outbuf) {
  let j = (data[6] << 8) | data[7];
  let k = (data[4] << 8) | data[5];
  const c = [[0,0,0],[0,0,0],[0,0,0]];
  const obaq = ((data[3] >> 1) & 1) > 0;

  const r = data[0] & 0xf8, dr = ((data[0] << 3) & 0x18) - ((data[0] << 3) & 0x20);
  const g = data[1] & 0xf8, dg = ((data[1] << 3) & 0x18) - ((data[1] << 3) & 0x20);
  const b = data[2] & 0xf8, db = ((data[2] << 3) & 0x18) - ((data[2] << 3) & 0x20);

  if (r + dr < 0 || r + dr > 255) { // T
    c[0][0] = u8((data[0] << 3) & 0xc0) | u8((data[0] << 4) & 0x30) | ((data[0] >> 1) & 0xc) | (data[0] & 3);
    c[0][0] = u8(c[0][0]);
    c[0][1] = (data[1] & 0xf0) | (data[1] >> 4);
    c[0][2] = (data[1] & 0x0f) | u8(data[1] << 4);
    c[1][0] = (data[2] & 0xf0) | (data[2] >> 4);
    c[1][1] = (data[2] & 0x0f) | u8(data[2] << 4);
    c[1][2] = (data[3] & 0xf0) | (data[3] >> 4);
    const d = ETC2_DISTANCE_TABLE[((data[3] >> 1) & 6) | (data[3] & 1)];
    const colorSet = [applicateColorRaw(c[0]), applicateColor(c[1], d), applicateColorRaw(c[1]), applicateColor(c[1], -d)];
    k <<= 1;
    for (let i = 0; i < 16; i++) {
      const px = i >> 2, py = i & 3;
      const index = (k & 2) | (j & 1);
      const px_ = colorSet[index].slice();
      if (!obaq && index === 2) px_[3] = 0;
      outbuf[py * 4 + px] = px_;
      j >>= 1; k >>= 1;
    }
  } else if (g + dg < 0 || g + dg > 255) { // H
    c[0][0] = u8((data[0] << 1) & 0xf0) | ((data[0] >> 3) & 0xf);
    c[0][1] = u8((data[0] << 5) & 0xe0) | (data[1] & 0x10);
    c[0][1] = u8(c[0][1] | (c[0][1] >> 4));
    c[0][2] = (data[1] & 8) | u8((data[1] << 1) & 6) | (data[2] >> 7);
    c[0][2] = u8(c[0][2] | u8(c[0][2] << 4));
    c[1][0] = u8((data[2] << 1) & 0xf0) | ((data[2] >> 3) & 0xf);
    c[1][1] = u8((data[2] << 5) & 0xe0) | ((data[3] >> 3) & 0x10);
    c[1][1] = u8(c[1][1] | (c[1][1] >> 4));
    c[1][2] = u8((data[3] << 1) & 0xf0) | ((data[3] >> 3) & 0xf);
    let dIdx = (data[3] & 4) | u8((data[3] << 1) & 2);
    if (c[0][0] > c[1][0] || (c[0][0] === c[1][0] && (c[0][1] > c[1][1] || (c[0][1] === c[1][1] && c[0][2] >= c[1][2])))) {
      dIdx += 1;
    }
    const d = ETC2_DISTANCE_TABLE[dIdx];
    const colorSet = [applicateColor(c[0], d), applicateColor(c[0], -d), applicateColor(c[1], d), applicateColor(c[1], -d)];
    k <<= 1;
    for (let i = 0; i < 16; i++) {
      const px = i >> 2, py = i & 3;
      const index = (k & 2) | (j & 1);
      const px_ = colorSet[index].slice();
      if (!obaq && index === 2) px_[3] = 0;
      outbuf[py * 4 + px] = px_;
      j >>= 1; k >>= 1;
    }
  } else if (b + db < 0 || b + db > 255) { // planar
    c[0][0] = u8((data[0] << 1) & 0xfc) | ((data[0] >> 5) & 3);
    c[0][1] = u8((data[0] << 7) & 0x80) | (data[1] & 0x7e) | (data[0] & 1);
    c[0][2] = u8((data[1] << 7) & 0x80) | ((data[2] << 2) & 0x60) | u8((data[2] << 3) & 0x18) | ((data[3] >> 5) & 4);
    c[0][2] = u8(c[0][2] | (c[0][2] >> 6));
    c[1][0] = u8((data[3] << 1) & 0xf8) | ((data[3] << 2) & 4) | ((data[3] >> 5) & 3);
    c[1][1] = (data[4] & 0xfe) | (data[4] >> 7);
    c[1][2] = u8((data[4] << 7) & 0x80) | ((data[5] >> 1) & 0x7c);
    c[1][2] = u8(c[1][2] | (c[1][2] >> 6));
    c[2][0] = u8((data[5] << 5) & 0xe0) | ((data[6] >> 3) & 0x1c) | ((data[5] >> 1) & 3);
    c[2][1] = u8((data[6] << 3) & 0xf8) | ((data[7] >> 5) & 0x6) | ((data[6] >> 4) & 1);
    c[2][2] = u8(data[7] << 2) | ((data[7] >> 4) & 3);
    let idx = 0;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const r2 = clamp8((x * (c[1][0] - c[0][0]) + y * (c[2][0] - c[0][0]) + 4 * c[0][0] + 2) >> 2);
        const g2 = clamp8((x * (c[1][1] - c[0][1]) + y * (c[2][1] - c[0][1]) + 4 * c[0][1] + 2) >> 2);
        const b2 = clamp8((x * (c[1][2] - c[0][2]) + y * (c[2][2] - c[0][2]) + 4 * c[0][2] + 2) >> 2);
        outbuf[idx] = [r2, g2, b2, 255];
        idx += 1;
      }
    }
  } else { // differential
    const code = [data[3] >> 5, (data[3] >> 2) & 7];
    const table = ETC1_SUBBLOCK_TABLE[data[3] & 1];
    c[0][0] = (r | (r >> 5)) & 0xFF; c[0][1] = (g | (g >> 5)) & 0xFF; c[0][2] = (b | (b >> 5)) & 0xFF;
    c[1][0] = u8(r + dr); c[1][1] = u8(g + dg); c[1][2] = u8(b + db);
    c[1][0] |= c[1][0] >> 5; c[1][1] |= c[1][1] >> 5; c[1][2] |= c[1][2] >> 5;
    for (let i = 0; i < 16; i++) {
      const px = i >> 2, py = i & 3;
      const s = table[i];
      const m = ETC2A_MODIFIER_TABLE[obaq ? 1 : 0][code[s]][j & 1];
      const transparent = !obaq && (k & 1) !== 0 && (j & 1) === 0;
      outbuf[py * 4 + px] = applicateColorAlpha(c[s], (k & 1) > 0 ? -m : m, transparent);
      j >>= 1; k >>= 1;
    }
  }
}

function decodeEtc2A8Block(data, outbuf) {
  if ((data[1] & 0xf0) > 0) {
    const multiplier = data[1] >> 4;
    const table = ETC2_ALPHA_MOD_TABLE[data[1] & 0xf];
    let l = 0n;
    for (let i = 0; i < 8; i++) l = (l << 8n) | BigInt(data[i]);
    for (let i = 0; i < 16; i++) {
      const sel = Number(l & 7n);
      const alpha = clamp8(data[0] + multiplier * table[sel]);
      outbuf[WRITE_ORDER_TABLE_REV[i]][3] = alpha;
      l >>= 3n;
    }
  } else {
    const alpha = data[0];
    for (let i = 0; i < 16; i++) outbuf[i][3] = alpha;
  }
}

function decodeEtc2Rgba8Block(data, outbuf) {
  decodeEtc2RgbBlock(data.subarray(8), outbuf);
  decodeEtc2A8Block(data, outbuf);
}

function decodeBlocks(data, width, height, blockW, blockH, rawBlockSize, blockDecodeFn) {
  const numBlocksX = Math.ceil(width / blockW);
  const numBlocksY = Math.ceil(height / blockH);
  const out = new Uint8Array(width * height * 4);
  const buffer = new Array(blockW * blockH);
  for (let i = 0; i < buffer.length; i++) buffer[i] = [0, 0, 0, 255];

  let dataOffset = 0;
  for (let by = 0; by < numBlocksY; by++) {
    for (let bx = 0; bx < numBlocksX; bx++) {
      blockDecodeFn(data.subarray(dataOffset), buffer);
      const x0 = blockW * bx;
      const copyWidth = (blockW * (bx + 1) > width) ? (width - blockW * bx) : blockW;
      const y0 = by * blockH;
      const copyHeight = (blockH * (by + 1) > height) ? (height - y0) : blockH;
      for (let y = 0; y < copyHeight; y++) {
        for (let x = 0; x < copyWidth; x++) {
          const px = buffer[y * blockW + x];
          const o = ((y0 + y) * width + (x0 + x)) * 4;
          out[o] = px[0]; out[o+1] = px[1]; out[o+2] = px[2]; out[o+3] = px[3];
        }
      }
      dataOffset += rawBlockSize;
    }
  }
  return out;
}

export function decodeEtc1(data, width, height) { return decodeBlocks(data, width, height, 4, 4, 8, decodeEtc1Block); }
export function decodeEtc2Rgb(data, width, height) { return decodeBlocks(data, width, height, 4, 4, 8, decodeEtc2RgbBlock); }
export function decodeEtc2Rgba1(data, width, height) { return decodeBlocks(data, width, height, 4, 4, 8, decodeEtc2Rgba1Block); }
export function decodeEtc2Rgba8(data, width, height) { return decodeBlocks(data, width, height, 4, 4, 16, decodeEtc2Rgba8Block); }

const EAC_MOD = ETC2_ALPHA_MOD_TABLE;
export function decodeEacR11Unorm(data, width, height) {
  const out = new Uint8Array(width * height * 4);
  const bx = Math.ceil(width / 4), by = Math.ceil(height / 4);
  for (let row = 0; row < by; row++) {
    for (let col = 0; col < bx; col++) {
      const off = (row * bx + col) * 8;
      if (off + 8 > data.length) continue;
      const block = data.subarray(off, off + 8);
      const base = block[0];
      const mul = (block[1] >> 4) & 0xF;
      const table = EAC_MOD[block[1] & 0xF];
      let bits = 0n;
      for (let i = 2; i < 8; i++) bits = (bits << 8n) | BigInt(block[i]);
      for (let pix = 0; pix < 16; pix++) {
        const px = pix % 4, py = Math.floor(pix / 4);
        const x = col * 4 + px, y = row * 4 + py;
        if (x >= width || y >= height) continue;
        const idx = Number((bits >> BigInt((15 - pix) * 3)) & 7n);
        const modifier = table[idx];
        let value11 = mul === 0 ? (base * 8 + 4 + modifier) : (base * 8 + 4 + modifier * mul * 8);
        value11 = Math.max(0, Math.min(2047, value11));
        const value8 = Math.floor((value11 * 255 + 1023) / 2047);
        const o = (y * width + x) * 4;
        out[o] = value8; out[o+1] = value8; out[o+2] = value8; out[o+3] = 255;
      }
    }
  }
  return out;
}

function dxt1Unpack565(c) {
  return [
    Math.floor(((c >> 11) & 31) * 255 / 31),
    Math.floor(((c >> 5) & 63) * 255 / 63),
    Math.floor((c & 31) * 255 / 31),
    255,
  ];
}
function dxt1Palette(c0, c1) {
  const p0 = dxt1Unpack565(c0), p1 = dxt1Unpack565(c1);
  const p = [p0, p1, [0,0,0,255], [0,0,0,255]];
  if (c0 > c1) {
    for (let i = 0; i < 3; i++) {
      p[2][i] = Math.floor((p0[i]*2 + p1[i]) / 3);
      p[3][i] = Math.floor((p0[i] + p1[i]*2) / 3);
    }
  } else {
    for (let i = 0; i < 3; i++) p[2][i] = Math.floor((p0[i] + p1[i]) / 2);
    p[3] = [0,0,0,0];
  }
  return p;
}
export function decodeDxt1(data, width, height) {
  const out = new Uint8Array(width * height * 4);
  const bx = Math.ceil(width / 4), by = Math.ceil(height / 4);
  for (let row = 0; row < by; row++) {
    for (let col = 0; col < bx; col++) {
      const off = (row * bx + col) * 8;
      if (off + 8 > data.length) continue;
      const c0 = data[off] | (data[off+1] << 8);
      const c1 = data[off+2] | (data[off+3] << 8);
      const bits = (data[off+4]) | (data[off+5]<<8) | (data[off+6]<<16) | (data[off+7]<<24);
      const pal = dxt1Palette(c0, c1);
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const ix = col*4+px, iy = row*4+py;
          if (ix < width && iy < height) {
            const idx = (bits >>> ((py*4+px)*2)) & 3;
            const o = (iy*width+ix)*4;
            const p = pal[idx];
            out[o]=p[0]; out[o+1]=p[1]; out[o+2]=p[2]; out[o+3]=p[3];
          }
        }
      }
    }
  }
  return out;
}

function wrapWord(n, w) { return ((w % n) + n) % n; }
function twiddleUV(xs, ys, xp, yp) {
  let minDim = xs, maxVal = yp, tw = 0, srcBit = 1, dstBit = 1, shift = 0;
  if (ys < xs) { minDim = ys; maxVal = xp; }
  while (srcBit < minDim) {
    if (yp & srcBit) tw |= dstBit;
    if (xp & srcBit) tw |= dstBit << 1;
    srcBit <<= 1; dstBit <<= 2; shift += 1;
  }
  maxVal >>= shift;
  return tw | (maxVal << (2 * shift));
}
function pvrtcColorA(c) {
  if (c & 0x8000) return [(c & 0x7c00) >> 10, (c & 0x3e0) >> 5, (c & 0x1e) | ((c & 0x1e) >> 4), 0xf];
  return [((c & 0xf00) >> 7) | ((c & 0xf00) >> 11), ((c & 0xf0) >> 3) | ((c & 0xf0) >> 7), ((c & 0xe) << 1) | ((c & 0xe) >> 2), (c & 0x7000) >> 11];
}
function pvrtcColorB(c) {
  if (c & 0x80000000) return [(c & 0x7c000000) >>> 26, (c & 0x03e00000) >>> 21, (c & 0x001f0000) >>> 16, 0xf];
  return [((c & 0x0f000000) >>> 23) | ((c & 0x0f000000) >>> 27), ((c & 0x00f00000) >>> 19) | ((c & 0x00f00000) >>> 23), ((c & 0x000f0000) >>> 15) | ((c & 0x000f0000) >>> 19), (c & 0x70000000) >>> 27];
}
function add4(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2],a[3]+b[3]];}
function sub4(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2],a[3]-b[3]];}
function mul4(a,k){return [a[0]*k,a[1]*k,a[2]*k,a[3]*k];}
function pvrtcInterpolate(p,q,r,s,bpp) {
  const ww = bpp === 2 ? 8 : 4, wh = 4;
  const qm = sub4(q,p), sm = sub4(s,r);
  let hp = mul4(p, ww), hr = mul4(r, ww);
  const out = new Array(ww*wh);
  if (bpp === 2) {
    for (let x = 0; x < ww; x++) {
      let result = mul4(hp, 4);
      const dy = sub4(hr, hp);
      for (let y = 0; y < wh; y++) {
        out[y*ww+x] = [(result[0]>>7)+(result[0]>>2),(result[1]>>7)+(result[1]>>2),(result[2]>>7)+(result[2]>>2),(result[3]>>5)+(result[3]>>1)];
        result = add4(result, dy);
      }
      hp = add4(hp, qm); hr = add4(hr, sm);
    }
  } else {
    for (let y = 0; y < wh; y++) {
      let result = mul4(hp, 4);
      const dy = sub4(hr, hp);
      for (let x = 0; x < ww; x++) {
        out[y*ww+x] = [(result[0]>>6)+(result[0]>>1),(result[1]>>6)+(result[1]>>1),(result[2]>>6)+(result[2]>>1),(result[3]>>4)+result[3]];
        result = add4(result, dy);
      }
      hp = add4(hp, qm); hr = add4(hr, sm);
    }
  }
  return out;
}
function pvrtcUnpackModulations(color, modData, ox, oy, vals, modes, bpp) {
  const mode = (color & 1) !== 0;
  let bits = modData >>> 0;
  if (bpp === 2) {
    let wordMode = mode ? 1 : 0;
    if (mode) {
      if (bits & 1) {
        wordMode = (bits & (1<<20)) ? 3 : 2;
        if (bits & (1<<21)) bits |= (1<<20); else bits &= ~(1<<20);
      }
      if (bits & 2) bits |= 1; else bits &= ~1;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
        modes[x+ox][y+oy] = wordMode;
        if (((x ^ y) & 1) === 0) { vals[x+ox][y+oy] = bits & 3; bits >>>= 2; }
      }
    } else {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
        modes[x+ox][y+oy] = wordMode;
        vals[x+ox][y+oy] = (bits & 1) ? 3 : 0;
        bits >>>= 1;
      }
    }
  } else {
    if (mode) {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        let v = bits & 3;
        if (v === 1) v = 4; else if (v === 2) v = 14; else if (v === 3) v = 8;
        vals[y+oy][x+ox] = v; bits >>>= 2;
      }
    } else {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        let v = (bits & 3) * 3;
        if (v > 3) v -= 1;
        vals[y+oy][x+ox] = v; bits >>>= 2;
      }
    }
  }
}
function pvrtcModValue(vals, modes, x, y, bpp) {
  if (bpp === 2) {
    const rep = [0,3,5,8];
    if (modes[x][y] === 0) return rep[vals[x][y]];
    if (((x ^ y) & 1) === 0) return rep[vals[x][y]];
    if (modes[x][y] === 1) return Math.floor((rep[vals[x][y-1]] + rep[vals[x][y+1]] + rep[vals[x-1][y]] + rep[vals[x+1][y]] + 2) / 4);
    if (modes[x][y] === 2) return Math.floor((rep[vals[x-1][y]] + rep[vals[x+1][y]] + 1) / 2);
    return Math.floor((rep[vals[x][y-1]] + rep[vals[x][y+1]] + 1) / 2);
  }
  return vals[x][y];
}
function pvrtcGetDecompressedPixels(p, q, r, s, bpp) {
  const ww = bpp === 2 ? 8 : 4, wh = 4;
  const vals = Array.from({length:16}, () => new Array(8).fill(0));
  const modes = Array.from({length:16}, () => new Array(8).fill(0));
  pvrtcUnpackModulations(p[0], p[1], 0, 0, vals, modes, bpp);
  pvrtcUnpackModulations(q[0], q[1], ww, 0, vals, modes, bpp);
  pvrtcUnpackModulations(r[0], r[1], 0, wh, vals, modes, bpp);
  pvrtcUnpackModulations(s[0], s[1], ww, wh, vals, modes, bpp);
  const upa = pvrtcInterpolate(pvrtcColorA(p[0]), pvrtcColorA(q[0]), pvrtcColorA(r[0]), pvrtcColorA(s[0]), bpp);
  const upb = pvrtcInterpolate(pvrtcColorB(p[0]), pvrtcColorB(q[0]), pvrtcColorB(r[0]), pvrtcColorB(s[0]), bpp);
  const px = new Array(ww*wh);
  for (let y = 0; y < wh; y++) {
    for (let x = 0; x < ww; x++) {
      let m = pvrtcModValue(vals, modes, x + ww/2, y + wh/2, bpp);
      let punch = false;
      if (m > 10) { m -= 10; punch = true; }
      const a = upa[y*ww+x], b = upb[y*ww+x];
      const c = [
        clamp8(Math.floor((a[0]*(8-m)+b[0]*m)/8)),
        clamp8(Math.floor((a[1]*(8-m)+b[1]*m)/8)),
        clamp8(Math.floor((a[2]*(8-m)+b[2]*m)/8)),
        punch ? 0 : clamp8(Math.floor((a[3]*(8-m)+b[3]*m)/8)),
      ];
      const idx = bpp === 2 ? y*ww+x : y + x*wh;
      px[idx] = c;
    }
  }
  return px;
}
export function decodePvrtc(data, width, height, twoBpp, hasAlpha) {
  const bpp = twoBpp ? 2 : 4;
  const wordW = bpp === 2 ? 8 : 4, wordH = 4;
  const xTrue = Math.max(width, bpp === 2 ? 16 : 8);
  const yTrue = Math.max(height, 8);
  const nx = xTrue / wordW, ny = yTrue / wordH;
  const needed = nx * ny * 2;
  const words = new Uint32Array(needed);
  for (let i = 0; i < needed; i++) {
    const off = i * 4;
    if (off + 4 <= data.length) words[i] = data[off] | (data[off+1]<<8) | (data[off+2]<<16) | (data[off+3]<<24);
  }
  const out = new Uint8Array(xTrue * yTrue * 4);
  function setRgba(x, y, p) {
    const off = (y * xTrue + x) * 4;
    if (off + 4 <= out.length) { out[off]=p[0]; out[off+1]=p[1]; out[off+2]=p[2]; out[off+3]=p[3]; }
  }
  for (let wordYI = -1; wordYI < ny - 1; wordYI++) {
    for (let wordXI = -1; wordXI < nx - 1; wordXI++) {
      const p = [wrapWord(nx, wordXI), wrapWord(ny, wordYI)];
      const q = [wrapWord(nx, wordXI+1), wrapWord(ny, wordYI)];
      const r = [wrapWord(nx, wordXI), wrapWord(ny, wordYI+1)];
      const s = [wrapWord(nx, wordXI+1), wrapWord(ny, wordYI+1)];
      const offs = [
        twiddleUV(nx, ny, p[0], p[1]) * 2,
        twiddleUV(nx, ny, q[0], q[1]) * 2,
        twiddleUV(nx, ny, r[0], r[1]) * 2,
        twiddleUV(nx, ny, s[0], s[1]) * 2,
      ];
      const pp = [words[offs[0]+1], words[offs[0]]];
      const qq = [words[offs[1]+1], words[offs[1]]];
      const rr = [words[offs[2]+1], words[offs[2]]];
      const ss = [words[offs[3]+1], words[offs[3]]];
      const pxs = pvrtcGetDecompressedPixels(pp, qq, rr, ss, bpp);
      for (let y = 0; y < wordH/2; y++) {
        for (let x = 0; x < wordW/2; x++) {
          setRgba(p[0]*wordW + x + wordW/2, p[1]*wordH + y + wordH/2, pxs[y*wordW+x]);
          setRgba(q[0]*wordW + x,           q[1]*wordH + y + wordH/2, pxs[y*wordW+x+wordW/2]);
          setRgba(r[0]*wordW + x + wordW/2, r[1]*wordH + y,           pxs[(y+wordH/2)*wordW+x]);
          setRgba(s[0]*wordW + x,           s[1]*wordH + y,           pxs[(y+wordH/2)*wordW+x+wordW/2]);
        }
      }
    }
  }
  const cropped = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const src = y * xTrue * 4, dst = y * width * 4;
    cropped.set(out.subarray(src, src + width*4), dst);
  }
  if (!hasAlpha) { for (let i = 3; i < cropped.length; i += 4) cropped[i] = 255; }
  return cropped;
}

// ===========================================================================
// Container parsing (PVR2/PVR3/KTX1/KTX2)
// ===========================================================================

class Rd {
  constructor(data) {
    this.d = data;
    this.v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  u32le(o) { return this.v.getUint32(o, true); }
  u32be(o) { return this.v.getUint32(o, false); }
  u64le(o) { return this.v.getBigUint64(o, true); }
}

const PVR3_FORMATS = {
  0: 'Pvrtc2Rgb', 1: 'Pvrtc2Rgba', 2: 'Pvrtc4Rgb', 3: 'Pvrtc4Rgba',
  6: 'Etc1Rgb', 7: 'Dxt1', 9: 'Dxt3', 11: 'Dxt5', 22: 'Etc2Rgb', 23: 'Etc2Rgba',
};

function pvr3MipSize(w, h, pf) {
  const blocks = (bw, bh, bytes) => Math.max(1, Math.ceil(w / bw)) * Math.max(1, Math.ceil(h / bh)) * bytes;
  if (pf === 0 || pf === 1) return Math.max(2, Math.ceil((w + 7) / 8)) * Math.max(2, Math.ceil((h + 3) / 4)) * 8;
  if (pf === 2 || pf === 3) return Math.max(2, Math.ceil((w + 3) / 4)) * Math.max(2, Math.ceil((h + 3) / 4)) * 8;
  if (pf === 6 || pf === 22 || pf === 7) return blocks(4, 4, 8);
  if (pf === 23 || pf === 9 || pf === 11) return blocks(4, 4, 16);
  if (pf >= 27 && pf <= 40) return blocks(4, 4, 16);
  return w * h * 4;
}

function decodePvr3(data, filename) {
  if (data.length < 52) throw new Error('file too small');
  const big = (data[0]===3 && data[1]===0x52 && data[2]===0x56 && data[3]===0x50) || (data[0]===0x03 && data[1]===0x50 && data[2]===0x56 && data[3]===0x52);
  const r = new Rd(data);
  const rd = big ? (o) => r.u32be(o) : (o) => r.u32le(o);
  const pfLo = rd(8);
  const colorSpace = rd(16);
  const channelType = rd(20);
  const height = rd(24);
  const width = rd(28);
  const surfaces = Math.max(1, rd(36));
  const faces = Math.max(1, rd(40));
  const mipCount = Math.max(1, rd(44));
  const metaSize = rd(48);
  const start = 52 + metaSize;
  if (start > data.length) throw new Error('PVR pixel data starts past EOF');
  const format = PVR3_FORMATS[pfLo] || 'Unknown';
  const mip0Size = pvr3MipSize(width, height, pfLo);
  const end = Math.min(start + mip0Size, data.length);
  const mip0 = data.subarray(start, end);
  const warnings = [];
  if (mip0.length < mip0Size) warnings.push(`mip0 truncated: ${mip0.length} < ${mip0Size}`);
  if (surfaces > 1 || faces > 1) warnings.push('only first surface/face/depth slice mip0 is decoded/extracted');

  let rgba = null;
  switch (pfLo) {
    case 0: rgba = { width, height, data: decodePvrtc(mip0, width, height, true, false) }; break;
    case 1: rgba = { width, height, data: decodePvrtc(mip0, width, height, true, true) }; break;
    case 2: rgba = { width, height, data: decodePvrtc(mip0, width, height, false, false) }; break;
    case 3: rgba = { width, height, data: decodePvrtc(mip0, width, height, false, true) }; break;
    case 6: rgba = { width, height, data: decodeEtc1(mip0, width, height) }; break;
    case 22: rgba = { width, height, data: decodeEtc2Rgb(mip0, width, height) }; break;
    case 23: rgba = { width, height, data: decodeEtc2Rgba8(mip0, width, height) }; break;
    case 7: rgba = { width, height, data: decodeDxt1(mip0, width, height) }; break;
    case 9: case 11:
      warnings.push('DXT3/DXT5 raw payload preserved; RGBA decode not implemented (same as upstream Rust source)');
      break;
    default:
      if (pfLo >= 27 && pfLo <= 40) warnings.push('ASTC raw payload preserved; not decoded (same as upstream Rust source)');
      else warnings.push(`unsupported PVR3 pixel format ${pfLo}; raw mip0 preserved`);
  }

  return {
    filename,
    meta: { container: 'Pvr3', format, width, height, depth: 1, mipCount, faces, arrayLayers: surfaces,
      colorSpace: colorSpace === 0 ? 'linear' : (colorSpace === 1 ? 'sRGB' : 'unknown'), channelType,
      decodedToRgba8: !!rgba },
    rgba, compressed: { mip0, mip0Size: mip0.length, note: 'PVR mip0 raw compressed bytes' }, warnings,
  };
}

function decodePvr2(data, filename) {
  if (data.length < 52) throw new Error('file too small');
  const r = new Rd(data);
  const h = r.u32le(16), w = r.u32le(20), flags = r.u32le(36);
  const fmt = flags & 0xFF;
  const pixel = data.subarray(52);
  let twoBpp, format;
  if (fmt === 0x18) { twoBpp = true; format = 'Pvrtc2Rgba'; }
  else if (fmt === 0x0C) { twoBpp = false; format = 'Pvrtc4Rgba'; }
  else throw new Error(`unsupported PVR2 format 0x${fmt.toString(16)}`);
  const rgbaData = decodePvrtc(pixel, w, h, twoBpp, true);
  return {
    filename,
    meta: { container: 'Pvr2', format, width: w, height: h, depth: 1, mipCount: 1, faces: 1, arrayLayers: 1, decodedToRgba8: true },
    rgba: { width: w, height: h, data: rgbaData },
    compressed: { mip0: pixel, mip0Size: pixel.length, note: 'PVR2 raw pixel bytes' },
    warnings: [],
  };
}

function decodeKtx1(data, filename) {
  if (data.length < 68) throw new Error('file too small');
  const r = new Rd(data);
  const endian = r.u32le(12);
  let big;
  if (endian === 0x04030201) big = false;
  else if (endian === 0x01020304) big = true;
  else throw new Error(`KTX endian marker 0x${endian.toString(16)}`);
  const rd = big ? (o) => r.u32be(o) : (o) => r.u32le(o);
  const glInternalFormat = rd(28);
  const width = rd(36);
  let height = rd(40) || 1;
  let depth = rd(44) || 1;
  const arrayElements = rd(48);
  const faces = Math.max(1, rd(52));
  const mipLevels = Math.max(1, rd(56));
  const kvBytes = rd(60);
  if (width === 0) throw new Error('KTX width is zero');
  const dataStart = 64 + kvBytes;
  if (dataStart + 4 > data.length) throw new Error('KTX mip size past EOF');
  const mipSize = big ? r.u32be(dataStart) : r.u32le(dataStart);
  const start = dataStart + 4;
  const end = Math.min(start + mipSize, data.length);
  const mip0 = data.subarray(start, end);
  const warnings = [];
  if (mip0.length < mipSize) warnings.push(`KTX mip0 truncated: ${mip0.length} < ${mipSize}`);
  if (faces > 1 || depth > 1 || arrayElements > 0) warnings.push('only first face/layer/depth slice is decoded/extracted');

  let format = 'Unknown', rgba = null;
  switch (glInternalFormat) {
    case 0x8D64: format = 'Etc1Rgb'; rgba = { width, height, data: decodeEtc1(mip0, width, height) }; break;
    case 0x9274: case 0x9275: format = 'Etc2Rgb'; rgba = { width, height, data: decodeEtc2Rgb(mip0, width, height) }; break;
    case 0x9276: format = 'Etc2RgbPunchthroughAlpha1'; rgba = { width, height, data: decodeEtc2Rgba1(mip0, width, height) }; break;
    case 0x9278: case 0x9279: format = 'Etc2Rgba'; rgba = { width, height, data: decodeEtc2Rgba8(mip0, width, height) }; break;
    case 0x9270: format = 'EacR11'; rgba = { width, height, data: decodeEacR11Unorm(mip0, width, height) }; break;
    case 0x8058: case 0x8C43: {
      format = 'Rgba8';
      const needed = width * height * 4;
      if (mip0.length < needed) throw new Error(`KTX RGBA8 mip0 truncated: ${mip0.length} < ${needed}`);
      rgba = { width, height, data: mip0.subarray(0, needed) };
      break;
    }
    case 0x8DBB: format = 'Bc4'; warnings.push('BC4 not decoded here; raw mip0 preserved'); break;
    case 0x8E8C: case 0x8E8D: format = 'Bc7'; warnings.push('BC7 not decoded here; raw mip0 preserved'); break;
    default:
      if (glInternalFormat >= 0x93B0 && glInternalFormat <= 0x93DD) {
        format = 'AstcLdr';
        warnings.push('ASTC not decoded here; raw mip0 preserved');
      } else {
        warnings.push(`unsupported KTX1 internal format 0x${glInternalFormat.toString(16)}; raw mip0 preserved`);
      }
  }

  return {
    filename,
    meta: { container: 'Ktx1', format, width, height, depth, mipCount: mipLevels, faces, arrayLayers: Math.max(1, arrayElements),
      glInternalFormat, decodedToRgba8: !!rgba },
    rgba, compressed: { mip0, mip0Size: mip0.length, note: 'KTX1 mip0 raw bytes' }, warnings,
  };
}

function parseKtx2Raw(data, filename) {
  if (data.length < 80) throw new Error('file too small');
  const r = new Rd(data);
  const vkFormat = r.u32le(12);
  const width = r.u32le(20);
  let height = r.u32le(24) || 1;
  let depth = r.u32le(28) || 1;
  const layerCount = r.u32le(32);
  const faces = Math.max(1, r.u32le(36));
  const levelCount = Math.max(1, r.u32le(40));
  const supercompression = r.u32le(44);
  const levelIndex = 80;
  if (data.length < levelIndex + 24) throw new Error('KTX2 missing level index');
  const byteOffset = Number(r.u64le(levelIndex));
  const byteLength = Number(r.u64le(levelIndex + 8));
  const end = Math.min(byteOffset + byteLength, data.length);
  const mip0 = byteOffset < data.length ? data.subarray(byteOffset, end) : new Uint8Array(0);
  const warnings = ['KTX2 parsed as raw compressed container; RGBA decode not implemented here'];
  if (supercompression !== 0) warnings.push(`KTX2 supercompressionScheme=${supercompression}; external transcoder/decompressor required`);
  return {
    filename,
    meta: { container: 'Ktx2', format: 'Unknown', width, height, depth, mipCount: levelCount, faces, arrayLayers: Math.max(1, layerCount), vkFormat, decodedToRgba8: false },
    rgba: null, compressed: { mip0, mip0Size: mip0.length, vkFormat, note: 'KTX2 level0 raw bytes' }, warnings,
  };
}

export function loadTextureBytes(data, filename) {
  if (data.length < 4) throw new Error('file too small');
  if ((data[0]===0x50&&data[1]===0x56&&data[2]===0x52&&data[3]===0x03) || (data[0]===0x03&&data[1]===0x52&&data[2]===0x56&&data[3]===0x50) || (data[0]===0x03&&data[1]===0x50&&data[2]===0x56&&data[3]===0x52)) {
    return decodePvr3(data, filename);
  }
  if (data.length >= 48) {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (v.getUint32(44, true) === 0x21525650) return decodePvr2(data, filename);
  }
  const KTX1_MAGIC = [0xAB,0x4B,0x54,0x58,0x20,0x31,0x31,0xBB,0x0D,0x0A,0x1A,0x0A];
  const KTX2_MAGIC = [0xAB,0x4B,0x54,0x58,0x20,0x32,0x30,0xBB,0x0D,0x0A,0x1A,0x0A];
  if (KTX1_MAGIC.every((b,i) => data[i]===b)) return decodeKtx1(data, filename);
  if (KTX2_MAGIC.every((b,i) => data[i]===b)) return parseKtx2Raw(data, filename);
  throw new Error(`unknown texture container for ${filename} — if this is PNG/JPG/BMP/TGA/WebP/GIF, decode it with the browser's native Image/createImageBitmap instead.`);
}
