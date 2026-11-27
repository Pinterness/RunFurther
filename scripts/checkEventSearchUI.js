const {chromium,expect}=require('@playwright/test');
const assert=require('node:assert/strict');
const {respond}=require('./uiPolishFixtures.cjs');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
const page=await browser.newPage();const base=process.env.WEB_TEST_URL||'http://localhost:3000';
await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.pathname.startsWith('/api/'))return route.fulfill({json:respond(u,'guest')||{}});return u.origin===new URL(base).origin?route.continue():route.abort();});
for(const width of [1440,768,390,360]){
await page.setViewportSize({width,height:900});await page.goto(base+'/events');
await page.getByLabel('Từ khóa',{exact:true}).fill('can tho');
assert.equal(new URL(page.url()).search,'','Typing must not navigate');
await page.getByRole('radio',{name:'21 – dưới 42 km',exact:true}).check();
await page.getByRole('button',{name:'Tìm giải chạy',exact:true}).click();
await expect(page).toHaveURL(/range=half/);assert.equal(new URL(page.url()).searchParams.get('search'),'can tho');
await expect(page.getByRole('radio',{name:'21 – dưới 42 km',exact:true})).toBeChecked();
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
await page.getByRole('link',{name:'Xóa bộ lọc'}).click();await expect(page).toHaveURL(base+'/events');
}
console.log('PASS event filters: stable typing, submission URL, range selection, reset and four viewports; fixtures only');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
