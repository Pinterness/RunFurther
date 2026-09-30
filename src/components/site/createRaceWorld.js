import * as THREE from 'three';
import { createRaceCameraPath } from './raceCameraPath.mjs';
import { createJourneyRunner } from './createJourneyRunner';

// Procedural, editorial scenery; never a route map or race-kit promise for a real event.
const routeX = z => Math.sin(-z / 29) * 8;
const smooth = value => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };

export function createRaceWorld(host, onFailure) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
  const scene = new THREE.Scene();
  const resources = new Set();
  const keep = item => { resources.add(item); return item; };
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    renderer.domElement.removeEventListener('webglcontextlost', lost);
    resources.forEach(resource => resource.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
  const lost = () => { if (!disposed) onFailure(); };
  renderer.domElement.addEventListener('webglcontextlost', lost);
  try {
    const camera = new THREE.PerspectiveCamera(58, 1, .3, 420);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.25 : 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x1a1a2e);
    renderer.shadowMap.enabled = true;
    // Three r186 removed PCFSoftShadowMap; PCFShadowMap now provides the
    // supported hardware-filtered soft shadows (without a fallback warning).
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // Idle pollen does not change any shadow caster, so redraw shadow maps only
    // when the camera, character, race kit or finish tape changes.
    renderer.shadowMap.autoUpdate = false;
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.FogExp2(0x1a1a2e, .002);
    scene.add(new THREE.HemisphereLight('#dce6ff', '#51422f', 1.6));
    const sun = new THREE.DirectionalLight('#ffe0ac', 3);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(window.innerWidth < 700 ? 1024 : 2048);
    sun.shadow.bias = -.00015;
    sun.shadow.normalBias = .035;
    sun.shadow.radius = 1.5;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 250;
    keep(sun.shadow);
    scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight('#b9cee8', .7); fill.position.set(30, 15, -100); scene.add(fill);
    const mat = (color, extra = {}) => keep(new THREE.MeshStandardMaterial({ color, roughness: .86, ...extra }));
    const clay = mat('#b85c39'), cream = mat('#f0e5ca'), dark = mat('#213e32'), bark = mat('#624a34');
    const orange = mat('#f07339'), sage = mat('#798b53');
    const gold = keep(new THREE.MeshPhysicalMaterial({ color: '#c99b43', metalness: .8, roughness: .2, clearcoat: .25, clearcoatRoughness: .18 }));
    // A small procedural sky reflection gives the metal something to reflect;
    // no network asset, external model or permanent offscreen renderer is needed.
    const sky = document.createElement('canvas'); sky.width = 512; sky.height = 256;
    const skyContext = sky.getContext('2d');
    const gradient = skyContext.createLinearGradient(0, 0, 0, sky.height);
    gradient.addColorStop(0, '#252e50'); gradient.addColorStop(.45, '#bacada');
    gradient.addColorStop(.52, '#f2cf9e'); gradient.addColorStop(.58, '#655c42'); gradient.addColorStop(1, '#292b25');
    skyContext.fillStyle = gradient; skyContext.fillRect(0, 0, sky.width, sky.height);
    skyContext.fillStyle = '#fff7da'; skyContext.beginPath(); skyContext.ellipse(110, 83, 24, 14, 0, 0, Math.PI * 2); skyContext.fill();
    const skyTexture = new THREE.CanvasTexture(sky);
    skyTexture.mapping = THREE.EquirectangularReflectionMapping; skyTexture.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    try { gold.envMap = keep(pmrem.fromEquirectangular(skyTexture)).texture; }
    finally { skyTexture.dispose(); pmrem.dispose(); }
    const runner = createJourneyRunner({ THREE, keep });
    runner.group.traverse(item => {
      if (item.material?.name === 'runner-medal') item.material.envMap = gold.envMap;
    });
    scene.add(runner.group);
    const white = mat('#fff4d9'), shoeDark = mat('#24362f');
    const cube = keep(new THREE.BoxGeometry(1,1,1));
    const cone = keep(new THREE.ConeGeometry(1,1,7));
    const sphere = keep(new THREE.IcosahedronGeometry(1,1));
    function mesh(geometry, material, parent = scene, position = [0,0,0], scale = [1,1,1]) {
      const item = new THREE.Mesh(geometry, material); item.position.set(...position); item.scale.set(...scale);
      item.castShadow = !material.isMeshBasicMaterial; item.receiveShadow = !material.isMeshBasicMaterial;
      parent.add(item); return item;
    }
    function box(parent, material, position, scale) { return mesh(cube,material,parent,position,scale); }
    function textPlane(text, width, height, color = '#f8efd7', background = '#254436') {
      const canvas = document.createElement('canvas'); canvas.width=1024; canvas.height=Math.ceil(1024*height/width);
      const ctx=canvas.getContext('2d');
      ctx.fillStyle=background; ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle=color; ctx.font='bold '+Math.floor(canvas.height*.64)+'px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(text,512,canvas.height*.53,940);
      const texture=keep(new THREE.CanvasTexture(canvas)); texture.colorSpace=THREE.SRGBColorSpace;
      const material=keep(new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));
      return new THREE.Mesh(keep(new THREE.PlaneGeometry(width,height)),material);
    }
    // Curved clay road, separate shoulder ribbons and white boundary stripes.
    const ground = mesh(keep(new THREE.PlaneGeometry(500,500)),mat('#71835a'),scene,[0,-.15,-90]);
    ground.rotation.x=-Math.PI/2; ground.castShadow=false;
    function ribbon(width, y, material, offset = 0) {
      const positions=[],indices=[];
      for(let i=0;i<=220;i++){
        const z=24-i;
        for(const side of [-1,1]) positions.push(routeX(z)+offset+width*.5*side,y,z);
        if(i<220){const n=i*2; indices.push(n,n+1,n+2,n+1,n+3,n+2);}
      }
      const geometry=keep(new THREE.BufferGeometry());
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      geometry.setIndex(indices); geometry.computeVertexNormals();
      const road = mesh(geometry,material); road.castShadow=false; return road;
    }
    ribbon(8,.02,mat('#b0a276'));
    ribbon(6.4,.12,clay);
    ribbon(.09,.16,cream,-2.9); ribbon(.09,.16,cream,2.9);
    for(let z=20;z>-185;z-=5) box(scene,cream,[routeX(z),.17,z],[.07,.02,1.7]);
    // Deterministic instancing keeps the scene compact and repeatable.
    let seed=71;
    const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    const trees=168;
    const trunks=new THREE.InstancedMesh(cube,bark,trees);
    const crowns=new THREE.InstancedMesh(cone,mat('#355a43'),trees*2);
    trunks.castShadow=trunks.receiveShadow=crowns.castShadow=crowns.receiveShadow=true;
    scene.add(trunks,crowns); keep(trunks); keep(crowns);
    const dummy=new THREE.Object3D();
    for(let i=0;i<trees;i++){
      const z=23-random()*220, x=routeX(z)+(i%2?1:-1)*(8+random()*34), height=3+random()*8;
      dummy.position.set(x,height*.3,z); dummy.scale.set(.24,height*.6,.24); dummy.rotation.set(0,0,0); dummy.updateMatrix(); trunks.setMatrixAt(i,dummy.matrix);
      for(let j=0;j<2;j++){
        dummy.position.set(x,height*(.58+j*.22),z); dummy.scale.set(height*(.3-j*.06),height*.65,height*(.3-j*.06)); dummy.rotation.y=random()*3; dummy.updateMatrix();
        crowns.setMatrixAt(i*2+j,dummy.matrix); crowns.setColorAt(i*2+j,new THREE.Color().setHSL(.28+random()*.08,.23,.18+random()*.14));
      }
    }
    const rocks=new THREE.InstancedMesh(sphere,mat('#929279'),100); rocks.castShadow=rocks.receiveShadow=true; scene.add(rocks); keep(rocks);
    for(let i=0;i<100;i++){const z=15-random()*205; dummy.position.set(routeX(z)+(i%2?1:-1)*(4+random()*6),.05,z); dummy.scale.set(.15+random()*.65,.1+random()*.3,.2+random()*.6); dummy.updateMatrix(); rocks.setMatrixAt(i,dummy.matrix);}
    // Distant mountain silhouettes and a few quiet city blocks.
    for(let i=0;i<18;i++){
      const peak=mesh(cone,mat(i%2?'#7d927c':'#91a08a'),scene,[(i-9)*23,8+random()*8,-208-random()*28],[20+random()*22,25+random()*30,20]);
      peak.rotation.y=random()*Math.PI;
    }
    for(let i=0;i<15;i++){const h=4+random()*12;box(scene,mat(i%2?'#d2c4a7':'#8b9c85'),[38+random()*18,h/2,-55-i*4],[3+random()*3,h,3+random()*2]);}
    const sunDisc=mesh(keep(new THREE.SphereGeometry(7,24,16)),keep(new THREE.MeshBasicMaterial({color:'#ffe9ac'})),scene,[-45,54,-193]);

    function arch(z, title, finish=false) {
      const group=new THREE.Group(); group.position.set(routeX(z),0,z);scene.add(group);
      box(group,dark,[-4,3,0],[.42,6,.5]);box(group,dark,[4,3,0],[.42,6,.5]);box(group,dark,[0,5.9,0],[8.4,.95,.6]);
      const banner=textPlane(title,7.6,.65); banner.position.set(0,5.9,.32);group.add(banner);
      for(const side of [-1,1]){
        box(group,orange,[side*4,1.9,.28],[.46,1.7,.08]);
        box(group,dark,[side*5,.2,0],[1,.4,2]);
      }
      for(let i=0;i<12;i++)for(let j=0;j<2;j++)box(group,(i+j)%2?dark:cream,[-2.75+i*.5,.17,j*.5-.3],[.5,.03,.5]);
      if(finish) return group;
    }
    arch(2,'RUNFURTHER / START');
    const finish=arch(-149,'YOU WENT FURTHER',true);
    const tape=new THREE.Group(); tape.position.y=1.5; finish.add(tape);
    const halves=[];
    for(const side of [-1,1]){
      const half=new THREE.Group();half.position.x=side*3.2;tape.add(half);
      box(half,orange,[-side*1.6,0,0],[3.2,.26,.025]); halves.push(half);
    }
    // Kilometer boards and water checkpoint.
    for(const [z,label] of [[-33,'05 KM'],[-72,'21 KM'],[-120,'42 KM']]){
      const x=routeX(z)+5;
      box(scene,dark,[x,1.4,z],[.13,2.8,.13]);
      const sign=textPlane(label,2.2,.65); sign.position.set(x,2.6,z);scene.add(sign);
    }
    const station=new THREE.Group();station.position.set(12,0,-36);scene.add(station);
    box(station,dark,[0,1.1,0],[4,.18,1.3]);
    for(const x of [-1.6,1.6])box(station,dark,[x,.55,0],[.15,1.1,1]);
    for(let i=0;i<9;i++)mesh(keep(new THREE.CylinderGeometry(.09,.07,.25,8)),cream,station,[-1.5+i*.36,1.31,0]);
    for(const x of [-2.6,2.6])box(station,cream,[x,2,0],[.1,4,.1]);
    const awning=mesh(keep(new THREE.CylinderGeometry(0,3.8,1.2,4)),orange,station,[0,4,0],[1,1,.7]);awning.rotation.y=Math.PI/4;
    const info=textPlane('YOUR NEXT CHAPTER',4.5,.7);info.position.set(0,3.1,.2);station.add(info);

    // Race kit: hollow box, hinged lid and a shirt. The medal is awarded only
    // to the runner after the finish, never inside the race-kit display.
    const kit=new THREE.Group();kit.position.set(1.5,.05,-103);scene.add(kit);
    mesh(keep(new THREE.CylinderGeometry(2.3,2.5,.35,64)),mat('#c6b799'),kit,[0,.15,0]);
    const packageMat=mat('#d77743'), inner=mat('#c49967');
    box(kit,inner,[0,.46,0],[3.1,.15,2.35]);
    box(kit,packageMat,[0,.96,-1.12],[3.1,1,.12]);
    box(kit,packageMat,[0,.96,1.12],[3.1,1,.12]);
    box(kit,packageMat,[-1.49,.96,0],[.12,1,2.2]);box(kit,packageMat,[1.49,.96,0],[.12,1,2.2]);
    const logo=textPlane('RUNFURTHER',2.4,.38,'#fbeccf','#d77743'); logo.position.set(0,.98,1.19);kit.add(logo);
    const lid=new THREE.Group();lid.position.set(0,1.49,-1.18);kit.add(lid);
    box(lid,packageMat,[0,0,1.18],[3.22,.16,2.48]);
    const lidLogo=textPlane('GO FURTHER.',2.6,.6,'#fbeccf','#d77743');lidLogo.position.set(0,.086,1.18);lidLogo.rotation.x=-Math.PI/2;lid.add(lidLogo);
    const products=new THREE.Group();products.position.y=.7;kit.add(products);
    const shirt=new THREE.Group();products.add(shirt);
    const shape=new THREE.Shape();
    const outline=[[-.54,-.78],[.54,-.78],[.54,.4],[.85,.17],[1.12,.65],[.56,1.03],[.27,1.12],[-.27,1.12],[-.56,1.03],[-1.12,.65],[-.85,.17],[-.54,.4]];
    outline.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();
    const neck=new THREE.Path();neck.absellipse(0,.96,.22,.18,0,Math.PI*2,true);shape.holes.push(neck);
    const shirtGeo=keep(new THREE.ExtrudeGeometry(shape,{depth:.11,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.045,bevelThickness:.04}));
    const fabric = keep(new THREE.MeshPhysicalMaterial({ color: '#f0e5ca', roughness: .93, metalness: 0, sheen: .35, sheenColor: '#fff1d9', sheenRoughness: .85 }));
    mesh(shirtGeo,fabric,shirt);
    const bib=textPlane('01',.6,.4,'#203e32','#fff7de');bib.position.set(0,-.15,.16);shirt.add(bib);
    box(shirt,orange,[0,.22,.14],[.9,.09,.025]);
    // A single Points draw call for fine, slowly drifting pollen.
    const particlePositions=new Float32Array(180*3);
    for(let i=0;i<180;i++){particlePositions[i*3]=(random()-.5)*34;particlePositions[i*3+1]=random()*13;particlePositions[i*3+2]=14-random()*190;}
    const particleGeometry=keep(new THREE.BufferGeometry());particleGeometry.setAttribute('position',new THREE.BufferAttribute(particlePositions,3));
    const particles=new THREE.Points(particleGeometry,keep(new THREE.PointsMaterial({color:'#fff0c7',size:.075,transparent:true,opacity:.55,depthWrite:false})));scene.add(particles);
    const mapLabels=new THREE.Group(); scene.add(mapLabels);
    for(const [z,label] of [[2,'START'],[-33,'05 KM'],[-72,'21 KM'],[-120,'42 KM'],[-149,'FINISH']]) {
      const sign=textPlane(label,10,2.8); sign.position.set(routeX(z)+11,.25,z); sign.rotation.x=-Math.PI/2;mapLabels.add(sign);
    }
    const look=new THREE.Vector3();
    const cameraPath=createRaceCameraPath();
    const shadowCenter=new THREE.Vector3();
    const sunOffset=new THREE.Vector3(-45,85,35);
    let shadowSpan=0, previousPose='';
    host.appendChild(renderer.domElement);
    function resize(){
      const width=host.clientWidth, height=host.clientHeight;
      if(!width||!height)return;
      renderer.setSize(width,height,false);
      camera.aspect=width/height;
      // Reserve readable negative space for HTML copy without covering the subject.
      camera.setViewOffset(width,height,width<700?0:-width*.21,width<700?height*.20:0,width,height);
      camera.updateProjectionMatrix();
      renderer.shadowMap.needsUpdate=true;
    }
    resize();
    return {
      resize, dispose, cameraStops: cameraPath.cameraStops,
      render(state,time){
        if(disposed)return;
        const progress=THREE.MathUtils.clamp(state.progress||0,0,1);
        const action=THREE.MathUtils.clamp(state.actionProgress||0,0,1);
        const moving=THREE.MathUtils.clamp(state.running||0,0,1);
        const pose=cameraPath.sample(progress,camera.position,look);
        runner.group.position.copy(pose.actorPosition);
        runner.group.rotation.y=Math.atan2(-pose.forward.x,-pose.forward.z)+(moving>.05&&state.travelDirection<0?Math.PI:0);
        runner.group.visible=pose.actorVisible;
        // Stop actions are separate from travel: wheel/keyboard input drives a
        // chapter journey, then the actor has time to drink or collect the kit.
        const drinking=state.actionIndex===1&&!moving
          ? smooth(action/.25)*(1-smooth((action-.7)/.3)):0;
        const receivedKit=progress>=.709
          ? (state.kitCollected?1:state.actionIndex===3&&!moving?smooth(action):0):0;
        const awardedMedal=progress>=.999
          ? (state.medalAwarded?1:state.actionIndex===4&&!moving?smooth((action-.12)/.42):0):0;
        const celebrate=state.actionIndex===4&&!moving?smooth((action-.45)/.35):state.medalAwarded&&progress>=.999?1:0;
        runner.update({gait:state.gait||0,run:moving,drink:drinking,receiveKit:receivedKit,medal:awardedMedal,celebrate});
        camera.lookAt(look);
        mapLabels.visible=camera.position.y>24;
        // Keep useful shadow texel density near the runner, widening smoothly
        // only for the overhead map. The sun direction stays constant.
        const overhead=smooth((camera.position.y-12)/40);
        shadowCenter.copy(look).sub(camera.position).normalize().multiplyScalar(12).add(camera.position).lerp(look,overhead);shadowCenter.y=0;
        sun.target.position.copy(shadowCenter);sun.position.copy(shadowCenter).add(sunOffset);
        const span=32+overhead*90;
        if(Math.abs(span-shadowSpan)>.001){
          const shadowCamera=sun.shadow.camera;
          shadowCamera.left=shadowCamera.bottom=-span;shadowCamera.right=shadowCamera.top=span;
          shadowCamera.updateProjectionMatrix();shadowSpan=span;
        }
        const nextPose=[progress,moving,state.gait||0,action,state.actionIndex,receivedKit,awardedMedal].join(':');
        if(nextPose!==previousPose){
          renderer.shadowMap.needsUpdate=true;
          previousPose=nextPose;
        }
        const opening=progress<.65?0:progress<.709?smooth((progress-.65)/.06)*.18
          :state.actionIndex===3&&!moving?Math.max(.18,smooth(action/.45)):state.kitCollected?1:.18;
        lid.rotation.x=-opening*Math.PI*.64;
        const collect=smooth((receivedKit-.45)/.4);
        products.visible=opening>.02&&collect<.99;
        products.position.y=.72+smooth(opening)*2.1;
        const size=(.3+.7*smooth(opening))*(1-collect);products.scale.setScalar(size);
        shirt.position.set(0,.35,collect*1.8);shirt.rotation.y=action*Math.PI*2;
        const finishProgress=smooth((progress-.969)/.02);
        halves[0].rotation.y=-finishProgress*1.2;halves[1].rotation.y=finishProgress*1.2;
        halves.forEach((half,i)=>{half.position.y=finishProgress*(i?.3:-.2);half.rotation.z=(i?1:-1)*finishProgress*.3;});
        particles.position.x=Math.sin(time*.12)*.4;particles.position.y=Math.sin(time*.2)*.2;
        sunDisc.rotation.y=time*.002;
        renderer.render(scene,camera);
      },
    };
  } catch(error) {
    dispose(); throw error;
  }
}
