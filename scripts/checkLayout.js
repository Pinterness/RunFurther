const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.WEB_TEST_URL || 'http://localhost:3000';
(async () => {
  fs.mkdirSync('artifacts', { recursive: true });
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#hero-heading').waitFor();
    await page.waitForFunction(() => document.querySelector('.landing-event-grid')?.getAttribute('aria-busy') === 'false');
    assert.equal(new URL(page.url()).pathname, '/');
    assert.equal(await page.locator('.app-header .avatar, .notification-button').count(), 0);
    assert.equal(await page.locator('.header-login').getAttribute('href'), '/login');
    await page.locator('#distance-tab-0').click();
    assert.equal(await page.locator('#distance-tab-0').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#distance-panel a').getAttribute('href'), '/events?distance=5');
    await page.locator('#distance-tab-0').press('ArrowRight');
    assert.equal(await page.locator('#distance-tab-1').getAttribute('aria-selected'), 'true');
    await page.locator('#distance-tab-2').click();
    await page.locator('#journey-tab-1').click();
    assert.equal(await page.locator('#journey-panel a').getAttribute('href'), '/account');
    await page.locator('#journey-tab-0').click();
    await page.locator('.faq-list summary').first().click();
    assert.equal(await page.locator('.faq-list details').first().getAttribute('open'), '');
    await page.locator('.faq-list summary').nth(1).click();
    assert.equal(await page.locator('.faq-list details').first().getAttribute('open'), null);
    await page.locator('.faq-list summary').nth(1).click();
    for (const section of await page.locator('[data-reveal]').all()) { await section.scrollIntoViewIfNeeded(); await page.waitForTimeout(100); }
    await page.evaluate(() => scrollTo(0,0));
    await page.waitForTimeout(850);
    await page.screenshot({ path: 'artifacts/landing-desktop.png', fullPage: true });
    for (const width of [1440, 1024, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Horizontal overflow at ' + width);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const menu = page.getByRole('button', { name: 'Mở menu', exact: true });
    await menu.click();
    assert.equal(await page.locator('#site-navigation').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#site-navigation').isVisible(), false);
    assert.equal(await menu.evaluate(node => node === document.activeElement), true);
    await page.evaluate(() => scrollTo(0,0));
    await page.screenshot({ path: 'artifacts/landing-mobile.png', fullPage: true });
    await page.locator('.header-login').click();
    await page.waitForURL('**/login');
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => { localStorage.setItem('rf_token', 'layout-test-only'); localStorage.setItem('rf_user', JSON.stringify({ fullName: 'Người dùng kiểm thử' })); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.account-trigger').click();
    assert.equal(await page.locator('.account-dropdown').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.account-dropdown').count(), 0);
    await page.locator('.account-trigger').click();
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
    await page.waitForURL('**/login');
    assert.equal(await page.evaluate(() => localStorage.getItem('rf_token')), null);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(base, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('.action-primary').evaluate(node => getComputedStyle(node).transitionDuration), '0s');
    await page.goto(base + '/account', { waitUntil: 'networkidle' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    let allowRetry = false;
    await page.route('**/api/events?limit=3', route => {
      return route.fulfill({ status: allowRetry ? 200 : 503, contentType: 'application/json', body: JSON.stringify(allowRetry ? { events: [] } : { message: 'Unavailable' }) });
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Thử lại', exact: false }).waitFor();
    allowRetry = true;
    await page.getByRole('button', { name: 'Thử lại', exact: false }).click();
    await page.getByRole('heading', { name: 'Hành trình mới sắp bắt đầu.' }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: landing, distance tabs/keyboard, journey tabs, FAQ, login, mobile menu/Escape, account/logout, reduced motion, 5 viewport widths, account regression, API error/retry/empty states.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
