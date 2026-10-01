const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.WEB_TEST_URL || 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /THREE|WebGL|Shader/.test(message.text())) errors.push(message.text()); });
    await page.route('**/api/**', route => route.fulfill({ json: { events: [], notifications: [] } }));
    await page.goto(base, { waitUntil: 'networkidle' });
    const host = page.locator('.immersive-canvas'), scene = page.locator('.immersive-journey');
    await expect(host).toHaveAttribute('data-character', 'glb', { timeout: 20000 });
    fs.mkdirSync('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/cinematic-start.png' });
    for (const [station, activity, filename] of [[1, 'drinking', 'water'], [3, 'receiving-kit', 'kit'], [4, 'medal', 'finish']]) {
      await page.locator('.immersive-controls nav button').nth(station).click();
      await expect(scene).toHaveAttribute('data-activity', activity, { timeout: 15000 });
      await page.waitForTimeout(station === 1 ? 900 : 750);
      await page.screenshot({ path: 'artifacts/cinematic-' + filename + '-action.png' });
      await expect(scene).toHaveAttribute('data-activity', 'idle', { timeout: 10000 });
    }
    for (const width of [1440, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(400);
      await expect(host).toHaveAttribute('data-character', 'glb');
      await expect(scene).toHaveAttribute('data-chapter', '4');
      await expect.poll(() => scene.evaluate(node => Number(node.style.getPropertyValue('--journey-progress')))).toBeCloseTo(1, 3);
      await expect.poll(() => page.locator('.immersive-chapter-4').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    await page.screenshot({ path: 'artifacts/cinematic-finish-mobile.png' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(host.locator('canvas')).toHaveCount(0); await expect(page.locator('.pin-spacer')).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(host).toHaveAttribute('data-character', 'glb', { timeout: 15000 });
    await expect(host.locator('canvas')).toHaveCount(1); await expect(page.locator('.pin-spacer')).toHaveCount(1);
    await page.route('**/assets/models/runner-casual.glb', route => route.fulfill({ status: 503, body: '' }));
    await page.reload({ waitUntil: 'networkidle' });
    await expect(host).toHaveAttribute('data-character', 'fallback', { timeout: 15000 });
    await expect(scene).toHaveAttribute('data-enhanced', 'true');
    await page.locator('.immersive-controls nav button').nth(1).click();
    await expect(scene).toHaveAttribute('data-chapter', '1', { timeout: 15000 });
    await expect(scene).toHaveAttribute('data-activity', 'idle', { timeout: 15000 });
    await page.unroute('**/assets/models/runner-casual.glb');
    let release, requested = false;
    await page.route('**/assets/models/runner-casual.glb', async route => {
      requested = true; await new Promise(done => { release = done; });
      await route.fulfill({ contentType: 'model/gltf-binary', body: fs.readFileSync('public/assets/models/runner-casual.glb') }).catch(() => {});
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => requested).toBe(true);
    await page.locator('.header-login').click(); await expect(page).toHaveURL(/\/login$/);
    release();
    await expect(page.locator('.immersive-canvas canvas')).toHaveCount(0);
    await expect(page.locator('.pin-spacer')).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log('PASS: local GLB, water/kit/medal poses, 4 viewport widths, reduced motion, missing-model fallback and navigation during asset loading; no shader/page errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
