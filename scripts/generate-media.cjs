// Synthetic fixture only: red 64x64 video with a 440 Hz tone, one second long.
const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const cache = path.resolve(__dirname, '..', '.test-cache');
  if (!fs.existsSync(path.join(cache,'ffmpeg-core.wasm'))) throw new Error('Cache the FFmpeg core first: node scripts/cache-core.cjs');
  const createCore = require(path.join(cache,'ffmpeg-core.js'));
  const core = await createCore({wasmBinary:fs.readFileSync(path.join(cache,'ffmpeg-core.wasm'))});
  core.exec('-f','lavfi','-i','color=c=red:s=64x64:r=10:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libvpx','-c:a','libopus','fixture.webm');
  if (core.ret !== 0) throw new Error('Synthetic video fixture generation failed');
  fs.writeFileSync(path.join(cache,'video.webm'),core.FS.readFile('fixture.webm'));
  console.log('Generated synthetic one-second video fixture');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
