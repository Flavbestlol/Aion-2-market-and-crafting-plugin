'use strict';
/* a2-tracker refusing the app (HTTP 403 "access_restricted", seen 2026-10-30) must not take the prices with it: the
   refresh still finishes, the Exchange as the game showed it still prices the plan, the refusal is asked once (no
   retries) and not again for six hours, and nothing is worked around. A made-up catalogue: one Gloves chain. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DRAGON_GEAR_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'flav-tracker-'));
const C = require('../compute');
const { Market } = require('../market');

const G = [1, 2, 3, 4, 5, 6].map(t => 900000100 + t), LEATHER = 900000401;
const items = { [LEATHER]: { name: 'Test Leather' } };
G.forEach((id, i) => { items[id] = { name: `Test Dragon Gloves T${i + 1}` }; });
const recipes = G.map((id, i) => ({ id: 'r-g' + (i + 1), itemId: String(id), profession: 'Tailoring', requiredMastery: 1, outputQuantity: 1, successVerified: true, successProbability: '1',
  client: { recipeKey: `Recipe_Tailoring_L_ar_Gloves_Unique_0${i === 0 ? '01' : 10 + i}` },
  ingredients: [{ itemId: String(i ? G[i - 1] : LEATHER), quantity: i ? 1 : 5, itemType: i ? 'Equip' : 'Material' }] }));
const catFile = path.join(C.DATA, 'catalogue.json');
const settings = { server: 1304, faction: 'elyos', history_days: 7, alerts_list: [], proficiency: {} };

let calls = [];
function refusing() {
  calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('https://a2-tracker.com/')) return new Response(JSON.stringify({ ok: false, error: 'access_restricted', ref: 'test' }), { status: 403, headers: { 'content-type': 'application/json' } });
    throw new Error('offline'); // the exchange rates: kept as they are
  };
}
const tracker = () => calls.filter(u => u.startsWith('https://a2-tracker.com/'));

test.beforeEach(() => { fs.rmSync(path.join(C.DATA, 'tracker.json'), { force: true }); });

test('a refusal without a recipe list on disk says so plainly', async () => {
  fs.rmSync(catFile, { force: true });
  C.Tracker.refused('HTTP 403 access_restricted');
  refusing();
  await assert.rejects(C.fetchAll(settings, () => {}), /refuses Dragon Gear Prices/);
  assert.equal(tracker().length, 0, 'not asked while the refusal stands');
});

test('a refusal is asked once, not retried, and the refresh still finishes', async () => {
  fs.writeFileSync(catFile, JSON.stringify({ ok: true, items, recipes }));
  fs.utimesSync(catFile, new Date(), new Date()); // a fresh list: only the quotes are asked
  refusing();
  const data = await C.fetchAll(settings, () => {});
  assert.deepEqual(tracker(), ['https://a2-tracker.com/api.crafting.ashx?quotes=1&server=1304'], 'one request, no retries, no chests or histories after it');
  assert.equal(data.tracker.state, 'refused');
  assert.match(data.tracker.why, /403 access_restricted/);
  assert.equal(data.quotes.size, 0);
  assert.ok(C.Tracker.refusedNow(), 'written down');
});

test('while refused, a2-tracker is not asked again; after six hours it is', async () => {
  fs.writeFileSync(catFile, JSON.stringify({ ok: true, items, recipes }));
  C.Tracker.refused('HTTP 403 access_restricted');
  refusing();
  const data = await C.fetchAll(settings, () => {});
  assert.equal(tracker().length, 0);
  assert.equal(data.tracker.state, 'refused');
  // six hours later
  const t = C.Tracker.read();
  fs.writeFileSync(path.join(C.DATA, 'tracker.json'), JSON.stringify({ ...t, refusedAt: new Date(Date.now() - 6 * 3600000 - 1000).toISOString() }));
  assert.equal(C.Tracker.refusedNow(), null);
  refusing();
  await C.fetchAll(settings, () => {});
  assert.equal(tracker().length, 1, 'asked once more');
  assert.equal(C.Tracker.read().since, t.since, 'the refusal keeps the day it started');
});

test('the plan is still priced from the Exchange as the game showed it', async () => {
  fs.writeFileSync(catFile, JSON.stringify({ ok: true, items, recipes }));
  refusing();
  const data = await C.fetchAll(settings, () => {});
  const market = new Market(path.join(C.DATA, 'market.json'));
  market.take({ type: 'market-summary', at: Math.floor(Date.now() / 1000), server: 11304, rows: [{ item: LEATHER, min_unit_price: 1000, sale_count: 50 }, ...Array.from({ length: 60 }, (_, i) => ({ item: 900001000 + i, min_unit_price: 10, sale_count: 1 }))] }); // the whole Kina Exchange opens with hundreds of rows
  const st = C.computeState(data, { ...settings, cheap_when_below_usual_percent: 5, expensive_when_above_usual_percent: 5, currency: 'USD', quna_pack: { quna: 4000, eur: 44.49 } }, market);
  const t1 = st.pieces.Gloves.stages[0];
  assert.ok(t1.cost > 0, 'tier 1 has a cost from the Exchange');
  assert.equal(t1.materials.find(m => m.id === String(LEATHER)).source, 'summary', "the Exchange's own cheapest listing");
});
