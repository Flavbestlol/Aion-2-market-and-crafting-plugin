'use strict';
/* node --test test/crafting.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Inventory } = require('../inventory');
const { Crafting, GAP_MS, SHOW_MS } = require('../crafting');

// made-up ids in the game's shape: a plain result, its Splendent result, and another recipe
const PLAIN = 210560901, LUCKY = 210550901, OTHER = 210550902, OTHER_LUCKY = 210540902, ORE = 610530901;
const catalogue = {
  recipes: [
    { id: 'craft-1', itemId: PLAIN, combo: { itemId: LUCKY } },
    { id: 'craft-2', itemId: OTHER, combo: { itemId: OTHER_LUCKY } },
    { id: 'craft-3', itemId: ORE }, // no lucky result: not counted
  ],
};
const names = { [PLAIN]: 'Orichalcum Gloves', [LUCKY]: 'Splendent Orichalcum Gloves' };
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'craft-')), 'inventory.json');
const stack = (item, count, container, slot) => ({ item, count, container, slot });

function setup() {
  const inv = new Inventory(tmp());
  const cr = new Crafting({ name: id => names[id] || 'Item ' + id, icon: id => '/icon/' + id });
  cr.learn(catalogue);
  // in hand before the batch: 3 Splendent already, the ore
  inv.take({ type: 'list', stacks: [stack(LUCKY, 1, 'bag', 10), stack(LUCKY, 1, 'bag', 11), stack(LUCKY, 1, 'storage', 4), stack(ORE, 500, 'bag', 2)] });
  let slot = 40, t = 1_000_000;
  // one craft: the ore used up, then the piece in a new bag slot (gear doesn't stack), as the game sends them
  const craft = (item, at = t + 20_000) => {
    t = at;
    inv.take({ type: 'inventory', kind: 'changed', stacks: [stack(ORE, inv.owned(ORE).bag - 5, 'bag', 2)] });
    cr.take(inv.lastDelta, at);
    inv.take({ type: 'inventory', kind: 'changed', stacks: [stack(item, 1, 'bag', slot++)] });
    return cr.take(inv.lastDelta, at);
  };
  return { inv, cr, craft, now: () => t };
}

test('each piece that lands counts; only the Splendent ones are the big number; what was in hand is not counted', () => {
  const { cr, craft, now } = setup();
  assert.equal(cr.view(now()), null, 'nothing crafted yet');
  for (const item of [PLAIN, LUCKY, PLAIN, PLAIN, LUCKY, PLAIN, LUCKY]) assert.equal(craft(item), true);
  const v = cr.view(now());
  assert.equal(v.lucky.n, 3);
  assert.equal(v.plain.n, 4);
  assert.equal(v.made, 7);
  assert.equal(v.pct, 43);
  assert.equal(v.lucky.name, 'Splendent Orichalcum Gloves');
  assert.equal(v.plain.name, 'Orichalcum Gloves');
});

test('a move between bag, storage and warehouse, a list at a zone change and pieces used up count nothing', () => {
  const { inv, cr, craft, now } = setup();
  craft(LUCKY); craft(PLAIN);
  // a Splendent piece to storage: one change, out of one slot and into another
  inv.take({ type: 'inventory', kind: 'changed', stacks: [stack(LUCKY, 0, 'bag', 10), stack(LUCKY, 1, 'storage', 5)] });
  assert.equal(cr.take(inv.lastDelta, now()), false);
  // a zone change sends the whole list again
  inv.take({ type: 'list', stacks: [stack(LUCKY, 1, 'bag', 11), stack(LUCKY, 1, 'storage', 4), stack(LUCKY, 1, 'storage', 5), stack(LUCKY, 1, 'bag', 40), stack(PLAIN, 1, 'bag', 41)] });
  assert.equal(inv.lastDelta.size, 0);
  // a Splendent piece used in the next craft
  inv.take({ type: 'inventory', kind: 'changed', stacks: [stack(LUCKY, 0, 'bag', 11)] });
  assert.equal(cr.take(inv.lastDelta, now()), false);
  assert.deepEqual([cr.view(now()).lucky.n, cr.view(now()).made], [1, 2]);
});

test('another recipe or a long pause starts a new count; it is shown for half an hour after the last piece', () => {
  const { cr, craft, now } = setup();
  craft(LUCKY); craft(PLAIN);
  craft(OTHER_LUCKY);
  assert.equal(cr.view(now()).lucky.id, OTHER_LUCKY, 'another recipe: a new batch');
  assert.equal(cr.view(now()).made, 1);
  craft(OTHER, now() + GAP_MS + 1);
  assert.equal(cr.view(now()).made, 1, 'after a long pause the same recipe starts again');
  assert.ok(cr.view(now() + SHOW_MS - 1));
  assert.equal(cr.view(now() + SHOW_MS + 1), null);
});

test('cleared by hand: gone until the next piece', () => {
  const { cr, craft, now } = setup();
  craft(LUCKY);
  assert.equal(cr.clear(), true);
  assert.equal(cr.view(now()), null);
  craft(PLAIN);
  assert.deepEqual([cr.view(now()).lucky.n, cr.view(now()).made], [0, 1]);
});

test('nothing is counted before the recipes are known, and junk deltas are ignored', () => {
  const cr = new Crafting();
  assert.equal(cr.take(new Map([[PLAIN, 1]]), 1), false);
  cr.learn(catalogue);
  assert.equal(cr.take(new Map([[PLAIN, 5000]]), 1), false, 'a jump of thousands is not a craft');
  assert.equal(cr.take(new Map([[ORE, 1]]), 1), false, 'a recipe without a lucky result');
  assert.equal(cr.take(null, 1), false);
  cr.learn({ recipes: [{ id: 'x', itemId: 'nope', combo: { itemId: LUCKY } }, null] });
  assert.equal(cr.take(new Map([[LUCKY, 1]]), 1), false);
});

test('with ids, a piece that comes with the slot number of another stack still counts', () => {
  // the batch that came out short before stacks had ids: pieces with the number of the ore's stack, and with each other's
  const inv = new Inventory(tmp());
  const cr = new Crafting({ name: id => names[id] || 'Item ' + id });
  cr.learn(catalogue);
  const s = (id, item, count, slot) => ({ id, item, count, container: 'bag', slot });
  inv.take({ type: 'list', stacks: [s(1, ORE, 500, 129)] });
  let t = 1_000_000, ore = 500, id = 10;
  const craft = (item, slot) => {
    t += 20_000;
    inv.take({ type: 'changed', stacks: [s(1, ORE, (ore -= 5), 129)] });
    cr.take(inv.lastDelta, t);
    inv.take({ type: 'changed', stacks: [s(id++, item, 1, slot)] });
    cr.take(inv.lastDelta, t);
  };
  craft(PLAIN, 129); craft(LUCKY, 178); craft(PLAIN, 178); craft(LUCKY, 178); craft(PLAIN, 40);
  const v = cr.view(t);
  assert.deepEqual([v.lucky.n, v.plain.n, v.made], [2, 3, 5]);
  assert.equal(inv.owned(ORE).bag, 475);
});
