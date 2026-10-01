// A self-contained dawn environment. All GPU resources belong to the world's
// `keep` registry, so retrying or leaving the landing page releases them too.
// Scenery is illustrative, never an actual event's elevation or route data.
export function createCinematicAtmosphere({ THREE, scene, keep, mobile = false }) {
  let seed = 1729;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const root = new THREE.Group();
  root.name = 'cinematic-atmosphere';
  scene.add(root);
  const horizon = new THREE.Color('#b8bda7');
  scene.background = horizon.clone();
  scene.fog = new THREE.FogExp2(horizon, .0065);

  // The dome follows translation, never rotation. Its dawn remains in one
  // world direction when the camera turns, without an external HDR download.
  const skyMaterial = keep(new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      zenith: { value: new THREE.Color('#678b90') },
      horizon: { value: horizon.clone() },
      sunrise: { value: new THREE.Color('#edc894') },
      sunDirection: { value: new THREE.Vector3(-.42, .19, -1).normalize() },
    },
    vertexShader: `
      varying vec3 vSkyDirection;
      void main() {
        vSkyDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 sunrise;
      uniform vec3 sunDirection;
      varying vec3 vSkyDirection;
      void main() {
        vec3 direction = normalize(vSkyDirection);
        float elevation = smoothstep(-0.08, 0.78, direction.y);
        vec3 sky = mix(horizon, zenith, pow(elevation, 0.68));
        float facingSun = max(0.0, dot(direction, sunDirection));
        float glow = pow(facingSun, 14.0) * 0.68;
        sky = mix(sky, sunrise, glow);
        sky += sunrise * pow(facingSun, 160.0) * 0.3;
        sky += vec3(1.0, 0.84, 0.56) * smoothstep(0.99955, 0.99975, facingSun) * 1.7;
        gl_FragColor = vec4(sky, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }));
  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(360, 32, 20)), skyMaterial);
  sky.name = 'dawn-sky'; sky.renderOrder = -1000; sky.frustumCulled = false;
  root.add(sky);

  // Continuous profiles replace isolated cone-shaped peaks. The three valley
  // walls share one geometry per layer, keeping distant scenery at three draws.
  const ridges = [
    { distance: 295, height: 62, color: '#acb7ab', phase: 1.6 },
    { distance: 251, height: 51, color: '#8eaa9e', phase: 4.7 },
    { distance: 211, height: 39, color: '#6e9284', phase: 8.2 },
  ];
  for (const [layer, ridge] of ridges.entries()) {
    const positions = [], indices = [];
    for (let wall = 0; wall < 3; wall++) {
      const first = positions.length / 3;
      for (let i = 0; i <= 96; i++) {
        const u = i / 96, along = (u - .5) * 670;
        const profile = .52 + Math.sin(u * 13 + ridge.phase) * .2
          + Math.sin(u * 32 + ridge.phase * .7) * .11
          + Math.sin(u * 71 + ridge.phase) * .045;
        const height = 8 + profile * ridge.height;
        const depth = ridge.distance + Math.sin(u * 17 + ridge.phase) * 12;
        const x = wall === 0 ? along : (wall === 1 ? -depth : depth);
        const z = wall === 0 ? -depth : along - 90;
        positions.push(x, -2, z, x, height, z);
        if (i < 96) {
          const n = first + i * 2;
          indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
        }
      }
    }
    const geometry = keep(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    // Their colors already express atmospheric distance; applying exponential
    // fog again would erase the far ridges completely at the starting line.
    const material = keep(new THREE.MeshBasicMaterial({ color: ridge.color, side: THREE.DoubleSide, fog: false }));
    const mountains = new THREE.Mesh(geometry, material);
    mountains.name = 'valley-ridge-' + layer;
    root.add(mountains);
  }

  // Tall pines sit behind the existing roadside trees. A lathed branch profile
  // gives a softer, layered silhouette without hundreds of separate meshes.
  const profile = [
    [0, 0], [.30, .10], [.14, .18], [.34, .22], [.13, .31],
    [.29, .37], [.10, .46], [.24, .52], [.08, .63], [.17, .69],
    [.05, .80], [.10, .84], [0, 1],
  ].map(([radius, height]) => new THREE.Vector2(radius, height));
  const crownGeometry = keep(new THREE.LatheGeometry(profile, mobile ? 7 : 10));
  const trunkGeometry = keep(new THREE.CylinderGeometry(.035, .06, 1, 6));
  const crownMaterial = keep(new THREE.MeshStandardMaterial({ color: '#32584b', roughness: 1 }));
  const trunkMaterial = keep(new THREE.MeshStandardMaterial({ color: '#555a47', roughness: 1 }));
  const count = mobile ? 100 : 180;
  const crowns = keep(new THREE.InstancedMesh(crownGeometry, crownMaterial, count));
  const trunks = keep(new THREE.InstancedMesh(trunkGeometry, trunkMaterial, count));
  crowns.name = 'distant-pine-canopy'; trunks.name = 'distant-pine-trunks';
  // Distant trees do not need to expand the moving high-resolution shadow map.
  crowns.receiveShadow = trunks.receiveShadow = true;
  root.add(crowns, trunks);
  const dummy = new THREE.Object3D(), tint = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (48 + random() * 75), z = 38 - random() * 274;
    const height = 11 + random() * 18, width = .8 + random() * .55;
    dummy.position.set(x, height * .19, z);
    dummy.rotation.set(0, random() * Math.PI, 0);
    dummy.scale.set(height * width, height * .86, height * width);
    dummy.updateMatrix(); crowns.setMatrixAt(i, dummy.matrix);
    tint.setHSL(.39 + random() * .035, .16 + random() * .1, .18 + random() * .10);
    crowns.setColorAt(i, tint);
    dummy.position.y = height * .32;
    dummy.scale.set(height, height * .64, height);
    dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
  }
  crowns.instanceMatrix.needsUpdate = trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceColor.needsUpdate = true;

  // A small generated alpha texture serves both low roadside mist and dust.
  // No full-screen translucent plane can hide the character or checkpoint UI.
  const size = 64, texels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + .5 - size / 2) / (size / 2), dy = (y + .5 - size / 2) / (size / 2);
    const radius = dx * dx + dy * dy;
    const alpha = Math.max(0, Math.exp(-radius * 4.2) - Math.exp(-4.2));
    const index = (y * size + x) * 4;
    texels[index] = texels[index + 1] = texels[index + 2] = 255;
    texels[index + 3] = Math.round(alpha * 255);
  }
  const softTexture = keep(new THREE.DataTexture(texels, size, size, THREE.RGBAFormat));
  softTexture.minFilter = softTexture.magFilter = THREE.LinearFilter;
  softTexture.needsUpdate = true;
  const mistMaterial = keep(new THREE.SpriteMaterial({
    map: softTexture, color: '#d4d8ba', transparent: true, opacity: .16,
    depthWrite: false, fog: true,
  }));
  const mist = [];
  for (let i = 0; i < (mobile ? 8 : 14); i++) {
    const sprite = new THREE.Sprite(mistMaterial);
    sprite.name = 'roadside-mist';
    const x = (i % 2 ? 1 : -1) * (23 + random() * 24);
    const z = 14 - random() * 199, y = .75 + random() * 1.2;
    sprite.position.set(x, y, z); sprite.scale.set(21 + random() * 19, 3 + random() * 2, 1);
    root.add(sprite); mist.push({ sprite, x, y, z, phase: random() * Math.PI * 2 });
  }

  const particleCount = mobile ? 64 : 132;
  const dustPositions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    dustPositions[i * 3] = (random() - .5) * 34;
    dustPositions[i * 3 + 1] = .5 + random() * 8;
    dustPositions[i * 3 + 2] = (random() - .5) * 42;
  }
  const dustGeometry = keep(new THREE.BufferGeometry());
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dustMaterial = keep(new THREE.PointsMaterial({
    color: '#ffe6ba', map: softTexture, size: .13, transparent: true,
    opacity: .58, alphaTest: .015, depthWrite: false, sizeAttenuation: true,
  }));
  const dust = new THREE.Points(dustGeometry, dustMaterial);
  dust.name = 'sunlit-dust'; root.add(dust);

  return {
    settings: { fogColor: '#b8bda7', fogDensity: .0065, skyRadius: 360 },
    update({ time = 0, camera, actorPosition, moving = 0 }) {
      // Rendering is paused by the parent for reduced motion, hidden tabs and
      // offscreen journeys. This module schedules no independent animation loop.
      sky.position.copy(camera.position);
      const anchor = actorPosition || camera.position;
      dust.position.set(anchor.x + Math.sin(time * .09) * .4, Math.sin(time * .16) * .22, anchor.z);
      dustMaterial.opacity = .43 + Math.min(1, Math.max(0, moving)) * .15;
      mistMaterial.opacity = THREE.MathUtils.lerp(.16, .05, THREE.MathUtils.smoothstep(camera.position.y, 12, 48));
      for (const patch of mist) {
        patch.sprite.position.x = patch.x + Math.sin(time * .035 + patch.phase) * 1.6;
        patch.sprite.position.y = patch.y + Math.sin(time * .055 + patch.phase) * .13;
      }
    },
  };
}
