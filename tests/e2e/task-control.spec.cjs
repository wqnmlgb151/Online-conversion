const { test, expect } = require('@playwright/test');
const fixture = require('./fixtures.cjs');
const image = name => ({ name, mimeType: 'image/png', buffer: fixture.png() });

test('cancel a batch discards unfinished output and permits a fresh conversion', async ({ page }) => {
  await page.goto('/');
  // Hold encoding so cancellation is deterministic even on fast machines.
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
      original.call(this, blob => { window.releaseEncoding = () => callback(blob); }, ...args);
    };
    window.restoreEncoding = () => { HTMLCanvasElement.prototype.toBlob = original; };
  });
  await page.locator('#img-input').setInputFiles([image('a.png'), image('b.png')]);
  await page.locator('#img-btn').click();
  await page.waitForFunction(() => !!window.releaseEncoding);
  await expect(page.locator('#task-progress')).toBeVisible();
  await page.locator('#cancel-btn').click();
  await expect(page.locator('#task-progress')).toBeVisible();
  await page.evaluate(() => { window.restoreEncoding(); window.releaseEncoding(); });
  await expect(page.locator('#task-progress')).toBeHidden();
  await expect(page.locator('#statusText')).toContainText('任务已取消');
  await expect(page.locator('#results-list li')).toHaveCount(0);
  await page.locator('#img-input').setInputFiles(image('fresh.png'));
  await page.locator('#img-btn').click();
  await expect(page.locator('#results-list a')).toHaveCount(1);
  await expect(page.locator('#statusText')).toContainText('转换完成');
});

test('large resize is rejected before allocating its canvas and can recover', async ({ page }) => {
  await page.goto('/');
  await page.locator('#img-input').setInputFiles(image('small.png'));
  await fixture.openImageOptions(page);
  await page.locator('#img-width').fill('6000');
  await fixture.openImageOptions(page);
  await page.locator('#img-height').fill('6000');
  await fixture.openImageOptions(page);
  await page.locator('#img-ratio').uncheck();
  await page.locator('#img-btn').click();
  await expect(page.locator('#statusText')).toContainText('预算');
  await expect(page.locator('#results-list a')).toHaveCount(0);
  await fixture.openImageOptions(page);
  await page.locator('#img-width').fill('10');
  await fixture.openImageOptions(page);
  await page.locator('#img-height').fill('10');
  await page.locator('#img-btn').click();
  await expect(page.locator('#results-list a')).toHaveCount(1);
});

test('document results explain filtered content and remain local', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-tab="doc"]').click();
  await page.locator('#doc-input').setInputFiles({ name: 'note.md', mimeType: 'text/markdown', buffer: Buffer.from('# 标题\n![图片](https://example.test/private.png)') });
  await page.locator('#doc-format').selectOption('html');
  await page.locator('#doc-btn').click();
  await expect(page.locator('#results-list')).toContainText('图片、链接及嵌入内容会被过滤');
  const html = await page.locator('#doc-link').evaluate(async link => (await fetch(link.href)).text());
  expect(html).not.toContain('<img');
  expect(html).toContain('标题');
});
