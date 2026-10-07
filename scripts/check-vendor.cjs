const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const manifest = require('../vendor/manifest.json');
const checksumFile = path.join(root, 'vendor/checksums.json');
const actual = {};
for (const library of manifest.libraries) {
  if (library.files.length !== library.urls.length) throw new Error(`Incomplete provenance: ${library.name}`);
  for (const file of library.files) {
    const resolved = path.resolve(root, file);
    if (!resolved.startsWith(path.join(root, 'vendor') + path.sep)) throw new Error(`Invalid path: ${file}`);
    const bytes = fs.readFileSync(resolved);
    if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error(`Invalid static asset size: ${file}`);
    actual[file] = crypto.createHash('sha256').update(bytes).digest('hex');
  }
}
if (process.argv.includes('--write')) {
  fs.writeFileSync(checksumFile, JSON.stringify(actual, null, 2) + '\n');
  console.log(`Recorded ${Object.keys(actual).length} vendor checksums`);
} else {
  const expected = JSON.parse(fs.readFileSync(checksumFile, 'utf8'));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Vendor checksum mismatch: review changed files before updating checksums');
  console.log(`Verified ${Object.keys(actual).length} vendor files and licenses`);
}
