// Reproducible preparation of the CC0 Quaternius runner. No geometry or skin edits.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const sourceUrl = 'https://static.poly.pizza/90a9e2d4-053f-42f1-99a2-8f5e1180ea7f.glb';
const sourceHash = 'fea7e71271203e7073f1a073fa1208de7402df276f87f80e149bf7589b5d46b4';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const response = process.argv[2] ? null : await fetch(sourceUrl);
if (response && !response.ok) throw new Error(`Asset download failed: ${response.status}`);
const source = process.argv[2]
  ? await fs.readFile(path.resolve(process.argv[2]))
  : Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(source).digest('hex') !== sourceHash) {
  throw new Error('Source changed; verify its licensing and geometry before updating the pinned hash.');
}
if (source.readUInt32LE(0) !== 0x46546c67 || source.readUInt32LE(4) !== 2) throw new Error('Expected glTF 2 GLB');
const jsonLength = source.readUInt32LE(12);
const gltf = JSON.parse(source.toString('utf8', 20, 20 + jsonLength));
const binary = source.subarray(28 + jsonLength);
if (gltf.buffers.length !== 1 || gltf.images?.length || gltf.accessors.some(a => a.sparse)) {
  throw new Error('Unexpected asset structure; compacting would be unsafe.');
}

const keepClips = new Set(['Idle', 'Idle_Neutral', 'Run', 'Walk', 'Interact', 'Wave']);
gltf.animations = gltf.animations.filter(animation => keepClips.has(animation.name.split('|').at(-1)));
if (gltf.animations.length !== keepClips.size) throw new Error('Expected runner clips are missing');

const neededAccessors = new Set();
for (const mesh of gltf.meshes) {
  for (const primitive of mesh.primitives) {
    Object.values(primitive.attributes).forEach(index => neededAccessors.add(index));
    if (primitive.indices !== undefined) neededAccessors.add(primitive.indices);
    for (const target of primitive.targets || []) Object.values(target).forEach(index => neededAccessors.add(index));
  }
}
for (const skin of gltf.skins) neededAccessors.add(skin.inverseBindMatrices);
for (const animation of gltf.animations) {
  for (const sampler of animation.samplers) {
    neededAccessors.add(sampler.input);
    neededAccessors.add(sampler.output);
  }
}

const accessorIndices = [...neededAccessors].sort((a, b) => a - b);
const accessorMap = new Map(accessorIndices.map((old, index) => [old, index]));
const accessors = accessorIndices.map(index => gltf.accessors[index]);
const viewIndices = [...new Set(accessors.map(accessor => accessor.bufferView))].sort((a, b) => a - b);
const viewMap = new Map(viewIndices.map((old, index) => [old, index]));
let byteOffset = 0;
const chunks = [];
const views = viewIndices.map(index => {
  const original = gltf.bufferViews[index];
  const padding = (4 - byteOffset % 4) % 4;
  if (padding) { chunks.push(Buffer.alloc(padding)); byteOffset += padding; }
  const view = { ...original, buffer: 0, byteOffset };
  chunks.push(binary.subarray(original.byteOffset || 0, (original.byteOffset || 0) + original.byteLength));
  byteOffset += original.byteLength;
  return view;
});
for (const accessor of accessors) accessor.bufferView = viewMap.get(accessor.bufferView);
for (const mesh of gltf.meshes) {
  for (const primitive of mesh.primitives) {
    for (const name of Object.keys(primitive.attributes)) primitive.attributes[name] = accessorMap.get(primitive.attributes[name]);
    if (primitive.indices !== undefined) primitive.indices = accessorMap.get(primitive.indices);
    for (const target of primitive.targets || []) for (const name of Object.keys(target)) target[name] = accessorMap.get(target[name]);
  }
}
for (const skin of gltf.skins) skin.inverseBindMatrices = accessorMap.get(skin.inverseBindMatrices);
for (const animation of gltf.animations) {
  for (const sampler of animation.samplers) {
    sampler.input = accessorMap.get(sampler.input);
    sampler.output = accessorMap.get(sampler.output);
  }
}
gltf.accessors = accessors;
gltf.bufferViews = views;
gltf.buffers = [{ byteLength: byteOffset }];
gltf.asset.copyright = 'Casual Character by Quaternius; CC0 1.0 Universal';
gltf.asset.extras = { source: 'https://poly.pizza/m/kZ3DmIoGip', preparation: 'Retain six non-combat clips; compact unused accessors and buffer views. Geometry, rig and animation keyframes unchanged.' };
const json = Buffer.from(JSON.stringify(gltf));
const jsonPadding = Buffer.alloc((4 - json.length % 4) % 4, 0x20);
const bin = Buffer.concat(chunks);
const binPadding = Buffer.alloc((4 - bin.length % 4) % 4);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + json.length + jsonPadding.length + bin.length + binPadding.length, 8);
header.writeUInt32LE(json.length + jsonPadding.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(bin.length + binPadding.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);
const prepared = Buffer.concat([header, json, jsonPadding, binHeader, bin, binPadding]);
const destination = path.join(root, 'public/assets/models/runner-casual.glb');
await fs.mkdir(path.dirname(destination), { recursive: true });
await fs.writeFile(destination, prepared);
console.log(JSON.stringify({ destination, bytes: prepared.length, sha256: createHash('sha256').update(prepared).digest('hex'), clips: gltf.animations.map(a => a.name) }, null, 2));
