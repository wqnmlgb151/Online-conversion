const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('../e2e/fixtures.cjs');

async function convert(page, prefix, format, file, option = 'format') {
  await page.locator(`#${prefix}-input`).setInputFiles(file);
  await page.locator(`#${prefix}-${option}`).selectOption(format);
  await page.locator(`#${prefix}-btn`).click();
  await expect(page.locator('#task-progress')).toBeHidden();
  // The progress indicator is already hidden: the operation has reached a terminal state.
  expect(await page.locator('#statusText').textContent()).toMatch(/转换完成|处理完成/);
  return page.locator(`#${prefix}-link`).evaluate(async link => {
    const blob = await (await fetch(link.href)).blob();
    const data = await new Promise(resolve => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob);
    });
    return { name: link.download, type: blob.type, base64: data.split(',')[1] };
  });
}

async function inspectPdf(page, output) {
  return page.evaluate(async base64 => {
    const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    const task = pdfjs.getDocument({ data: Uint8Array.from(atob(base64), c => c.charCodeAt(0)), isEvalSupported: false });
    try {
      const pdf = await task.promise, first = await pdf.getPage(1);
      const viewport = first.getViewport({ scale: .5 }), canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      const context = canvas.getContext('2d'); await first.render({ canvasContext: context, viewport }).promise;
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonWhite = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] < 200 && data[i + 1] < 200 && data[i + 2] < 200) nonWhite++;
      return { pages: pdf.numPages, nonWhite };
    } finally { await task.destroy(); }
  }, output.base64);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#results-panel')).toBeVisible();
});

test('live image formats load and decode, including JPEG white background', async ({ page }) => {
  for (const format of ['jpeg', 'png', 'webp']) {
    const output = await convert(page, 'img', format, { name: '透明.png', mimeType: 'image/png', buffer: fixture.png() });
    expect(output.type).toBe(`image/${format}`);
    const decoded = await page.evaluate(async ({ type, base64 }) => {
      const image = new Image(); image.src = `data:${type};base64,${base64}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return { size: [image.width, image.height], pixel: [...context.getImageData(0, 0, 1, 1).data] };
    }, output);
    expect(decoded.size).toEqual([4, 2]);
    expect(decoded.pixel).toEqual(format === 'jpeg' ? [255, 255, 255, 255] : [0, 0, 0, 0]);
  }
  await expect(page.locator('#results-list a')).toHaveCount(3);
});

test('live Excel and document formats retain content and PDF output renders', async ({ page }) => {
  const requests = []; page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  await page.locator('[data-tab="doc"]').click();
  for (const format of ['json', 'csv', 'txt', 'html', 'pdf']) {
    const output = await convert(page, 'doc', format, { name: '工作簿.xlsx', mimeType: 'application/octet-stream', buffer: fixture.xlsx() });
    if (format === 'pdf') expect((await inspectPdf(page, output)).nonWhite).toBeGreaterThan(20);
    else {
      const text = Buffer.from(output.base64, 'base64').toString();
      expect(text).toContain('苹果'); expect(text).not.toContain('不应导出第二个工作表');
      if (format === 'json') expect(JSON.parse(text)).toEqual([{ 名称: '苹果', 数量: 3 }, { 名称: '梨', 数量: 5 }]);
    }
  }
  for (const extension of ['docx', 'md', 'txt']) {
    const buffer = extension === 'docx' ? await fixture.docx() : Buffer.from('# 中文文档转换验证\n\nSecond paragraph');
    for (const format of ['txt', 'html', 'pdf']) {
      const output = await convert(page, 'doc', format, { name: `文档.${extension}`, mimeType: 'application/octet-stream', buffer });
      if (format === 'pdf') expect((await inspectPdf(page, output)).nonWhite).toBeGreaterThan(20);
      else expect(Buffer.from(output.base64, 'base64').toString()).toContain('中文文档转换验证');
    }
  }
  const unsafe = await convert(page, 'doc', 'html', { name: 'unsafe.md', mimeType: 'text/markdown', buffer: Buffer.from('# 标题\n<script>window.pwned=true</script><img src="https://example.invalid/private" onerror="alert(1)">') });
  expect(Buffer.from(unsafe.base64, 'base64').toString()).not.toMatch(/<script|<img|onerror=/);
  const origin = new URL(page.url()).origin;
  expect(requests.filter(request => request.method !== 'GET')).toEqual([]);
  expect(requests.filter(request => !request.url.startsWith(origin + '/') && !request.url.startsWith('blob:') && !request.url.startsWith('data:'))).toEqual([]);
});

test('live PDF and corrupt image failures preserve earlier results and recover', async ({ page }) => {
  await page.locator('#img-input').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') });
  await page.locator('#img-btn').click(); await expect(page.locator('#task-progress')).toBeHidden();
  await expect(page.locator('#statusText')).toContainText('图片无法解码');
  await convert(page, 'img', 'png', { name: 'valid.png', mimeType: 'image/png', buffer: fixture.png() });
  await page.locator('[data-tab="pdf"]').click();
  const scan = await convert(page, 'pdf', 'merge', { name: 'scan.png', mimeType: 'image/png', buffer: fixture.png() }, 'action');
  await page.locator('#pdf-input').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from(scan.base64, 'base64') });
  await page.locator('#pdf-action').selectOption('to-txt'); await page.locator('#pdf-btn').click();
  await expect(page.locator('#task-progress')).toBeHidden(); await expect(page.locator('#statusText')).toContainText('未提取到文字');
  const recovered = await convert(page, 'pdf', 'to-txt', { name: 'real.pdf', mimeType: 'application/pdf', buffer: fixture.pdf() }, 'action');
  expect(Buffer.from(recovered.base64, 'base64').toString()).toContain('Page 2 sample');
  await expect(page.locator('#results-list a')).toHaveCount(3);
});

test('live dependency load failure can retry without clearing results', async ({ page }) => {
  await convert(page, 'img', 'png', { name: 'keep.png', mimeType: 'image/png', buffer: fixture.png() });
  await page.locator('[data-tab="doc"]').click();
  await page.route('**/vendor/xlsx/xlsx.full.min.js', route => route.abort());
  await page.locator('#doc-input').setInputFiles({ name: 'book.xlsx', mimeType: 'application/octet-stream', buffer: fixture.xlsx() });
  await page.locator('#doc-format').selectOption('json'); await page.locator('#doc-btn').click();
  await expect(page.locator('#task-progress')).toBeHidden(); await expect(page.locator('#statusText')).toContainText('加载失败');
  await expect(page.locator('#results-list a')).toHaveCount(1);
  await page.unroute('**/vendor/xlsx/xlsx.full.min.js'); await page.locator('#retry-btn').click();
  await expect(page.locator('#task-progress')).toBeHidden(); await expect(page.locator('#statusText')).toHaveText('转换完成');
  await expect(page.locator('#results-list a')).toHaveCount(2);
});

test('live FFmpeg downloads real CDN core and produces all advertised audio and video formats', async ({ page }) => {
  const cdnResponses = [];
  page.on('response', response => { if (response.url().includes('/@ffmpeg/core@')) cdnResponses.push({ url: response.url(), status: response.status() }); });
  await page.locator('[data-tab="audio"]').click();
  for (const format of ['mp3', 'wav', 'flac', 'm4a']) {
    const output = await convert(page, 'aud', format, { name: 'tone.wav', mimeType: 'audio/wav', buffer: fixture.wav() });
    const duration = await page.evaluate(async base64 => {
      const context = new AudioContext();
      try { return (await context.decodeAudioData(Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer)).duration; }
      finally { await context.close(); }
    }, output.base64);
    expect(duration).toBeGreaterThan(.8); expect(duration).toBeLessThan(1.5);
  }
  await page.locator('[data-tab="video"]').click();
  const buffer = fs.readFileSync(path.resolve('.test-cache/video.webm'));
  for (const format of ['mp4', 'webm', 'mp3', 'gif']) {
    const output = await convert(page, 'vid', format, { name: 'sample.webm', mimeType: 'video/webm', buffer });
    if (format === 'gif') {
      const bytes = Buffer.from(output.base64, 'base64'); expect(bytes.subarray(0, 3).toString()).toBe('GIF'); expect(bytes.readUInt16LE(6)).toBe(480);
    } else if (format === 'mp3') {
      const duration = await page.evaluate(async base64 => {
        const context = new AudioContext(); try { return (await context.decodeAudioData(Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer)).duration; }
        finally { await context.close(); }
      }, output.base64);
      expect(duration).toBeGreaterThan(.5);
    } else {
      const size = await page.evaluate(async ({ type, base64 }) => {
        const video = document.createElement('video'); video.src = `data:${type};base64,${base64}`;
        await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error('视频输出无法解码')); });
        return [video.videoWidth, video.videoHeight];
      }, output);
      expect(size).toEqual([64, 64]);
    }
  }
  expect(cdnResponses.some(response => response.url.endsWith('ffmpeg-core.js') && response.status === 200)).toBe(true);
  expect(cdnResponses.some(response => response.url.endsWith('ffmpeg-core.wasm') && response.status === 200)).toBe(true);
  await expect(page.locator('#results-list a')).toHaveCount(8);
});
