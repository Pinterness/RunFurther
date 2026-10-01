import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const component = new URL('../../src/components/site/', import.meta.url);
const dataModule = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
const fallback = dataModule(await readFile(new URL('createJourneyRunner.js', component), 'utf8'));
const props = dataModule(await readFile(new URL('createRunnerAccessories.js', component), 'utf8'));
const loader = new URL('../../node_modules/three/examples/jsm/loaders/GLTFLoader.js', import.meta.url).href;
const adapter = (await readFile(new URL('createCinematicRunner.js', component), 'utf8'))
  .replace("'three/addons/loaders/GLTFLoader.js'", JSON.stringify(loader))
  .replace("'./createJourneyRunner'", JSON.stringify(fallback))
  .replace("'./createRunnerAccessories'", JSON.stringify(props));
export const { createRiggedAthlete, createCinematicRunner } = await import(dataModule(adapter));
export async function loadFixture() {
  const bytes = await readFile(new URL('../../public/assets/models/runner-casual.glb', import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}
