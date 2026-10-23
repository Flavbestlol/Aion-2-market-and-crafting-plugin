'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Market, coverCheapest, MAX_AGE_MS } = require('../market');

const T = 1_800_000_000; // seconds
const listing = (item, unit, quantity, currency = 'kina', id = Math.random().toString(36).slice(2)) =>
  ({ id, item, quantity, unit_price: unit, sale_price: unit * quantity, currency, expires: '', is_set_item: false, conditions: [] });

test('summary gives every item a cheapest price while fresh', () => {
  const m = new Market(null);
  assert.equal(m.take({ type: 'market-summary', at: T, server: 11304, rows: [{ item: 610530001, min_unit_price: 999, sale_count: 96 }] }), 'summary');
  // one row only: which market it is isn't known yet
  assert.equal(m.min(610530001, 'kina', T * 1000), null);
  // listings under that server id say it is the Kina market
  m.take({ type: 'market-listings', at: T, server: 11304, items: [7], sort: 'UnitPrice ASC', page: 1, has_next_page: false, listings: [listing(7, 5, 1, 'kina')] });
  assert.deepEqual(m.min(610530001, 'kina', T * 1000), { price: 999, count: 96, at: T * 1000, source: 'summary' });
  assert.equal(m.min(610530001, 'kina', T * 1000 + MAX_AGE_MS + 1), null);
  assert.equal(m.min(1, 'kina', T * 1000), null);
});

test('summaries merge per market: the whole Exchange, then one category; a big summary is the Kina market', () => {
  const m = new Market(null);
  const rows = n => Array.from({ length: n }, (_, i) => ({ item: 1000 + i, min_unit_price: 10 + i, sale_count: 1 }));
  m.take({ type: 'market-summary', at: T, server: 11304, rows: rows(60) });
  m.take({ type: 'market-summary', at: T + 5, server: 11304, rows: [{ item: 1000, min_unit_price: 9, sale_count: 2 }] });
  m.take({ type: 'market-summary', at: T, server: 1304, rows: [{ item: 516140001, min_unit_price: 790, sale_count: 122 }] });
  assert.equal(m.min(1000, 'kina', T * 1000 + 6000).price, 9);
  assert.equal(m.min(1059, 'kina', T * 1000 + 6000).price, 69);
  assert.equal(m.min(516140001, 'quna', T * 1000), null); // 1304's market isn't known until listings show it
  m.take({ type: 'market-listings', at: T, server: 1304, items: [516140001], sort: 'UnitPrice ASC', page: 2, has_next_page: false, listings: [listing(516140001, 822, 1, 'quna')] });
  assert.equal(m.min(516140001, 'quna', T * 1000).source, 'summary'); // a page 2 alone isn't a ladder, the summary answers
  assert.equal(m.min(516140001, 'quna', T * 1000).price, 790);
  assert.equal(m.status(T * 1000 + 6000).summary.items, 61);
});

test('a ladder sorted by unit price is used page by page; the cost of N is the cheapest N', () => {
  const m = new Market(null);
  const page = (n, next, ls) => ({ type: 'market-listings', at: T + n, server: 11304, items: [610530001], sort: 'UnitPrice ASC', page: n, has_next_page: next, listings: ls });
  m.take(page(1, true, [listing(610530001, 999, 3), listing(610530001, 1000, 1)]));
  const after1 = m.costOf(610530001, 5, 'kina', T * 1000);
  // the ladder has 4 units: everything, plus the missing one priced at the dearest seen
  assert.deepEqual([after1.cost, after1.bought, after1.exact], [999 * 3 + 1000 + 1000, 4, false]);
  m.take(page(2, false, [listing(610530001, 1100, 10)]));
  const l = m.ladder(610530001, 'kina', T * 1000);
  assert.equal(l.complete, true);
  assert.deepEqual(l.listings.map(x => x.unit), [999, 1000, 1100]);
  // 5 units: the stack of 10 at 1,100 must be bought whole, so 3 + 1 + 10 = 14 units for 15,997, or the stack alone
  // for 11,000 — the stack alone is cheaper, and the plan says so
  const c = m.costOf(610530001, 5, 'kina', T * 1000);
  assert.deepEqual([c.cost, c.bought, c.exact, c.maxUnit], [11000, 10, true, 1100]);
  assert.deepEqual(c.listings, [{ unit: 1100, quantity: 10, count: 1 }]);
  // 4 units: the 3-stack and the single
  const d = m.costOf(610530001, 4, 'kina', T * 1000);
  assert.deepEqual([d.cost, d.bought, d.maxUnit], [999 * 3 + 1000, 4, 1000]);
  // the ladder beats the summary for the cheapest price
  m.take({ type: 'market-summary', at: T, server: 11304, rows: [{ item: 610530001, min_unit_price: 5, sale_count: 1 }] });
  assert.equal(m.min(610530001, 'kina', T * 1000).source, 'ladder');
});

test('a page sorted by total price is only trusted when every page was seen', () => {
  const m = new Market(null);
  const ev = (page, next) => ({ type: 'market-listings', at: T, items: [1], sort: 'SalePrice ASC', page, has_next_page: next, listings: [listing(1, 50 + page, 1)] });
  m.take(ev(1, true));
  assert.equal(m.ladder(1, 'kina', T * 1000), null);
  m.take(ev(2, false));
  assert.deepEqual(m.ladder(1, 'kina', T * 1000).listings.map(x => x.unit), [51, 52]);
});

test('Quna and Kina listings of one item are different ladders; chest offers rank by Quna per Kina', () => {
  const m = new Market(null);
  m.take({ type: 'market-listings', at: T, items: [516140001], sort: 'UnitPrice ASC', page: 1, has_next_page: false,
    listings: [listing(516140001, 790, 1, 'quna'), listing(516140001, 822, 2, 'quna'), listing(516140001, 1_900_000, 1, 'kina')] });
  m.take({ type: 'market-listings', at: T, items: [516150001], sort: 'UnitPrice ASC', page: 1, has_next_page: false, listings: [listing(516150001, 150, 1, 'quna')] });
  assert.deepEqual(m.ladder(516140001, 'kina', T * 1000).listings.map(x => x.unit), [1_900_000]);
  const offers = m.chestOffers({ 516140001: 2_000_000, 516150001: 400_000 }, T * 1000);
  assert.deepEqual(offers.map(o => [o.id, o.quna, o.quantity]), [['516150001', 150, 1], ['516140001', 790, 1], ['516140001', 822, 2]]);
});

test('an item browsed and found empty has no price; a new page 1 starts over', () => {
  const m = new Market(null);
  m.take({ type: 'market-summary', at: T, server: 11304, rows: [{ item: 7, min_unit_price: 10, sale_count: 1 }] });
  m.take({ type: 'market-listings', at: T + 1, server: 11304, items: [7], sort: 'UnitPrice ASC', page: 1, has_next_page: false, listings: [] });
  assert.equal(m.min(7, 'kina', T * 1000 + 2000), null);
  m.take({ type: 'market-listings', at: T + 2, server: 11304, items: [7], sort: 'UnitPrice ASC', page: 1, has_next_page: false, listings: [listing(7, 12, 1)] });
  assert.equal(m.min(7, 'kina', T * 1000 + 3000).price, 12);
});

test('saves and loads what it saw', () => {
  const file = require('path').join(require('os').tmpdir(), 'flav-market-test-' + process.pid + '.json');
  const m = new Market(file);
  m.take({ type: 'market-summary', at: T, server: 11304, rows: [{ item: 1, min_unit_price: 10, sale_count: 2 }] });
  m.take({ type: 'market-listings', at: T, server: 11304, items: [1], sort: 'UnitPrice ASC', page: 1, has_next_page: false, listings: [listing(1, 10, 2), listing(1, 11, 1)] });
  m.take({ type: 'item-stats', at: T, item: 1, average_unit_price: 10.5, min_unit_price: 9, max_unit_price: 12, quantity: 100 });
  m.save();
  const again = new Market(file);
  assert.equal(again.min(1, 'kina', T * 1000).price, 10);
  assert.equal(again.marketOf(11304), 'kina');
  assert.equal(again.costOf(1, 3, 'kina', T * 1000).cost, 31);
  assert.equal(again.stats.get('1').average, 10.5);
  assert.equal(again.status(T * 1000).live, true);
  require('fs').unlinkSync(file);
});

test('ignores what it does not understand', () => {
  const m = new Market(null);
  assert.equal(m.take(null), null);
  assert.equal(m.take({ type: 'hit' }), null);
  assert.equal(m.take({ type: 'market-summary', rows: 'no' }), null);
  assert.equal(m.updates, 0);
});

test('coverCheapest buys whole stacks and prefers a cheap overshoot to a dear exact fit', () => {
  const pick = coverCheapest([{ units: 1, cost: 10 }, { units: 1, cost: 10 }, { units: 1, cost: 10 }, { units: 5, cost: 24 }], 3);
  assert.deepEqual([pick.units, pick.cost], [5, 24]);
  const tight = coverCheapest([{ units: 1, cost: 10 }, { units: 1, cost: 10 }, { units: 1, cost: 10 }, { units: 5, cost: 40 }], 3);
  assert.deepEqual([tight.units, tight.cost], [3, 30]);
  const short = coverCheapest([{ units: 2, cost: 5 }], 10);
  assert.deepEqual([short.units, short.cost], [2, 5]);
  assert.deepEqual(coverCheapest([], 3), { picked: [], units: 0, cost: 0 });
});
