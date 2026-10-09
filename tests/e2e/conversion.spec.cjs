const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('../../vendor/jszip/jszip.min.js');
const fixture = require('./fixtures.cjs');

async function open(page, tab = 'image') {
  await page.goto('/');
  if (tab !== 'image') await page.locator(`[data-tab="${tab}"]`).click();
}
async function convert(page, prefix, format, file, option = 'format') {
  await page.locator(`#${prefix}-input`).setInputFiles(file);
  await page.locator(`#${prefix}-${option}`).selectOption(format);
  await page.locator(`#${prefix}-btn`).click();
  await expect(page.locator('#task-progress')).toBeHidden();
  expect(await page.locator('#statusText').textContent()).toMatch(/转换完成|处理完成/);
  const output = await page.locator(`#${prefix}-link`).evaluate(async link => {
    const blob = await (await fetch(link.href)).blob();
    const encoded = await new Promise(resolve => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob);
    });
    return { name: link.download, type: blob.type, encoded: encoded.split(',')[1] };
  });
  output.bytes = Buffer.from(output.encoded, 'base64');
  expect(output.bytes.length).toBeGreaterThan(0);
  return output;
}
async function inspectPdf(page, output) {
  return page.evaluate(async base64 => {
    const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const task = pdfjs.getDocument({data:bytes,isEvalSupported:false});
    try {
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      const canvas = document.createElement('canvas');
      const viewport = page.getViewport({scale:.5});
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
      const pixels = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      let nonWhite = 0;
      for (let i=0;i<pixels.length;i+=4) if (pixels[i] < 200 && pixels[i+1] < 200 && pixels[i+2] < 200) nonWhite++;
      return {pages:pdf.numPages, nonWhite};
    } finally { await task.destroy(); }
  }, output.encoded);
}

for (const format of ['png','jpeg','webp']) {
  test(`image -> ${format}: output decodes, dimensions and JPEG background preserved`, async ({page}) => {
    await open(page);
    const output = await convert(page, 'img', format, {name:'transparent.PNG',mimeType:'image/png',buffer:fixture.png()});
    expect(output.name).toBe(`transparent.${format === 'jpeg' ? 'jpg' : format}`);
    expect(output.type).toBe(`image/${format}`);
    const decoded = await page.evaluate(async ({base64,type}) => {
      const img = new Image(); img.src = `data:${type};base64,${base64}`; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width=img.width; canvas.height=img.height;
      canvas.getContext('2d').drawImage(img,0,0);
      return {width:img.width,height:img.height,pixel:[...canvas.getContext('2d').getImageData(0,0,1,1).data]};
    }, {base64:output.encoded,type:output.type});
    expect(decoded.width).toBe(4); expect(decoded.height).toBe(2);
    expect(decoded.pixel).toEqual(format === 'jpeg' ? [255,255,255,255] : [0,0,0,0]);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#img-link').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(output.name);
    expect(await download.failure()).toBeNull();
  });
}

for (const format of ['json','csv','txt','html','pdf']) {
  test(`Excel -> ${format}: first sheet values survive`, async ({page}) => {
    await open(page,'doc');
    const output = await convert(page,'doc',format,{name:'工作簿.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:fixture.xlsx()});
    expect(output.name).toBe(`工作簿.${format}`);
    if (format === 'pdf') {
      const pdf = await inspectPdf(page,output); expect(pdf.pages).toBe(1); expect(pdf.nonWhite).toBeGreaterThan(20);
    } else if (format === 'json') {
      expect(JSON.parse(output.bytes.toString())).toEqual([{'名称':'苹果','数量':3},{'名称':'梨','数量':5}]);
    } else {
      expect(output.bytes.toString()).toContain('苹果'); expect(output.bytes.toString()).toContain('3');
      expect(output.bytes.toString()).not.toContain('不应导出第二个工作表');
      if (format === 'html') expect(output.type).toContain('text/html');
    }
  });
}

for (const extension of ['docx','md','txt']) {
  for (const format of ['txt','html','pdf']) {
    test(`${extension} -> ${format}: Chinese content survives and PDF renders`, async ({page}) => {
      await open(page,'doc');
      const buffer = extension === 'docx' ? await fixture.docx() : Buffer.from(extension === 'md' ? '# 中文文档转换验证\n\nSecond paragraph' : '中文文档转换验证\nSecond paragraph');
      const output = await convert(page,'doc',format,{name:`文档.${extension}`,mimeType:'application/octet-stream',buffer});
      expect(output.name).toBe(`文档.${format}`);
      if (format === 'pdf') {
        const pdf = await inspectPdf(page,output); expect(pdf.pages).toBe(1); expect(pdf.nonWhite).toBeGreaterThan(20);
      } else expect(output.bytes.toString()).toContain('中文文档转换验证');
    });
  }
}

test('long Chinese document creates multiple readable PDF pages', async ({page}) => {
  await open(page,'doc');
  const output = await convert(page,'doc','pdf',{name:'长文档.txt',mimeType:'text/plain',buffer:Buffer.from('中文分页验证\n'.repeat(130))});
  expect((await inspectPdf(page,output)).pages).toBeGreaterThan(1);
});

test('Markdown executable markup and remote images are removed', async ({page}) => {
  await open(page,'doc');
  const requests = []; page.on('request', request => { if (request.url().includes('example.invalid')) requests.push(request.url()); });
  const output = await convert(page,'doc','html',{name:'unsafe.md',mimeType:'text/markdown',buffer:Buffer.from('# 标题\n<script>window.pwned=true</script><img src="https://example.invalid/private" onerror="alert(1)">')});
  expect(output.bytes.toString()).not.toMatch(/<script|<img|onerror=/);
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
});

test('PDF text extraction preserves both pages', async ({page}) => {
  await open(page,'pdf');
  const output = await convert(page,'pdf','to-txt',{name:'sample.PDF',mimeType:'application/pdf',buffer:fixture.pdf()},'action');
  expect(output.name).toBe('sample.txt');
  expect(output.bytes.toString()).toContain('Page 1 sample'); expect(output.bytes.toString()).toContain('Page 2 sample');
});

test('PDF images ZIP contains every page as a decodable PNG', async ({page}) => {
  await open(page,'pdf');
  const output = await convert(page,'pdf','to-img',{name:'sample.pdf',mimeType:'application/pdf',buffer:fixture.pdf()},'action');
  const zip = await JSZip.loadAsync(output.bytes);
  expect(Object.keys(zip.files)).toEqual(['page_1.png','page_2.png']);
  for (const file of Object.values(zip.files)) {
    const png = await file.async('nodebuffer');
    expect(png.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
    expect(png.readUInt32BE(16)).toBe(600); expect(png.readUInt32BE(20)).toBe(600);
    const dimensions = await page.evaluate(async base64 => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      return {width:image.naturalWidth,height:image.naturalHeight};
    },png.toString('base64'));
    expect(dimensions).toEqual({width:600,height:600});
  }
});

test('two images merge into two PDF pages', async ({page}) => {
  await open(page,'pdf');
  const files = [1,2].map(i=>({name:`image${i}.png`,mimeType:'image/png',buffer:fixture.png()}));
  const output = await convert(page,'pdf','merge',files,'action');
  expect((await inspectPdf(page,output)).pages).toBe(2);
});

test('corrupt input fails then a valid file succeeds without reload', async ({page}) => {
  await open(page);
  await page.locator('#img-input').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('corrupt')});
  await page.locator('#img-btn').click();
  await expect(page.locator('#statusText')).toContainText('图片无法解码');
  await expect(page.locator('#task-progress')).toBeHidden();
  await expect(page.locator('#retry-btn')).toBeVisible();
  await convert(page,'img','png',{name:'good.png',mimeType:'image/png',buffer:fixture.png()});
});

test('dependency failure retries the same operation', async ({page}) => {
  await open(page,'doc');
  await page.route('**/vendor/xlsx/xlsx.full.min.js',route=>route.abort());
  await page.locator('#doc-input').setInputFiles({name:'book.xlsx',mimeType:'application/octet-stream',buffer:fixture.xlsx()});
  await page.locator('#doc-format').selectOption('json'); await page.locator('#doc-btn').click();
  await expect(page.locator('#statusText')).toContainText('加载失败');
  await page.unroute('**/vendor/xlsx/xlsx.full.min.js');
  await page.locator('#retry-btn').click();
  await expect(page.locator('#statusText')).toHaveText('转换完成');
});

test('failed PDF module import can be retried in the same browser', async ({page}) => {
  await open(page,'pdf');
  await page.route('**/vendor/pdfjs/pdf.min.mjs*',route=>route.abort());
  await page.locator('#pdf-input').setInputFiles({name:'sample.pdf',mimeType:'application/pdf',buffer:fixture.pdf()});
  await page.locator('#pdf-action').selectOption('to-txt'); await page.locator('#pdf-btn').click();
  await expect(page.locator('#task-progress')).toBeHidden();
  await expect(page.locator('#statusText')).toContainText('加载失败');
  await page.unroute('**/vendor/pdfjs/pdf.min.mjs*'); await page.locator('#retry-btn').click();
  await expect(page.locator('#task-progress')).toBeHidden();
  await expect(page.locator('#statusText')).toHaveText('处理完成');
});

test('image-only PDF gives a clear no-OCR error instead of empty success', async ({page}) => {
  await open(page,'pdf');
  const output = await convert(page,'pdf','merge',{name:'image.png',mimeType:'image/png',buffer:fixture.png()},'action');
  await page.locator('#pdf-input').setInputFiles({name:'scan.pdf',mimeType:'application/pdf',buffer:output.bytes});
  await page.locator('#pdf-action').selectOption('to-txt'); await page.locator('#pdf-btn').click();
  await expect(page.locator('#task-progress')).toBeHidden();
  await expect(page.locator('#statusText')).toContainText('未提取到文字');
});

test('over 50 PDF pages are rejected then valid PDF succeeds', async ({page}) => {
  await open(page,'pdf');
  await page.locator('#pdf-input').setInputFiles({name:'large.pdf',mimeType:'application/pdf',buffer:fixture.pdf(51)});
  await page.locator('#pdf-btn').click();
  await expect(page.locator('#statusText')).toContainText('最多支持 50 页');
  await expect(page.locator('#task-progress')).toBeHidden();
  await convert(page,'pdf','to-txt',{name:'small.pdf',mimeType:'application/pdf',buffer:fixture.pdf()},'action');
});

test('corrupt PDF releases the failed task and recovers', async ({page}) => {
  await open(page,'pdf');
  await page.locator('#pdf-input').setInputFiles({name:'broken.pdf',mimeType:'application/pdf',buffer:Buffer.from('not a PDF')});
  await page.locator('#pdf-btn').click();
  await expect(page.locator('#task-progress')).toBeHidden();
  await expect(page.locator('#statusText')).toContainText('失败');
  await convert(page,'pdf','to-txt',{name:'valid.pdf',mimeType:'application/pdf',buffer:fixture.pdf()},'action');
});

test('ordinary conversions make only same-origin GET requests', async ({page}) => {
  const requests = []; page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  await open(page,'doc');
  await convert(page,'doc','html',{name:'private.docx',mimeType:'application/octet-stream',buffer:await fixture.docx()});
  expect(requests.filter(r=>r.method!=='GET')).toEqual([]);
  expect(requests.filter(r=>!r.url.startsWith('http://127.0.0.1:8080/')&&!r.url.startsWith('blob:'))).toEqual([]);
});

test.describe('real FFmpeg conversion', () => {
  test.beforeEach(async ({page}) => {
    for (const ext of ['js','wasm']) {
      const file = path.resolve('.test-cache',`ffmpeg-core.${ext}`);
      if (!fs.existsSync(file)) throw new Error('Run scripts/cache-core.ps1 before media tests');
      await page.route(`**/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.${ext}`,route=>route.fulfill({path:file,contentType:ext==='js'?'text/javascript':'application/wasm'}));
    }
  });
  test('failed engine download can be retried without reloading', async ({page}) => {
    await open(page,'audio');
    await page.route('**/ffmpeg-core.js',route=>route.abort());
    await page.locator('#aud-input').setInputFiles({name:'tone.wav',mimeType:'audio/wav',buffer:fixture.wav()});
    await page.locator('#aud-btn').click();
    await expect(page.locator('#task-progress')).toBeHidden();
    await expect(page.locator('#statusText')).toContainText('初始化失败');
    await page.unroute('**/ffmpeg-core.js');
    await page.locator('#retry-btn').click();
    await expect(page.locator('#task-progress')).toBeHidden();
    await expect(page.locator('#statusText')).toHaveText('转换完成');
  });
  test('cancel engine download then initialize and convert successfully', async ({page}) => {
    await open(page, 'audio');
    let heldRoute;
    await page.route('**/ffmpeg-core.js', route => { heldRoute = route; });
    await page.locator('#aud-input').setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: fixture.wav() });
    await page.locator('#aud-btn').click();
    await expect.poll(() => !!heldRoute).toBe(true);
    await page.locator('#cancel-btn').click();
    await expect(page.locator('#task-progress')).toBeHidden();
    await expect(page.locator('#statusText')).toContainText('任务已取消');
    await expect(page.locator('#results-list a')).toHaveCount(0);
    await heldRoute.abort();
    await page.unroute('**/ffmpeg-core.js');
    await page.locator('#aud-btn').click();
    await expect(page.locator('#statusText')).toHaveText('转换完成');
    await expect(page.locator('#results-list a')).toHaveCount(1);
  });
  test('corrupt audio fails and valid audio works on the same page', async ({page}) => {
    await open(page,'audio');
    await page.locator('#aud-input').setInputFiles({name:'broken.wav',mimeType:'audio/wav',buffer:Buffer.from('not audio')});
    await page.locator('#aud-btn').click();
    await expect(page.locator('#task-progress')).toBeHidden();
    await expect(page.locator('#statusText')).toContainText('失败');
    await convert(page,'aud','mp3',{name:'good.wav',mimeType:'audio/wav',buffer:fixture.wav()});
  });
  for (const format of ['mp3','wav','flac','m4a']) {
    test(`audio -> ${format}: browser can decode one second of audio`, async ({page}) => {
      await open(page,'audio');
      const output = await convert(page,'aud',format,{name:'tone.wav',mimeType:'audio/wav',buffer:fixture.wav()});
      if (format === 'flac') expect(output.bytes.subarray(0,4).toString()).toBe('fLaC');
      const info = await page.evaluate(async base64 => {
        const context = new AudioContext();
        try { const audio = await context.decodeAudioData(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)).buffer); return {duration:audio.duration, channels:audio.numberOfChannels}; }
        finally { await context.close(); }
      },output.encoded);
      expect(info.duration).toBeGreaterThan(.8); expect(info.duration).toBeLessThan(1.5); expect(info.channels).toBe(1);
    });
  }
  for (const format of ['mp4','webm','mp3','gif']) {
    test(`video -> ${format}: generated video and audio can be reopened`, async ({page}) => {
      await open(page,'video');
      const output = await convert(page,'vid',format,{name:'sample.webm',mimeType:'video/webm',buffer:fs.readFileSync(path.resolve('.test-cache/video.webm'))});
      if(format==='gif') {
        expect(output.bytes.subarray(0,3).toString()).toBe('GIF');
        expect(output.bytes.readUInt16LE(6)).toBe(480);
        expect(await page.evaluate(async base64=>{const image=new Image();image.src=`data:image/gif;base64,${base64}`;await image.decode();return image.naturalWidth;},output.encoded)).toBe(480);
      } else if(format==='mp3') {
        const duration=await page.evaluate(async base64=>{const ctx=new AudioContext();try{return(await ctx.decodeAudioData(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)).buffer)).duration;}finally{await ctx.close();}},output.encoded);
        expect(duration).toBeGreaterThan(.5);
      } else {
        const dimensions=await page.evaluate(async ({base64,type})=>{const video=document.createElement('video');video.src=`data:${type};base64,${base64}`;await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('Video output cannot decode'));});return {width:video.videoWidth,height:video.videoHeight};},{base64:output.encoded,type:output.type});
        expect(dimensions).toEqual({width:64,height:64});
      }
    });
  }
});
