const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createQueue } = require('../runtime.js');
const gate = () => {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
};

test('queue executes serially and a failure does not block following jobs', async () => {
  const first = gate(), events = [];
  const queue = createQueue();
  const a = queue.add({ label: 'a', bytes: 10 }, async () => { events.push('a start'); await first.promise; events.push('a end'); throw new Error('broken'); });
  const b = queue.add({ label: 'b', bytes: 20 }, async () => { events.push('b'); });
  assert.deepEqual(events, ['a start']);
  assert.deepEqual(queue.entries().map(job => job.status), ['running', 'waiting']);
  first.release();
  assert.equal(await a.done, 'failed'); assert.equal(await b.done, 'done');
  assert.deepEqual(events, ['a start', 'a end', 'b']);
  assert.equal('run' in queue.entries()[0], false);
});

test('pending removal releases budget and never runs removed input', async () => {
  const first = gate();
  const queue = createQueue({ maxBytes: 100, maxPending: 1 });
  const a = queue.add({ label: 'a', bytes: 60 }, () => first.promise);
  assert.throws(() => queue.add({ label: 'big', bytes: 41 }, () => {}), /预算/);
  const b = queue.add({ label: 'b', bytes: 40 }, () => assert.fail('removed job ran'));
  assert.throws(() => queue.add({ label: 'extra', bytes: 1 }, () => {}), /等待队列/);
  assert.equal(queue.remove(a.id), false);
  assert.equal(queue.remove(b.id), true); assert.equal(await b.done, 'cancelled');
  const c = queue.add({ label: 'c', bytes: 40 }, () => {});
  first.release('cancelled');
  assert.equal(await a.done, 'cancelled'); assert.equal(await c.done, 'done');
});

test('clearing pending jobs preserves current work and bounds cancelled history', async () => {
  const first = gate();
  const queue = createQueue();
  const a = queue.add({ label: 'active', bytes: 1 }, () => first.promise);
  for (let i = 0; i < 40; i++) {
    const item = queue.add({ label: String(i), bytes: 1 }, () => assert.fail('cleared job ran'));
    queue.clearPending(); assert.equal(await item.done, 'cancelled');
  }
  assert.equal(queue.entries().find(job => job.id === a.id).status, 'running');
  assert.equal(queue.entries().length, 20);
  first.release(); assert.equal(await a.done, 'done');
});
