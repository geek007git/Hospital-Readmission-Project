// Browser integration checks. Start `npm run dev` first, then `npm run test:ui`.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:1080},reducedMotion:'reduce'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror',error => errors.push(error.message));
  try {
    await page.goto(process.env.DASHBOARD_URL || 'http://localhost:3000');
    await page.waitForFunction(() => document.getElementById('kpi-total').textContent === '3,000');
    assert.equal(await page.locator('#kpi-high-risk').innerText(),'92');
    assert.equal(await page.locator('#priority-table tr').count(),5);
    assert.equal(await page.locator('#risk-legend strong').allTextContents().then(values => values.reduce((sum,value) => sum+Number(value.replaceAll(',','')),0)),3000);
    await page.locator('[data-group="quarter"]').click();
    assert.equal(await page.locator('[data-group="quarter"]').getAttribute('aria-pressed'),'true');
    assert.ok(await page.locator('.chart-point').count() < 20);
    await page.locator('[data-group="month"]').click();
    await page.locator('.chart-point').first().focus();
    assert.equal(await page.locator('.chart-tooltip').isVisible(),true);

    await page.locator('#priority-table .patient-id').first().click();
    const id = await page.locator('#detail-title').innerText();
    await page.locator('#review-note').fill('Follow-up context saved during UI verification.');
    await page.locator('#save-review').click();
    assert.match(await page.locator('#review-save-status').innerText(),/Review saved/);
    await page.keyboard.press('Escape');
    await page.locator('#review-button').click();
    await page.locator('#review-filter').selectOption('reviewed');
    assert.match(await page.locator('#review-table').innerText(),new RegExp(id));
    await page.reload();
    await page.waitForFunction(() => document.getElementById('data-status').textContent.includes('connected'));
    await page.locator('#review-filter').selectOption('reviewed');
    await page.locator('#review-table .patient-id').first().click();
    assert.equal(await page.locator('#review-note').inputValue(),'Follow-up context saved during UI verification.');
    await page.locator('#reopen-review').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#review-table .patient-id').count(),0);

    await page.locator('#search-shortcut').click();
    await page.locator('#patient-search').fill('PT-10000');
    assert.equal(await page.locator('#patient-table .patient-id').count(),1);
    assert.match(await page.locator('#patient-table').innerText(),/Acute MI/);
    await page.locator('#risk-filter').selectOption('High');
    assert.match(await page.locator('#patient-table').innerText(),/No patients found/);
    await page.locator('#patient-search').fill('');
    assert.match(await page.locator('#patient-page-info').innerText(),/92 patients/);
    const first = await page.locator('#patient-table .patient-id').first().innerText();
    await page.locator('#patient-next').click();
    assert.notEqual(await page.locator('#patient-table .patient-id').first().innerText(),first);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-button').click();
    const download = await downloadPromise;
    const csv = await fs.readFile(await download.path(),'utf8');
    assert.equal(csv.trim().split('\r\n').length,93);
    assert.match(download.suggestedFilename(),/caresync-patients/);
    await page.locator('#patient-sort').selectOption('risk-asc');
    const riskValues = await page.locator('#patient-table .score-cell strong').allTextContents();
    assert.ok(parseFloat(riskValues[0]) <= parseFloat(riskValues.at(-1)));

    await page.locator('[data-view="overview"]').click();
    await page.locator('#hospital-filter').selectOption({label:'City General Hospital'});
    const hospitalCount = Number((await page.locator('#kpi-total').innerText()).replaceAll(',',''));
    assert.ok(hospitalCount > 0 && hospitalCount < 3000);
    assert.equal(await page.locator('#risk-legend strong').allTextContents().then(values => values.reduce((sum,value) => sum+Number(value.replaceAll(',','')),0)),hospitalCount);
    await page.locator('#period-filter').selectOption('6');
    const filteredCount = Number((await page.locator('#kpi-total').innerText()).replaceAll(',',''));
    assert.ok(filteredCount < hospitalCount);
    await page.locator('[data-view="analytics"]').click();
    const departmentTotal = await page.locator('#department-table tr td:nth-child(2)').allTextContents();
    assert.equal(departmentTotal.reduce((sum,value) => sum+Number(value.replaceAll(',','')),0),filteredCount);
    await page.locator('[data-view="reports"]').click();
    assert.match(await page.locator('#report-scope').innerText(),/City General Hospital/);
    assert.match(await page.locator('#report-content').innerText(),new RegExp(String(filteredCount)));
    await page.emulateMedia({media:'print'});
    assert.equal(await page.locator('.sidebar').isVisible(),false);
    assert.equal(await page.locator('#view-reports').isVisible(),true);
    await page.emulateMedia({media:'screen'});
    await page.locator('#reset-filters').click();

    await page.locator('[data-view="chat"]').click();
    await page.locator('[data-question]').first().click();
    assert.match(await page.locator('#chat-messages').innerText(),/92 patients/);
    await page.route('**/api/chat',route => route.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'}));
    await page.locator('#chat-input').fill('Explain the source of these records');
    await page.locator('#chat-send-btn').click();
    await page.waitForFunction(() => document.getElementById('assistant-status').textContent.includes('Local dataset'));
    assert.match(await page.locator('#chat-messages').innerText(),/unavailable/);
    await page.unroute('**/api/chat');
    await page.route('**/api/chat',route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({text:'<p>Response <strong>received</strong><img src=x onerror="window.bad=true"><script>window.bad=true</script></p>'})}));
    await page.locator('#chat-input').fill('Explain the source of these records');
    await page.locator('#chat-send-btn').click();
    await page.waitForFunction(() => document.getElementById('assistant-status').textContent.includes('Connected'));
    assert.equal(await page.locator('#chat-messages img, #chat-messages script').count(),0);
    assert.equal(await page.evaluate(() => window.bad),undefined);

    await page.locator('[data-view="settings"]').click();
    await page.locator('#compact-setting').check();
    await page.locator('#page-size-setting').selectOption('25');
    await page.reload();
    await page.waitForFunction(() => document.getElementById('data-status').textContent.includes('connected'));
    assert.equal(await page.locator('body').evaluate(element => element.classList.contains('compact')),true);
    await page.locator('[data-view="patients"]').click();
    assert.equal(await page.locator('#patient-table .patient-id').count(),25);
    await page.keyboard.press('/');
    assert.equal(await page.locator('#patient-search').evaluate(element => document.activeElement === element),true);

    const outputDir = path.join(__dirname,'..','.ui-artifacts');
    await fs.mkdir(outputDir,{recursive:true});
    await page.locator('[data-view="settings"]').click();
    await page.locator('#compact-setting').uncheck();
    await page.locator('[data-view="overview"]').click();
    await page.waitForFunction(() => document.getElementById('view-overview').classList.contains('active'));
    await page.waitForTimeout(100);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({path:path.join(outputDir,'desktop.png'),fullPage:true});
    for (const width of [1920,1280,768,390,320]) {
      await page.setViewportSize({width,height:900});
      await page.waitForTimeout(250);
      for (const view of ['overview','patients','analytics','discharge','reports','chat','settings']) {
        await page.evaluate(view => { location.hash=view; },view);
        await page.waitForFunction(view => document.getElementById(`view-${view}`).classList.contains('active'),view);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1),`${view} overflows at ${width}px`);
      }
    }
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(() => { location.hash='overview'; });
    await page.waitForTimeout(250);
    await page.screenshot({path:path.join(outputDir,'mobile.png'),fullPage:true});
    await page.locator('#menu-button').click();
    assert.equal(await page.locator('#menu-button').getAttribute('aria-expanded'),'true');
    await page.locator('[data-view="patients"]').click();
    await page.waitForFunction(() => document.getElementById('view-patients').classList.contains('active'));
    assert.equal(await page.locator('#menu-button').getAttribute('aria-expanded'),'false');
    await page.locator('#menu-button').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#menu-button').getAttribute('aria-expanded'),'false');

    const failed = await context.newPage();
    failed.on('pageerror',error => errors.push(error.message));
    await failed.route('**/hospital_readmission_fhir.csv',route => route.fulfill({status:500,body:'Unavailable'}));
    await failed.goto(process.env.DASHBOARD_URL || 'http://localhost:3000');
    await failed.locator('#load-error').waitFor({state:'visible'});
    await failed.unroute('**/hospital_readmission_fhir.csv');
    await failed.locator('#retry-button').click();
    await failed.waitForFunction(() => document.getElementById('kpi-total').textContent === '3,000');
    assert.deepEqual(errors,[]);
    console.log('PASS: data totals, chart controls, saved reviews, search, sort, pagination, CSV export, cohort filters, analytics, report print layout, assistant fallback and sanitization, preferences, keyboard controls, all 7 views at 5 viewport sizes, mobile navigation, and load recovery.');
    console.log(`Screenshots: ${outputDir}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
