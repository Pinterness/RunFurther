const { spawn } = require('node:child_process');
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fixtureApi = 'https://runfurther-deployment-check.example/api';
const base = 'http://localhost:3101';

(async () => {
  // Run after building with NEXT_PUBLIC_API_URL=fixtureApi. This is never a deploy.
  const server = spawn(process.execPath, [path.resolve('node_modules/next/dist/bin/next'), 'start', '--port', '3101'], {
    env: { ...process.env, NEXT_PUBLIC_API_URL: fixtureApi }, stdio: 'ignore', windowsHide: true,
  });
  let browser;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (server.exitCode !== null) throw new Error('Temporary preview server exited; check port 3101.');
      try { if ((await fetch(base + '/login')).ok) { ready = true; break; } } catch { /* wait for owned preview */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'Preview server did not start.');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage(); const errors = [], hosts = new Set(); let attempts = 0;
    page.on('pageerror', error => errors.push(error.message));
    const user = { id: 'deployment-user', fullName: 'Deployment Fixture', email: 'fixture@test.local', createdAt: '2026-01-01', systemRole: 'RUNNER' };
    await page.route('**/api/**', route => {
      const request = route.request(), url = new URL(request.url()); hosts.add(url.origin);
      const reply = json => route.fulfill({ json });
      if (url.pathname === '/api/auth/login') {
        attempts++;
        if (attempts === 1) return route.fulfill({ status: 503, contentType: 'text/html', body: '<html>Service starting</html>' });
        return reply({ user, token: 'fixture' });
      }
      if (url.pathname === '/api/auth/me') return reply({ user, profile: { club: '' } });
      if (url.pathname === '/api/registrations/me') return reply({ registrations: [] });
      if (url.pathname === '/api/bookings/me') return reply({ bookings: [] });
      if (url.pathname === '/api/wallet') return reply({ wallet: { balance: 0 }, runPoints: { balance: 0 } });
      if (url.pathname === '/api/registrations/achievements/me') return reply({ achievements: { completedRaces: 0, totalKm: 0 } });
      if (url.pathname === '/api/notifications') return reply({ notifications: [] });
      return route.fulfill({ status: 404, json: { message: 'Unexpected fixture URL' } });
    });
    await page.goto(base + '/login');
    await page.getByLabel('Email', { exact: true }).fill('fixture@test.local');
    await page.getByLabel('Mật khẩu', { exact: true }).fill('fixture-password');
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator('.onboarding-form [role="alert"]')).toContainText('Máy chủ chưa sẵn sàng');
    assert.equal(attempts, 1, 'Mutating requests must not retry silently.');
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL('**/account');
    await expect(page.locator('.runner-identity')).toContainText(user.fullName);
    assert.deepEqual([...hosts], ['https://runfurther-deployment-check.example']);
    assert.deepEqual(errors, []);
    console.log('PASS: production build uses the HTTPS API for login/account/notifications, handles HTML cold-start errors, and never retries writes automatically. No remote writes.');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
