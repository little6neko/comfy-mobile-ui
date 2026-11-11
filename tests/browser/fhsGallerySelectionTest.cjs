// Run with Vite on 5179 and PLAYWRIGHT_PATH pointing to an installed Playwright.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    let copies = 0;
    const errors = [];
    page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
    await page.route('**/comfymobile/api/files/view?*', r => r.fulfill({
      contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6l8AAAAASUVORK5CYII=', 'base64'),
    }));
    await page.route('**/comfymobile/api/files/copy', r => {
      copies++;
      return r.fulfill({ json: { status: 'success' } });
    });
    await page.route('**/comfymobile/api/files/list', r => r.fulfill({ json: {
      status: 'success', images: ['input', 'output'].map(type => ({
        filename: '测试.png', subfolder: '目录/二级', type,
      })), videos: [], files: [],
    } }));
    await page.route('**/fhs-test', r => r.fulfill({ contentType: 'text/html', body: `
      <div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/@vite/client');
      await import('/tests/browser/fhsGalleryHarness.tsx');
      </script>` }));
    await page.goto('http://127.0.0.1:5179/fhs-test');
    for (const type of ['input', 'output']) {
      await page.getByRole('button', { name: 'Select File', exact: true }).click();
      if (type === 'output') await page.locator('footer').getByRole('button', { name: 'Output', exact: true }).click();
      await page.locator('img[alt="测试.png"]').first().click();
      await page.waitForFunction(expected => window.selected === expected, `${type}/目录/二级/测试.png`);
    }
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.waitForFunction(() => window.manual === true);
    assert.equal(copies, 0);
    assert.deepEqual(errors, []);
    console.log('PASS: empty FHS path opens picker; nested input/output paths saved without copying; manual editing retained');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
