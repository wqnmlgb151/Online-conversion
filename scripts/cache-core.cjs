// Cross-platform counterpart to cache-core.ps1 for CI.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { external } = require('../vendor/manifest.json');
async function main() {
  const probe = process.argv.includes('--probe');
  const cache = path.resolve(__dirname, '..', '.test-cache');
  if (!probe) fs.mkdirSync(cache, {recursive:true});
  const core = external.find(item => item.name === 'FFmpeg core');
  for (const [i, extension] of ['js','wasm'].entries()) {
    const target = path.join(cache, `ffmpeg-core.${extension}`);
    let bytes;
    const started = Date.now();
    if (!probe && fs.existsSync(target)) bytes = fs.readFileSync(target);
    else {
      const response = await fetch(core.urls[i], {signal:AbortSignal.timeout(probe ? 60000 : 90000), cache:'no-store'});
      if (!response.ok) throw new Error(`Core download failed: ${response.status}`);
      if (probe && response.headers.get('access-control-allow-origin') !== '*') throw new Error(`Core response is missing public CORS permission: ${extension}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== core.sha256[extension]) throw new Error(`Core checksum mismatch: ${extension}`);
    if (!probe && !fs.existsSync(target)) fs.writeFileSync(target,bytes);
    console.log(probe ? `Verified fresh CDN ffmpeg-core.${extension}: ${bytes.length} bytes, SHA-256 and CORS passed, ${Date.now() - started} ms` : `Verified cached ffmpeg-core.${extension}`);
  }
}
main().catch(error => {console.error(error.message);process.exitCode=1;});
