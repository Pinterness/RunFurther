import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';

const source = await readFile(new URL('../src/components/site/createJourneyRunner.js', import.meta.url), 'utf8');
const { createJourneyRunner } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
function fixture() {
  const resources = new Set();
  const runner = createJourneyRunner({ THREE, keep: resource => (resources.add(resource), resource) });
  return { ...runner, dispose: () => resources.forEach(resource => resource.dispose()) };
}

test('shirt surfaces face outwards, including when viewed from behind', () => {
  const runner = fixture();
  try {
    const geometry = runner.group.getObjectByName('runner-shirt').geometry;
    const p = geometry.attributes.position, indices = geometry.index;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const normal = new THREE.Vector3(), radial = new THREE.Vector3();
    for (let i = 0; i < indices.count; i += 3) {
      a.fromBufferAttribute(p, indices.getX(i)); b.fromBufferAttribute(p, indices.getX(i + 1)); c.fromBufferAttribute(p, indices.getX(i + 2));
      if (Math.abs(a.y - b.y) < 1e-7 && Math.abs(b.y - c.y) < 1e-7) continue;
      radial.copy(a).add(b).add(c); radial.y = 0;
      normal.subVectors(b, a).cross(c.clone().sub(a));
      assert.ok(normal.dot(radial) > 0, 'Inside-out torso triangle at ' + i / 3);
    }
  } finally { runner.dispose(); }
});

test('running shoes clear the ground and maintain contact during stance across a complete stride', () => {
  const runner = fixture();
  try {
    const previous = [null, null], feet = [0, 1].map(i => runner.group.getObjectByName('runner-sole-' + i));
    for (let step = 0; step <= 360; step++) {
      const gait = step / 360 * Math.PI * 2;
      runner.update({ run: 1, gait, receiveKit: 1 }); runner.group.updateMatrixWorld(true);
      feet.forEach((foot, index) => {
        const box = new THREE.Box3().setFromObject(foot, true);
        assert.ok(box.min.y >= -.005, 'Sole passes through ground at ' + step + '/' + index + ': ' + box.min.y);
        const phase = ((step / 360 + index * .5) % 1 + 1) % 1;
        if (phase < .42) assert.ok(box.min.y < .055, 'Planted foot is floating at ' + step + '/' + index + ': ' + box.min.y);
        const position = foot.getWorldPosition(new THREE.Vector3());
        if (previous[index]) assert.ok(position.distanceTo(previous[index]) < .04, 'Foot snaps at a stride boundary');
        previous[index] = position;
      });
    }
    runner.update(); runner.group.updateMatrixWorld(true);
    feet.forEach(foot => assert.ok(Math.abs(new THREE.Box3().setFromObject(foot, true).min.y) < .015, 'Idle shoes must rest on the ground'));
  } finally { runner.dispose(); }
});

test('actions preserve the scene transform and keep backpack webbing around the torso', () => {
  const runner = fixture();
  try {
    runner.group.position.set(11, .17, -34); runner.group.rotation.y = .7;
    const position = runner.group.position.clone(), rotation = runner.group.quaternion.clone();
    for (const pose of [{}, { run: 1, gait: 2 }, { drink: 1 }, { receiveKit: .5 }, { receiveKit: 1, medal: 1, celebrate: 1 }]) {
      runner.update(pose); runner.group.updateMatrixWorld(true);
      assert.ok(runner.group.position.equals(position)); assert.ok(runner.group.quaternion.equals(rotation));
      runner.group.traverse(object => assert.ok(object.matrixWorld.elements.every(Number.isFinite)));
    }
    for (const side of [-1, 1]) {
      const strap = runner.group.getObjectByName('runner-pack-strap-' + side);
      strap.geometry.computeBoundingBox();
      const { min, max } = strap.geometry.boundingBox;
      assert.ok(min.z < -.09 && max.z > .145, 'Shoulder webbing needs front and back anchors');
      assert.ok(max.y > .51 && min.y < .14, 'Webbing must pass over the shoulder and return to the lower pack');
    }
  } finally { runner.dispose(); }
});
