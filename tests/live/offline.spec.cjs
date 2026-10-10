const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const JSZip = require('../../vendor/jszip/jszip.min.js');
const fixture = require('../e2e/fixtures.cjs');

// These tests use real deployed assets and CDN responses, without request mocks.
test.use({ serviceWorkers: 'allow' });
async function open(page, entry = '') {
  await page.goto(`/${entry}`);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 90000 });
  if (await page.locator('#offline-panel').getAttribute('open') === null) await page.locator('#offline-panel summary').click();
  await expect(page.locator('#offline-clear')).toBeEnabled();
}
async function prepare(page, group) {
  await page.locator(`#offline-${group}`).click();
  await expect(page.locator('#offline-status')).not.toContainText('正在准备');
  await expect(page.locator(`#offline-${group}-state`)).toContainText('已缓存，可离线使用');
}
async function finish(page, prefix) {
  await page.locator(`#${prefix}-btn`).click();
  await expect(page.locator('#task-progress')).toBeHidden();
  await expect(page.locator('#statusText')).toContainText(/转换完成|处理完成/);
}
async function bytes(link) {
  return Buffer.from(await link.evaluate(async element => Array.from(new Uint8Array(await (await fetch(element.href)).arrayBuffer()))));
}

test('live cached images, ZIP and guide survive a fully offline reload', async ({ page, context }) => {
  await open(page); await prepare(page, 'image');
  await context.setOffline(true); await open(page, '#image');
  await expect(page.locator('#network-state')).toHaveText('当前离线');
  await expect(page.locator('#offline-doc-state')).toContainText('未完整缓存');
  for (const format of ['png', 'jpeg', 'webp']) {
    await page.locator('#img-input').setInputFiles({ name: `${format}.png`, mimeType: 'image/png', buffer: fixture.png() });
    await page.locator('#img-format').selectOption(format); await finish(page, 'img');
  }
  const waiting = page.waitForEvent('download'); await page.locator('#results-zip').click();
  const download = await waiting; expect(await download.failure()).toBeNull();
  const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
  expect(Object.keys(zip.files)).toEqual(['png.png', 'jpeg.jpg', 'webp.webp']);
  for (const [name, file] of Object.entries(zip.files)) {
    const size = await page.evaluate(async ({ name, data }) => {
      const image = new Image(); image.src = `data:image/${name.endsWith('.jpg') ? 'jpeg' : name.split('.').pop()};base64,${data}`;
      await image.decode(); return [image.naturalWidth, image.naturalHeight];
    }, { name, data: await file.async('base64') });
    expect(size).toEqual([4, 2]);
  }
  await page.goto('/guide.html'); await expect(page.locator('h1')).toHaveText('使用指南');
  expect(await page.evaluate(async () => (await fetch('examples/sample.md')).text())).toContain('苹果');
});

test('live prepared documents and PDF workers run offline without caching user files', async ({ page, context }) => {
  await open(page); await prepare(page, 'doc'); await prepare(page, 'pdf');
  await context.setOffline(true); await open(page, '#doc');
  await page.locator('#doc-input').setInputFiles({ name: 'private-book.xlsx', mimeType: 'application/octet-stream', buffer: fixture.xlsx() });
  await page.locator('#doc-format').selectOption('json'); await finish(page, 'doc');
  expect(JSON.parse((await bytes(page.locator('#doc-link'))).toString())).toEqual([{ 名称: '苹果', 数量: 3 }, { 名称: '梨', 数量: 5 }]);
  await page.locator('[data-tab="pdf"]').click();
  await page.locator('#pdf-input').setInputFiles({ name: 'private-pages.pdf', mimeType: 'application/pdf', buffer: fixture.pdf() });
  await page.locator('#pdf-action').selectOption('to-img'); await finish(page, 'pdf');
  const zip = await JSZip.loadAsync(await bytes(page.locator('#pdf-link')));
  expect(Object.keys(zip.files)).toEqual(['page_1.png', 'page_2.png']);
  for (const file of Object.values(zip.files)) expect((await file.async('nodebuffer')).subarray(1, 4).toString()).toBe('PNG');
  const keys = await page.evaluate(async () => {
    const urls = []; for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    return urls;
  });
  expect(keys.some(url => /private-book|private-pages|^blob:/.test(url))).toBe(false);
});

test('live real CDN preparation supports audio conversion after offline reload', async ({ page, context }) => {
  await open(page); await prepare(page, 'media');
  await context.setOffline(true); await open(page, '#audio');
  await page.locator('#aud-input').setInputFiles({ name: 'offline.wav', mimeType: 'audio/wav', buffer: fixture.wav() });
  await page.locator('#aud-format').selectOption('mp3'); await finish(page, 'aud');
  const duration = await page.locator('#aud-link').evaluate(async link => {
    const audio = new AudioContext();
    try { return (await audio.decodeAudioData(await (await fetch(link.href)).arrayBuffer())).duration; }
    finally { await audio.close(); }
  });
  expect(duration).toBeGreaterThan(.8); expect(duration).toBeLessThan(1.5);
});

test('live cache readiness synchronizes between tabs after preparing and clearing', async ({ page, context }) => {
  await open(page); const other = await context.newPage(); await open(other);
  await prepare(page, 'image');
  await expect(other.locator('#offline-image-state')).toContainText('已缓存，可离线使用');
  await other.locator('#offline-clear').click();
  await expect(other.locator('#offline-status')).toContainText('功能缓存已清除');
  await expect(page.locator('#offline-image-state')).toContainText('未完整缓存');
  await other.close();
});
