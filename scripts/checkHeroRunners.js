const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.WEB_TEST_URL || 'http://localhost:3000';
(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    fs.mkdirSync('artifacts', { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/events?limit=3', route => route.fulfill({ json: { events: [] } }));
    await page.goto(base, { waitUntil: 'networkidle' });
    const orange = page.locator('.athlete-clay'), green = page.locator('.athlete-sage');
    await expect(page.locator('.hero-athlete')).toHaveCount(2);
    const state = locator => locator.locator('.athlete-leg-front').evaluate(node => getComputedStyle(node).animationPlayState);
    assert.equal(await state(orange), 'paused'); assert.equal(await state(green), 'paused');
    await orange.hover();
    assert.equal(await state(orange), 'running'); assert.equal(await state(green), 'paused');
    const first = await orange.locator('.athlete-leg-front').evaluate(node => getComputedStyle(node).transform);
    await page.waitForTimeout(180);
    assert.notEqual(await orange.locator('.athlete-leg-front').evaluate(node => getComputedStyle(node).transform), first);
    await green.hover();
    assert.equal(await state(orange), 'paused'); assert.equal(await state(green), 'running');
    await page.mouse.move(0, 0);
    assert.equal(await state(green), 'paused');
    await orange.focus(); await page.keyboard.press('Enter');
    await expect(orange).toHaveAttribute('aria-pressed', 'true');
    assert.equal(await state(orange), 'running');
    await page.keyboard.press('Escape');
    await expect(orange).toHaveAttribute('aria-pressed', 'false');
    assert.equal(await state(orange), 'paused');
    await page.evaluate(() => document.activeElement.blur());
    const jointErrors = await page.locator('.hero-athletes').evaluate(root => {
      const animations = root.getAnimations({ subtree: true });
      const saved = animations.map(animation => ({ animation, time: animation.currentTime, state: animation.playState }));
      const errors = [];
      try {
        animations.forEach(animation => animation.pause());
        // Sample the complete gait, including maximum flexion and both leg crossings.
        for (let time = 0; time <= 800; time += 40) {
          animations.forEach(animation => { animation.currentTime = time; });
          for (const joint of root.querySelectorAll('.athlete-hip-socket, .athlete-knee-socket')) {
            const socket = new DOMPoint(0, 0).matrixTransform(joint.getScreenCTM());
            const limb = new DOMPoint(0, 0).matrixTransform(joint.firstElementChild.getScreenCTM());
            if (Math.hypot(socket.x - limb.x, socket.y - limb.y) > .01) errors.push('Detached joint at ' + time);
          }
          for (const shin of root.querySelectorAll('.athlete-shin')) {
            const matrix = new DOMMatrix(getComputedStyle(shin).transform);
            const angle = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
            if (angle < -1 || angle > 111) errors.push('Knee bending backwards at ' + time);
          }
        }
      } finally {
        saved.forEach(({ animation, time, state }) => { animation.currentTime = time; if (state === 'running') animation.play(); });
      }
      return errors;
    });
    assert.deepEqual(jointErrors, [], 'Hip/knee continuity over the complete gait');
    await page.locator('.landing-hero').screenshot({ path: 'artifacts/hero-runners-desktop.png' });
    for (const width of [1868,1440,1024,768,700,390,360]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Overflow at ' + width);
      const copy = await page.locator('.hero-copy').boundingBox(), art = await page.locator('.hero-runners').boundingBox();
      assert.ok(copy.x + copy.width <= art.x + 1 || copy.y + copy.height <= art.y + 1, 'Runners overlap hero copy at ' + width);
      await expect(page.locator('.hero-actions .action-primary')).toBeVisible();
    }
    await page.locator('.landing-hero').screenshot({ path: 'artifacts/hero-runners-mobile.png' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await orange.hover();
    assert.equal(await orange.locator('.athlete-leg-front').evaluate(node => getComputedStyle(node).animationName), 'none');
    await expect(page.locator('.runner-help-reduced')).toBeVisible();
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const touchPage = await mobile.newPage();
    await touchPage.route('**/api/events?limit=3', route => route.fulfill({ json: { events: [] } }));
    await touchPage.goto(base, { waitUntil: 'networkidle' });
    const touchRunner = touchPage.locator('.athlete-clay');
    await touchRunner.tap(); await expect(touchRunner).toHaveAttribute('aria-pressed', 'true');
    assert.equal(await state(touchRunner), 'running');
    await touchRunner.tap(); await expect(touchRunner).toHaveAttribute('aria-pressed', 'false');
    assert.equal(await state(touchRunner), 'paused');
    await expect(touchPage.locator('.runner-help-touch')).toBeVisible();
    await mobile.close();
    assert.deepEqual(errors, []);
    console.log('PASS: hip/knee continuity across 21 gait samples, correct knee flexion, independent hover, keyboard/touch, reduced motion, 7 viewport widths and no copy/CTA overlap.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
