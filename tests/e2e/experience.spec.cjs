const { test, expect } = require('@playwright/test');
const fixture = require('./fixtures.cjs');

test.describe.configure({ timeout: 30000 });

async function drop(page, input, files) {
  await page.locator(`[data-input="${input}"]`).evaluate((zone, files) => {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(new File([file.content], file.name, { type: file.type }));
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, files);
}

test('first screen shows the conversion action with optional controls folded on desktop and mobile', async ({ page }, testInfo) => {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      await page.goto('/');
      await expect(page.locator('#img-options')).not.toHaveAttribute('open', '', { timeout: 5000 });
      await expect(page.locator('#queue-panel')).not.toHaveAttribute('open', '', { timeout: 5000 });
      const action = await page.locator('#img-btn').boundingBox();
      expect(action.y + action.height).toBeLessThan(844);
      await expect(page.locator('#cancel-btn')).toBeHidden();
      for (const tab of ['image', 'video', 'audio', 'doc', 'pdf']) {
        const bounds = await page.locator(`#tab-${tab}`).boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`first-screen-${width}-${colorScheme}.png`) });
    }
  }
});

test('video, audio and document accept a dragged file and show its name', async ({ page }) => {
  await page.goto('/');
  for (const [tab, prefix, name, type] of [
    ['video', 'vid', '演示.webm', 'video/webm'],
    ['audio', 'aud', '演示.wav', 'audio/wav'],
    ['doc', 'doc', '演示.txt', 'text/plain']
  ]) {
    await page.locator(`[data-tab="${tab}"]`).click();
    await drop(page, `${prefix}-input`, [{ name, type, content: '本地拖放内容' }]);
    await expect(page.locator(`#${prefix}-files`)).toContainText(name, { timeout: 5000 });
    expect(await page.locator(`#${prefix}-input`).evaluate(input => input.files.length)).toBe(1);
  }
  await page.locator('#doc-format').selectOption('txt');
  await page.locator('#doc-btn').click();
  await expect(page.locator('#doc-down')).toBeVisible({ timeout: 10000 });
  expect(await page.locator('#doc-link').evaluate(async link => (await fetch(link.href)).text())).toBe('本地拖放内容');
});

test('single-file drop rejects extra files without replacing a previous selection', async ({ page }) => {
  await page.goto('/#doc');
  await page.locator('#doc-input').setInputFiles({ name: '保留.txt', mimeType: 'text/plain', buffer: Buffer.from('原来的内容') });
  await drop(page, 'doc-input', ['甲.txt', '乙.txt'].map(name => ({ name, type: 'text/plain', content: '不可替换' })));
  await expect(page.locator('#statusText')).toContainText('一次只处理一个文件', { timeout: 5000 });
  expect(await page.locator('#doc-input').evaluate(input => [...input.files].map(file => file.name))).toEqual(['保留.txt']);
  await page.locator('#doc-format').selectOption('txt');
  await page.locator('#doc-btn').click();
  await expect(page.locator('#doc-down')).toBeVisible({ timeout: 10000 });
  expect(await page.locator('#doc-link').evaluate(async link => (await fetch(link.href)).text())).toBe('原来的内容');
});

test('default image conversion works and optional resize keeps the original result', async ({ page }) => {
  await page.goto('/');
  await page.locator('#img-input').setInputFiles({ name: '图片.png', mimeType: 'image/png', buffer: fixture.png() });
  await page.locator('#img-format').selectOption('png');
  await expect(page.locator('#img-btn')).toHaveText('转换为 PNG');
  await page.locator('#img-btn').click();
  await expect(page.locator('#img-down')).toBeVisible({ timeout: 10000 });
  await page.locator('#img-options > summary').click();
  await page.locator('#img-width').fill('12');
  await page.locator('#img-btn').click();
  await expect(page.locator('#results-list a')).toHaveCount(2, { timeout: 10000 });
  const latestName = await page.locator('#img-link').getAttribute('download');
  await expect(page.locator('#img-link')).toHaveText(`下载 ${latestName}`);
  await expect(page.locator('#results-list a').last()).toHaveAttribute('aria-label', `下载 ${latestName}`);
  const dimensions = await page.locator('#results-list a').evaluateAll(async links => Promise.all(links.map(async link => {
    const image = new Image(); image.src = link.href; await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  })));
  expect(dimensions).toEqual([[4, 2], [12, 6]]);
  await page.locator('#results-list li').last().getByRole('button', { name: /^删除结果 / }).click();
  const remainingName = await page.locator('#results-list a').getAttribute('download');
  await expect(page.locator('#img-link')).toHaveText(`下载 ${remainingName}`);
  await expect(page.locator('#img-link')).toHaveAttribute('href', await page.locator('#results-list a').getAttribute('href'));
});
