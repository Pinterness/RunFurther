const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let release;
    const ready = new Promise(resolve => { release = resolve; });
    await page.route('**/api/events?limit=3', async route => { await ready; await route.fulfill({ json: { events: [0,1,2].map(i => ({ _id: String(i), slug: 'motion-' + i, name: 'Giải kiểm thử ' + i, categories: ['5K'], location: { city: 'Đà Lạt' } })) } }); });
    await page.goto(process.env.WEB_TEST_URL || 'http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.journey-panel')).toHaveClass(/will-reveal/);
    await expect(page.locator('.journey-panel')).not.toHaveClass(/is-visible/);
    release();
    await expect(page.locator('.landing-event-card')).toHaveCount(3);
    await expect(page.locator('.event-carousel').locator('..')).toHaveClass(/will-reveal/);
    const initialFog = await page.locator('.hero-scroll-mist').evaluate(node => Number(getComputedStyle(node).opacity));
    await page.evaluate(() => scrollTo({ top: 450, behavior: 'instant' }));
    await expect.poll(() => page.locator('.hero-scroll-mist').evaluate(node => Number(getComputedStyle(node).opacity))).toBeLessThan(initialFog);
    await page.locator('.journey-grid').scrollIntoViewIfNeeded();
    await expect(page.locator('.journey-panel')).toHaveClass(/is-visible/);
    await expect.poll(() => page.locator('.journey-panel').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
    await expect.poll(() => page.locator('.journey-panel').evaluate(node => getComputedStyle(node).filter)).toBe('blur(0px)');
    await page.locator('.landing-cta a').first().focus();
    await expect(page.locator('.landing-cta')).toHaveClass(/is-visible/);
    await expect(page.locator('.landing-cta')).not.toHaveClass(/will-reveal/);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.will-reveal')).toHaveCount(0);
    await expect(page.locator('.hero-scroll-mist')).not.toBeVisible();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(page.locator('.journey-panel')).toHaveClass(/is-visible/);
    // Let the live media listener settle before issuing another scroll.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => { document.activeElement?.blur(); scrollTo({ top: 0, behavior: 'instant' }); });
    await expect.poll(() => page.locator('.hero-scroll-mist').evaluate(node => Number(getComputedStyle(node).opacity))).toBe(initialFog);
    assert.deepEqual(errors, []);
    const noJS = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await noJS.newPage();
    await staticPage.goto(process.env.WEB_TEST_URL || 'http://localhost:3000');
    await expect(staticPage.locator('.journey-panel')).toBeVisible();
    assert.equal(await staticPage.locator('.journey-panel').evaluate(node => getComputedStyle(node).opacity), '1');
    await noJS.close();
    console.log('PASS: scroll mist, directional reveal, async carousel reveal, keyboard focus, live reduced-motion toggle, reveal once and no-JS visibility.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
