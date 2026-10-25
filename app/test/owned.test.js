'use strict';
/* What is already made counts: a crafted step's item in the bag (10 of the 18 Splendent gloves crafted before a break)
   comes off that step and its tries, the next step's line says it is in hand, and every crafted step says whether
   buying the rest on the Exchange is cheaper than crafting it. A made-up catalogue: one Gloves chain, tier 1 only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { Inventory } = require('../inventory');
const C = require('../compute');

// items: the six tiers (G1…G6), the Artisan ladder (A1 Splendent, A2 Expert's Splendent, A3 Artisan's Splendent, each
// the lucky result of crafting its base B1…B3), leather and a stone
// (nine-digit keys, as the game's)
const G = [1, 2, 3, 4, 5, 6].map(t => 900000100 + t), A1 = 900000201, A2 = 900000202, A3 = 900000203, B1 = 900000301, B2 = 900000302, B3 = 900000303, LEATHER = 900000401, STONE = 900000402;
const names = { [A1]: 'Splendent Test Gloves', [A2]: "Expert's Splendent Test Gloves", [A3]: "Artisan's Splendent Test Gloves", [B1]: 'Test Gloves', [B2]: "Expert's Test Gloves", [B3]: "Artisan's Test Gloves", [LEATHER]: 'Test Leather', [STONE]: 'Test Stone' };
const items = {};
for (const [id, name] of Object.entries(names)) items[id] = { name };
G.forEach((id, i) => { items[id] = { name: `Test Dragon Gloves T${i + 1}` }; });
const ing = (itemId, quantity, itemType = 'Material') => ({ itemId: String(itemId), quantity, itemType });
const lucky = (id, item, ingredients, combo) => ({ id, itemId: String(item), profession: 'Tailoring', requiredMastery: 1, outputQuantity: 1, successVerified: true, successProbability: '1', ingredients,
  combo: { itemId: String(combo), quantity: 1, probability: 0.25, probabilityVerified: true } });
const recipes = [
  lucky('r-b1', B1, [ing(LEATHER, 2)], A1),
  lucky('r-b2', B2, [ing(A1, 1), ing(STONE, 2)], A2),
  lucky('r-b3', B3, [ing(A2, 1), ing(STONE, 4)], A3),
  ...G.map((id, i) => ({ id: 'r-g' + (i + 1), itemId: String(id), profession: 'Tailoring', requiredMastery: 1, outputQuantity: 1, successVerified: true, successProbability: '1',
    client: { recipeKey: `Recipe_Tailoring_L_ar_Gloves_Unique_0${i === 0 ? '01' : 10 + i}` },
    ingredients: [i === 0 ? ing(A3, 1, 'Equip') : ing(G[i - 1], 1, 'Equip'), ing(STONE, 10)] })),
];

function world({ prices = {}, bag = [] } = {}) {
  const now = Date.now();
  const quote = price => ({ status: 'current', price, currency: 'Kinah', marketKind: 'items', observedAt: new Date(now).toISOString(), delaySeconds: 0, listings: 10 });
  const quotes = new Map(Object.entries({ [LEATHER]: 1000, [STONE]: 100, ...prices }).map(([id, p]) => [String(id), quote(p)]));
  const data = { catalogue: { items, recipes }, quotes, hist: new Map(), chests: {}, fetchedAt: now };
  const settings = { faction: 'elyos', class: 'Ranger', plan: { Gloves: { have: 0, goal: 1 } }, proficiency: {}, currency: 'USD', quna_pack: { quna: 4000, eur: 44.49 },
    shop: { sel: ['Gloves'], ticks: {}, use_inventory: true, kina_have: 0, quna_have: 0 }, cheap_when_below_usual_percent: 5, expensive_when_above_usual_percent: 5 };
  const inv = new Inventory(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flav-owned-')), 'inventory.json'));
  inv.take({ type: 'inventory', kind: 'list', at: Math.floor(now / 1000), stacks: bag.map(([item, count], i) => ({ item, count, container: 'bag', slot: i + 1 })) });
  return C.shopping(data, settings, null, inv).chosen[0].steps;
}
const stepOf = (steps, id) => steps.find(s => s.id === String(id));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

test('the plan: 1 Artisan from 4 Expert from 16 Splendent, each a quarter of its tries', () => {
  const steps = world();
  near(stepOf(steps, A1).makes, 16, 'Splendent to make');
  near(stepOf(steps, A1).attempts, 64, 'tries for them');
  near(stepOf(steps, A2).makes, 4, "Expert's to make");
  assert.equal(stepOf(steps, A1).owned, undefined, 'nothing in the bag, nothing owned');
});

test('Splendent gloves in the bag come off their step: fewer to make, fewer tries, fewer materials', () => {
  const steps = world({ bag: [[A1, 10]] });
  const s1 = stepOf(steps, A1);
  near(s1.makes, 6, 'Splendent left to make');
  near(s1.attempts, 24, 'tries left');
  near(s1.rows.find(r => r.id === String(LEATHER)).count, 48, 'leather for the tries left');
  assert.deepEqual({ need: s1.owned.need, used: s1.owned.used, bag: s1.owned.have.bag }, { need: 16, used: 10, bag: 10 });
  assert.ok(!s1.covered);
  // the next step still uses 16, and says 10 of them are in hand
  const line = stepOf(steps, A2).rows.find(r => r.id === String(A1));
  near(line.count, 16, 'the next step still uses all of them');
  near(line.inHand, 10, 'of which in hand');
  near(stepOf(steps, A2).makes, 4, "the Expert's step is unchanged");
});

test('a step whose item is all in hand is covered', () => {
  const steps = world({ bag: [[A1, 16]] });
  const s1 = stepOf(steps, A1);
  assert.equal(s1.covered, true);
  assert.equal(s1.makes, 0);
  assert.equal(s1.cost, 0, 'nothing to buy for it');
  assert.equal(s1.compare, undefined, 'nothing to compare');
  near(stepOf(steps, A2).rows.find(r => r.id === String(A1)).inHand, 16, 'all of the next step\'s line in hand');
});

test('owning the higher item shrinks the steps below it too', () => {
  const steps = world({ bag: [[A2, 2]] });
  near(stepOf(steps, A2).makes, 2, "Expert's left");
  near(stepOf(steps, A1).makes, 8, 'half the Splendent are needed now');
});

test('each crafted step says whether buying it is cheaper than crafting it', () => {
  // Splendent: crafting one = 4 tries of 2 leather = 8,000; listed from 5,000 → buy, saving 3,000 on each of the 6 left
  const steps = world({ prices: { [A1]: 5000 }, bag: [[A1, 10]] });
  const c = stepOf(steps, A1).compare;
  near(c.craftUnit, 8000, 'crafting one');
  assert.equal(c.better, 'buy');
  assert.equal(c.buy.count, 6);
  assert.equal(c.buy.from, 5000);
  assert.equal(c.buy.source, 'hourly', 'a2-tracker only: an hourly price');
  near(c.saves, 3000 * 6, 'what buying the rest saves');
  // no price for the Expert's: crafting it is known, buying isn't
  const e = stepOf(steps, A2).compare;
  assert.equal(e.buy, null);
  assert.equal(e.better, null);
  // dearer on the Exchange than crafting: crafting wins
  const dear = stepOf(world({ prices: { [A1]: 9000 } }), A1).compare;
  assert.equal(dear.better, 'craft');
  near(dear.saves, 1000 * 16, 'what crafting saves');
});

test('with "count what I own" off, nothing in the bag changes the steps', () => {
  const now = Date.now();
  const quote = price => ({ status: 'current', price, currency: 'Kinah', marketKind: 'items', observedAt: new Date(now).toISOString(), delaySeconds: 0, listings: 10 });
  const data = { catalogue: { items, recipes }, quotes: new Map([[String(LEATHER), quote(1000)], [String(STONE), quote(100)]]), hist: new Map(), chests: {}, fetchedAt: now };
  const settings = { faction: 'elyos', class: 'Ranger', plan: { Gloves: { have: 0, goal: 1 } }, proficiency: {}, currency: 'USD', quna_pack: { quna: 4000, eur: 44.49 },
    shop: { sel: ['Gloves'], ticks: {}, use_inventory: false }, cheap_when_below_usual_percent: 5, expensive_when_above_usual_percent: 5 };
  const inv = new Inventory(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flav-owned-')), 'inventory.json'));
  inv.take({ type: 'inventory', kind: 'list', at: Math.floor(now / 1000), stacks: [{ item: A1, count: 10, container: 'bag', slot: 1 }] });
  const s1 = C.shopping(data, settings, null, inv).chosen[0].steps.find(s => s.id === String(A1));
  near(s1.makes, 16, 'full count');
  assert.equal(s1.owned, undefined);
});
