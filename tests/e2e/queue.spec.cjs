const { test, expect } = require('@playwright/test');
const fixture = require('./fixtures.cjs');
const image = name => ({ name, mimeType: 'image/png', buffer: fixture.png() });

async function holdFirstEncoding(page) {
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
      HTMLCanvasElement.prototype.toBlob = original;
      original.call(this, blob => { window.releaseEncoding = () => callback(blob); }, ...args);
    };
  });
  await page.locator('#img-input').setInputFiles(image('first.png'));
  await page.locator('#img-format').selectOption('png');
  await page.locator('#img-btn').click();
  await page.waitForFunction(() => !!window.releaseEncoding);
}
async function resultSize(page, name) {
  return page.locator(`#results-list a[download="${name}"]`).evaluate(async link => {
    const img = new Image(); img.src = link.href; await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  });
}

test('cross-feature queue freezes files and options while forms remain editable', async ({ page }) => {
  await page.goto('/');
  await holdFirstEncoding(page);
  await page.locator('#img-input').setInputFiles(image('second.png'));
  await page.locator('#img-width').fill('12');
  await page.locator('#img-btn').click();
  await page.locator('#img-input').setInputFiles(image('never-submitted.png'));
  await page.locator('#img-width').fill('30');
  await page.locator('[data-tab="doc"]').click();
  await page.locator('#doc-input').setInputFiles({ name: 'kept.txt', mimeType: 'text/plain', buffer: Buffer.from('提交时的内容') });
  await page.locator('#doc-format').selectOption('txt');
  await page.locator('#doc-btn').click();
  await page.locator('#doc-format').selectOption('pdf');
  await expect(page.locator('#queue-summary')).toContainText('等待 2 个任务');
  await expect(page.locator('#results-list a')).toHaveCount(0);
  await page.evaluate(() => window.releaseEncoding());
  await expect(page.locator('#queue-summary')).toContainText('当前空闲');
  await expect(page.locator('#results-list a')).toHaveCount(3);
  expect(await page.locator('#results-list a').evaluateAll(links => links.map(link => link.download))).toEqual(['first.png', 'second.png', 'kept.txt']);
  expect(await resultSize(page, 'first.png')).toEqual([4, 2]);
  expect(await resultSize(page, 'second.png')).toEqual([12, 6]);
  expect(await page.locator('#doc-link').evaluate(async link => (await fetch(link.href)).text())).toBe('提交时的内容');
});

test('cancel current work, remove waiting work and automatically run the next job', async ({ page }) => {
  await page.goto('/'); await holdFirstEncoding(page);
  await page.locator('#img-input').setInputFiles(image('removed.png'));
  await page.locator('#img-btn').click();
  await page.locator('#img-input').setInputFiles(image('kept.png'));
  await page.locator('#img-btn').click();
  await page.getByRole('button', { name: '移除任务 2', exact: true }).click();
  await page.locator('#cancel-btn').click();
  await expect(page.locator('#results-list a')).toHaveCount(0);
  await page.evaluate(() => window.releaseEncoding());
  await expect(page.locator('#queue-summary')).toContainText('当前空闲');
  await expect(page.locator('#results-list a')).toHaveCount(1);
  expect(await page.locator('#results-list a').getAttribute('download')).toBe('kept.png');
  await expect(page.locator('#queue-list li').nth(0)).toContainText('已取消');
  await expect(page.locator('#queue-list li').nth(1)).toContainText('已取消');
  await expect(page.locator('#queue-list li').nth(2)).toContainText('已完成');
});

test('queue limit and clear waiting work preserve the active task on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await holdFirstEncoding(page);
  for (let i = 0; i < 8; i++) await page.locator('#img-btn').click();
  await page.locator('#img-btn').click();
  await expect(page.locator('#queue-notice')).toContainText('最多 8 个任务');
  await expect(page.locator('#queue-summary')).toContainText('等待 8 个任务');
  await page.locator('#queue-clear').click();
  await expect(page.locator('#queue-summary')).toContainText('正在处理 1 个任务 · 等待 0 个任务');
  await page.evaluate(() => window.releaseEncoding());
  await expect(page.locator('#queue-summary')).toContainText('当前空闲');
  await expect(page.locator('#results-list a')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('ZIP generation shares the execution slot with queued conversions', async ({ page }) => {
  await page.goto('/');
  await page.locator('#img-input').setInputFiles(image('packed.png'));
  await page.locator('#img-btn').click();
  await expect(page.locator('#task-progress')).toBeHidden();
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/jszip/jszip.min.js'; script.onload = resolve; script.onerror = reject;
      document.head.appendChild(script);
    });
    const original = JSZip.prototype.generateAsync;
    JSZip.prototype.generateAsync = function(...args) {
      return new Promise(resolve => { window.releaseZip = resolve; }).then(() => original.apply(this, args));
    };
  });
  await page.locator('#results-zip').click();
  await page.waitForFunction(() => !!window.releaseZip);
  await page.locator('#img-input').setInputFiles(image('after-zip.png'));
  await page.locator('#img-btn').click();
  await expect(page.locator('#queue-summary')).toContainText('等待 1 个任务');
  await expect(page.locator('#results-list a')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.evaluate(() => window.releaseZip());
  expect(await (await download).failure()).toBeNull();
  await expect(page.locator('#queue-summary')).toContainText('当前空闲');
  await expect(page.locator('#results-list a')).toHaveCount(2);
});

test('failed PDF does not stop queued PDF and selected pages are snapshotted', async ({ page }) => {
  await page.goto('/'); await holdFirstEncoding(page);
  await page.locator('[data-tab="pdf"]').click();
  await page.locator('#pdf-input').setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('broken') });
  await page.locator('#pdf-action').selectOption('to-txt');
  await page.locator('#pdf-btn').click();
  await page.locator('#pdf-input').setInputFiles({ name: 'good.pdf', mimeType: 'application/pdf', buffer: fixture.pdf() });
  await page.locator('#pdf-pages').fill('2');
  await page.locator('#pdf-btn').click();
  await page.locator('#pdf-pages').fill('1');
  await page.locator('#pdf-action').selectOption('to-img');
  await page.evaluate(() => window.releaseEncoding());
  await expect(page.locator('#queue-summary')).toContainText('当前空闲');
  await expect(page.locator('#queue-list li').nth(1)).toContainText('有失败项');
  await expect(page.locator('#queue-list li').nth(2)).toContainText('已完成');
  const text = await page.locator('#pdf-link').evaluate(async link => (await fetch(link.href)).text());
  expect(text).toContain('--- Page 2 ---');
  expect(text).not.toContain('--- Page 1 ---');
});

test('12 megapixel image can resize and release its conversion slot', async ({ page }) => {
  await page.goto('/');
  const buffer = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 4000; canvas.height = 3000;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#194677'; ctx.fillRect(0, 0, 4000, 3000);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    canvas.width = canvas.height = 0;
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.locator('#img-input').setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.from(buffer) });
  await page.locator('#img-width').fill('1600');
  await page.locator('#img-btn').click();
  await expect(page.locator('#task-progress')).toBeHidden();
  expect(await resultSize(page, 'large.webp')).toEqual([1600, 1200]);
  await expect(page.locator('#queue-summary')).toContainText('当前空闲');
});
