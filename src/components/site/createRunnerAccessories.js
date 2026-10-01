// Socket-ready race accessories: metres, +Y up, -Z facing the runner's front.
// The caller owns visibility, attachment transforms and disposal via `keep`.
export function createRunnerAccessories({ THREE, keep }) {
  const surface = (name, color, options = {}) => {
    const material = keep(new THREE.MeshStandardMaterial({ color, roughness: .83, ...options }));
    material.name = name; return material;
  };
  const forest = surface('athlete-pack-fabric', '#344f43');
  const webbing = surface('athlete-pack-webbing', '#516a57');
  const clay = surface('athlete-clay-trim', '#df7046');
  const cream = surface('athlete-paper', '#f4eedb');
  const ink = surface('athlete-ink', '#182e27');
  const water = surface('athlete-water', '#6fabb0', { roughness: .2, metalness: .15 });
  const gold = keep(new THREE.MeshPhysicalMaterial({ color: '#d6a748', metalness: .8, roughness: .2, clearcoat: .22 }));
  gold.name = 'runner-medal';
  const cube = keep(new THREE.BoxGeometry(1, 1, 1));
  function group(name) { const value = new THREE.Group(); value.name = name; return value; }
  function mesh(parent, geometry, material, position = [0, 0, 0], scale = [1, 1, 1], name = '') {
    const value = new THREE.Mesh(geometry, material);
    value.name = name; value.position.set(...position); value.scale.set(...scale);
    value.castShadow = value.receiveShadow = true; parent.add(value); return value;
  }
  function rounded(width, height, depth, radius) {
    const x = -width / 2, y = -height / 2, r = Math.min(radius, width / 2, height / 2);
    const shape = new THREE.Shape();
    shape.moveTo(x + r, y); shape.lineTo(x + width - r, y);
    shape.quadraticCurveTo(x + width, y, x + width, y + r);
    shape.lineTo(x + width, y + height - r);
    shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    shape.lineTo(x + r, y + height); shape.quadraticCurveTo(x, y + height, x, y + height - r);
    shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y); shape.closePath();
    const bevel = Math.min(.004, depth / 5);
    const geometry = keep(new THREE.ExtrudeGeometry(shape, {
      depth: depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel,
      bevelSize: bevel, bevelSegments: 2, steps: 1, curveSegments: 5,
    }));
    geometry.translate(0, 0, -depth / 2 + bevel); return geometry;
  }
  function ribbon(parent, name, points, width, thickness, material = webbing, widthAxis = [1, 0, 0]) {
    const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)), false, 'centripetal');
    const positions = [], indices = [], divisions = 48;
    const axis = new THREE.Vector3(...widthAxis), tangent = new THREE.Vector3(), side = new THREE.Vector3();
    const point = new THREE.Vector3(), normal = new THREE.Vector3(), vertex = new THREE.Vector3();
    // A stable width axis keeps these straps flat against the chest instead
    // of allowing the rectangular cross-section to twist around the curve.
    for (let step = 0; step <= divisions; step++) {
      curve.getPointAt(step / divisions, point); curve.getTangentAt(step / divisions, tangent);
      side.copy(axis).addScaledVector(tangent, -axis.dot(tangent));
      if (side.lengthSq() < .0001) side.set(0, 0, 1).addScaledVector(tangent, -tangent.z);
      side.normalize(); normal.crossVectors(tangent, side).normalize();
      for (const [across, deep] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        vertex.copy(point).addScaledVector(side, across * width / 2).addScaledVector(normal, deep * thickness / 2);
        positions.push(vertex.x, vertex.y, vertex.z);
      }
      if (step < divisions) {
        const row = step * 4;
        for (let edge = 0; edge < 4; edge++) {
          const a = row + edge, b = row + (edge + 1) % 4, c = b + 4, d = a + 4;
          indices.push(a, b, d, b, c, d);
        }
      }
    }
    indices.push(0, 2, 1, 0, 3, 2);
    const end = divisions * 4; indices.push(end, end + 1, end + 2, end, end + 2, end + 3);
    const geometry = keep(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    return mesh(parent, geometry, material, [0, 0, 0], [1, 1, 1], name);
  }

  const pack = group('athlete-backpack');
  mesh(pack, rounded(.292, .392, .15, .052), forest, [0, -.10, .17], [1, 1, 1], 'athlete-pack-body');
  mesh(pack, rounded(.226, .16, .022, .027), webbing, [0, -.17, .249], [1, 1, 1], 'athlete-pack-pocket');
  mesh(pack, cube, cream, [0, -.115, .262], [.08, .009, .003], 'athlete-pack-reflector');
  mesh(pack, cube, clay, [.09, -.067, .262], [.009, .033, .004], 'athlete-pack-zipper');
  ribbon(pack, 'athlete-pack-handle', [[-.036, .09, .17], [-.032, .123, .17], [.032, .123, .17], [.036, .09, .17]], .013, .006, ink, [0, 0, 1]);
  for (const sign of [-1, 1]) {
    ribbon(pack, 'athlete-pack-strap-' + sign, [
      [sign * .09, .076, .17], [sign * .137, .12, .095], [sign * .149, .14, .018],
      [sign * .143, .117, -.065], [sign * .128, .015, -.084], [sign * .121, -.13, -.085],
      [sign * .162, -.236, -.045], [sign * .148, -.27, .085], [sign * .087, -.27, .17],
    ], .027, .006);
    mesh(pack, cube, ink, [sign * .128, .014, -.09], [.031, .03, .01], 'athlete-pack-adjuster-' + sign);
  }
  ribbon(pack, 'athlete-pack-sternum-strap', [[-.128, .017, -.088], [0, .017, -.121], [.128, .017, -.088]], .012, .005, webbing, [0, 1, 0]);
  mesh(pack, cube, ink, [0, .017, -.125], [.026, .022, .01], 'athlete-pack-buckle');

  const bib = group('athlete-bib');
  mesh(bib, rounded(.186, .126, .005, .012), cream, [0, 0, 0], [1, 1, 1], 'athlete-bib-card');
  mesh(bib, cube, clay, [0, .042, -.004], [.164, .011, .002], 'athlete-bib-trim');
  // Seen from -Z, positive X is the viewer's left: these meshes spell 01.
  const zero = mesh(bib, keep(new THREE.TorusGeometry(.026, .005, 6, 20)), ink, [.032, -.008, -.007]);
  zero.scale.x = .72;
  mesh(bib, cube, ink, [-.03, -.008, -.007], [.01, .059, .006]);
  mesh(bib, cube, ink, [-.03, -.035, -.007], [.032, .008, .006]);
  const oneTip = mesh(bib, cube, ink, [-.019, .015, -.007], [.025, .009, .006]); oneTip.rotation.z = -.5;

  const medal = group('athlete-medal');
  ribbon(medal, 'athlete-medal-ribbon', [
    [-.012, -.09, -.132], [-.062, .019, -.115], [-.071, .145, -.065],
    [-.043, .20, .046], [.043, .20, .046], [.071, .145, -.058],
    [.062, .019, -.115], [.012, -.09, -.132],
  ], .017, .004, clay);
  const pendant = mesh(medal, keep(new THREE.CylinderGeometry(.048, .048, .01, 32)), gold, [0, -.098, -.134], [1, 1, 1], 'athlete-medal-pendant');
  pendant.rotation.x = Math.PI / 2;
  mesh(medal, keep(new THREE.TorusGeometry(.034, .0025, 6, 32)), gold, [0, -.098, -.141], [1, 1, 1], 'athlete-medal-rim');
  // Small embossed finish bars keep the medal readable without an icon font.
  for (let i = -1; i <= 1; i++) {
    const bar = mesh(medal, cube, gold, [i * .012, -.098, -.141], [.005, .025 - Math.abs(i) * .009, .002]);
    bar.rotation.z = -.2;
  }

  const cup = group('athlete-water-cup');
  const cupWall = surface('athlete-cup-paper', '#f4eedb', { side: THREE.DoubleSide });
  mesh(cup, keep(new THREE.CylinderGeometry(.04, .03, .10, 20, 1, true)), cupWall, [0, .02, 0]);
  mesh(cup, keep(new THREE.CylinderGeometry(.0305, .0305, .003, 20)), cream, [0, -.029, 0]);
  const rim = mesh(cup, keep(new THREE.TorusGeometry(.04, .0025, 6, 24)), cream, [0, .07, 0]); rim.rotation.x = Math.PI / 2;
  const drink = mesh(cup, keep(new THREE.CircleGeometry(.0355, 20)), water, [0, .059, 0]); drink.rotation.x = -Math.PI / 2;
  mesh(cup, keep(new THREE.CylinderGeometry(.0365, .0345, .02, 20, 1, true)), clay, [0, .01, 0]);

  const kitBag = group('athlete-kit-bag');
  mesh(kitBag, rounded(.23, .265, .075, .028), forest, [0, -.172, 0], [1, 1, 1], 'athlete-kit-bag-body');
  mesh(kitBag, rounded(.073, .052, .003, .006), cream, [0, -.16, -.04], [1, 1, 1], 'athlete-kit-bag-label');
  for (const sign of [-1, 1]) ribbon(kitBag, 'athlete-kit-bag-handle-' + sign, [
    [-.054, -.043, sign * .024], [-.042, .004, sign * .009], [0, .022, sign * .009],
    [.042, .004, sign * .009], [.054, -.043, sign * .024],
  ], .011, .004, webbing, [0, 0, 1]);
  return { pack, bib, medal, cup, kitBag };
}
