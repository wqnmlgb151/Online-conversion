const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader, withTimeout, fetchBytes } = require('../runtime.js');

test('concurrent dependency requests share one load', async () => {
  const globals = {};
  let loads = 0;
  const loader = createLoader({ demo: { var: 'Demo', urls: ['demo.js'] } }, {
    globals, load: async () => { loads++; globals.Demo = {}; }
  });
  await Promise.all([loader.ensure('demo'), loader.ensure('demo')]);
  assert.equal(loads, 1);
});

test('failed dependency can be retried without refreshing', async () => {
  const globals = {};
  let attempts = 0;
  const states = [];
  const loader = createLoader({ demo: { var: 'Demo', urls: ['demo.js'] } }, {
    globals, onState: (_, status) => states.push(status),
    load: async () => { if (++attempts === 1) throw new Error('network'); globals.Demo = {}; }
  });
  await assert.rejects(loader.ensure('demo'), /network/);
  await loader.ensure('demo');
  assert.deepEqual(states, ['loading', 'error', 'loading', 'success']);
});

test('dependency timeout clears pending state for retry', async () => {
  const globals = {};
  let attempts = 0;
  const loader = createLoader({ demo: { var: 'Demo', urls: ['demo.js'] } }, {
    globals, timeout: 10, load: () => {
      if (++attempts === 1) return new Promise(() => {});
      globals.Demo = {}; return Promise.resolve();
    }
  });
  await assert.rejects(loader.ensure('demo'), /超时/);
  await loader.ensure('demo');
  assert.equal(attempts, 2);
});

test('task timeout invokes cleanup', async () => {
  let stopped = false;
  await assert.rejects(withTimeout(new Promise(() => {}), 5, 'timeout', () => { stopped = true; }), /timeout/);
  assert.equal(stopped, true);
});

test('module retry uses a fresh URL after failed import', async () => {
  const globals = {}, urls = [];
  const loader = createLoader({ demo: { var: 'Demo', module: true, urls: ['./demo.mjs'] } }, {
    globals, moduleImport: async url => {
      urls.push(url);
      if (urls.length === 1) throw new Error('fetch');
      return { version: '1' };
    }
  });
  await assert.rejects(loader.ensure('demo'), /fetch/);
  await loader.ensure('demo');
  assert.deepEqual(urls, ['./demo.mjs','./demo.mjs?retry=1']);
});

test('corrupt engine bytes are rejected by SHA-256', async () => {
  const original = global.fetch;
  global.fetch = async () => ({ok:true,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer});
  try { await assert.rejects(fetchBytes('https://example.invalid',1000,'0'.repeat(64)), /完整性/); }
  finally { global.fetch = original; }
});

test('HTTP errors do not create a result', async () => {
  const original = global.fetch;
  global.fetch = async () => ({ ok: false, status: 404 });
  try { await assert.rejects(fetchBytes('https://example.invalid'), /404/); }
  finally { global.fetch = original; }
});
