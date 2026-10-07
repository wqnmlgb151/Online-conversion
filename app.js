    (function() {
      // ================= 配置与状态 =================
      const LIBS = {
        html2canvas: { var: 'html2canvas', urls: ['vendor/html2canvas/html2canvas.min.js'] },
        purify: { var: 'DOMPurify', urls: ['vendor/dompurify/purify.min.js'] },
        marked: { var: 'marked', urls: ['vendor/marked/marked.min.js'] },
        xlsx: {
          var: 'XLSX',
          urls: ['vendor/xlsx/xlsx.full.min.js']
        },
        mammoth: {
          var: 'mammoth',
          urls: ['vendor/mammoth/mammoth.browser.min.js']
        },
        jspdf: {
          var: 'jspdf',
          urls: ['vendor/jspdf/jspdf.umd.min.js']
        },
        pdfjs: {
          var: 'pdfjsLib',
          module: true,
          urls: ['./vendor/pdfjs/pdf.min.mjs'],
          init: () => { if(window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.mjs'; }
        },
        jszip: {
          var: 'JSZip',
          urls: ['vendor/jszip/jszip.min.js']
        },
        ffmpeg: {
          var: 'FFmpegWASM',
          urls: ['vendor/ffmpeg/ffmpeg.js'],
          integrity: {"text/javascript": "a34873964b0f62aec516bac75e3aa9086ec3535d4d07f0269aa94ea748b6cb71", "application/wasm": "2390efa7fb66e7e42dbae15427571a5ffc96b829480904c30f471f0a78967f61"},
          core: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js'
        }
      };

      const state = {
        loaded: {},
        dependencyStatus: {},
        lastAction: null,
        ffmpeg: null,
        ffmpegReady: false,
        _busy: false,
        get busy() { return this._busy; },
        set busy(value) {
          this._busy = value;
          document.querySelectorAll('button, input, select').forEach(el => { el.disabled = value; });
          document.querySelector('main').setAttribute('aria-busy', String(value));
        },
        activeBlob: null
      };

      // ================= 工具函数 =================
      const $ = (id) => document.getElementById(id);
      const setStatus = msg => {
        $('statusText').textContent = msg;
        const failure = /失败|错误|超时/.test(msg);
        $('statusText').setAttribute('role', failure ? 'alert' : 'status');
        $('retry-btn').classList.toggle('hidden', !failure || !state.lastAction);
      };
      
      const clearBlob = () => {
        if (state.activeBlob) {
          URL.revokeObjectURL(state.activeBlob);
          state.activeBlob = null;
        }
        // 隐藏所有下载链接
        ['img-down','vid-down','aud-down','doc-down','pdf-down'].forEach(id => $(id).classList.add('hidden'));
      };

      const triggerDownload = (linkEl, blob, filename) => {
        if (!(blob instanceof Blob) || !blob.size) throw new Error('未生成有效文件');
        clearBlob();
        const url = URL.createObjectURL(blob);
        state.activeBlob = url;
        linkEl.href = url;
        linkEl.download = filename;
        linkEl.parentElement.classList.remove('hidden');
      };

      const { withTimeout, fetchBytes, createLoader } = ConversionRuntime;
      const loader = createLoader(LIBS, {
        onState: (name, status) => {
          state.dependencyStatus[name] = status;
          state.loaded[name] = status === 'success';
          if (status === 'loading') setStatus(`正在加载 ${name}...`);
          updateMiniStatus();
        }
      });
      const ensureLib = name => loader.ensure(name);
      ['img','vid','aud','doc','pdf'].forEach(prefix => {
        $(`${prefix}-btn`).addEventListener('click', () => { state.lastAction = `${prefix}-btn`; });
      });
      $('retry-btn').addEventListener('click', () => {
        if (!state.busy && state.lastAction) $(state.lastAction).click();
      });

      // 初始化 FFmpeg
      const initFFmpeg = async () => {
        if (state.ffmpegReady) return true;
        if (!(await ensureLib('ffmpeg'))) return false;
        
        setStatus("正在初始化 FFmpeg (约30MB)...");
        state.dependencyStatus.ffmpeg = 'loading';
        updateMiniStatus();
        try {
          state.ffmpeg = new FFmpegWASM.FFmpeg();
          const urls = [];
          try {
            const asBlob = async (url, type) => {
              const blobURL = URL.createObjectURL(new Blob([await fetchBytes(url, 60000, LIBS.ffmpeg.integrity[type])], { type }));
              urls.push(blobURL);
              return blobURL;
            };
            await withTimeout(state.ffmpeg.load({
              coreURL: await asBlob(LIBS.ffmpeg.core, 'text/javascript'),
              wasmURL: await asBlob(LIBS.ffmpeg.core.replace(/\.js$/, '.wasm'), 'application/wasm')
            }), 45000, '引擎初始化超时', () => state.ffmpeg?.terminate());
          } finally { urls.forEach(url => URL.revokeObjectURL(url)); }
          state.ffmpegReady = true;
          state.dependencyStatus.ffmpeg = 'success';
          state.fetchFile = async file => new Uint8Array(await file.arrayBuffer());
          updateMiniStatus();
          return true;
        } catch (e) {
          state.ffmpeg?.terminate();
          state.ffmpeg = null;
          state.ffmpegReady = false;
          state.dependencyStatus.ffmpeg = 'error';
          updateMiniStatus();
          throw new Error(`FFmpeg 初始化失败：${e?.message || e}，可点击重试`);
        }
      };

      // 更新右上角小状态
      const updateMiniStatus = () => {
        const container = $('miniLibStatus');
        container.innerHTML = '';
        // 只显示几个关键库
        const checks = [
          { id: 'xlsx', label: 'Excel' },
          { id: 'pdfjs', label: 'PDF' },
          { id: 'ffmpeg', label: 'FFmpeg', ready: () => state.ffmpegReady }
        ];
        
        checks.forEach(c => {
          const div = document.createElement('div');
          div.className = 'flex items-center';
          const dot = document.createElement('span');
          
          let isReady = state.loaded[c.id];
          if (c.ready) isReady = c.ready();

          const status = isReady ? 'success' : (c.id === 'ffmpeg' && state.dependencyStatus[c.id] === 'success' ? 'idle' : state.dependencyStatus[c.id] || 'idle');
          dot.className = `lib-dot dot-${status}`;
          div.title = { idle: '尚未加载', loading: '加载中', success: '已就绪', error: '加载失败，可重试' }[status];
          div.appendChild(dot);
          div.appendChild(document.createTextNode(c.label));
          container.appendChild(div);
        });
      };

      const outputName = (name, ext) => name.replace(/\.[^.]+$/, '') + '.' + ext;
      const escapeHTML = text => text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const loadImage = async (img, file) => {
        const url = URL.createObjectURL(file);
        try {
          await withTimeout(new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('图片无法解码，请选择有效图片'));
            img.src = url;
          }), 15000, '图片解码超时，请选择较小图片');
          if (img.naturalWidth * img.naturalHeight > 40000000) throw new Error('图片超过 4000 万像素');
        } finally { URL.revokeObjectURL(url); }
      };
      // Validate before expensive decoding and give immediate feedback.
      document.querySelectorAll('input[type=file]').forEach(input => {
        input.addEventListener('change', () => {
          clearBlob();
          const files = Array.from(input.files);
          const limit = ['vid-input','aud-input'].includes(input.id) ? 200 : 30;
          if (files.some(file => !file.size || file.size > limit * 1024 * 1024) || files.reduce((n, file) => n + file.size, 0) > 200 * 1024 * 1024) {
            input.value = '';
            setStatus(`文件不能为空，单个文件最多 ${limit} MB，总大小最多 200 MB`);
          } else { setStatus(files.length ? `已选择 ${files.length} 个文件` : '就绪'); }
          if (input.id === 'doc-input') updateDocFormats();
        });
      });
      const updateDocFormats = () => {
        const excel = /\.xlsx$/i.test($('doc-input').files[0]?.name || '');
        for (const option of $('doc-format').options) option.disabled = ['json','csv'].includes(option.value) && !excel;
        if ($('doc-format').selectedOptions[0].disabled) $('doc-format').value = 'pdf';
      };
      window.addEventListener('pagehide', clearBlob);

      // ================= Tab 切换 =================
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          // UI 更新
          document.querySelectorAll('.tab-btn').forEach(b => {
            b.classList.remove('border-blue-600', 'text-blue-600');
            b.classList.add('border-transparent', 'text-gray-500');
          });
          btn.classList.add('border-blue-600', 'text-blue-600');
          btn.classList.remove('border-transparent', 'text-gray-500');

          // 面板切换
          const tab = btn.dataset.tab;
          document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden-tab'));
          $(`panel-${tab}`).classList.remove('hidden-tab');
          clearBlob();
          setStatus("就绪");
        });
      });

      // ================= 功能实现 =================

      // 1. 图片转换
      $('img-btn').addEventListener('click', async () => {
        if (state.busy) return;
        const file = $('img-input').files[0];
        if (!file) return setStatus("请先选择图片");
        
        state.busy = true;
        setStatus("处理中...");
        clearBlob();

        try {
          const quality = parseFloat($('img-quality').value);
          if (!Number.isFinite(quality) || quality < 0.1 || quality > 1) throw new Error('质量必须在 0.1 至 1 之间');
          const img = new Image();
          await loadImage(img, file);

          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if ($('img-format').value === 'jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
          ctx.drawImage(img, 0, 0);

          const fmt = $('img-format').value;
          const blob = await new Promise(res => canvas.toBlob(res, `image/${fmt}`, quality));
          
          if (!blob || blob.type !== `image/${fmt}`) throw new Error('浏览器不支持该输出格式');
          const newName = outputName(file.name, fmt === 'jpeg' ? 'jpg' : fmt);
          triggerDownload($('img-link'), blob, newName);
          setStatus("转换完成");
        } catch (e) {
          setStatus("转换失败: " + (e?.message || String(e)));
        } finally {
          state.busy = false;
        }
      });

      // 通用 FFmpeg 处理
      const runFFmpeg = async (file, ext, args, outName, mime) => {
        if (!(await initFFmpeg())) return;
        const { ffmpeg, fetchFile } = state;
        
        const inName = `input.${ext}`;
        try {
          await withTimeout(ffmpeg.writeFile(inName, await fetchFile(file)), 15000, '写入引擎超时', () => { ffmpeg.terminate(); state.ffmpegReady = false; });
          const code = await withTimeout(ffmpeg.exec(args, 120000), 125000, '转换超时，请尝试更短的文件', () => {
            ffmpeg.terminate(); state.ffmpegReady = false;
          });
          if (code !== 0) throw new Error('转换失败，文件损坏或编码不受支持');
          const data = await withTimeout(ffmpeg.readFile(outName), 15000, '读取结果超时', () => { ffmpeg.terminate(); state.ffmpegReady = false; });
          return new Blob([data], { type: mime });
        } finally {
          if (state.ffmpegReady) {
            const cleanup = await Promise.allSettled([inName, outName].map(name =>
              withTimeout(ffmpeg.deleteFile(name), 3000, '清理超时')));
            if (cleanup.some(result => result.status === 'rejected')) {
              ffmpeg.terminate(); state.ffmpegReady = false;
            }
          }
          updateMiniStatus();
        }
      };

      // 2. 视频转换
      $('vid-btn').addEventListener('click', async () => {
        if (state.busy) return;
        const file = $('vid-input').files[0];
        if (!file) return setStatus("请先选择视频");
        
        state.busy = true;
        setStatus("准备中...");
        clearBlob();

        try {
          const fmt = $('vid-format').value;
          const ext = file.name.split('.').pop();
          const outFile = 'output.' + (fmt === 'mp3' ? 'mp3' : fmt);
          const mime = { mp3: 'audio/mpeg', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm' }[fmt];
          
          let args = ['-i', 'input.' + ext];
          if (fmt === 'gif') {
             args = args.concat(['-t', '10', '-vf', 'fps=10,scale=480:-1', '-f', 'gif']); // 默认只转10秒防止太大
          } else if (fmt === 'mp3') {
             args = args.concat(['-vn', '-acodec', 'libmp3lame', '-ab', '192k']);
          } else if (fmt === 'mp4') {
             args = args.concat(['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
          } else if (fmt === 'webm') {
             args = args.concat(['-c:v', 'libvpx', '-b:v', '1M', '-c:a', 'libvorbis']);
          }
          args.push(outFile);

          setStatus("正在转换 (这可能需要几分钟)...");
          const blob = await runFFmpeg(file, ext, args, outFile, mime);
          
          triggerDownload($('vid-link'), blob, outputName(file.name, fmt));
          setStatus("转换完成");
        } catch (e) {
          setStatus("失败: " + (e?.message || String(e)));
        } finally {
          state.busy = false;
        }
      });

      // 3. 音频转换
      $('aud-btn').addEventListener('click', async () => {
        if (state.busy) return;
        const file = $('aud-input').files[0];
        if (!file) return setStatus("请先选择音频");
        
        state.busy = true;
        setStatus("准备中...");
        clearBlob();

        try {
          const fmt = $('aud-format').value;
          const ext = file.name.split('.').pop();
          const outFile = 'output.' + fmt;
          const mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4' };
          
          let args = ['-i', 'input.' + ext];
          if (fmt === 'mp3') args.push('-acodec', 'libmp3lame', '-ab', '320k');
          else if (fmt === 'wav') args.push('-acodec', 'pcm_s16le');
          else if (fmt === 'flac') args.push('-acodec', 'flac');
          else if (fmt === 'm4a') args.push('-acodec', 'aac', '-ab', '320k', '-f', 'mp4');
          args.push(outFile);

          setStatus("正在转换...");
          const blob = await runFFmpeg(file, ext, args, outFile, mimeMap[fmt] || 'audio/octet-stream');
          
          triggerDownload($('aud-link'), blob, outputName(file.name, fmt));
          setStatus("转换完成");
        } catch (e) {
          setStatus("失败: " + (e?.message || String(e)));
        } finally {
          state.busy = false;
        }
      });

      // Sanitize before rendering: source documents cannot load remote resources.
      const sanitize = async html => {
        await ensureLib('purify');
        return DOMPurify.sanitize(html, {
          ALLOWED_TAGS: ['p','br','div','span','pre','code','h1','h2','h3','h4','strong','em','b','i','ul','ol','li','table','thead','tbody','tr','td','th','blockquote','hr'],
          ALLOWED_ATTR: ['colspan','rowspan']
        });
      };
      const htmlDocument = html => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>转换文档</title><body>${html}</body></html>`;
      const htmlToPdf = async htmlStr => {
        await ensureLib('jspdf');
        await ensureLib('html2canvas');
        const container = document.createElement('div');
        container.innerHTML = await sanitize(htmlStr);
        container.style.cssText = 'position:absolute;left:-10000px;top:0;width:714px;padding:32px;background:white;color:black;font:16px/1.6 sans-serif;overflow-wrap:anywhere';
        container.querySelectorAll('pre').forEach(el => { el.style.whiteSpace = 'pre-wrap'; });
        document.body.appendChild(container);
        try {
          await document.fonts.ready;
          if (container.scrollHeight > 20000) throw new Error('文档过长，请导出 HTML 后使用浏览器打印为 PDF');
          const canvas = await html2canvas(container, { scale: 1.5, backgroundColor: '#fff' });
          const pdf = new jspdf.jsPDF();
          const pageHeight = Math.floor(canvas.width * 277 / 190);
          for (let y = 0; y < canvas.height; y += pageHeight) {
            if (y) pdf.addPage();
            const slice = document.createElement('canvas');
            slice.width = canvas.width;
            slice.height = Math.min(pageHeight, canvas.height - y);
            slice.getContext('2d').drawImage(canvas, 0, y, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
            pdf.addImage(slice, 'PNG', 10, 10, 190, slice.height * 190 / canvas.width);
            slice.width = slice.height = 0;
          }
          canvas.width = canvas.height = 0;
          return pdf.output('blob');
        } finally { container.remove(); }
      };

      // 4. 文档转换
      $('doc-btn').addEventListener('click', async () => {
        if (state.busy) return;
        const file = $('doc-input').files[0];
        if (!file) return setStatus("请先选择文档");
        
        state.busy = true;
        setStatus("处理中...");
        clearBlob();

        const ext = file.name.split('.').pop().toLowerCase();
        const target = $('doc-format').value;
        let blob = null;
        let filename = outputName(file.name, target);

        try {
          if (!['xlsx','docx','md','txt'].includes(ext)) throw new Error('请选择 XLSX、DOCX、Markdown 或 TXT 文件');
          if (['json','csv'].includes(target) && ext !== 'xlsx') throw new Error('JSON 和 CSV 输出仅支持 Excel');
          const buf = await file.arrayBuffer();

          if (ext === 'xlsx') {
            if (!(await ensureLib('xlsx'))) return;
            const wb = XLSX.read(buf);
            const ws = wb.Sheets[wb.SheetNames[0]];
            
            if (target === 'json') {
              const json = XLSX.utils.sheet_to_json(ws);
              blob = new Blob([JSON.stringify(json, null, 2)], {type: 'application/json'});
            } else if (target === 'pdf') {
              blob = await htmlToPdf(XLSX.utils.sheet_to_html(ws));
            } else if (target === 'html') {
              blob = new Blob([htmlDocument(await sanitize(XLSX.utils.sheet_to_html(ws)))], {type: 'text/html;charset=utf-8'});
            } else if (target === 'csv') {
              blob = new Blob(['\ufeff' + XLSX.utils.sheet_to_csv(ws)], {type: 'text/csv;charset=utf-8'});
            } else {
              blob = new Blob([XLSX.utils.sheet_to_csv(ws, {FS: '\t'})], {type: 'text/plain;charset=utf-8'});
            }
          } 
          else if (ext === 'docx') {
            if (!(await ensureLib('mammoth'))) return;
            if (target === 'txt') {
              const raw = await mammoth.extractRawText({ arrayBuffer: buf });
              blob = new Blob([raw.value], {type: 'text/plain;charset=utf-8'});
            } else {
            const result = await mammoth.convertToHtml({ arrayBuffer: buf });
            const html = await sanitize(result.value);
            
            if (target === 'html') {
              blob = new Blob([htmlDocument(html)], {type: 'text/html;charset=utf-8'});
            } else if (target === 'pdf') {
               blob = await htmlToPdf(html);
            }
            }
          }
          else if (ext === 'md' || ext === 'txt') {
             const text = await file.text();
             let html = `<pre>${escapeHTML(text)}</pre>`;
             if (ext === 'md' && target !== 'txt') { await ensureLib('marked'); html = await sanitize(marked.parse(text)); }
             if (target === 'pdf') {
                blob = await htmlToPdf(html);
             } else if (target === 'html') {
                blob = new Blob([htmlDocument(html)], {type: 'text/html;charset=utf-8'});
             } else {
                blob = new Blob([text], {type: 'text/plain'});
             }
          }

          if (blob) {
            triggerDownload($('doc-link'), blob, filename);
            setStatus("转换完成");
          } else {
            setStatus("不支持的转换格式");
          }
        } catch (e) {
          setStatus("失败: " + (e?.message || String(e)));
        } finally {
          state.busy = false;
        }
      });

      // 5. PDF 处理
      $('pdf-btn').addEventListener('click', async () => {
        if (state.busy) return;
        const files = Array.from($('pdf-input').files);
        if (files.length === 0) return setStatus("请先选择文件");
        
        state.busy = true;
        setStatus("处理中...");
        clearBlob();

        const action = $('pdf-action').value;
        let blob = null;
        let filename = "output";

        try {
          if (action === 'merge') {
            if (!(await ensureLib('jspdf'))) return;
            const { jsPDF } = jspdf;
            const pdf = new jsPDF();
            const imgs = files;
            if (!imgs.every(f => f.type.startsWith('image/'))) throw new Error('图片合并只能选择图片文件');
            
            for(let i=0; i<imgs.length; i++) {
              setStatus(`添加图片 ${i+1}/${imgs.length}`);
              const img = new Image();
              await loadImage(img, imgs[i]);
              
              if(i>0) pdf.addPage();
              const pw = pdf.internal.pageSize.getWidth();
              const ph = pdf.internal.pageSize.getHeight();
              const ratio = Math.min(pw/img.width, ph/img.height) * 0.9;
              const w = img.width * ratio;
              const h = img.height * ratio;
              const imageCanvas = document.createElement('canvas');
              imageCanvas.width = img.naturalWidth; imageCanvas.height = img.naturalHeight;
              imageCanvas.getContext('2d').drawImage(img, 0, 0);
              pdf.addImage(imageCanvas, 'PNG', (pw-w)/2, (ph-h)/2, w, h);
              imageCanvas.width = imageCanvas.height = 0;
            }
            blob = pdf.output('blob');
            filename = "合并.pdf";
          } 
          else {
            if (files.length !== 1) throw new Error('请只选择一个 PDF 文件');
            const pdfFile = files.find(f => /\.pdf$/i.test(f.name));
            if (!pdfFile) throw new Error("请选择PDF文件");
            
            if (!(await ensureLib('pdfjs'))) return;
            if (action === 'to-img') await ensureLib('jszip');

            const buf = await pdfFile.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({data: buf, isEvalSupported: false});
            try {
            const pdf = await loadingTask.promise;

            if (action === 'to-txt') {
              let text = "";
              let characters = 0;
              for(let i=1; i<=pdf.numPages; i++) {
                setStatus(`提取文本 ${i}/${pdf.numPages}`);
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                characters += content.items.reduce((count, item) => count + (item.str || '').trim().length, 0);
                text += `--- Page ${i} ---\n`;
                text += content.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join('') + '\n';
                page.cleanup();
              }
              if (!characters) throw new Error('未提取到文字：文件可能是扫描版，本工具不提供 OCR');
              blob = new Blob([text], {type: 'text/plain'});
              filename = outputName(pdfFile.name, 'txt');
            } 
            else if (action === 'to-img') {
              const zip = new JSZip();
              if (pdf.numPages > 50) throw new Error('PDF 转图片最多支持 50 页，请先拆分文档');
              const maxPages = pdf.numPages;
              for(let i=1; i<=maxPages; i++) {
                setStatus(`渲染图片 ${i}/${maxPages}`);
                const page = await pdf.getPage(i);
                const scale = 2;
                const viewport = page.getViewport({scale});
                if (viewport.width * viewport.height > 40000000) throw new Error('PDF 页面超过 4000 万像素，无法安全渲染');
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                await page.render({canvasContext: canvas.getContext('2d'), viewport}).promise;
                
                const imgBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));
                if (!imgBlob) throw new Error('页面图片生成失败');
                zip.file(`page_${i}.png`, imgBlob);
                canvas.width = canvas.height = 0;
                page.cleanup();
              }
              blob = await zip.generateAsync({type: 'blob'});
              filename = outputName(pdfFile.name, 'zip');
            }
            } finally { await loadingTask.destroy(); }
          }

          if (blob) {
            triggerDownload($('pdf-link'), blob, filename);
            setStatus("处理完成");
          }
        } catch (e) {
          setStatus("失败: " + (e?.message || String(e)));
        } finally {
          state.busy = false;
        }
      });

      // 初始化
      updateMiniStatus();
      setStatus("就绪");
      updateDocFormats();

    })();
