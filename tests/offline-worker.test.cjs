const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

function worker() {
  const events = {}, storage = new Map(), notifications = [], scope = 'https://local.test/app/';
  const bodies = { 'index.html': '<html>shell</html>', 'one.js': 'one', 'two.js': 'two' };
  const config = { version: 'test', groups: { shell: ['index.html'], doc: ['one.js', 'two.js'] }, hashes: {} };
  for (const [path, body] of Object.entries(bodies)) config.hashes[path] = crypto.createHash('sha256').update(body).digest('hex');
  const caches = {
    async keys() { return [...storage.keys()]; },
    async delete(name) { return storage.delete(name); },
    async open(name) {
      if (!storage.has(name)) storage.set(name, new Map());
      const items = storage.get(name);
      return { async match(url) { return items.get(url)?.clone(); }, async put(url, response) { items.set(url, response.clone()); } };
    }
  };
  const self = { OFFLINE_ASSETS: config, registration: { scope }, clients: {
    claim: async () => {}, matchAll: async () => [{ postMessage: value => notifications.push(value) }]
  }, addEventListener: (name, fn) => { events[name] = fn; } };
  const context = { self, importScripts() {}, caches, URL, crypto: crypto.webcrypto, AbortController, setTimeout, clearTimeout,
    fetch: async url => new Response(bodies[new URL(url).pathname.split('/').pop()], { status: 200 }) };
  vm.runInNewContext(fs.readFileSync('sw.js', 'utf8'), context);
  const dispatch = type => new Promise((resolve, reject) => events[type]({ waitUntil: promise => promise.then(resolve, reject) }));
  const message = async (type, group) => {
    let response, completion;
    events.message({ data: { type, group }, ports: [{ postMessage: value => { response = value; } }], waitUntil: promise => { completion = promise; } });
    await completion; return response;
  };
  return { storage, scope, context, bodies, dispatch, message, events, notifications };
}

test('offline readiness requires every verified resource and retry completes a partial group', async () => {
  const w = worker(); await w.dispatch('install');
  w.bodies['two.js'] = 'tampered';
  assert.match((await w.message('PREPARE', 'doc')).error, /校验失败/);
  assert.equal((await w.message('STATUS')).value.ready.doc, false);
  w.bodies['two.js'] = 'two';
  assert.equal((await w.message('PREPARE', 'doc')).value.ready.doc, true);
  const status = (await w.message('CLEAR')).value;
  assert.equal(status.ready.shell, true); assert.equal(status.ready.doc, false);
  assert.equal(w.notifications.length, 3);
  assert.ok(w.notifications.every(value => value.type === 'OFFLINE_CACHE_CHANGED'));
});

test('storage failure preserves partial resources and queued clearing cannot restore stale readiness', async () => {
  const w = worker(); await w.dispatch('install');
  const open = w.context.caches.open;
  w.context.caches.open = async name => {
    const cache = await open(name), put = cache.put;
    cache.put = async (url, response) => {
      if (url.endsWith('/two.js')) throw new Error('QuotaExceededError');
      return put(url, response);
    };
    return cache;
  };
  assert.match((await w.message('PREPARE', 'doc')).error, /QuotaExceededError/);
  assert.equal((await w.message('STATUS')).value.ready.doc, false);
  w.context.caches.open = open;
  const prepared = w.message('PREPARE', 'doc');
  const cleared = w.message('CLEAR');
  assert.equal((await prepared).value.ready.doc, true);
  assert.equal((await cleared).value.ready.doc, false);
  assert.equal((await w.message('STATUS')).value.ready.doc, false);
});

test('new version activation removes only caches in its own application scope', async () => {
  const w = worker();
  w.storage.set(`converter:${w.scope}:old:shell`, new Map());
  w.storage.set('converter:https://local.test/other/:old:shell', new Map());
  w.storage.set('another-application', new Map());
  await w.dispatch('install'); await w.dispatch('activate');
  assert.equal(w.storage.has(`converter:${w.scope}:old:shell`), false);
  assert.equal(w.storage.has('converter:https://local.test/other/:old:shell'), true);
  assert.equal(w.storage.has('another-application'), true);
});

test('worker ignores uploads and unknown resources while serving cached shell offline', async () => {
  const w = worker(); await w.dispatch('install');
  let intercepted = false;
  w.events.fetch({ request: { method: 'POST', url: w.scope }, respondWith() { intercepted = true; } });
  w.events.fetch({ request: { method: 'GET', url: `${w.scope}private-file` }, respondWith() { intercepted = true; } });
  assert.equal(intercepted, false);
  w.context.fetch = async () => { throw new Error('offline'); };
  let response;
  w.events.fetch({ request: { method: 'GET', url: w.scope }, respondWith(value) { response = value; } });
  assert.equal(await (await response).text(), '<html>shell</html>');
});
