// A self-contained articulated runner. Local -Z is forward; the outer group's
// origin stays at ground level and its world transform belongs to the scene.
export function createJourneyRunner({ THREE, keep }) {
  const group = new THREE.Group(); group.name = 'journey-runner';
  const clamp = value => THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
  const material = (name, color, options = {}) => {
    const result = keep(new THREE.MeshStandardMaterial({ color, roughness: .78, ...options }));
    result.name = name; return result;
  };
  const skin = material('runner-skin', '#bd805d');
  const jersey = material('runner-jersey', '#ef6b37');
  const shorts = material('runner-shorts', '#273f38');
  const sage = material('runner-pack', '#829573');
  const cream = material('runner-cream', '#eee5ce');
  const dark = material('runner-dark', '#21302b');
  const sole = material('runner-sole', '#d7d9c7');
  const gold = keep(new THREE.MeshPhysicalMaterial({ color: '#e4b34e', metalness: .8, roughness: .2, clearcoat: .3 }));
  gold.name = 'runner-medal';
  const ball = keep(new THREE.SphereGeometry(1, 16, 12));
  const cube = keep(new THREE.BoxGeometry(1, 1, 1));
  const capsule = (radius, length) => keep(new THREE.CapsuleGeometry(radius, length, 6, 14));
  const shoeShape = capsule(.072, .136);
  function mesh(shape, surface, parent, position = [0, 0, 0], scale = [1, 1, 1]) {
    const object = new THREE.Mesh(shape, surface);
    object.position.set(...position); object.scale.set(...scale);
    object.castShadow = object.receiveShadow = true; parent.add(object); return object;
  }
  function joint(name, parent, position, bone = false) {
    const result = bone ? new THREE.Bone() : new THREE.Group(); result.name = name; result.position.set(...position); parent.add(result); return result;
  }
  function skinLimb(root, bendJoint, length, pivot, profile) {
    // A single weighted surface bends across each elbow/knee, removing the
    // hard seam left by intersecting capsules. Clothing covers the end caps.
    const positions = [], indices = [], skinIndices = [], weights = [];
    const rings = 48, segments = 16, blend = .09;
    for (let row = 0; row <= rings; row++) {
      const distance = row / rings * length;
      const next = Math.max(1, profile.findIndex(([at]) => at >= distance));
      const [beforeAt, beforeRadius] = profile[next - 1], [afterAt, afterRadius] = profile[next];
      const radius = THREE.MathUtils.lerp(beforeRadius, afterRadius, (distance - beforeAt) / (afterAt - beforeAt));
      const influence = clamp((distance - pivot + blend / 2) / blend);
      for (let i = 0; i <= segments; i++) {
        const angle = i / segments * Math.PI * 2;
        positions.push(Math.sin(angle) * radius, -distance, Math.cos(angle) * radius);
        skinIndices.push(0, 1, 0, 0); weights.push(1 - influence, influence, 0, 0);
      }
    }
    for (let row = 0; row < rings; row++) for (let i = 0; i < segments; i++) {
      const a = row * (segments + 1) + i, b = a + segments + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
    for (const row of [0, rings]) {
      const center = positions.length / 3; positions.push(0, -row / rings * length, 0);
      skinIndices.push(0, 1, 0, 0); weights.push(row ? 0 : 1, row ? 1 : 0, 0, 0);
      for (let i = 0; i < segments; i++) {
        const a = row * (segments + 1) + i;
        indices.push(...(row ? [center, a + 1, a] : [center, a, a + 1]));
      }
    }
    const geometry = keep(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const limb = new THREE.SkinnedMesh(geometry, skin);
    limb.name = root.name + '-skin'; limb.castShadow = limb.receiveShadow = true;
    // A posed limb can extend beyond its rest-pose bounds; this tiny actor
    // stays in the shot and should never lose an arm through frustum culling.
    limb.frustumCulled = false; root.add(limb); group.updateMatrixWorld(true);
    limb.bind(keep(new THREE.Skeleton([root, bendJoint])));
  }
  const torsoProfile = [[0, .162, .114], [.06, .166, .116], [.28, .201, .127], [.44, .218, .115], [.505, .191, .093], [.57, .066, .065]];
  function shirtGeometry() {
    const vertices = [], indices = [], segments = 24;
    torsoProfile.forEach(([y, width, depth]) => {
      for (let i = 0; i <= segments; i++) {
        const angle = i / segments * Math.PI * 2;
        vertices.push(Math.sin(angle) * width, y, Math.cos(angle) * depth);
      }
    });
    for (let row = 0; row < torsoProfile.length - 1; row++) for (let i = 0; i < segments; i++) {
      const a = row * (segments + 1) + i, b = a + segments + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
    for (const [row, top] of [[0, false], [torsoProfile.length - 1, true]]) {
      const center = vertices.length / 3; vertices.push(0, torsoProfile[row][0], 0);
      for (let i = 0; i < segments; i++) {
        const a = row * (segments + 1) + i;
        indices.push(...(top ? [center, a, a + 1] : [center, a + 1, a]));
      }
    }
    const geometry = keep(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
  }
  function webbing(name, parent, points, width, thickness, surface = sage) {
    const path = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)), false, 'centripetal');
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, -thickness / 2); shape.lineTo(width / 2, -thickness / 2);
    shape.lineTo(width / 2, thickness / 2); shape.lineTo(-width / 2, thickness / 2); shape.closePath();
    const strap = mesh(keep(new THREE.ExtrudeGeometry(shape, { steps: 64, bevelEnabled: false, extrudePath: path })), surface, parent);
    strap.name = name; return strap;
  }
  const body = joint('runner-pelvis', group, [0, .965, 0]);
  // The pelvis overlaps both thigh roots; legs never detach while striding.
  mesh(ball, shorts, body, [0, -.015, 0], [.184, .145, .115]);
  mesh(shirtGeometry(), jersey, body).name = 'runner-shirt';
  mesh(keep(new THREE.CylinderGeometry(.175, .18, .06, 24)), shorts, body, [0, .008, 0], [1, 1, .72]);
  mesh(ball, skin, body, [0, .575, 0], [.063, .083, .063]);
  const head = joint('runner-head', body, [0, .75, -.008]);
  mesh(ball, skin, head, [0, 0, 0], [.127, .15, .125]);
  mesh(ball, skin, head, [0, -.015, -.124], [.028, .033, .025]);
  for (const side of [-1, 1]) {
    mesh(ball, skin, head, [side * .123, -.012, 0], [.022, .037, .022]);
    mesh(ball, dark, head, [side * .045, .026, -.119], [.011, .009, .006]);
  }
  const cap = mesh(keep(new THREE.SphereGeometry(.137, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)), cream, head, [0, .038, .005]);
  const visor = mesh(ball, cream, head, [0, .038, -.124], [.142, .015, .108]);
  visor.rotation.x = -.08;
  mesh(ball, dark, head, [0, -.045, .1], [.093, .1, .036]);
  // Geometry-only bib keeps this module independent of the DOM and textures.
  mesh(cube, cream, body, [0, .274, -.127], [.192, .128, .014]);
  const zero = mesh(keep(new THREE.TorusGeometry(.026, .006, 5, 16)), dark, body, [.034, .274, -.14]);
  zero.scale.x = .7;
  mesh(cube, dark, body, [-.029, .274, -.14], [.011, .057, .007]);
  const oneTip = mesh(cube, dark, body, [-.019, .296, -.14], [.026, .01, .007]); oneTip.rotation.z = -.45;

  const shortsLeg = capsule(.097, .13);
  const sockShape = keep(new THREE.CylinderGeometry(.066, .063, .155, 16));
  const sockStripe = keep(new THREE.CylinderGeometry(.0665, .0665, .013, 16));

  const legs = [-1, 1].map((side, index) => {
    const hip = joint(`runner-hip-${index}`, body, [side * .108, -.015, 0], true);
    mesh(shortsLeg, shorts, hip, [0, -.065, 0]);
    const knee = joint(`runner-knee-${index}`, hip, [0, -.44, 0], true);
    skinLimb(hip, knee, .87, .44, [[0, .084], [.19, .076], [.36, .065], [.44, .060], [.54, .064], [.66, .058], [.87, .045]]);
    mesh(sockShape, cream, knee, [0, -.361, 0]);
    mesh(sockStripe, jersey, knee, [0, -.293, 0]);
    const ankle = joint(`runner-ankle-${index}`, knee, [0, -.43, 0]);
    const shoe = mesh(shoeShape, cream, ankle, [0, -.025, -.064]); shoe.name = `runner-shoe-${index}`; shoe.rotation.x = Math.PI / 2; shoe.scale.x = 1.02; shoe.scale.z = .73;
    const tread = mesh(shoeShape, sole, ankle, [0, -.066, -.064]); tread.rotation.x = Math.PI / 2; tread.scale.set(1.05, 1.01, .25);
    tread.name = `runner-sole-${index}`;
    mesh(cube, jersey, ankle, [side * .069, -.014, -.038], [.008, .032, .101]);
    return { hip, knee, ankle, side };
  });
  const arms = [-1, 1].map((side, index) => {
    const shoulder = joint(`runner-shoulder-${index}`, body, [side * .193, .465, 0], true);
    mesh(ball, jersey, shoulder, [0, -.03, 0], [.08, .096, .078]);
    const elbow = joint(`runner-elbow-${index}`, shoulder, [0, -.255, 0], true);
    skinLimb(shoulder, elbow, .50, .255, [[0, .054], [.12, .051], [.255, .040], [.33, .044], [.50, .030]]);
    const hand = joint(`runner-hand-${index}`, elbow, [0, -.245, 0]);
    mesh(ball, skin, hand, [0, -.017, 0], [.041, .055, .037]);
    if (side === -1) {
      mesh(cube, dark, elbow, [0, -.201, 0], [.082, .029, .071]);
      mesh(cube, cream, elbow, [0, -.201, -.039], [.037, .033, .009]);
    }
    return { shoulder, elbow, hand, side, targetShoulder: new THREE.Quaternion(), targetElbow: new THREE.Quaternion() };
  });

  const cup = joint('runner-water-cup', arms[1].hand, [0, 0, 0]);
  mesh(keep(new THREE.CylinderGeometry(.04, .03, .102, 16, 1, true)), cream, cup, [0, .022, 0]);
  const rim = mesh(keep(new THREE.TorusGeometry(.04, .004, 5, 20)), cream, cup, [0, .073, 0]); rim.rotation.x = Math.PI / 2;
  const water = mesh(keep(new THREE.CircleGeometry(.035, 16)), material('runner-water', '#7fbbc0', { metalness: .2, roughness: .22 }), cup, [0, .064, 0]); water.rotation.x = -Math.PI / 2;

  function addPack(parent, position, scale) {
    const bag = joint('runner-race-bag', parent, position); bag.scale.setScalar(scale);
    mesh(ball, sage, bag, [0, -.145, 0], [.133, .177, .067]);
    mesh(cube, cream, bag, [0, -.146, -.067], [.09, .068, .008]);
    const handle = mesh(keep(new THREE.TorusGeometry(.05, .008, 5, 16)), dark, bag, [0, .025, 0]); handle.scale.y = .65;
    return bag;
  }
  const handBag = addPack(arms[0].hand, [0, 0, 0], 1);
  const backpack = addPack(body, [0, .42, .166], 1.15);
  backpack.name = 'runner-backpack'; backpack.rotation.y = Math.PI;
  const straps = joint('runner-bag-straps', body, [0, 0, 0]);
  // One continuous strip per shoulder, starting inside the pack's upper seam
  // and finishing inside its lower seam. Every point follows the torso rather
  // than the moving arms, so shoulder animation cannot tear the harness apart.
  for (const side of [-1, 1]) {
    webbing(`runner-pack-strap-${side}`, straps, [
      [side * .085, .395, .17], [side * .14, .49, .089], [side * .15, .52, .005],
      [side * .139, .50, -.077], [side * .145, .36, -.096], [side * .135, .18, -.09],
      [side * .169, .11, -.032], [side * .159, .106, .071], [side * .084, .107, .147],
    ], .032, .008);
  }
  webbing('runner-pack-chest-strap', straps, [[-.145, .36, -.104], [0, .36, -.132], [.145, .36, -.104]], .015, .005);
  mesh(cube, dark, straps, [0, .36, -.139], [.026, .021, .013]);
  const award = joint('runner-award', body, [0, .58, 0]);
  webbing('runner-medal-ribbon', award, [
    [-.012, -.21, -.145], [-.057, -.13, -.121], [-.066, -.025, -.058],
    [-.038, .025, .05], [.038, .025, .05], [.066, -.025, -.058],
    [.057, -.13, -.121], [.012, -.21, -.145],
  ], .017, .004);
  const pendant = mesh(keep(new THREE.CylinderGeometry(.056, .056, .014, 24)), gold, award, [0, -.212, -.15]); pendant.rotation.x = Math.PI / 2;
  const seal = mesh(keep(new THREE.TorusGeometry(.037, .003, 5, 24)), cream, award, [0, -.212, -.161]);
  seal.name = 'runner-medal-engraving';

  // Two-bone IK makes the cup actually reach the face, and keeps both hands
  // at the kit. All animated endpoints remain children of anatomical joints.
  const down = new THREE.Vector3(0, -1, 0);
  const axis = new THREE.Vector3(), pole = new THREE.Vector3(), bend = new THREE.Vector3();
  const upper = new THREE.Vector3(), lower = new THREE.Vector3(), elbowPoint = new THREE.Vector3();
  const combined = new THREE.Quaternion(), inverse = new THREE.Quaternion(), cupTilt = new THREE.Quaternion();
  const rightDrinkTarget = new THREE.Vector3(.025, .633, -.201);
  const kitTargets = [new THREE.Vector3(-.105, .30, -.405), new THREE.Vector3(.105, .30, -.405)];
  const xAxis = new THREE.Vector3(1, 0, 0);
  const footTarget = new THREE.Vector3(), reachableTarget = new THREE.Vector3();
  const bodyInverse = new THREE.Quaternion(), footOrientation = new THREE.Quaternion();
  function reach(arm, target, amount) {
    if (amount <= 0) return;
    axis.subVectors(target, arm.shoulder.position);
    const distance = Math.min(.499, Math.max(.015, axis.length())); axis.normalize();
    const along = (.255 ** 2 - .245 ** 2 + distance ** 2) / (2 * distance);
    const height = Math.sqrt(Math.max(0, .255 ** 2 - along ** 2));
    pole.set(arm.side, -.8, -.15);
    bend.copy(pole).addScaledVector(axis, -pole.dot(axis)).normalize();
    elbowPoint.copy(arm.shoulder.position).addScaledVector(axis, along).addScaledVector(bend, height);
    upper.subVectors(elbowPoint, arm.shoulder.position).normalize();
    lower.subVectors(target, elbowPoint).normalize();
    arm.targetShoulder.setFromUnitVectors(down, upper);
    arm.targetElbow.setFromUnitVectors(down, lower);
    inverse.copy(arm.targetShoulder).invert(); arm.targetElbow.premultiply(inverse);
    arm.shoulder.quaternion.slerp(arm.targetShoulder, amount);
    arm.elbow.quaternion.slerp(arm.targetElbow, amount);
  }
  function plantLeg({ hip, knee, ankle, side }, phase, amount) {
    const cycle = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
    const stance = cycle < .42;
    const swing = stance ? 0 : (cycle - .42) / .58;
    const smoothSwing = swing * swing * (3 - 2 * swing);
    // Contact lasts 42% of a stride; the opposite leg arrives half a stride
    // later. This leaves a short flight phase without dragging either foot.
    const z = stance ? THREE.MathUtils.lerp(-.30, .30, cycle / .42)
      : THREE.MathUtils.lerp(.30, -.30, smoothSwing) + .132 * Math.sin(swing * Math.PI * 2);
    const lift = stance ? 0 : .37 * Math.pow(Math.sin(swing * Math.PI), 1.6);
    const pitch = amount * (stance ? .14 - .32 * cycle / .42 : -.18 + .45 * Math.sin(swing * Math.PI) + .32 * swing);
    // Account for the shoe's rotated sole, rather than placing the ankle on
    // the floor. The conservative clearance also prevents toe clipping.
    const clearance = .084 * Math.cos(pitch) - .064 * Math.sin(pitch) + .141 * Math.abs(Math.sin(pitch));
    footTarget.set(side * .108, clearance + lift * amount, z * amount);
    footTarget.sub(body.position).applyQuaternion(bodyInverse);
    axis.subVectors(footTarget, hip.position);
    const distance = THREE.MathUtils.clamp(axis.length(), .03, .8699);
    axis.normalize(); reachableTarget.copy(hip.position).addScaledVector(axis, distance);
    const along = (.44 ** 2 - .43 ** 2 + distance ** 2) / (2 * distance);
    const height = Math.sqrt(Math.max(0, .44 ** 2 - along ** 2));
    pole.set(0, 0, -1);
    bend.copy(pole).addScaledVector(axis, -pole.dot(axis)).normalize();
    elbowPoint.copy(hip.position).addScaledVector(axis, along).addScaledVector(bend, height);
    upper.subVectors(elbowPoint, hip.position).normalize();
    lower.subVectors(reachableTarget, elbowPoint).normalize();
    hip.quaternion.setFromUnitVectors(down, upper);
    knee.quaternion.setFromUnitVectors(down, lower);
    inverse.copy(hip.quaternion).invert(); knee.quaternion.premultiply(inverse);
    combined.copy(body.quaternion).multiply(hip.quaternion).multiply(knee.quaternion);
    footOrientation.setFromAxisAngle(xAxis, pitch);
    ankle.quaternion.copy(combined).invert().multiply(footOrientation);
  }
  function update({ gait = 0, run = 0, drink = 0, receiveKit = 0, medal = 0, celebrate = 0 } = {}) {
    run = clamp(run); drink = clamp(drink); receiveKit = clamp(receiveKit); medal = clamp(medal); celebrate = clamp(celebrate);
    gait = Number.isFinite(gait) ? gait : 0;
    body.position.y = THREE.MathUtils.lerp(.965, .888 + .015 * Math.cos(gait * 2), run);
    body.rotation.set(-.065 * run, Math.sin(gait) * .035 * run, Math.cos(gait) * .028 * run);
    head.rotation.set(-drink * .11, Math.sin(gait) * -.035 * run, 0);
    bodyInverse.copy(body.quaternion).invert();
    legs.forEach((leg, index) => plantLeg(leg, gait + index * Math.PI, run));
    arms.forEach((arm, index) => {
      const phase = gait + index * Math.PI;
      arm.shoulder.rotation.set(.08 - Math.sin(phase) * .64 * run, 0, arm.side * (.065 + celebrate * 2.18));
      arm.elbow.rotation.set(.13 + run * (1 + .19 * Math.cos(phase)) + celebrate * .3, 0, 0);
    });
    const kitReach = Math.sin(Math.PI * receiveKit) * (1 - celebrate);
    arms.forEach((arm, index) => reach(arm, kitTargets[index], kitReach));
    reach(arms[1], rightDrinkTarget, drink);
    cup.visible = drink > .035;
    combined.copy(arms[1].shoulder.quaternion).multiply(arms[1].elbow.quaternion);
    cupTilt.setFromAxisAngle(xAxis, .4 * drink);
    cup.quaternion.copy(combined).invert().multiply(cupTilt);
    handBag.visible = receiveKit > .18 && receiveKit < .88;
    combined.copy(arms[0].shoulder.quaternion).multiply(arms[0].elbow.quaternion);
    handBag.quaternion.copy(combined).invert();
    backpack.visible = straps.visible = receiveKit >= .88;
    award.visible = medal > .01;
    award.scale.setScalar(Math.max(.001, medal));
    award.rotation.z = Math.sin(gait) * .13 * run;
  }
  update();
  return { group, update };
}
