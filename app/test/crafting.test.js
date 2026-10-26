'use strict';
/* node --test test/crafting.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Inventory } = require('../inventory');
const { Crafting, GAP_MS, SHOW_MS, FAIL_MS } = require('../crafting');

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

// ---- tries, fails and streaks: one try takes the recipe's materials in one change, its piece comes in the next ----
const INGOT = 610710901, LEATHER = 610720901, STONE = 610530901, ODYLE = 610610901;
const GREAVES = 210260901, SPL_GREAVES = 210250901, BOOTS = 210260902, SPL_BOOTS = 210250902;
const mats = [{ itemId: INGOT, quantity: 2 }, { itemId: LEATHER, quantity: 3 }, { itemId: STONE, quantity: 2 }, { itemId: ODYLE, quantity: 1 }];
const book = { recipes: [
  { id: 'g', itemId: GREAVES, ingredients: mats, combo: { itemId: SPL_GREAVES, probability: null, probabilityRaw: 2500 } },
  { id: 'b', itemId: BOOTS, ingredients: [{ itemId: INGOT, quantity: 2 }, { itemId: LEATHER, quantity: 3 }, { itemId: STONE, quantity: 2 }, { itemId: ODYLE, quantity: 1 }], combo: { itemId: SPL_BOOTS, probabilityRaw: 2500 } },
  { id: 'x', itemId: 210260903, ingredients: [{ itemId: INGOT, quantity: 5 }], combo: { itemId: 210250903, probabilityRaw: 2500 } },
] };
const spend = (k = 1) => new Map([[INGOT, -2 * k], [LEATHER, -3 * k], [STONE, -2 * k], [ODYLE, -1]]);
const got = item => new Map([[item, 1]]);

test('the recorded batch: 15 tries, 14 pieces, the try with no piece failed', () => {
  const cr = new Crafting();
  cr.learn({ recipes: [book.recipes[0]] });
  let t = 1_000_000;
  // as recorded: S P P S P P (fail) P P P P P P P P
  const order = 'SPPSPPxPPPPPPPP';
  for (const c of order) {
    cr.take(spend(), (t += 1600));
    if (c !== 'x') cr.take(got(c === 'S' ? SPL_GREAVES : GREAVES), (t += 8000));
    else t += 20000;
  }
  const v = cr.view(t);
  assert.deepEqual({ tries: v.tries, made: v.made, failed: v.failed, lucky: v.lucky.n }, { tries: 15, made: 14, failed: 1, lucky: 2 });
  assert.equal(v.chance, 0.25, "the combo's raw 2500 is 25%");
  assert.equal(v.crafting, false);
  assert.deepEqual(v.last, { kind: 'plain', dry: 11, ended: 0 }, 'eleven tries without a Splendent since the last one (the fail counts)');
});

test('streaks build up and end; a try left with no piece fails after a while; materials given back call a try off', () => {
  const cr = new Crafting();
  cr.learn({ recipes: [book.recipes[0]] });
  let t = 1_000_000;
  const one = item => { cr.take(spend(), (t += 1600)); if (item) cr.take(got(item), (t += 6000)); };
  one(SPL_GREAVES); one(SPL_GREAVES); one(SPL_GREAVES);
  let v = cr.view(t);
  assert.deepEqual([v.streak, v.best, v.last.kind, v.last.streak], [3, 3, 'lucky', 3]);
  one(GREAVES);
  v = cr.view(t);
  assert.deepEqual([v.streak, v.last.kind, v.last.ended], [0, 'plain', 3]);
  // the last try of the batch: materials gone, no piece, nothing more
  cr.take(spend(), (t += 1600));
  assert.equal(cr.view(t).crafting, true);
  assert.equal(cr.tick(t + 10_000), false, 'not yet');
  assert.equal(cr.tick(t + FAIL_MS + 1), true);
  v = cr.view(t + FAIL_MS + 1);
  assert.deepEqual([v.failed, v.tries, v.last.kind, v.crafting], [1, 5, 'fail', false]);
  // a try called off: the same materials come back
  cr.take(spend(), (t += FAIL_MS + 5000));
  cr.take(new Map([[INGOT, 2], [LEATHER, 3], [STONE, 2], [ODYLE, 1]]), (t += 500));
  v = cr.view(t);
  assert.deepEqual([v.tries, v.failed, v.crafting], [5, 1, false]);
});

test('materials that fit two recipes: the piece says which; other spending is no try', () => {
  const cr = new Crafting();
  cr.learn(book);
  let t = 1_000_000;
  assert.equal(cr.take(spend(), (t += 1000)), false, 'greaves or boots: not known yet');
  cr.take(got(SPL_BOOTS), (t += 6000));
  let v = cr.view(t);
  assert.deepEqual([v.lucky.id, v.tries, v.made], [SPL_BOOTS, 1, 1]);
  cr.take(spend(), (t += 1000)); // the run's own recipe fits: a try of it
  assert.equal(cr.view(t).tries, 2);
  assert.equal(cr.take(new Map([[INGOT, -7]]), (t += 1000)), false, 'not one try of anything');
  assert.equal(cr.take(new Map([[INGOT, -2], [LEATHER, -3]]), (t += 1000)), false, 'part of the materials is no try');
  assert.equal(cr.view(t).tries, 2);
});
