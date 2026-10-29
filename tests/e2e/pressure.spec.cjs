const { test, expect } = require('@playwright/test');
const XLSX = require('../../vendor/xlsx/xlsx.full.min.js');
const JSZip = require('../../vendor/jszip/jszip.min.js');
const fixture = require('./fixtures.cjs');

async function convert(page, prefix) {
  await page.locator(`#${prefix}-btn`).click();
  await expect(page.locator('#task-progress')).toBeHidden();
  await expect(page.locator('#statusText')).toContainText(/转换完成|处理完成/);
}
async function textResult(page, prefix) {
  return page.locator(`#${prefix}-link`).evaluate(async link => (await fetch(link.href)).text());
}

test('10000-row workbook retains values, cached formulas and first-sheet boundaries', async ({ page }) => {
  const wb = XLSX.utils.book_new();
  const rows = [['编号', '名称', '数量', '金额', '备注', '分类', '状态', '校验']];
  for (let i = 1; i <= 10000; i++) rows.push([i, `商品-${i}`, i % 100, i * 0.5, `中文,逗号"引号\n换行-${i}`, '库存', '有效', i * 3]);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet.D2 = { t: 'n', f: 'A2*0.5', v: 0.5 };
  XLSX.utils.book_append_sheet(wb, sheet, '数据');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['SECOND_SHEET_SECRET']]), '其他');
  const buffer = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }));
  await page.goto('/'); await page.locator('[data-tab="doc"]').click();
  await page.locator('#doc-input').setInputFiles({ name: 'inventory.xlsx', mimeType: 'application/octet-stream', buffer });
  await page.locator('#doc-format').selectOption('json'); await convert(page, 'doc');
  const output = await textResult(page, 'doc'); const data = JSON.parse(output);
  expect(data).toHaveLength(10000);
  expect(data[0]['金额']).toBe(0.5);
  expect(data[9999]).toMatchObject({ 编号: 10000, 校验: 30000, 备注: '中文,逗号"引号\n换行-10000' });
  expect(output).not.toContain('SECOND_SHEET_SECRET');
  await expect(page.locator('#results-list')).toContainText('公式保留缓存值');
});

test('DOCX paragraphs, table and external link preserve text without remote loading', async ({ page }) => {
  const zip = await JSZip.loadAsync(await fixture.docx());
  const paragraphs = Array.from({ length: 80 }, (_, i) => `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>第${i + 1}段 中文复杂内容</w:t></w:r></w:p>`).join('');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${paragraphs}<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格名称</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>表格数值42</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:hyperlink r:id="external"><w:r><w:t>外部链接文本</w:t></w:r></w:hyperlink></w:p></w:body></w:document>`);
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="external" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/private" TargetMode="External"/></Relationships>');
  const requests = []; page.on('request', request => { if (request.url().includes('example.invalid')) requests.push(request.url()); });
  await page.goto('/'); await page.locator('[data-tab="doc"]').click();
  await page.locator('#doc-input').setInputFiles({ name: 'complex.docx', mimeType: 'application/octet-stream', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await page.locator('#doc-format').selectOption('html'); await convert(page, 'doc');
  const html = await textResult(page, 'doc');
  expect(html).toContain('第80段'); expect(html).toContain('<table>'); expect(html).toContain('表格数值42');
  expect(html).toContain('外部链接文本'); expect(html).not.toContain('<a '); expect(requests).toEqual([]);
  await page.locator('#doc-format').selectOption('pdf'); await convert(page, 'doc');
  const pages = await page.locator('#doc-link').evaluate(async link => {
    const lib = await import('/vendor/pdfjs/pdf.min.mjs'); lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    const task = lib.getDocument({ data: await (await fetch(link.href)).arrayBuffer() });
    try { return (await task.promise).numPages; } finally { await task.destroy(); }
  });
  expect(pages).toBeGreaterThan(1);
});

test('1000-page PDF extracts selected pages in order without processing all pages', async ({ page }) => {
  await page.goto('/'); await page.locator('[data-tab="pdf"]').click();
  await page.locator('#pdf-input').setInputFiles({ name: 'thousand.pdf', mimeType: 'application/pdf', buffer: fixture.pdf(1000) });
  await page.locator('#pdf-action').selectOption('to-txt'); await page.locator('#pdf-pages').fill('1000,501,1');
  await convert(page, 'pdf');
  const text = await textResult(page, 'pdf');
  expect([...text.matchAll(/--- Page (\d+) ---/g)].map(match => Number(match[1]))).toEqual([1000, 501, 1]);
  expect(text).toContain('Page 1000 sample');
});

test('repacking results releases the previous archive before generating its replacement', async ({ page }) => {
  await page.addInitScript(() => {
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    window.archiveUrls = new Set();
    URL.createObjectURL = function(blob) {
      const url = create.call(this, blob);
      if (blob.type === 'application/zip') window.archiveUrls.add(url);
      return url;
    };
    URL.revokeObjectURL = function(url) { window.archiveUrls.delete(url); return revoke.call(this, url); };
  });
  await page.goto('/');
  await page.locator('#img-input').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: fixture.png() });
  await convert(page, 'img');
  let download = page.waitForEvent('download'); await page.locator('#results-zip').click();
  expect(await (await download).failure()).toBeNull();
  await expect(page.locator('#task-progress')).toBeHidden();
  expect(await page.evaluate(() => window.archiveUrls.size)).toBe(1);
  await page.evaluate(() => {
    const generate = JSZip.prototype.generateAsync;
    JSZip.prototype.generateAsync = function(...args) {
      window.archivesAtGeneration = window.archiveUrls.size;
      return generate.apply(this, args);
    };
  });
  download = page.waitForEvent('download'); await page.locator('#results-zip').click();
  expect(await (await download).failure()).toBeNull();
  await expect(page.locator('#task-progress')).toBeHidden();
  expect(await page.evaluate(() => window.archivesAtGeneration)).toBe(0);
  expect(await page.evaluate(() => window.archiveUrls.size)).toBe(1);
  await page.locator('#results-clear').click();
  expect(await page.evaluate(() => window.archiveUrls.size)).toBe(0);
});

test('oversized PDF canvas is rejected and a following PDF still converts', async ({ page }) => {
  const oversized = fixture.pdf(1, 20000);
  await page.goto('/'); await page.locator('[data-tab="pdf"]').click();
  await page.locator('#pdf-input').setInputFiles({ name: 'oversized.pdf', mimeType: 'application/pdf', buffer: oversized });
  await page.locator('#pdf-btn').click();
  await expect(page.locator('#task-progress')).toBeHidden();
  await expect(page.locator('#statusText')).toContainText('4000 万像素');
  await page.locator('#pdf-input').setInputFiles({ name: 'valid.pdf', mimeType: 'application/pdf', buffer: fixture.pdf(1) });
  await page.locator('#pdf-action').selectOption('to-txt'); await convert(page, 'pdf');
});

test('mobile touch with 4x CPU slowdown converts textured 12MP image and releases repeated result URLs', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  try {
    const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.addInitScript(() => {
      const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
      window.liveUrls = new Set();
      URL.createObjectURL = function(blob) { const url = create.call(this, blob); window.liveUrls.add(url); return url; };
      URL.revokeObjectURL = function(url) { window.liveUrls.delete(url); return revoke.call(this, url); };
    });
    await page.goto('http://127.0.0.1:8080/');
    const png = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 4000; canvas.height = 3000;
      const ctx = canvas.getContext('2d');
      for (let y = 0; y < 3000; y += 20) for (let x = 0; x < 4000; x += 20) {
        ctx.fillStyle = `rgb(${(x * 7 + y) % 256},${(y * 3 + x) % 256},${(x + y * 11) % 256})`; ctx.fillRect(x, y, 20, 20);
      }
      const blob = await new Promise(resolve => canvas.toBlob(resolve)); canvas.width = canvas.height = 0;
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    await page.locator('#img-input').setInputFiles({ name: 'texture.png', mimeType: 'image/png', buffer: Buffer.from(png) });
    await fixture.openImageOptions(page);
    await page.locator('#img-width').fill('1000'); await convert(page, 'img');
    const size = await page.locator('#img-link').evaluate(async link => { const img = new Image(); img.src = link.href; await img.decode(); return [img.naturalWidth, img.naturalHeight]; });
    expect(size).toEqual([1000, 750]);
    await page.locator('#results-clear').tap();
    expect(await page.evaluate(() => window.liveUrls.size)).toBe(0);
    await page.locator('#img-input').setInputFiles({ name: 'repeat.png', mimeType: 'image/png', buffer: fixture.png() });
    await fixture.openImageOptions(page);
    await page.locator('#img-width').fill('');
    for (let i = 0; i < 22; i++) {
      await convert(page, 'img'); await page.locator('#results-clear').tap();
      expect(await page.evaluate(() => window.liveUrls.size)).toBe(0);
    }
    await expect(page.locator('#queue-list li')).toHaveCount(20);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); }
});
