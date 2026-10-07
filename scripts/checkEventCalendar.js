const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const base = process.env.WEB_TEST_URL || 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    const errors = [], requestedPages = [];
    page.on('pageerror', error => errors.push(error.message));
    const events = Array.from({ length: 22 }, (_, i) => ({
      _id: 'calendar-' + i, slug: 'calendar-' + i, name: 'Calendar race ' + (i + 1),
      status: 'REGISTRATION_OPEN', dateInfo: { raceDate: '2030-12-01', registrationStart: '2020-01-01', registrationEnd: '2030-11-01' },
      categories: ['10K'], price: 150000, location: { city: 'Can Tho' },
    }));
    events[3].name = 'Cantho Heritage fixture';
    let failNext = true;
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/events') {
        assert.equal(url.searchParams.get('upcoming'), 'true');
        assert.equal(url.searchParams.get('limit'), '20');
        const index = Number(url.searchParams.get('page')); requestedPages.push(index);
        if (index === 2 && failNext) { failNext = false; return route.fulfill({ status: 503, json: { message: 'Temporary fixture failure' } }); }
        return route.fulfill({ json: { events: events.slice((index - 1) * 20, index * 20), pagination: { page: index, limit: 20, total: events.length, totalPages: Math.ceil(events.length / 20) } } });
      }
      return route.fulfill({ json: { notifications: [] } });
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await expect(page.locator('.immersive-journey')).toHaveAttribute('data-enhanced', 'true', { timeout: 15000 });
    await page.locator('.immersive-panel-trigger[data-panel="events"]').click();
    const calendar = page.locator('.landing-events');
    await expect(calendar.locator('.carousel-slide')).toHaveCount(20);
    await expect(calendar.locator('.landing-calendar-footer')).toContainText('20 / 22');
    await calendar.locator('.carousel-pause').click();
    await calendar.getByRole('button', { name: 'Xem giải 4', exact: true }).click();
    await expect(calendar.locator('.carousel-slide.is-current')).toContainText('Cantho Heritage fixture');
    const more = calendar.getByRole('button', { name: 'Xem thêm giải', exact: true });
    await more.click();
    await expect(calendar.getByRole('alert')).toBeVisible();
    await expect(calendar.locator('.carousel-slide')).toHaveCount(20);
    await calendar.getByRole('button', { name: 'Thử tải lại', exact: true }).click();
    await expect(calendar.locator('.carousel-slide')).toHaveCount(22);
    await expect(calendar.locator('.landing-calendar-footer')).toContainText('22 / 22');
    await expect(more).toHaveCount(0);
    // React Strict Mode can repeat the initial read; pagination must retry page 2.
    assert.deepEqual(requestedPages.filter(page => page !== 1), [2, 2]);
    assert.ok(requestedPages.includes(1));
    await page.setViewportSize({ width: 360, height: 900 });
    await expect(calendar.locator('.carousel-dots button')).toHaveCount(5);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const next = calendar.getByRole('button', { name: 'Giải tiếp theo', exact: true });
    for (let i = 0; i < 18; i++) await next.click();
    await expect(calendar.locator('.carousel-slide.is-current')).toHaveAttribute('aria-label', '22 / 22');
    await next.click();
    await expect(calendar.locator('.carousel-slide.is-current')).toHaveAttribute('aria-label', '1 / 22');

    // A single actual upcoming race is never duplicated to fill the carousel.
    events.splice(1);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.immersive-panel-trigger[data-panel="events"]').click();
    await expect(calendar.locator('.carousel-slide')).toHaveCount(1);
    await expect(calendar.locator('.carousel-controls')).toHaveCount(0);
    events.splice(0);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.immersive-panel-trigger[data-panel="events"]').click();
    await expect(calendar.locator('.events-empty')).toBeVisible();
    await expect(calendar.locator('.carousel-slide')).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log('PASS: live calendar query, fourth race reachable, 22 paginated races, retry keeps loaded cards, mobile controls, wraparound, single-race and empty states. API fixtures only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
