// Verify the directory that Cloudflare Pages will publish, including stale files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const vendor = require('../vendor/manifest.json');
const expected = new Set([
  'index.html', 'app.js', 'runtime.js', 'offline.js', 'sw.js', 'offline-assets.js',
  'manifest.webmanifest', 'styles.css', 'privacy.html', 'favicon.svg', 'guide.html',
  'examples/sample.md', 'vendor/manifest.json', 'vendor/checksums.json',
  ...vendor.libraries.flatMap(library => library.files)
]);

function verify() {
  let count = 0, largest = 0;
  function walk(directory) {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name), info = fs.lstatSync(file);
      const relative = path.relative(output, file).split(path.sep).join('/');
      if (info.isSymbolicLink()) throw new Error(`Publish directory contains a symbolic link: ${relative}`);
      if (info.isDirectory()) { walk(file); continue; }
      if (!info.isFile() || !expected.has(relative)) throw new Error(`Unexpected publish file: ${relative}`);
      if (info.size > 25 * 1024 * 1024) throw new Error(`Cloudflare Pages asset exceeds 25 MiB: ${relative}`);
      count++; largest = Math.max(largest, info.size);
    }
  }
  walk(output);
  for (const file of expected) if (!fs.existsSync(path.join(output, file))) throw new Error(`Missing publish file: ${file}`);
  const text = fs.readFileSync(path.join(output, 'offline-assets.js'), 'utf8');
  const match = /^self\.OFFLINE_ASSETS = (\{.*\});\s*$/.exec(text);
  if (!match) throw new Error('Invalid offline asset manifest');
  const config = JSON.parse(match[1]);
  const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const core = vendor.external.find(item => item.name === 'FFmpeg core');
  const resources = new Set(Object.values(config.groups).flat());
  if (Object.keys(config.hashes).length !== resources.size) throw new Error('Offline manifest resource count mismatch');
  for (const file of resources) {
    if (core.urls.includes(file)) {
      if (config.hashes[file] !== core.sha256[file.endsWith('.wasm') ? 'wasm' : 'js']) throw new Error(`Unpinned external core: ${file}`);
    } else {
      if (!expected.has(file)) throw new Error(`Unknown offline resource: ${file}`);
      if (config.hashes[file] !== digest(fs.readFileSync(path.join(output, file)))) throw new Error(`Offline checksum mismatch: ${file}`);
    }
  }
  const version = crypto.createHash('sha256').update(JSON.stringify({ groups: config.groups, hashes: config.hashes }))
    .update(fs.readFileSync(path.join(output, 'sw.js'))).digest('hex').slice(0, 20);
  if (config.version !== version) throw new Error('Offline version does not match published code');
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.webmanifest'), 'utf8'));
  if (manifest.start_url !== './' || manifest.scope !== './' || manifest.id !== './') throw new Error('PWA scope must stay within this static application');
  for (const icon of manifest.icons) if (!expected.has(icon.src)) throw new Error(`Missing PWA icon: ${icon.src}`);
  console.log(`Verified ${count} publish files, offline checksums/version and PWA scope; largest asset ${(largest / 1024 / 1024).toFixed(2)} MiB`);
}

try { verify(); } catch (error) { console.error(error.message); process.exitCode = 1; }
