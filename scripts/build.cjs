const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
fs.mkdirSync(output, {recursive:true});
const files = ['index.html','app.js','runtime.js','offline.js','sw.js','manifest.webmanifest','styles.css','privacy.html','favicon.svg','guide.html','examples/sample.md',
  'vendor/manifest.json','vendor/checksums.json',
  ...require('../vendor/manifest.json').libraries.flatMap(library=>library.files)];
for (const file of files) {
  const target = path.join(output,file);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.copyFileSync(path.join(root,file),target);
}
const groups = {
  shell: ['index.html','app.js','runtime.js','offline.js','styles.css','privacy.html','favicon.svg','manifest.webmanifest','guide.html','examples/sample.md'],
  image: ['vendor/jszip/jszip.min.js'],
  doc: ['vendor/html2canvas/html2canvas.min.js','vendor/dompurify/purify.min.js','vendor/marked/marked.min.js','vendor/xlsx/xlsx.full.min.js','vendor/mammoth/mammoth.browser.min.js','vendor/jspdf/jspdf.umd.min.js','vendor/jszip/jszip.min.js'],
  pdf: ['vendor/pdfjs/pdf.min.mjs','vendor/pdfjs/pdf.worker.min.mjs','vendor/jspdf/jspdf.umd.min.js','vendor/jszip/jszip.min.js'],
  media: ['vendor/ffmpeg/ffmpeg.js','vendor/ffmpeg/814.ffmpeg.js','vendor/jszip/jszip.min.js']
};
const hashes = {};
for (const file of new Set(Object.values(groups).flat())) {
  hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(output, file))).digest('hex');
}
const core = require('../vendor/manifest.json').external.find(item => item.name === 'FFmpeg core');
for (const url of core.urls) {
  groups.media.push(url);
  hashes[url] = core.sha256[url.endsWith('.wasm') ? 'wasm' : 'js'];
}
const version = crypto.createHash('sha256').update(JSON.stringify({ groups, hashes })).update(fs.readFileSync(path.join(output, 'sw.js'))).digest('hex').slice(0, 20);
fs.writeFileSync(path.join(output, 'offline-assets.js'), `self.OFFLINE_ASSETS = ${JSON.stringify({ version, groups, hashes })};\n`);
files.push('offline-assets.js');
console.log(`Built ${files.length} static files into dist (no test cache or node_modules)`);
