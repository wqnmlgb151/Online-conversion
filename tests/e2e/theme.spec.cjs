const { test, expect } = require('@playwright/test');
const fixture = require('./fixtures.cjs');

test.use({ serviceWorkers: 'allow' });

async function appearance(page, selectors) {
  return page.evaluate(selectors => {
    const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = color => rgb(color).map(value => {
      value /= 255;
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const background = element => {
      for (; element; element = element.parentElement) {
        const color = getComputedStyle(element).backgroundColor;
        if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
      }
      return 'rgb(255, 255, 255)';
    };
    const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    return {
      scheme: getComputedStyle(document.documentElement).colorScheme,
      luminance: luminance(background(document.documentElement)),
      text: selectors.flatMap(selector => Array.from(document.querySelectorAll(selector))
        .filter(element => element.getClientRects().length && !element.disabled)
        .map(element => ({ selector, contrast: contrast(getComputedStyle(element).color, background(element)) }))),
      placeholder: document.querySelector('#img-width')
        ? contrast(getComputedStyle(document.querySelector('#img-width'), '::placeholder').color, background(document.querySelector('#img-width')))
        : null,
      matchingThemeColors: Array.from(document.querySelectorAll('meta[name="theme-color"]'))
        .filter(meta => matchMedia(meta.media).matches).length
    };
  }, selectors);
}

test('all pages follow system theme live, including when JavaScript is disabled', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark' });
  const page = await context.newPage();
  try {
    for (const path of ['/', '/guide.html', '/privacy.html']) {
      await page.goto(`http://127.0.0.1:8080${path}`);
      for (const colorScheme of ['dark', 'light', 'dark']) {
        await page.emulateMedia({ colorScheme });
        await expect(page.locator('html')).toHaveCSS('color-scheme', colorScheme);
        const result = await appearance(page, ['h1', 'p', 'a', 'label', '.tab-btn', '#img-btn', 'select']);
        expect(result.scheme).toBe(colorScheme);
        expect(result.luminance)[colorScheme === 'dark' ? 'toBeLessThan' : 'toBeGreaterThan'](colorScheme === 'dark' ? .05 : .9);
        expect(result.text.length).toBeGreaterThan(0);
        for (const item of result.text) expect(item.contrast, `${path}: ${colorScheme} ${item.selector}`).toBeGreaterThanOrEqual(4.5);
        if (result.placeholder !== null) expect(result.placeholder).toBeGreaterThanOrEqual(4.5);
        expect(result.matchingThemeColors).toBe(1);
      }
    }
  } finally { await context.close(); }
});

test('theme changes retain selected files, options, results and readable errors', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.locator('#img-input').setInputFiles([
    { name: 'theme.png', mimeType: 'image/png', buffer: fixture.png() },
    { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') }
  ]);
  await page.locator('#img-format').selectOption('jpeg');
  await page.locator('#img-btn').click();
  await expect(page.locator('#results-summary')).toContainText('1 个成功，1 个失败');
  const link = await page.locator('#img-link').getAttribute('href');
  const queue = await page.locator('#queue-list').textContent();
  await fixture.openImageOptions(page);
  await page.locator('#img-width').fill('24');
  await page.locator('#offline-panel summary').click();
  await expect(page.locator('#offline-clear')).toBeEnabled();
  await fixture.openImageOptions(page);
  await page.locator('#img-width').focus();
  for (const colorScheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator('html')).toHaveCSS('color-scheme', colorScheme);
    await expect(page.locator('#img-width')).toHaveValue('24');
    await expect(page.locator('#img-format')).toHaveValue('jpeg');
    expect(await page.locator('#img-input').evaluate(input => Array.from(input.files, file => file.name))).toEqual(['theme.png', 'broken.png']);
    expect(await page.locator('#img-link').getAttribute('href')).toBe(link);
    expect(await page.locator('#queue-list').textContent()).toBe(queue);
    await expect(page.locator('#img-width')).toBeFocused();
    const result = await appearance(page, ['.result-error p', '.result-row a', '.results-panel button', '.file-list button', '#offline-panel p', '#offline-panel a']);
    for (const item of result.text) expect(item.contrast, `${colorScheme} ${item.selector}`).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: testInfo.outputPath(`theme-desktop-${colorScheme}.png`), fullPage: true });
  }
  const image = await page.locator('#img-link').evaluate(async link => {
    const image = new Image(); image.src = link.href; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return { size: [image.width, image.height], pixel: Array.from(canvas.getContext('2d').getImageData(0, 0, 1, 1).data) };
  });
  expect(image).toEqual({ size: [4, 2], pixel: [255, 255, 255, 255] });
});

test('dark and light mobile layouts keep all conversion panels within the viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.locator('#offline-panel summary').click();
  for (const colorScheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme });
    for (const tab of ['image', 'video', 'audio', 'doc', 'pdf']) {
      await page.locator(`[data-tab="${tab}"]`).click();
      await expect(page.locator(`#panel-${tab}`)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.locator('[data-tab="image"]').click();
    await page.screenshot({ path: testInfo.outputPath(`theme-mobile-${colorScheme}.png`), fullPage: true });
  }
});

test('document PDF rendering keeps the same white page and text in both themes', async ({ page }) => {
  await page.goto('/#doc');
  await page.locator('#doc-format').selectOption('pdf');
  const rendered = [];
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await page.locator('#doc-input').setInputFiles({
      name: 'theme.md', mimeType: 'text/markdown',
      buffer: Buffer.from('# 主题验证\n\n中文段落与 English text。\n\n- 列表内容\n\n另一段文字。')
    });
    await page.locator('#doc-btn').click();
    await expect(page.locator('#statusText')).toContainText('转换完成');
    rendered.push(await page.locator('#doc-link').evaluate(async link => {
      const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
      const task = pdfjs.getDocument({ data: new Uint8Array(await (await fetch(link.href)).arrayBuffer()), isEvalSupported: false });
      try {
        const pdf = await task.promise;
        const pdfPage = await pdf.getPage(1);
        const viewport = pdfPage.getViewport({ scale: 1 });
        const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        await pdfPage.render({ canvasContext: context, viewport }).promise;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let textPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 150 && pixels[i + 1] < 150 && pixels[i + 2] < 150) textPixels++;
        return { pages: pdf.numPages, textPixels, corner: Array.from(pixels.slice(0, 4)), image: canvas.toDataURL() };
      } finally { await task.destroy(); }
    }));
  }
  expect(rendered[0].pages).toBe(1);
  expect(rendered[0].textPixels).toBeGreaterThan(100);
  expect(rendered[0].corner).toEqual([255, 255, 255, 255]);
  expect(rendered[1]).toEqual(rendered[0]);
});
