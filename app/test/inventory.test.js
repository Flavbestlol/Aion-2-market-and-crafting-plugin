'use strict';
/* node --test test/inventory.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Inventory, KINA, MAX_AGE_MS } = require('../inventory');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inv-')), 'inventory.json');
const stack = (item, count, container, slot) => ({ item, count, container, slot });

test('a list replaces everything; owned() sums the three containers', () => {
  const inv = new Inventory(tmp());
  assert.equal(inv.take({ type: 'list', stacks: [stack(610530001, 856, 'bag', 287), stack(610530001, 506, 'storage', 224), stack(533460001, 6, 'warehouse', 260), stack(KINA, 12861636, 'bag', 1)] }), 'list');
  assert.deepEqual(inv.owned(610530001), { bag: 856, storage: 506, warehouse: 0, total: 1362 });
  assert.deepEqual(inv.owned(533460001), { bag: 0, storage: 0, warehouse: 6, total: 6 });
  assert.equal(inv.kina(), 12861636);
  assert.equal(inv.take({ type: 'list', stacks: [stack(610530001, 1, 'bag', 287)] }), 'list');
  assert.deepEqual(inv.owned(610530001), { bag: 1, storage: 0, warehouse: 0, total: 1 });
  assert.equal(inv.kina(), 0, 'a new list without the Kina stack means no Kina stack');
});

test('a change updates its stacks, 0 removes one, the feed wrapping is accepted too', () => {
  const inv = new Inventory(tmp());
  inv.take({ type: 'list', stacks: [stack(533460001, 6, 'warehouse', 260), stack(533460001, 1541, 'bag', 297), stack(KINA, 12861636, 'bag', 1)] });
  // a move: the source's new count, the destination's
  assert.equal(inv.take({ type: 'inventory', kind: 'changed', stacks: [stack(533460001, 5, 'warehouse', 260), stack(533460001, 1542, 'bag', 297)] }), 'changed');
  assert.deepEqual(inv.owned(533460001), { bag: 1542, storage: 0, warehouse: 5, total: 1547 });
  // a purchase: the Kina stack, then the bought stack
  inv.take({ type: 'changed', stacks: [stack(KINA, 12601636, 'bag', 1)] });
  inv.take({ type: 'changed', stacks: [stack(610530010, 3, 'bag', 187)] });
  assert.equal(inv.kina(), 12601636);
  assert.equal(inv.owned(610530010).bag, 3);
  // gone
  inv.take({ type: 'changed', stacks: [stack(610530010, 0, 'bag', 187)] });
  assert.equal(inv.owned(610530010).total, 0);
  assert.equal(inv.take({ type: 'changed', stacks: [] }), null);
  assert.equal(inv.take({ type: 'hit' }), null);
});

test('unknown containers are kept apart and never counted as owned', () => {
  const inv = new Inventory(tmp());
  inv.take({ type: 'list', stacks: [stack(310440017, 1, { other: 11 }, 5), stack(310440017, 1, { other: 14 }, 5), stack(310440017, 2, 'bag', 5)] });
  assert.equal(inv.stacks.size, 3, 'two unknown containers with the same slot are two stacks');
  assert.deepEqual(inv.owned(310440017), { bag: 2, storage: 0, warehouse: 0, total: 2 });
});

test('freshness: a picture older than MAX_AGE is not acted on; the file survives a restart', () => {
  const file = tmp();
  const inv = new Inventory(file);
  assert.equal(inv.fresh(), false, 'nothing seen yet');
  const at = (Date.now() - MAX_AGE_MS - 60000) / 1000;
  inv.take({ type: 'list', at, stacks: [stack(610530001, 10, 'bag', 1)] });
  assert.equal(inv.fresh(), false);
  inv.take({ type: 'changed', stacks: [stack(610530001, 11, 'bag', 1)] });
  assert.equal(inv.fresh(), true, 'a fresh change makes the picture current again');
  inv.save();
  const again = new Inventory(file);
  assert.deepEqual(again.owned(610530001), { bag: 11, storage: 0, warehouse: 0, total: 11 });
  assert.equal(again.status().seen, true);
});
