import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createRiggedAthlete, createCinematicRunner, loadFixture } from './helpers/cinematicFixture.mjs';

function resourcesOf(gltf) {
  const found = new Set();
  gltf.scene.traverse(node => { if (node.geometry) found.add(node.geometry); if (node.skeleton) found.add(node.skeleton); if (node.material) found.add(node.material); });
  return found;
}
function wrapper(loadModel, onReady) {
  const resources = new Set();
  const runner = createCinematicRunner({ THREE, keep: value => (resources.add(value), value), loadModel, onReady });
  return { runner, dispose() { runner.dispose(); resources.forEach(value => value.dispose()); } };
}

test('local rig includes authored locomotion and preserves its skin binding', async () => {
  const gltf = await loadFixture();
  assert.deepEqual(gltf.animations.map(clip => clip.name.split('|')[1]).sort(), ['Idle', 'Idle_Neutral', 'Interact', 'Run', 'Walk', 'Wave']);
  const athlete = createRiggedAthlete({ THREE, gltf });
  try {
    athlete.group.updateMatrixWorld(true);
    const skin = gltf.scene.getObjectByName('Casual2_Body_2');
    assert.equal(skin.isSkinnedMesh, true);
    assert.ok(skin.geometry.attributes.skinWeight.count > 1000);
    const bounds = new THREE.Box3().setFromObject(gltf.scene, true);
    assert.ok(Math.abs(bounds.max.y - bounds.min.y - 1.8) < .02);
    assert.ok(Math.abs(bounds.min.y) < .005);
  } finally { athlete.dispose(); }
});

test('sampled running clip stays above the road and changes leg pose without moving the scene root', async () => {
  const athlete = createRiggedAthlete({ THREE, gltf: await loadFixture() });
  try {
    let lowest = Infinity, highest = -Infinity;
    const positions = [];
    for (let i = 0; i < 180; i++) {
      athlete.update({ run: 1, gait: i / 180 * Math.PI * 2, time: i / 60, receiveKit: 1 });
      athlete.group.updateMatrixWorld(true);
      let floor = Infinity;
      athlete.group.traverse(mesh => {
        assert.ok(mesh.matrixWorld.elements.every(Number.isFinite));
        if (mesh.isSkinnedMesh && mesh.name.startsWith('Casual2_Feet')) floor = Math.min(floor, new THREE.Box3().setFromObject(mesh, true).min.y);
      });
      lowest = Math.min(lowest, floor); highest = Math.max(highest, floor);
      if ([60, 90, 120].includes(i)) positions.push(athlete.group.getObjectByName('WristR').getWorldPosition(new THREE.Vector3()));
      assert.deepEqual(athlete.group.position.toArray(), [0, 0, 0]);
    }
    assert.ok(lowest >= -.006 && highest < .12, `Invalid contact/flight bounds ${lowest}..${highest}`);
    assert.ok(positions[0].distanceTo(positions[1]) > .04, 'Run clip must actually move the rig');
  } finally { athlete.dispose(); }
});

test('props follow bone sockets and reversible actions remain local to the actor', async () => {
  const athlete = createRiggedAthlete({ THREE, gltf: await loadFixture() });
  try {
    athlete.group.position.set(11, .17, -34); athlete.group.rotation.y = .72;
    const before = athlete.group.quaternion.clone();
    for (const [index, state] of [{ drink: 1 }, { receiveKit: .5 }, { receiveKit: 1, medal: 1, celebrate: 1 }, {}].entries()) {
      for (let i = 0; i < 30; i++) athlete.update({ ...state, time: index + i / 60 });
      athlete.group.updateMatrixWorld(true);
      assert.deepEqual(athlete.group.position.toArray(), [11, .17, -34]); assert.ok(athlete.group.quaternion.equals(before));
      const cup = athlete.group.getObjectByName('athlete-water-cup');
      const pack = athlete.group.getObjectByName('athlete-backpack');
      assert.equal(cup.parent.parent.name, 'WristR'); assert.equal(pack.parent.parent.name, 'Chest');
      assert.equal(cup.visible, Boolean(state.drink)); assert.equal(pack.visible, state.receiveKit === 1);
      if (state.drink) {
        const cupPoint = cup.getWorldPosition(new THREE.Vector3()), head = athlete.group.getObjectByName('Head').getWorldPosition(new THREE.Vector3());
        assert.ok(cupPoint.distanceTo(head) < .25, 'Cup must reach the face');
      }
    }
  } finally { athlete.dispose(); }
});

test('successful asynchronous loading swaps the child while retaining the world-owned root', async () => {
  const calls = [], fixture = wrapper(loadFixture, value => calls.push(value));
  try {
    const root = fixture.runner.group; root.position.set(3, .17, -10);
    fixture.runner.update({ receiveKit: 1, time: 1 }); await fixture.runner.ready;
    assert.equal(fixture.runner.group, root); assert.deepEqual(root.position.toArray(), [3, .17, -10]);
    assert.equal(fixture.runner.source, 'glb'); assert.deepEqual(calls, ['glb']);
    assert.equal(root.getObjectByName('athlete-backpack').visible, true);
    assert.equal(root.children[0].visible, false);
  } finally { fixture.dispose(); }
});

test('failed or incomplete assets leave the procedural journey usable', async () => {
  for (const load of [async () => { throw new Error('offline'); }, async () => { const gltf = await loadFixture(); gltf.scene.getObjectByName('Head').name = 'MissingHead'; return gltf; }]) {
    const fixture = wrapper(load);
    try {
      await fixture.runner.ready; assert.equal(fixture.runner.source, 'fallback');
      fixture.runner.update({ run: 1, gait: 1 });
      assert.equal(fixture.runner.group.children[0].visible, true);
      assert.equal(fixture.runner.group.children.length, 1);
    } finally { fixture.dispose(); }
  }
});

test('navigation during loading aborts and disposes a late model without attaching it', async () => {
  const gltf = await loadFixture(), resources = resourcesOf(gltf), disposed = new Set();
  resources.forEach(resource => {
    const original = resource.dispose.bind(resource);
    resource.dispose = () => { disposed.add(resource); original(); };
  });
  let resolve, signal, notifications = 0;
  const fixture = wrapper(abortSignal => { signal = abortSignal; return new Promise(done => { resolve = done; }); }, () => { notifications++; });
  await Promise.resolve(); fixture.dispose(); assert.equal(signal.aborted, true);
  resolve(gltf); await fixture.runner.ready;
  assert.equal(notifications, 0); assert.equal(fixture.runner.group.children.length, 1);
  assert.equal(disposed.size, resources.size);
});
