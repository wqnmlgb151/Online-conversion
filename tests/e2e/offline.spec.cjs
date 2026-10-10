const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const JSZip = require('../../vendor/jszip/jszip.min.js');
const fixture = require('./fixtures.cjs');
test.use({ serviceWorkers: 'allow' });

async function ready(page) {
  await page.goto('/');
  await page.locator('#offline-panel summary').click();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await expect(page.locator('#offline-image')).toBeEnabled();
}
async function prepare(page, group) {
  await page.locator(`#offline-${group}`).click();
  await expect(page.locator(`#offline-${group}-state`)).toContainText('已缓存，可离线使用');
}
async function finish(page, prefix) {
  await page.locator(`#${prefix}-btn`).click();
  await expect(page.locator('#task-progress')).toBeHidden();
  await expect(page.locator('#statusText')).toContainText(/转换完成|处理完成/);
}

test('uncached feature stays unavailable after offline reload, shell and direct entry survive', async ({ page, context }) => {
  await ready(page); await context.setOffline(true);
  await page.goto('/#doc'); await page.locator('#offline-panel summary').click();
  await expect(page.locator('#panel-doc')).toBeVisible();
  await expect(page.locator('#offline-doc-state')).toContainText('未完整缓存');
  await expect(page.locator('#offline-doc')).toBeDisabled();
  await expect(page.locator('#network-state')).toHaveText('当前离线');
  await page.goto('/guide.html'); await expect(page.locator('h1')).toHaveText('使用指南');
});

test('prepared documents and PDF workers convert after a fully offline reload', async ({ page, context }) => {
  await ready(page); await prepare(page, 'doc'); await prepare(page, 'pdf');
  await context.setOffline(true); await page.goto('/#doc');
  await page.locator('#doc-input').setInputFiles({ name: 'offline.xlsx', mimeType: 'application/octet-stream', buffer: fixture.xlsx() });
  await page.locator('#doc-format').selectOption('json'); await finish(page, 'doc');
  expect(await page.locator('#doc-link').evaluate(async link => (await fetch(link.href)).text())).toContain('苹果');
  await page.locator('[data-tab="pdf"]').click();
  await page.locator('#pdf-input').setInputFiles({ name: 'offline.pdf', mimeType: 'application/pdf', buffer: fixture.pdf() });
  await page.locator('#pdf-action').selectOption('to-img'); await finish(page, 'pdf');
  await expect(page.locator('#pdf-link')).toHaveAttribute('download', 'offline.zip');
  const keys = await page.evaluate(async () => {
    const urls = []; for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    return urls;
  });
  expect(keys.some(url => url.includes('offline.xlsx') || url.includes('offline.pdf') || url.startsWith('blob:'))).toBe(false);
});

test('partial or corrupt cache never reports ready and can recover, clear removes readiness', async ({ page, context }) => {
  await ready(page);
  await context.route('**/vendor/marked/marked.min.js', route => route.fulfill({ status: 200, body: 'tampered', contentType: 'text/javascript' }));
  await page.locator('#offline-doc').click();
  await expect(page.locator('#offline-status')).toContainText('校验失败');
  await expect(page.locator('#offline-doc-state')).toContainText('未完整缓存');
  await context.unroute('**/vendor/marked/marked.min.js');
  await prepare(page, 'doc');
  await page.locator('#offline-clear').click();
  await expect(page.locator('#offline-status')).toContainText('功能缓存已清除');
  await expect(page.locator('#offline-doc-state')).toContainText('未完整缓存');
});

test('failed FFmpeg download retries only missing assets and then converts fully offline', async ({ page, context }) => {
  const downloads = { js: 0, wasm: 0 };
  let failWasm = true;
  for (const ext of ['js', 'wasm']) {
    await context.route(`**/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.${ext}`, route => {
      downloads[ext]++;
      if (ext === 'wasm' && failWasm) return route.fulfill({ status: 503, body: 'temporary outage', headers: { 'Access-Control-Allow-Origin': '*' } });
      return route.fulfill({ path: path.resolve('.test-cache', `ffmpeg-core.${ext}`), headers: { 'Access-Control-Allow-Origin': '*' }, contentType: ext === 'js' ? 'text/javascript' : 'application/wasm' });
    });
  }
  await ready(page); await page.locator('#offline-media').click();
  await expect(page.locator('#offline-status')).toContainText('资源下载失败');
  await expect(page.locator('#offline-media-state')).toContainText('未完整缓存');
  failWasm = false; await prepare(page, 'media');
  expect(downloads).toEqual({ js: 1, wasm: 2 });
  await context.unrouteAll(); await context.setOffline(true); await page.goto('/#audio');
  await page.locator('#aud-input').setInputFiles({ name: 'offline.wav', mimeType: 'audio/wav', buffer: fixture.wav() });
  await page.locator('#aud-format').selectOption('mp3'); await finish(page, 'aud');
  const duration = await page.locator('#aud-link').evaluate(async link => {
    const audio = new AudioContext();
    try { return (await audio.decodeAudioData(await (await fetch(link.href)).arrayBuffer())).duration; }
    finally { await audio.close(); }
  });
  expect(duration).toBeGreaterThan(0.8);
});

test('prepared images and ZIP downloads decode after offline reload', async ({ page, context }) => {
  await ready(page); await prepare(page, 'image');
  await context.setOffline(true); await page.goto('/#image');
  for (const format of ['png', 'jpeg', 'webp']) {
    await page.locator('#img-input').setInputFiles({ name: `${format}.png`, mimeType: 'image/png', buffer: fixture.png() });
    await page.locator('#img-format').selectOption(format); await finish(page, 'img');
  }
  const waiting = page.waitForEvent('download'); await page.locator('#results-zip').click();
  const download = await waiting; expect(await download.failure()).toBeNull();
  const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
  expect(Object.keys(zip.files)).toEqual(['png.png', 'jpeg.jpg', 'webp.webp']);
  for (const [name, file] of Object.entries(zip.files)) {
    const size = await page.evaluate(async ({ name, base64 }) => {
      const image = new Image(); image.src = `data:image/${name.endsWith('.jpg') ? 'jpeg' : name.split('.').pop()};base64,${base64}`;
      await image.decode(); return [image.naturalWidth, image.naturalHeight];
    }, { name, base64: await file.async('base64') });
    expect(size).toEqual([4, 2]);
  }
  if (await page.locator('#offline-panel').getAttribute('open') === null) await page.locator('#offline-panel summary').click();
  const exampleWaiting = page.waitForEvent('download'); await page.locator('a[download][href="examples/sample.md"]').click();
  const example = await exampleWaiting; expect(await example.failure()).toBeNull();
  expect(fs.readFileSync(await example.path(), 'utf8')).toContain('苹果');
});

test('cache preparation and clearing serialize across tabs and refresh every open page', async ({ page, context }) => {
  await ready(page); const other = await context.newPage(); await ready(other);
  let heldRoute, intercepted;
  const held = new Promise(resolve => { intercepted = resolve; });
  await context.route('**/vendor/jszip/jszip.min.js', route => { heldRoute = route; intercepted(); });
  await page.locator('#offline-image').click(); await held;
  await other.locator('#offline-clear').click();
  await expect(other.locator('#offline-status')).toContainText('正在清除');
  await heldRoute.continue(); await context.unroute('**/vendor/jszip/jszip.min.js');
  await expect(other.locator('#offline-status')).toContainText('功能缓存已清除');
  await expect(page.locator('#offline-image-state')).toContainText('未完整缓存');
  await expect(other.locator('#offline-image-state')).toContainText('未完整缓存');
  await prepare(page, 'image');
  await expect(other.locator('#offline-image-state')).toContainText('已缓存，可离线使用');
  await other.locator('#offline-clear').click();
  await expect(page.locator('#offline-image-state')).toContainText('未完整缓存');
  await other.close();
});

test('update waits for existing pages to close and new version resets feature readiness', async ({ page, context }) => {
  await ready(page); await prepare(page, 'image');
  const configFile = path.resolve('dist/offline-assets.js');
  const workerFile = path.resolve('dist/sw.js');
  const originalConfig = fs.readFileSync(configFile, 'utf8');
  const originalWorker = fs.readFileSync(workerFile, 'utf8');
  try {
    fs.writeFileSync(configFile, originalConfig.replace(/"version":"[^"]+"/, '"version":"update-test"'));
    fs.writeFileSync(workerFile, originalWorker + '\n// update lifecycle test\n');
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await expect(page.locator('#offline-update')).toContainText('发现新版本');
    await expect(page.locator('#offline-image-state')).toContainText('已缓存');
    await page.locator('#img-input').setInputFiles({ name: 'still-active.png', mimeType: 'image/png', buffer: fixture.png() });
    await finish(page, 'img');
    const count = await page.locator('#results-list a').count(); expect(count).toBe(1);
    await page.close();
    const next = await context.newPage(); await next.goto('/'); await next.locator('#offline-panel summary').click();
    await expect(next.locator('#offline-image-state')).toContainText('未完整缓存');
    const names = await next.evaluate(() => caches.keys());
    expect(names.filter(name => name.startsWith('converter:')).every(name => name.includes(':update-test:'))).toBe(true);
    await next.close();
  } finally {
    fs.writeFileSync(configFile, originalConfig); fs.writeFileSync(workerFile, originalWorker);
  }
});

test('feature caches cannot be cleared while a conversion owns the execution slot', async ({ page }) => {
  await ready(page); await prepare(page, 'image');
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
      HTMLCanvasElement.prototype.toBlob = original;
      original.call(this, blob => { window.releaseEncoding = () => callback(blob); }, ...args);
    };
  });
  await page.locator('#img-input').setInputFiles({ name: 'active.png', mimeType: 'image/png', buffer: fixture.png() });
  await page.locator('#img-btn').click();
  await page.waitForFunction(() => !!window.releaseEncoding);
  await expect(page.locator('#offline-clear')).toBeDisabled();
  await page.evaluate(() => window.releaseEncoding());
  await expect(page.locator('#task-progress')).toBeHidden();
  await expect(page.locator('#offline-clear')).toBeEnabled();
  await expect(page.locator('#offline-image-state')).toContainText('已缓存');
});
