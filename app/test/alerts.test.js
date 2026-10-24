'use strict';
/* node --test test/alerts.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Alerts, KINDS } = require('../alerts');

const make = (known) => {
  const fired = [];
  const settings = { alerts_list: [] };
  const a = new Alerts({ settings, save: () => {}, lookup: id => known[id] || null, name: id => 'Item ' + id, icon: id => '/icon/' + id, fire: f => fired.push(f) });
  return { a, fired, settings };
};

test('kinds: price, count and against the usual price', () => {
  const now = { price: 7500, listed: 60, usual: 10000 };
  const n = { ...now, pct: -25 };
  assert.equal(KINDS.below.test(n, 8000), true); assert.equal(KINDS.below.test(n, 7000), false);
  assert.equal(KINDS.above.test(n, 7000), true); assert.equal(KINDS.above.test(n, 8000), false);
  assert.equal(KINDS.listed.test(n, 50), true); assert.equal(KINDS.scarce.test(n, 50), false); assert.equal(KINDS.scarce.test(n, 60), true);
  assert.equal(KINDS.cheaper.test(n, 20), true); assert.equal(KINDS.cheaper.test(n, 30), false);
  assert.equal(KINDS.pricier.test(n, 10), false); assert.equal(KINDS.pricier.test({ ...n, pct: 15 }, 10), true);
  assert.equal(KINDS.cheaper.test({ price: 1, listed: 1, pct: null }, 5), false, 'no usual price: never fires');
});

test('an alert fires once when its condition comes true, arms again when it is false, and fires again', () => {
  const known = { 610530001: { price: 9000, listed: 10, usual: 10000, source: 'summary' } };
  const { a, fired } = make(known);
  const al = a.add({ item: '610530001', kind: 'below', value: 8000 });
  assert.equal(typeof al, 'object');
  assert.deepEqual(a.check(), []);
  known[610530001].price = 7900;
  assert.equal(a.check('exchange').length, 1);
  assert.equal(fired[0].title, 'Item 610530001: price at or under 8k Kina');
  assert.match(fired[0].text, /now 8k Kina · 10 listed · usual 10k \(-21 %\) · the Exchange/);
  assert.equal(fired[0].icon, '/icon/610530001');
  assert.deepEqual(a.check(), [], 'still true: said once');
  known[610530001].price = 8500;
  assert.deepEqual(a.check(), []);
  assert.equal(al.state, 'armed');
  known[610530001].price = 7000;
  assert.equal(a.check().length, 1, 'true again: fires again');
  assert.equal(a.recent.length, 2);
  assert.equal(a.list()[0].met, true);
  a.toggle(al.id); assert.deepEqual(a.check(), [], 'off: never fires');
  assert.equal(a.remove(al.id), true); assert.equal(a.all.length, 0);
});

test('bad input is refused', () => {
  const { a } = make({});
  assert.equal(a.add({ item: 'x', kind: 'below', value: 1 }), 'not an item');
  assert.equal(a.add({ item: '610530001', kind: 'soon', value: 1 }), 'not a kind of alert');
  assert.equal(a.add({ item: '610530001', kind: 'below', value: -1 }), 'not a number');
  assert.equal(a.add({ item: '610530001', kind: 'below', value: 'abc' }), 'not a number');
});
