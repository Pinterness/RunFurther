const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const assert = require('node:assert/strict');

// Isolated asset review: no app data, API requests or production debug hooks.
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 600 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://runner.test/**', route => {
      const filename = new URL(route.request().url()).pathname.slice(1);
      const files = {
        'three.module.js': 'node_modules/three/build/three.module.js',
        'three.core.js': 'node_modules/three/build/three.core.js',
        'runner.js': 'src/components/site/createJourneyRunner.js',
      };
      if (files[filename]) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(files[filename], 'utf8') });
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>body{margin:0;background:#e8eae2}canvas{display:block}.labels{position:absolute;bottom:24px;inset-inline:0;display:flex;flex-direction:row-reverse;font:15px sans-serif;color:#304333}.labels span{flex:1;text-align:center}</style></head><body><div class="labels"><span>Stand</span><span>Run / contact</span><span>Run / recovery</span><span>Drink</span><span>Collect kit</span><span>Finish / backpack</span></div><script type="module">
        import * as THREE from './three.module.js';
        import { createJourneyRunner } from './runner.js';
        const resources = new Set(), keep = value => (resources.add(value), value);
        const renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true });
        renderer.setSize(1500,600); renderer.setPixelRatio(1); renderer.shadowMap.enabled=true;
        renderer.shadowMap.type=THREE.PCFShadowMap; renderer.toneMapping=THREE.ACESFilmicToneMapping;
        document.body.prepend(renderer.domElement);
        const scene=new THREE.Scene(); scene.background=new THREE.Color('#e8eae2');
        scene.add(new THREE.HemisphereLight('#ffffff','#697a5f',2.6));
        const sun=new THREE.DirectionalLight('#fff0d4',3); sun.position.set(-3,8,-4); sun.castShadow=true;
        sun.shadow.mapSize.set(2048,2048); Object.assign(sun.shadow.camera,{left:-8,right:8,top:4,bottom:-4}); scene.add(sun);
        const floor=new THREE.Mesh(keep(new THREE.PlaneGeometry(80,80)),keep(new THREE.MeshStandardMaterial({color:'#dce0d3',roughness:1})));
        floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; scene.add(floor);
        const poses=[{}, {run:1,gait:0}, {run:1,gait:1.8,receiveKit:1}, {drink:1}, {receiveKit:.55}, {receiveKit:1,medal:1,celebrate:1}];
        const runners=poses.map((pose,index)=>{const actor=createJourneyRunner({THREE,keep});actor.group.position.x=(index-2.5)*1.2;actor.update(pose);scene.add(actor.group);return actor;});
        const camera=new THREE.OrthographicCamera(-3.65,3.65,1.46,-1.46,.1,100);
        camera.position.set(0,2.7,-12);camera.lookAt(0,.9,0);
        window.renderView=angle=>{runners.forEach(actor=>actor.group.rotation.y=angle);renderer.render(scene,camera);};
        window.reviewReady=true; window.renderView(0);
      </script></body></html>` });
    });
    await page.goto('http://runner.test/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.reviewReady);
    fs.mkdirSync('artifacts', { recursive: true });
    for (const [name, angle] of [['front', 0], ['side', Math.PI / 2], ['back', Math.PI]]) {
      await page.evaluate(angle => window.renderView(angle), angle);
      await page.screenshot({ path: 'artifacts/runner-review-' + name + '.png' });
    }
    assert.deepEqual(errors, []);
    console.log('PASS: six character poses rendered from front, side and back. Review artifacts/runner-review-*.png.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
