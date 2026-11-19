// Run against a production preview with scripts/uiPolishSsr.cjs preloaded for SSR fixtures.
// Browser requests are intercepted; this check never writes to a real API.
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { respond, userFor } = require('./uiPolishFixtures.cjs');
const base = process.env.WEB_TEST_URL || 'http://localhost:3000';
(async () => {
  const browser = await chromium.launch({ channel:'chrome', headless:true });
  const errors = [], results = [];
  try {
    fs.mkdirSync('artifacts/ui-polish', { recursive:true });
    for (const width of [1440,1024,768,390,360]) {
      console.log('UI viewport: ' + width);
      const context = await browser.newContext({ viewport:{ width,height:width>700?1000:844 } });
      let role = 'guest';
      await context.route('**/*', route => {
        const req = route.request(), url = new URL(req.url());
        if(url.pathname.startsWith('/api/')) {
          assert.ok(['GET','OPTIONS'].includes(req.method()), 'Unexpected API write');
          const body = respond(url,role);
          return route.fulfill({ status:body?200:404,json:body || { message:'No test fixture' } });
        }
        return url.origin === new URL(base).origin ? route.continue() : route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      const overflow = async () => assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false, 'Horizontal overflow at '+width+' '+page.url());
      const screenshot = name => process.env.UI_POLISH_SCREENSHOTS === '0' ? Promise.resolve() : page.screenshot({ path:`artifacts/ui-polish/${name}-${width}.png`, fullPage:!name.startsWith('home') });
      await page.goto(base,{ waitUntil:'networkidle' });
      await expect(page.locator('.immersive-journey')).toHaveAttribute('data-enhanced','true');
      await overflow();
      for(const selector of ['.immersive-panel-trigger','.immersive-step-controls button','.immersive-motion-toggle']) {
        for(const box of await page.locator(selector).evaluateAll(nodes=>nodes.map(n=>({ height:n.getBoundingClientRect().height,font:parseFloat(getComputedStyle(n).fontSize) })))) {
          assert.ok(box.height>=44,'Touch target too short: '+selector+' '+width);
          assert.ok(box.font>=12,'Small control text: '+selector);
        }
      }
      if ([1440,390,360].includes(width)) await screenshot('home');
      if (width===360) {
        await page.setViewportSize({width,height:667});
        await page.locator('.immersive-controls nav button').nth(3).click();
        await expect(page.locator('.immersive-journey')).toHaveAttribute('data-chapter','3',{timeout:15000});
        await expect(page.locator('.immersive-journey')).toHaveAttribute('data-activity','idle',{timeout:15000});
        const copy=await page.locator('.immersive-chapter-3 .immersive-copy').boundingBox();
        const controls=await page.locator('.immersive-controls').boundingBox();
        assert.ok(copy.y>=72 && copy.y+copy.height<=controls.y+2,'Compact hero copy overlaps controls');
        for(const fits of await page.locator('.immersive-controls nav button').evaluateAll(nodes=>nodes.map(n=>n.scrollWidth<=n.clientWidth))) assert.ok(fits,'Checkpoint label overflows its button');
        await page.locator('.immersive-controls nav button').first().click();
        await expect(page.locator('.immersive-journey')).toHaveAttribute('data-chapter','0',{timeout:15000});
        await expect(page.locator('.immersive-journey')).toHaveAttribute('data-activity','idle',{timeout:15000});
        await page.setViewportSize({width,height:844});
        await page.waitForTimeout(500); // Let the journey's resize rebuild finish before opening a panel.
        await expect(page.locator('.immersive-journey')).toHaveAttribute('data-enhanced','true');
      }
      const opener = page.locator('[data-panel="events"]');
      await opener.focus(); await page.keyboard.press('Enter');
      const dialog = page.locator('dialog.immersive-panel-dialog');
      await expect(dialog).toBeVisible();
      assert.equal(await dialog.evaluate(n=>n.matches(':modal')),true);
      await expect(page.locator('.support-launcher')).toBeHidden();
      for(let i=0;i<12;i++) {
        await page.keyboard.press('Tab');
        assert.equal(await dialog.evaluate(n=>n.contains(document.activeElement)),true,'Focus escaped modal at '+width+': '+await page.evaluate(()=>document.activeElement?.outerHTML.slice(0,180)));
      }
      await expect(dialog.locator('.carousel-pause')).toBeVisible();
      await dialog.locator('.carousel-pause').click();
      await page.waitForTimeout(500); // Capture a settled card, not the 440ms slide transition.
      if ([1440,390,360].includes(width)) await screenshot('home-calendar');
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible(); await expect(opener).toBeFocused();
      await page.locator('.support-launcher').click();
      await expect(page.locator('#support-panel')).toBeVisible();
      // Nonmodal chat can stay open while a real modal opens, but it must be hidden/inert.
      // On compact screens chat covers the launcher visually; keyboard activation
      // exercises the still-accessible background without a forced pointer click.
      await opener.focus(); await page.keyboard.press('Enter');
      await expect(dialog).toBeVisible(); await expect(page.locator('#support-panel')).toBeHidden();
      await page.keyboard.press('Escape');
      await expect(opener).toBeFocused();
      await expect(page.locator('#support-panel')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#support-panel')).not.toBeVisible();
      await expect(page.locator('.support-launcher')).toBeFocused();
      // Native modal on another page also suppresses the floating support control.
      await page.goto(base+'/marketplace',{ waitUntil:'networkidle' });
      await page.getByRole('button',{name:'Đăng tin',exact:true}).click();
      await expect(page.locator('dialog.rf-dialog')).toBeVisible();
      await expect(page.locator('.support-launcher')).toBeHidden();
      await page.keyboard.press('Escape');
      await overflow();
      if ([1440,390].includes(width)) await screenshot('marketplace');
      await page.goto(base+'/register',{ waitUntil:'networkidle' });
      if(width<=390) {
        const field=page.locator('#signup-name');
        assert.ok((await field.boundingBox()).y<600,'Signup form still below the fold');
        await field.focus(); await expect(page.locator('.support-launcher')).toBeHidden();
        await page.keyboard.press('Tab');
      }
      await overflow();
      if ([1440,390].includes(width)) await screenshot('register');
      await page.goto(base+'/events',{ waitUntil:'networkidle' });
      await expect(page.locator('.race-card .race-date').first()).toHaveText('21/02/2027');
      await expect(page.locator('.race-card time').first()).toHaveAttribute('datetime','2027-02-21T00:00:00.000Z');
      await overflow();
      if ([1440,390].includes(width)) await screenshot('events');
      role='runner';
      await page.evaluate(user=>{localStorage.setItem('rf_token','ui-polish-fixture');localStorage.setItem('rf_user',JSON.stringify(user));},userFor(role));
      await page.goto(base+'/events/dalat-forest/register',{ waitUntil:'networkidle' });
      await expect(page.locator('#checkout-name')).toHaveValue('Nguyễn Minh Anh');
      await expect(page.getByLabel('Email nhận vé *',{exact:true})).toHaveValue('runner@example.com');
      const choices=page.locator('.checkout-choice').filter({hasText:'10K'});
      await choices.click(); await expect(choices).toHaveAttribute('aria-pressed','true');
      await overflow();
      if ([1440,390].includes(width)) await screenshot('checkout');
      if(width===390) {
        await page.emulateMedia({reducedMotion:'reduce'});
        await page.goto(base,{waitUntil:'networkidle'});
        await expect(page.locator('.immersive-journey')).toHaveAttribute('data-enhanced','false');
        await expect(page.locator('#events-heading')).toBeVisible();
        await expect(page.locator('.immersive-canvas canvas')).toHaveCount(0);
        await overflow();
      }
      results.push({width,passed:true});
      await context.close();
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ results, errors, fixtureOnly:true }));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
