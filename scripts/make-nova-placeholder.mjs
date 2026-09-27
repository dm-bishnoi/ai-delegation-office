// Builds public/models/nova/nova.glb — a CLEARLY-LABELLED PLACEHOLDER, not a
// final character asset. It exists so the GLB loading path can be validated
// end-to-end before an approved rigged character is dropped into this path.
//
// The placeholder is a static (non-skinned) blocky figure with NO animation
// clips: the loader's clip-resolution logic still runs, resolves every state to
// the fallback, and the office keeps working while exercising the real GLB
// path. It is written with a tiny dependency-free GLB writer (single JSON + BIN
// chunk, no external buffers) and is original geometry created by this
// repository, so redistribution terms are unambiguous.
//
// Usage: node scripts/make-nova-placeholder.mjs

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const outPath = resolve(dirname(fileURLToPath(import.meta.url)), '../public/models/nova/nova.glb');

// ---- original placeholder geometry: torso, head, legs, feet ---------------
const positions = [];
const normals = [];
const indices = [];

function quad(a, b, c, d, normal) {
  const base = positions.length / 3;
  for (const [x, y, z] of [a, b, c, d]) positions.push(x, y, z);
  for (let i = 0; i < 4; i++) normals.push(...normal);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** Adds an axis-aligned box from corner `min` to corner `max`, feet at y=0. */
function box(min, max) {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);   // front (+Z faces the office like the procedural figures)
  quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);  // back
  quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);   // right
  quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);  // left
  quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);   // top
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);  // bottom
}

box([-0.23, 0.74, -0.125], [0.23, 1.3, 0.125]);   // torso (Nova green jacket)
box([-0.26, 0.74, -0.1], [0.26, 1.12, 0.1]);      // shoulders widen the jacket
box([-0.13, 1.4, -0.11], [0.13, 1.72, 0.11]);     // head
box([-0.135, 1.62, -0.13], [0.135, 1.76, 0.13]);  // hair cap
box([-0.06, 1.64, 0.02], [0.06, 1.66, 0.14]);     // face plate (lighter skin tone via second material not needed for placeholder)
box([-0.19, 0, -0.105], [-0.05, 0.76, 0.105]);    // left leg
box([0.05, 0, -0.105], [0.19, 0.76, 0.105]);      // right leg
box([-0.21, 0, -0.16], [-0.03, 0.09, 0.14]);      // left foot (extends forward)
box([0.03, 0, -0.16], [0.21, 0.09, 0.14]);        // right foot

// ---- GLB assembly ----------------------------------------------------------
const uv = [0, 0, 1, 0, 1, 1, 0, 1];
const uvs = new Float32Array(Array.from({ length: positions.length / 3 * 2 }, (_, i) => uv[i % uv.length]));
const positionArray = new Float32Array(positions);
const normalArray = new Float32Array(normals);
const indexArray = new Uint16Array(indices);

let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
for (let i = 0; i < positionArray.length; i += 3) {
  minX = Math.min(minX, positionArray[i]); maxX = Math.max(maxX, positionArray[i]);
  minY = Math.min(minY, positionArray[i + 1]); maxY = Math.max(maxY, positionArray[i + 1]);
  minZ = Math.min(minZ, positionArray[i + 2]); maxZ = Math.max(maxZ, positionArray[i + 2]);
}

const json = {
  asset: { version: '2.0', generator: 'Relay Office placeholder generator (scripts/make-nova-placeholder.mjs)' },
  scene: 0,
  scenes: [{ name: 'NovaPlaceholder', nodes: [0] }],
  nodes: [{ name: 'PLACEHOLDER_NOVA_STATIC_NO_CLIPS', mesh: 0 }],
  meshes: [{ name: 'placeholder', primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
  materials: [{
    name: 'NovaPlaceholderMaterial',
    pbrMetallicRoughness: { baseColorFactor: [0.255, 0.435, 0.38, 1], metallicFactor: 0, roughnessFactor: 0.85 },
  }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: positionArray.length / 3, type: 'VEC3', min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    { bufferView: 1, componentType: 5126, count: normalArray.length / 3, type: 'VEC3' },
    { bufferView: 2, componentType: 5126, count: uvs.length / 2, type: 'VEC2' },
    { bufferView: 3, componentType: 5123, count: indexArray.length, type: 'SCALAR' },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: positionArray.byteLength, target: 34962 },
    { buffer: 0, byteOffset: aligned(positionArray.byteLength), byteLength: normalArray.byteLength, target: 34962 },
    { buffer: 0, byteOffset: aligned(positionArray.byteLength, normalArray.byteLength), byteLength: uvs.byteLength, target: 34962 },
    { buffer: 0, byteOffset: aligned(positionArray.byteLength, normalArray.byteLength, uvs.byteLength), byteLength: indexArray.byteLength, target: 34963 },
  ],
  buffers: [{ byteLength: aligned(positionArray.byteLength, normalArray.byteLength, uvs.byteLength, indexArray.byteLength) }],
};

function aligned(...sizes) {
  let offset = 0;
  for (const size of sizes) offset = Math.ceil((offset + size) / 4) * 4;
  return offset;
}

const bin = new Uint8Array(json.buffers[0].byteLength);
bin.set(new Uint8Array(positionArray.buffer), 0);
bin.set(new Uint8Array(normalArray.buffer), json.bufferViews[1].byteOffset);
bin.set(new Uint8Array(uvs.buffer), json.bufferViews[2].byteOffset);
bin.set(new Uint8Array(indexArray.buffer), json.bufferViews[3].byteOffset);

// glTF requires the JSON chunk to be padded with spaces (0x20) and the BIN
// chunk with zeros, so third-party parsers never see trailing NULs.
const jsonChunk = encodeChunk(0x4e4f534a, JSON.stringify(json), 0x20);
const binChunk = encodeChunk(0x004e4942, bin, 0x00);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // 'glTF'
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + jsonChunk.length + binChunk.length, 8);

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, Buffer.concat([header, jsonChunk, binChunk]));
console.log(`Wrote ${outPath} (${12 + jsonChunk.length + binChunk.length} bytes, static placeholder, no clips).`);

function encodeChunk(type, data, fillByte) {
  const padded = Buffer.alloc(Math.ceil((data.length || 0) / 4) * 4, fillByte);
  Buffer.from(data).copy(padded);
  const chunk = Buffer.alloc(8 + padded.length);
  chunk.writeUInt32LE(padded.length, 0);
  chunk.writeUInt32LE(type, 4);
  padded.copy(chunk, 8);
  return chunk;
}
