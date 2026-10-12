const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const JSZip = require('../../vendor/jszip/jszip.min.js');
const fixture = require('./fixtures.cjs');

const image = (name = 'photo.png') => ({ name, mimeType: 'image/png', buffer: fixture.png() });
async function finish(page, prefix) {
  await page.locator(`#${prefix}-btn`).click();
  await expect(page.locator('#task-progress')).toBeHidden();
}
async function bytes(link) {
  return Buffer.from(await link.evaluate(async element => {
    const buffer = await (await fetch(element.href)).arrayBuffer();
    return Array.from(new Uint8Array(buffer));
  }));
}
async function zipDownload(page) {
  const waiting = page.waitForEvent('download');
  await page.locator('#results-zip').click();
  const download = await waiting;
  expect(await download.failure()).toBeNull();
  return JSZip.loadAsync(fs.readFileSync(await download.path()));
}

test('batch isolates failures, retains outputs across tabs and ZIP resolves duplicate names', async ({ page }) => {
  await page.goto('/');
  await page.locator('#img-input').setInputFiles([image(), { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') }, image()]);
  await page.locator('#img-format').selectOption('webp');
  await page.locator('#img-width').fill('12');
  await page.locator('#img-height').fill('12');
  await finish(page, 'img');
  await expect(page.locator('#results-summary')).toContainText('2 个成功，1 个失败');
  await expect(page.locator('#results-list a')).toHaveCount(2);
  await expect(page.locator('#results-list')).toContainText('4 × 2 → 12 × 6');
  await expect(page.locator('#results-list')).toContainText(/增大|减少/);
  await page.locator('[data-tab="doc"]').click();
  await page.locator('#doc-input').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('保留结果') });
  await page.locator('#doc-format').selectOption('txt');
  await finish(page, 'doc');
  const zip = await zipDownload(page);
  expect(Object.keys(zip.files)).toEqual(['photo.webp', 'photo (2).webp', 'note.txt']);
  expect(await zip.file('note.txt').async('string')).toBe('保留结果');
  for (const name of ['photo.webp', 'photo (2).webp']) {
    const buffer = await zip.file(name).async('nodebuffer');
    const size = await page.evaluate(async base64 => {
      const img = new Image(); img.src = `data:image/webp;base64,${base64}`; await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    }, buffer.toString('base64'));
    expect(size).toEqual([12, 6]);
  }
  await page.locator('[data-tab="image"]').click();
  await expect(page.locator('#img-down')).toBeVisible();
  expect((await bytes(page.locator('#img-link'))).length).toBeGreaterThan(0);
});

test('drop accepts multiple files and exact resize outputs chosen dimensions', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-input="img-input"]').evaluate((zone, base64) => {
    const transfer = new DataTransfer();
    for (const name of ['first.png', 'second.png']) transfer.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], name, { type: 'image/png' }));
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, fixture.png().toString('base64'));
  await expect(page.locator('#img-files li')).toHaveCount(2);
  await page.locator('#img-format').selectOption('png');
  await page.locator('#img-width').fill('10'); await page.locator('#img-height').fill('7');
  await page.locator('#img-ratio').uncheck(); await finish(page, 'img');
  const zip = await zipDownload(page);
  expect(Object.keys(zip.files)).toEqual(['first.png', 'second.png']);
  for (const file of Object.values(zip.files)) {
    const output = await file.async('nodebuffer');
    expect(output.readUInt32BE(16)).toBe(10); expect(output.readUInt32BE(20)).toBe(7);
  }
});

test('invalid resize preserves prior results and one-side resize retains ratio', async ({ page }) => {
  await page.goto('/');
  await page.locator('#img-input').setInputFiles(image()); await finish(page, 'img');
  await page.locator('#img-width').fill('1.5'); await finish(page, 'img');
  await expect(page.locator('#statusText')).toContainText('尺寸必须');
  await expect(page.locator('#results-list a')).toHaveCount(1);
  await page.locator('#img-width').fill('20'); await finish(page, 'img');
  await expect(page.locator('#results-list')).toContainText('20 × 10');
  await expect(page.locator('#retry-btn')).toBeHidden();
});

test('deleting and clearing results revoke URLs and update legacy download links', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.revoked = []; const original = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = url => { window.revoked.push(url); original(url); };
    window.created = []; const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); window.created.push(url); return url; };
  });
  await page.locator('#img-input').setInputFiles([image('one.png'), image('two.png')]); await finish(page, 'img');
  const urls = await page.locator('#results-list a').evaluateAll(links => links.map(link => link.href));
  await zipDownload(page);
  const zipURL = await page.evaluate(() => window.created.at(-1));
  await page.getByRole('button', { name: '删除结果 two.webp', exact: true }).click();
  expect(await page.locator('#img-link').getAttribute('href')).toBe(urls[0]);
  expect(await page.evaluate(url => window.revoked.includes(url), urls[1])).toBe(true);
  expect(await page.evaluate(url => window.revoked.includes(url), zipURL)).toBe(true);
  await page.locator('#results-clear').click();
  await expect(page.locator('#results-list li')).toHaveCount(0);
  await expect(page.locator('#img-down')).toBeHidden();
  expect(await page.locator('#img-link').getAttribute('href')).toBeNull();
  expect(await page.evaluate(url => window.revoked.includes(url), urls[0])).toBe(true);
  await page.locator('#results-zip').click();
  await expect(page.locator('#statusText')).toContainText('没有可下载');
});

test('PDF selected text pages preserve order and reject out of range without losing results', async ({ page }) => {
  await page.goto('/'); await page.locator('[data-tab="pdf"]').click();
  await page.locator('#pdf-input').setInputFiles({ name: 'pages.pdf', mimeType: 'application/pdf', buffer: fixture.pdf(4) });
  await page.locator('#pdf-action').selectOption('to-txt');
  await page.locator('#pdf-pages').fill('3,1-2,2'); await finish(page, 'pdf');
  const text = (await bytes(page.locator('#pdf-link'))).toString();
  expect(text.indexOf('Page 3 sample')).toBeLessThan(text.indexOf('Page 1 sample'));
  expect(text.indexOf('Page 1 sample')).toBeLessThan(text.indexOf('Page 2 sample'));
  expect(text).not.toContain('Page 4 sample'); expect(text.match(/Page 2 sample/g)).toHaveLength(1);
  await page.locator('#pdf-pages').fill('5'); await finish(page, 'pdf');
  await expect(page.locator('#statusText')).toContainText('页码超出范围');
  await expect(page.locator('#results-list a')).toHaveCount(1);
  expect((await bytes(page.locator('#pdf-link'))).toString()).toBe(text);
});

test('large PDF can export a selected subset within the 50 page limit', async ({ page }) => {
  await page.goto('/'); await page.locator('[data-tab="pdf"]').click();
  await page.locator('#pdf-input').setInputFiles({ name: 'large.pdf', mimeType: 'application/pdf', buffer: fixture.pdf(51) });
  await page.locator('#pdf-pages').fill('51,1'); await finish(page, 'pdf');
  await expect(page.locator('#statusText')).toHaveText('处理完成');
  const zip = await JSZip.loadAsync(await bytes(page.locator('#pdf-link')));
  expect(Object.keys(zip.files)).toEqual(['page_51.png', 'page_1.png']);
  for (const file of Object.values(zip.files)) expect((await file.async('nodebuffer')).readUInt32BE(16)).toBe(600);
});

test('PDF image order controls change actual merged page colors', async ({ page }) => {
  await page.goto('/'); await page.locator('[data-tab="pdf"]').click();
  const colors = await page.evaluate(() => ['red', 'blue'].map(color => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 20;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 20, 20);
    return canvas.toDataURL().split(',')[1];
  }));
  await page.locator('#pdf-input').setInputFiles(colors.map((data, i) => ({ name: `${i === 0 ? 'red' : 'blue'}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  await page.locator('#pdf-action').selectOption('merge');
  await expect(page.locator('#pdf-pages-field')).toBeHidden();
  await page.getByRole('button', { name: '上移 blue.png', exact: true }).click();
  await expect(page.locator('#pdf-files li').first()).toContainText('blue.png');
  await finish(page, 'pdf');
  await expect(page.getByRole('button', { name: '上移 blue.png', exact: true })).toBeDisabled();
  const output = await bytes(page.locator('#pdf-link'));
  const pixels = await page.evaluate(async base64 => {
    const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    const task = pdfjs.getDocument({ data: Uint8Array.from(atob(base64), c => c.charCodeAt(0)), isEvalSupported: false });
    try {
      const pdf = await task.promise, result = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i), viewport = page.getViewport({ scale: .5 });
        const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
        const context = canvas.getContext('2d'); await page.render({ canvasContext: context, viewport }).promise;
        result.push([...context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data]);
      }
      return result;
    } finally { await task.destroy(); }
  }, output.toString('base64'));
  expect(pixels).toEqual([[0, 0, 255, 255], [255, 0, 0, 255]]);
});

test('PDF drop works and results fit desktop and mobile layouts', async ({ page }, testInfo) => {
  await page.goto('/'); await page.locator('[data-tab="pdf"]').click();
  await page.locator('[data-input="pdf-input"]').evaluate((zone, base64) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], '拖拽文档.pdf', { type: 'application/pdf' }));
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, fixture.pdf().toString('base64'));
  await page.locator('#pdf-action').selectOption('to-txt'); await finish(page, 'pdf');
  await expect(page.locator('#results-list')).toContainText('拖拽文档.txt');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`layout-${width}.png`), fullPage: true });
  }
});

test('PNG ignores unused quality and labeled tabs support keyboard navigation', async ({ page }) => {
  await page.goto('/');
  expect(await page.locator('input, select').evaluateAll(inputs => inputs.every(input => input.labels.length > 0))).toBe(true);
  await page.locator('#img-input').setInputFiles(image());
  await page.locator('#img-quality').fill('');
  await page.locator('#img-format').selectOption('png');
  await expect(page.locator('#img-quality')).toBeDisabled();
  await finish(page, 'img');
  await expect(page.locator('#img-quality')).toBeDisabled();
  const output = await bytes(page.locator('#img-link'));
  expect(output.readUInt32BE(16)).toBe(4); expect(output.readUInt32BE(20)).toBe(2);
  const tab = page.getByRole('tab', { name: '图片', exact: true });
  await tab.focus(); await tab.press('End');
  await expect(page.getByRole('tab', { name: 'PDF', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'PDF', exact: true }).press('Home');
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#img-down')).toBeVisible();
  await tab.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'PDF', exact: true })).toBeFocused();
  await page.getByRole('tab', { name: 'PDF', exact: true }).press('ArrowRight');
  await expect(tab).toBeFocused();
  await page.locator('#img-format').selectOption('webp'); await expect(page.locator('#img-quality')).toBeEnabled();
});

test('dropping files outside input zones prevents navigation and preserves results', async ({ page }) => {
  await page.goto('/'); await page.locator('#img-input').setInputFiles(image()); await finish(page, 'img');
  const url = page.url();
  const prevented = await page.evaluate(() => {
    const transfer = new DataTransfer(); transfer.items.add(new File(['sample'], 'outside.txt', { type: 'text/plain' }));
    return ['dragover', 'drop'].map(type => {
      const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer });
      document.body.dispatchEvent(event); return event.defaultPrevented;
    });
  });
  expect(prevented).toEqual([true, true]); expect(page.url()).toBe(url);
  await expect(page.locator('#statusText')).toContainText('请将文件拖到');
  await expect(page.locator('#results-list a')).toHaveCount(1);
  expect((await bytes(page.locator('#img-link'))).length).toBeGreaterThan(0);
});
