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
  const capsule = (radius, length) => keep(new THREE.CapsuleGeometry(radius, Math.max(.001, length - radius * 2), 5, 10));
  const upperLegShape = capsule(.079, .44);
  const lowerLegShape = capsule(.062, .43);
  const upperArmShape = capsule(.05, .255);
  const lowerArmShape = capsule(.043, .245);
  const shoeShape = capsule(.072, .28);
  function mesh(shape, surface, parent, position = [0, 0, 0], scale = [1, 1, 1]) {
    const object = new THREE.Mesh(shape, surface);
    object.position.set(...position); object.scale.set(...scale);
    object.castShadow = object.receiveShadow = true; parent.add(object); return object;
  }
  function joint(name, parent, position) {
    const result = new THREE.Group(); result.name = name; result.position.set(...position); parent.add(result); return result;
  }
  const body = joint('runner-pelvis', group, [0, .985, 0]);
  // The pelvis overlaps both thigh roots; legs never detach while striding.
  mesh(ball, shorts, body, [0, -.015, 0], [.184, .145, .115]);
  mesh(ball, jersey, body, [0, .295, 0], [.201, .302, .125]);
  mesh(cube, cream, body, [0, .09, -.124], [.21, .005, .009]);
  mesh(ball, skin, body, [0, .575, 0], [.063, .083, .063]);
  const head = joint('runner-head', body, [0, .75, -.008]);
  mesh(ball, skin, head, [0, 0, 0], [.127, .15, .125]);
  mesh(ball, skin, head, [0, -.015, -.124], [.028, .033, .025]);
  for (const side of [-1, 1]) {
    mesh(ball, skin, head, [side * .123, -.012, 0], [.022, .037, .022]);
    mesh(ball, dark, head, [side * .045, .026, -.119], [.011, .009, .006]);
  }
  const cap = mesh(keep(new THREE.SphereGeometry(.134, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)), cream, head, [0, .02, .005]);
  cap.scale.y = .95;
  const visor = mesh(ball, cream, head, [0, .032, -.124], [.142, .015, .108]);
  visor.rotation.x = -.08;
  mesh(ball, dark, head, [0, -.045, .1], [.093, .1, .036]);
  // Geometry-only bib keeps this module independent of the DOM and textures.
  mesh(cube, cream, body, [0, .274, -.127], [.192, .128, .014]);
  const zero = mesh(keep(new THREE.TorusGeometry(.026, .006, 5, 16)), dark, body, [-.034, .274, -.14]);
  zero.scale.x = .7;
  mesh(cube, dark, body, [.029, .274, -.14], [.011, .057, .007]);
  const oneTip = mesh(cube, dark, body, [.019, .296, -.14], [.026, .01, .007]); oneTip.rotation.z = .45;

  const legs = [-1, 1].map((side, index) => {
    const hip = joint(`runner-hip-${index}`, body, [side * .108, -.015, 0]);
    mesh(upperLegShape, skin, hip, [0, -.22, 0]);
    mesh(ball, shorts, hip, [0, -.085, 0], [.096, .137, .105]);
    const knee = joint(`runner-knee-${index}`, hip, [0, -.44, 0]);
    mesh(ball, skin, knee, [0, 0, 0], [.064, .066, .064]);
    mesh(lowerLegShape, skin, knee, [0, -.215, 0]);
    mesh(cube, cream, knee, [0, -.36, 0], [.096, .135, .091]);
    const ankle = joint(`runner-ankle-${index}`, knee, [0, -.43, 0]);
    const shoe = mesh(shoeShape, cream, ankle, [0, -.025, -.064]); shoe.rotation.x = Math.PI / 2; shoe.scale.x = 1.02; shoe.scale.z = .73;
    const tread = mesh(shoeShape, sole, ankle, [0, -.066, -.064]); tread.rotation.x = Math.PI / 2; tread.scale.set(1.05, 1.01, .25);
    mesh(cube, jersey, ankle, [side * .069, -.014, -.038], [.008, .032, .101]);
    return { hip, knee, ankle, side };
  });
  const arms = [-1, 1].map((side, index) => {
    const shoulder = joint(`runner-shoulder-${index}`, body, [side * .215, .485, 0]);
    mesh(ball, jersey, shoulder, [0, -.034, 0], [.064, .092, .067]);
    mesh(upperArmShape, skin, shoulder, [0, -.1275, 0]);
    const elbow = joint(`runner-elbow-${index}`, shoulder, [0, -.255, 0]);
    mesh(ball, skin, elbow, [0, 0, 0], [.046, .046, .046]);
    mesh(lowerArmShape, skin, elbow, [0, -.1225, 0]);
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
  const straps = joint('runner-bag-straps', body, [0, 0, 0]);
  for (const side of [-1, 1]) {
    const strap = mesh(cube, sage, straps, [side * .137, .365, -.09], [.027, .39, .025]); strap.rotation.z = side * -.1;
  }
  const award = joint('runner-award', body, [0, .39, -.156]);
  for (const side of [-1, 1]) {
    const ribbon = mesh(cube, sage, award, [side * .047, .12, 0], [.019, .25, .009]); ribbon.rotation.z = side * -.36;
  }
  const pendant = mesh(keep(new THREE.CylinderGeometry(.056, .056, .014, 24)), gold, award, [0, -.022, -.011]); pendant.rotation.x = Math.PI / 2;
  const seal = mesh(keep(new THREE.TorusGeometry(.037, .003, 5, 24)), cream, award, [0, -.022, -.022]);
  seal.name = 'runner-medal-engraving';

  // Two-bone IK makes the cup actually reach the face, and keeps both hands
  // at the kit. All animated endpoints remain children of anatomical joints.
  const down = new THREE.Vector3(0, -1, 0);
  const axis = new THREE.Vector3(), pole = new THREE.Vector3(), bend = new THREE.Vector3();
  const upper = new THREE.Vector3(), lower = new THREE.Vector3(), elbowPoint = new THREE.Vector3();
  const combined = new THREE.Quaternion(), inverse = new THREE.Quaternion(), cupTilt = new THREE.Quaternion();
  const rightDrinkTarget = new THREE.Vector3(.025, .679, -.201);
  const kitTargets = [new THREE.Vector3(-.105, .30, -.405), new THREE.Vector3(.105, .30, -.405)];
  const xAxis = new THREE.Vector3(1, 0, 0);
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
  function update({ gait = 0, run = 0, drink = 0, receiveKit = 0, medal = 0, celebrate = 0 } = {}) {
    run = clamp(run); drink = clamp(drink); receiveKit = clamp(receiveKit); medal = clamp(medal); celebrate = clamp(celebrate);
    gait = Number.isFinite(gait) ? gait : 0;
    body.position.y = .985 + run * (.024 + .026 * Math.cos(gait * 2)) + celebrate * .025;
    body.rotation.set(-.065 * run, Math.sin(gait) * .035 * run, Math.cos(gait) * .028 * run);
    head.rotation.set(-drink * .11, Math.sin(gait) * -.035 * run, 0);
    legs.forEach(({ hip, knee, ankle, side }, index) => {
      const phase = gait + index * Math.PI;
      const swing = Math.sin(phase);
      hip.rotation.set((swing * .79 + .05) * run, 0, side * -.016);
      knee.rotation.x = -run * (.24 + 1.17 * Math.max(0, -Math.cos(phase)));
      ankle.rotation.x = -.56 * hip.rotation.x - .43 * knee.rotation.x;
    });
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
