const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup() {
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, {
      files: [], value: '', textContent: '', dataset: {}, options: [], selectedOptions: [{ disabled: false }],
      classList: { add() {}, remove() {}, toggle() {} }, parentElement: { classList: { remove() {} } },
      listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; },
      appendChild() {}, replaceChildren() {}, setAttribute() {}, removeAttribute() {}
    });
    return elements.get(id);
  };
  const inputs = ['img-input', 'vid-input', 'aud-input', 'doc-input', 'pdf-input'].map(el);
  inputs.forEach((input, i) => { input.id = ['img-input', 'vid-input', 'aud-input', 'doc-input', 'pdf-input'][i]; });
  const context = {
    document: {
      getElementById: el, createElement: () => el('created'),
      addEventListener() {},
      createTextNode: text => text, querySelector: () => el('main'),
      querySelectorAll: selector => selector === 'input[type=file]' ? inputs : []
    },
    window: { addEventListener() {} }, Blob, URL, console, setTimeout, clearTimeout,
    ConversionRuntime: require('../runtime.js'),
    Image: class { set src(value) { this.onerror(); } }
  };
  const source = fs.readFileSync('app.js', 'utf8').replace('    })();',
    'globalThis.api = { state, outputName, escapeHTML, runFFmpeg, loadImage, parsePages, resizeDimensions, readDimension, uniqueName }; })();');
  vm.runInNewContext(source, context);
  return { ...context, el };
}

test('output naming handles uppercase extensions and extensionless names', () => {
  const { api } = setup();
  assert.equal(api.outputName('报告.PDF', 'txt'), '报告.txt');
  assert.equal(api.outputName('recording', 'mp3'), 'recording.mp3');
});

test('plain text escapes executable HTML', () => {
  const { api } = setup();
  assert.equal(api.escapeHTML('<img src="x" onerror=alert(1)>&'), '&lt;img src=&quot;x&quot; onerror=alert(1)&gt;&amp;');
});

test('invalid image quality is rejected before decoding', async () => {
  const { el } = setup();
  el('img-input').files = [new Blob(['image'])];
  for (const value of ['', '0', '1.1']) {
    el('img-quality').value = value;
    await el('img-btn').listeners.click();
    assert.match(el('statusText').textContent, /质量必须/);
  }
});

test('PNG bypasses irrelevant quality validation and stays disabled after processing', async () => {
  const { el } = setup();
  el('img-input').files = [Object.assign(new Blob(['broken']), { name: 'broken.png' })];
  el('img-format').value = 'png'; el('img-quality').value = '';
  el('img-format').listeners.change();
  await el('img-btn').listeners.click();
  assert.match(el('statusText').textContent, /图片无法解码/);
  assert.equal(el('img-quality').disabled, true);
  el('img-format').value = 'webp'; el('img-format').listeners.change();
  assert.equal(el('img-quality').disabled, false);
});

test('empty and oversized inputs are cleared', () => {
  const { el } = setup();
  const input = el('img-input');
  for (const size of [0, 31 * 1024 * 1024]) {
    input.value = 'selected'; input.files = [{ size }];
    input.listeners.change();
    assert.equal(input.value, '');
    assert.match(el('statusText').textContent, /30 MB/);
  }
});

test('FFmpeg failure propagates and cleans both virtual files', async () => {
  const { api } = setup();
  const deleted = [];
  api.state.ffmpegReady = true;
  api.state.fetchFile = async () => new Uint8Array([1]);
  api.state.ffmpeg = { writeFile: async () => {}, exec: async () => 1,
    deleteFile: async name => deleted.push(name) };
  await assert.rejects(api.runFFmpeg({ size: 1 }, 'mp4', [], 'output.mp3', 'audio/mpeg'), /转换失败/);
  assert.deepEqual(deleted.sort(), ['input.mp4', 'output.mp3']);
});

test('image decoding errors release the source URL', async () => {
  const original = URL.revokeObjectURL;
  const released = [];
  URL.revokeObjectURL = value => { released.push(value); original.call(URL, value); };
  try {
    const { api, Image } = setup();
    await assert.rejects(api.loadImage(new Image(), new Blob(['broken'])), /图片无法解码/);
    assert.equal(released.length, 1);
    assert.match(released[0], /^blob:/);
  } finally { URL.revokeObjectURL = original; }
});

test('non Excel files cannot be exported as fake JSON', async () => {
  const { el } = setup();
  el('doc-input').files = [{ name: 'note.txt', arrayBuffer: async () => new ArrayBuffer(0) }];
  el('doc-format').value = 'json';
  await el('doc-btn').listeners.click();
  assert.match(el('statusText').textContent, /仅支持 Excel/);
});

test('PDF selection preserves requested order, deduplicates and rejects invalid ranges', () => {
  const { api } = setup();
  assert.equal(JSON.stringify(api.parsePages('3,1-2,2', 4)), '[3,1,2]');
  assert.equal(JSON.stringify(api.parsePages('', 2)), '[1,2]');
  for (const value of ['0', '2-1', '1,', '5', '1-999999999', 'abc']) assert.throws(() => api.parsePages(value, 4));
});

test('image resize fits bounds, supports one side and exact dimensions', () => {
  const { api } = setup();
  const dimensions = (...args) => JSON.stringify(api.resizeDimensions(...args));
  assert.equal(dimensions(400, 200, 100, 100, true), '{"width":100,"height":50}');
  assert.equal(dimensions(400, 200, null, 50, false), '{"width":100,"height":50}');
  assert.equal(dimensions(400, 200, 100, 100, false), '{"width":100,"height":100}');
  assert.throws(() => api.resizeDimensions(400, 200, 8192, 8192, false));
  for (const value of ['0','1.5','8193']) assert.throws(() => api.readDimension(value));
});

test('ZIP names avoid collisions including case and path separators', () => {
  const { api } = setup(), used = new Set();
  assert.equal(api.uniqueName('photo.png', used), 'photo.png');
  assert.equal(api.uniqueName('PHOTO.PNG', used), 'PHOTO (2).PNG');
  assert.equal(api.uniqueName('photo (2).png', used), 'photo (2) (2).png');
  assert.equal(api.uniqueName('../photo.png', used), '.._photo.png');
});
