// Cross-platform counterpart to cache-core.ps1 for CI.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { external } = require('../vendor/manifest.json');
async function main() {
  const cache = path.resolve(__dirname, '..', '.test-cache');
  fs.mkdirSync(cache, {recursive:true});
  const core = external.find(item => item.name === 'FFmpeg core');
  for (const [i, extension] of ['js','wasm'].entries()) {
    const target = path.join(cache, `ffmpeg-core.${extension}`);
    let bytes;
    if (fs.existsSync(target)) bytes = fs.readFileSync(target);
    else {
      const response = await fetch(core.urls[i], {signal:AbortSignal.timeout(90000)});
      if (!response.ok) throw new Error(`Core download failed: ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== core.sha256[extension]) throw new Error(`Core checksum mismatch: ${extension}`);
    if (!fs.existsSync(target)) fs.writeFileSync(target,bytes);
    console.log(`Verified cached ffmpeg-core.${extension}`);
  }
}
main().catch(error => {console.error(error.message);process.exitCode=1;});
