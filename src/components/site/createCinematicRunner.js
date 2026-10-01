import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createJourneyRunner } from './createJourneyRunner';
import { createRunnerAccessories } from './createRunnerAccessories';

export const RUNNER_ASSET = '/assets/models/runner-casual.glb';

function assetResources(gltf) {
  const resources = new Set(), bitmaps = new Set();
  for (const scene of gltf.scenes || [gltf.scene]) scene.traverse(object => {
    if (object.geometry) resources.add(object.geometry);
    if (object.skeleton) resources.add(object.skeleton);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) {
        resources.add(value);
        if (typeof value.source?.data?.close === 'function') bitmaps.add(value.source.data);
      }
    }
  });
  return { resources, dispose() { resources.forEach(value => value.dispose()); bitmaps.forEach(value => value.close()); resources.clear(); bitmaps.clear(); } };
}

// Public for the isolated pose review and tests; the outer group remains owned
// by createRaceWorld. Imported armature transforms must never be flattened.
export function createRiggedAthlete({ THREE, gltf }) {
  const owned = assetResources(gltf), keep = value => (owned.resources.add(value), value);
  const group = new THREE.Group(); group.name = 'cinematic-athlete';
  let mixer;
  try {
    const model = gltf.scene;
    const required = ['Chest', 'Head', 'UpperArmL', 'LowerArmL', 'WristL', 'UpperArmR', 'LowerArmR', 'WristR'];
    const bones = Object.fromEntries(required.map(name => [name, model.getObjectByName(name)]));
    if (required.some(name => !bones[name]?.isBone)) throw new Error('Runner rig is incomplete');
    const findClip = name => gltf.animations.find(clip => clip.name.endsWith('|' + name));
    if (!findClip('Run') || !findClip('Idle_Neutral')) throw new Error('Runner locomotion clips are missing');
    model.traverse(object => {
      if (!object.isMesh) return;
      object.castShadow = object.receiveShadow = true;
      object.frustumCulled = false;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => {
        material.metalness = 0; material.roughness = .88;
        if (material.name === 'LightBrown') material.color.set('#d9693f');
        if (material.name === 'LightBlue') material.color.set('#223e34');
        if (material.name === 'Red_Dark') material.color.set('#d76d42');
        if (material.name === 'White') material.color.set('#e8e3cc');
        if (/Skin/.test(material.name)) material.roughness = .74;
      });
    });
    mixer = new THREE.AnimationMixer(model);
    const idle = mixer.clipAction(findClip('Idle_Neutral')), run = mixer.clipAction(findClip('Run'));
    // Both clips are in-place; leave the Body's authored vertical bounce intact.
    idle.play(); run.play(); idle.paused = run.paused = true;
    idle.setEffectiveWeight(1); run.setEffectiveWeight(0); mixer.update(0);
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model, true);
    const height = bounds.max.y - bounds.min.y;
    if (!Number.isFinite(height) || height < .1 || height > 10) throw new Error('Runner scale is invalid');
    const normalized = new THREE.Group(); normalized.name = 'athlete-normalized';
    normalized.rotation.y = Math.PI; normalized.scale.setScalar(1.8 / height);
    model.position.y -= bounds.min.y;
    model.position.z -= (bounds.min.z + bounds.max.z) / 2;
    normalized.add(model); group.add(normalized); group.updateMatrixWorld(true);
    const rest = [];
    model.traverse(bone => { if (bone.isBone) rest.push({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }); });
    const props = createRunnerAccessories({ THREE, keep });
    const v = new THREE.Vector3(), inverseMatrix = new THREE.Matrix4(), socketMatrix = new THREE.Matrix4();
    const identity = new THREE.Quaternion(), unit = new THREE.Vector3(1, 1, 1);
    function socket(bone, prop, position) {
      const holder = new THREE.Group(); holder.name = prop.name + '-socket';
      socketMatrix.compose(new THREE.Vector3(...position), identity, unit).premultiply(group.matrixWorld);
      inverseMatrix.copy(bone.matrixWorld).invert(); socketMatrix.premultiply(inverseMatrix);
      socketMatrix.decompose(holder.position, holder.quaternion, holder.scale);
      holder.add(prop); bone.add(holder); return holder;
    }
    socket(bones.Chest, props.pack, [0, 1.33, 0]);
    socket(bones.Chest, props.bib, [0, 1.20, -.130]);
    socket(bones.Chest, props.medal, [0, 1.33, 0]);
    const handPosition = bone => group.worldToLocal(bone.getWorldPosition(v)).toArray();
    const cupSocket = socket(bones.WristR, props.cup, handPosition(bones.WristR));
    const kitSocket = socket(bones.WristL, props.kitBag, handPosition(bones.WristL));
    props.cup.position.set(-.028, -.045, -.02);
    props.kitBag.position.set(.018, -.055, 0);
    const wristRest = { L: bones.WristL.getWorldQuaternion(new THREE.Quaternion()), R: bones.WristR.getWorldQuaternion(new THREE.Quaternion()) };
    // Reuse the authored closed-hand pose from Run while carrying a prop.
    // This changes fingers only; locomotion still owns the rest of the body.
    idle.setEffectiveWeight(0); run.setEffectiveWeight(1); mixer.update(0);
    const grips = { L: [], R: [] };
    for (const side of ['L', 'R']) bones['Wrist' + side].traverse(bone => {
      if (bone.isBone && bone !== bones['Wrist' + side]) grips[side].push({ bone, quaternion: bone.quaternion.clone() });
    });
    idle.setEffectiveWeight(1); run.setEffectiveWeight(0); mixer.update(0);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), target = new THREE.Vector3();
    const direction = new THREE.Vector3(), bend = new THREE.Vector3(), elbow = new THREE.Vector3();
    const from = new THREE.Vector3(), to = new THREE.Vector3(), pole = new THREE.Vector3();
    const worldQ = new THREE.Quaternion(), parentQ = new THREE.Quaternion(), deltaQ = new THREE.Quaternion(), desiredQ = new THREE.Quaternion();
    const localX = new THREE.Vector3(1, 0, 0), propQ = new THREE.Quaternion();
    function rotateToward(bone, child, point, amount) {
      bone.getWorldPosition(a); child.getWorldPosition(b);
      from.subVectors(b, a).normalize(); to.subVectors(point, a).normalize();
      deltaQ.setFromUnitVectors(from, to);
      bone.getWorldQuaternion(worldQ); desiredQ.copy(worldQ).premultiply(deltaQ);
      bone.parent.getWorldQuaternion(parentQ).invert(); desiredQ.premultiply(parentQ);
      bone.quaternion.slerp(desiredQ, amount); group.updateMatrixWorld(true);
    }
    function reach(side, localTarget, amount) {
      if (amount <= .001) return;
      const upper = bones['UpperArm' + side], lower = bones['LowerArm' + side], hand = bones['Wrist' + side];
      upper.getWorldPosition(a); lower.getWorldPosition(b); hand.getWorldPosition(c);
      const firstLength = a.distanceTo(b), secondLength = b.distanceTo(c);
      target.copy(localTarget); group.localToWorld(target);
      direction.subVectors(target, a);
      const distance = THREE.MathUtils.clamp(direction.length(), .02, firstLength + secondLength - .004);
      direction.normalize(); target.copy(a).addScaledVector(direction, distance);
      pole.set(side === 'L' ? -.45 : .45, 1.08, -.06); group.localToWorld(pole); pole.sub(a);
      bend.copy(pole).addScaledVector(direction, -pole.dot(direction)).normalize();
      const along = (firstLength ** 2 - secondLength ** 2 + distance ** 2) / (2 * distance);
      elbow.copy(a).addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0, firstLength ** 2 - along ** 2)));
      rotateToward(upper, lower, elbow, amount);
      rotateToward(lower, hand, target, amount);
    }
    function orientHeld(holder, bone, tilt = 0) {
      group.getWorldQuaternion(worldQ); propQ.setFromAxisAngle(localX, tilt); worldQ.multiply(propQ);
      bone.getWorldQuaternion(parentQ).invert(); holder.quaternion.copy(parentQ).multiply(worldQ);
    }
    function holdWrist(side, amount) {
      if (amount <= .001) return;
      const bone = bones['Wrist' + side];
      group.getWorldQuaternion(worldQ); worldQ.multiply(wristRest[side]);
      bone.parent.getWorldQuaternion(parentQ).invert(); desiredQ.copy(parentQ).multiply(worldQ);
      bone.quaternion.slerp(desiredQ, amount);
      grips[side].forEach(pose => pose.bone.quaternion.slerp(pose.quaternion, amount));
      group.updateMatrixWorld(true);
    }
    let lastTime = null, elapsed = 0, runningWeight = 0;
    const clamp = value => THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
    function update({ gait = 0, run: running = 0, drink = 0, receiveKit = 0, medal = 0, celebrate = 0, time = 0 } = {}) {
      const dt = lastTime === null ? 0 : THREE.MathUtils.clamp(time - lastTime, 0, .06);
      lastTime = time; elapsed += dt;
      running = clamp(running); drink = clamp(drink); receiveKit = clamp(receiveKit); medal = clamp(medal); celebrate = clamp(celebrate);
      runningWeight += (running - runningWeight) * (1 - Math.exp(-dt * 18));
      rest.forEach(({ bone, position, quaternion, scale }) => { bone.position.copy(position); bone.quaternion.copy(quaternion); bone.scale.copy(scale); });
      idle.time = (elapsed * .6) % idle.getClip().duration;
      run.time = (((Number.isFinite(gait) ? gait : 0) / (Math.PI * 2)) % 1 + 1) % 1 * run.getClip().duration;
      idle.setEffectiveWeight(1 - runningWeight); run.setEffectiveWeight(runningWeight); mixer.update(0);
      group.updateMatrixWorld(true);
      const kitReach = Math.sin(Math.PI * receiveKit) * (1 - celebrate);
      reach('L', v.set(-.11, 1.16, -.38), kitReach);
      reach('R', v.set(.11, 1.16, -.38), kitReach);
      bones.Head.getWorldPosition(v); group.worldToLocal(v); v.x += .04; v.y += .065; v.z -= .145;
      reach('R', v, drink);
      reach('L', v.set(-.43, 1.84, -.04), celebrate);
      reach('R', v.set(.43, 1.84, -.04), celebrate);
      holdWrist('R', Math.max(drink, kitReach)); holdWrist('L', kitReach);
      orientHeld(cupSocket, bones.WristR, drink * .30);
      orientHeld(kitSocket, bones.WristL);
      props.cup.visible = drink > .035;
      props.kitBag.visible = receiveKit > .18 && receiveKit < .88;
      props.pack.visible = receiveKit >= .88;
      props.medal.visible = medal > .01; props.medal.scale.setScalar(Math.max(.001, medal));
    }
    update();
    return { group, update, dispose() { mixer.stopAllAction(); mixer.uncacheRoot(model); group.removeFromParent(); owned.dispose(); } };
  } catch (error) {
    mixer?.stopAllAction(); mixer?.uncacheRoot(gltf.scene); owned.dispose(); throw error;
  }
}

export function createCinematicRunner({ THREE, keep, onReady = () => {}, loadModel } = {}) {
  const group = new THREE.Group(); group.name = 'journey-runner';
  const fallback = createJourneyRunner({ THREE, keep }); group.add(fallback.group);
  const abort = new AbortController(); let disposed = false, athlete = null, lastState = {};
  const runner = {
    group, source: 'loading',
    update(state) { lastState = state; (athlete || fallback).update(state); },
    dispose() { if (disposed) return; disposed = true; abort.abort(); clearTimeout(timeout); athlete?.dispose(); },
  };
  const timeout = setTimeout(() => abort.abort(), 10000);
  const fetchModel = async () => {
    const response = await fetch(RUNNER_ASSET, { signal: abort.signal });
    if (!response.ok) throw new Error('Runner asset unavailable');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 3 * 1024 * 1024) throw new Error('Runner asset exceeds size budget');
    return new GLTFLoader().parseAsync(bytes, '/assets/models/');
  };
  runner.ready = Promise.resolve().then(() => (loadModel || fetchModel)(abort.signal)).then(gltf => {
    if (disposed || abort.signal.aborted) {
      assetResources(gltf).dispose();
      if (!disposed) { runner.source = 'fallback'; onReady('fallback'); }
      return;
    }
    athlete = createRiggedAthlete({ THREE, gltf });
    athlete.update(lastState); group.add(athlete.group); fallback.group.visible = false;
    runner.source = 'glb'; onReady('glb');
  }).catch(() => {
    if (!disposed) { runner.source = 'fallback'; onReady('fallback'); }
  }).finally(() => clearTimeout(timeout));
  return runner;
}
