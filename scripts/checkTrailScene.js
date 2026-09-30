const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const sharp = require('sharp');
const base = process.env.WEB_TEST_URL || 'http://localhost:3000';
(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:'chrome' }), headless:true });
  try {
    fs.mkdirSync('artifacts',{recursive:true});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[]; page.on('pageerror', error=>errors.push(error.message));
    await page.route('**/api/events?limit=3', route=>route.fulfill({json:{events:[]}}));
    await page.goto(base,{waitUntil:'networkidle'});
    const scene=page.locator('.immersive-journey'), stage=page.locator('.immersive-stage');
    await expect(scene).toHaveAttribute('data-enhanced','true',{timeout:20000});
    await expect(page.locator('.immersive-canvas canvas')).toHaveCount(1);
    const spacers=page.locator('.pin-spacer');
    const progress=()=>scene.evaluate(node=>+node.style.getPropertyValue('--journey-progress'));
    const stops=[0,.25,.47,.71,1];
    const controls=page.locator('.immersive-controls nav button');
    const checkRunway=async()=>{
      await expect(spacers).toHaveCount(1);
      await expect.poll(()=>scene.evaluate(node=>Number(node.dataset.scrollEnd)-Number(node.dataset.scrollStart))).toBeCloseTo(6000,2);
    };
    const checkPinned=async()=>{
      await expect.poll(async()=>{
        const stageBox=await stage.boundingBox(), headerBox=await page.locator('.app-header').boundingBox();
        return Math.abs(stageBox.y-(headerBox.y+headerBox.height));
      }).toBeLessThan(2);
    };
    await checkRunway();
    const arrived=async phase=>{
      await expect(scene).toHaveAttribute('data-chapter',String(phase),{timeout:15000});
      await expect(scene).toHaveAttribute('data-activity','idle',{timeout:15000});
      await expect.poll(progress).toBeCloseTo(stops[phase],2);
      await expect.poll(()=>page.locator('.immersive-chapter').nth(phase).evaluate(node=>getComputedStyle(node).opacity)).toBe('1');
      await checkPinned();
    };
    const go=async (_,phase)=>{await controls.nth(phase).click();await arrived(phase);};
    await arrived(0);
    assert.deepEqual(await controls.locator('span:first-child').allTextContents(),['01','02','03','04','05']);
    // Capture the actual GPU scene separately from the changing HTML captions.
    const canvas=page.locator('.immersive-canvas canvas');
    const first=await canvas.screenshot();
    const stats=await sharp(first).stats();
    assert.ok(stats.channels.some(channel=>channel.stdev>15),'WebGL rendered a scene, not a blank canvas');
    await checkPinned();
    // One wheel gesture launches one whole leg; input during travel must not queue skipped stops.
    await page.mouse.move(1120,350);
    await page.mouse.wheel(0,500);
    await expect(scene).toHaveAttribute('data-activity','running');
    for(let i=0;i<6;i++){await page.mouse.wheel(0,120);await page.waitForTimeout(25);}
    await expect(scene).toHaveAttribute('data-activity','drinking',{timeout:15000});
    await arrived(1);
    await page.waitForTimeout(800);
    await expect(scene).toHaveAttribute('data-chapter','1');
    await checkPinned();
    await expect(page.locator('.immersive-chapter-0')).toHaveAttribute('inert','');
    await expect(page.locator('.immersive-chapter-1')).not.toHaveAttribute('inert','');
    const second=await canvas.screenshot();
    assert.ok(!first.equals(second),'Scroll changes the rendered 3D world');
    for(const [phase,activity] of [[2,'running'],[3,'receiving-kit'],[4,'medal']]) {
      await page.waitForTimeout(800);
      await page.mouse.wheel(0,500);
      await expect(scene).toHaveAttribute('data-activity',activity,{timeout:15000});
      await arrived(phase);
      await checkPinned();
      await page.screenshot({path:'artifacts/immersive-3d-desktop-'+phase+'.png'});
    }
    assert.equal(await page.locator('.immersive-chapter-4 .action-primary').getAttribute('href'),'/register');
    await page.waitForTimeout(800);
    await page.mouse.wheel(0,-500);
    await expect(scene).toHaveAttribute('data-activity','running');
    await arrived(3);
    await page.locator('.immersive-controls nav button').nth(2).focus();
    await page.keyboard.press('Enter');
    await arrived(2);
    await go(0,0);
    await page.screenshot({path:'artifacts/immersive-3d-desktop-0.png'});
    const distanceTrigger=page.locator('.immersive-panel-trigger[data-panel="distance"]:visible').first();
    await distanceTrigger.click();
    await expect(page.locator('.immersive-panel-dialog')).toHaveAttribute('data-open','distance');
    await expect(page.locator('#your-distance')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.immersive-panel-dialog')).toBeHidden();
    await expect(distanceTrigger).toBeFocused();
    await go(.71,3);
    await page.locator('.immersive-motion-toggle').click();
    await expect(scene).toHaveAttribute('data-enhanced','false');
    await expect(spacers).toHaveCount(0);
    await expect(canvas).toHaveCount(0);
    await expect(page.locator('.immersive-chapter[inert]')).toHaveCount(0);
    for(const selector of ['#your-distance','.landing-events','#how-it-works','#questions'])await expect(page.locator(selector)).toBeVisible();
    await page.locator('.immersive-motion-toggle').click();
    await expect(scene).toHaveAttribute('data-enhanced','true');
    await expect(canvas).toHaveCount(1);
    await checkRunway();
    for(const width of [1440,1024,768,390,360]){
      await go(.47,2);
      await page.setViewportSize({width,height:844});
      // ResizeObserver/ScrollTrigger refresh the runway before seeking.
      await page.waitForTimeout(350);
      await expect.poll(async()=>Math.abs(await progress()-.47)).toBeLessThan(.02);
      await checkRunway();
      await checkPinned();
      for(const [progress,phase] of [[0,0],[.71,3],[1,4]]){
        await go(progress,phase);
        await checkPinned();
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Overflow at '+width);
        const copy=await page.locator('.immersive-chapter-'+phase+' .immersive-copy').boundingBox();
        const controls=await page.locator('.immersive-controls').boundingBox();
        assert.ok(copy.y>=68,'Copy under the header at '+width);
        assert.ok(copy.y+copy.height<=controls.y+2,'Copy overlaps navigation at '+width);
      }
    }
    await go(.71,3);
    await page.screenshot({path:'artifacts/immersive-3d-mobile.png'});
    await page.setViewportSize({width:360,height:667});
    await page.waitForTimeout(350);
    await go(.71,3);
    const compactCopy=await page.locator('.immersive-chapter-3 .immersive-copy').boundingBox();
    const compactControls=await page.locator('.immersive-controls').boundingBox();
    assert.ok(compactCopy.y>=68 && compactCopy.y+compactCopy.height<=compactControls.y+2,'Compact phone content fits');
    await page.setViewportSize({width:844,height:390});
    await expect(scene).toHaveAttribute('data-enhanced','false');
    await expect(canvas).toHaveCount(0);
    await expect(spacers).toHaveCount(0);
    await page.setViewportSize({width:390,height:844});
    await expect(scene).toHaveAttribute('data-enhanced','true');
    await checkRunway();
    await page.emulateMedia({reducedMotion:'reduce'});
    await expect(scene).toHaveAttribute('data-enhanced','false');
    await expect(canvas).toHaveCount(0);
    await expect(spacers).toHaveCount(0);
    await expect(page.locator('.immersive-chapter[inert]')).toHaveCount(0);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await expect(scene).toHaveAttribute('data-enhanced','true');
    await checkRunway();
    // Lost GPU context must release the pinned runway and preserve real links.
    await canvas.evaluate(node=>node.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
    await expect(scene).toHaveAttribute('data-enhanced','false');
    await expect(page.locator('.immersive-fallback-note')).toBeVisible();
    await expect(canvas).toHaveCount(0);
    await expect(spacers).toHaveCount(0);
    await page.goto(base+'/login',{waitUntil:'networkidle'});
    await expect(page.locator('.immersive-stage')).toHaveCount(0);
    await expect(spacers).toHaveCount(0);
    await page.goto(base,{waitUntil:'networkidle'});
    await expect(scene).toHaveAttribute('data-enhanced','true');
    await expect(canvas).toHaveCount(1);
    await checkRunway();
    // Client-side navigation unmounts a live pin; a full reload alone would hide teardown bugs.
    await page.locator('.app-header a[href="/login"]').click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('.immersive-stage')).toHaveCount(0);
    await expect(spacers).toHaveCount(0);
    await page.goBack({waitUntil:'networkidle'});
    await expect(scene).toHaveAttribute('data-enhanced','true');
    await expect(canvas).toHaveCount(1);
    await checkRunway();
    const noGPU=await browser.newContext();
    await noGPU.addInitScript(()=>{
      const original=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/i.test(type)?null:original.call(this,type,...args);};
    });
    const fallback=await noGPU.newPage();
    await fallback.route('**/api/events?limit=3',route=>route.fulfill({json:{events:[]}}));
    await fallback.goto(base,{waitUntil:'networkidle'});
    await expect(fallback.locator('.immersive-fallback-note')).toBeVisible();
    await expect(fallback.locator('.pin-spacer')).toHaveCount(0);
    assert.equal(await fallback.locator('.immersive-stage').evaluate(node=>getComputedStyle(node).position),'relative');
    await expect(fallback.locator('#hero-heading')).toBeVisible();
    await expect(fallback.locator('#your-distance')).toBeVisible();
    await noGPU.close();
    const noJS=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
    const staticPage=await noJS.newPage();await staticPage.goto(base);
    await expect(staticPage.locator('.immersive-chapter')).toHaveCount(5);
    await expect(staticPage.locator('.pin-spacer')).toHaveCount(0);
    await expect(staticPage.locator('.immersive-chapter[inert]')).toHaveCount(0);
    await expect(staticPage.locator('.immersive-chapter-4 a').first()).toHaveAttribute('href','/register');
    for(const selector of ['#your-distance','#how-it-works','#questions'])await expect(staticPage.locator(selector)).toBeVisible();
    assert.equal(await staticPage.locator('.immersive-stage').evaluate(node=>getComputedStyle(node).position),'relative');
    await noJS.close();
    assert.deepEqual(errors,[]);
    console.log('PASS: nonblank 3D, 6000px pin, one gesture per checkpoint, busy-input gating, drink/kit/medal actions, reverse/keyboard navigation, panels, resize continuity, responsive copy at 5 widths, fallback and client-navigation cleanup.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
