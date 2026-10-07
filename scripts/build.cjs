const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
fs.mkdirSync(output, {recursive:true});
const files = ['index.html','app.js','runtime.js','styles.css','privacy.html',
  'vendor/manifest.json','vendor/checksums.json',
  ...require('../vendor/manifest.json').libraries.flatMap(library=>library.files)];
for (const file of files) {
  const target = path.join(output,file);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.copyFileSync(path.join(root,file),target);
}
console.log(`Built ${files.length} static files into dist (no test cache or node_modules)`);
