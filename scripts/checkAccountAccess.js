const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const base = process.env.WEB_TEST_URL || 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let status = null, unavailable = false, holdNext = false, release;
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/notifications') return route.fulfill({ json: { notifications: [] } });
      if (path === '/api/admin/organizer-access') {
        const application = status ? { status } : null;
        if (holdNext) { holdNext = false; await new Promise(resolve => { release = resolve; }); }
        return route.fulfill({ status: unavailable ? 503 : 200, json: { application } }).catch(() => {});
      }
      return route.fulfill({ status: 404, json: { message: 'Unexpected fixture route' } });
    });
    await page.goto(base + '/lookup', { waitUntil: 'networkidle' });
    const menu = page.locator('#account-dropdown');
    const organizer = menu.locator('a[href="/organizer"]');
    const platform = menu.locator('a[href="/admin"]');
    async function signIn(id, role = 'RUNNER') {
      await page.evaluate(({ id, role }) => {
        localStorage.setItem('rf_token', 'fixture-' + id);
        // Deliberately stale/fabricated organizer data must not grant navigation.
        localStorage.setItem('rf_user', JSON.stringify({ id, fullName: 'Runner ' + id, systemRole: role, organizerApproved: true }));
        window.dispatchEvent(new Event('rf-auth'));
      }, { id, role });
    }
    async function openMenu() {
      await Promise.all([
        page.waitForResponse('**/api/admin/organizer-access'),
        page.locator('.account-trigger').click(),
      ]);
      await expect(menu).toBeVisible();
    }
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const value of [null, 'PENDING', 'REJECTED', 'APPROVED']) {
        status = value;
        await signIn('runner-' + value);
        await openMenu();
        await expect(menu.locator('a[href="/account"]')).toBeVisible();
        await expect(menu.locator('a[href="/account/wallet"]')).toBeVisible();
        await expect(platform).toHaveCount(0);
        if (value === 'APPROVED') await expect(organizer).toBeVisible();
        else await expect(organizer).toHaveCount(0);
        await page.keyboard.press('Escape');
      }
    }
    await signIn('moderator', 'SUPER_ADMIN');
    await page.locator('.account-trigger').click();
    await expect(platform).toBeVisible(); await expect(organizer).toHaveCount(0);
    await page.keyboard.press('Escape');
    status = 'APPROVED'; unavailable = true;
    await signIn('offline'); await openMenu(); await expect(organizer).toHaveCount(0);
    await page.keyboard.press('Escape'); unavailable = false;

    // A late approval response for a previous session must not leak into this one.
    await signIn('old-owner'); holdNext = true;
    await page.locator('.account-trigger').click();
    await expect.poll(() => Boolean(release)).toBe(true);
    await expect(organizer).toHaveCount(0);
    status = null;
    await Promise.all([page.waitForResponse('**/api/admin/organizer-access'), signIn('ordinary')]);
    release();
    await page.waitForTimeout(150);
    await expect(organizer).toHaveCount(0); await expect(platform).toHaveCount(0);
    await menu.locator('button').click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('.account-trigger')).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log('PASS: runner/pending/rejected hide organizer controls; approved organizer and Super Admin have distinct menus; desktop/mobile, unavailable API, stale cached role, account switch during loading and logout. API fixtures only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
