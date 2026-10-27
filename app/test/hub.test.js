'use strict';
/* Dragon Gear's settings in Flav-Toolkit's hub (hub.js; ADDONS.md section 4d): what the hub is told, within the
   core's limits, and what a change made there becomes here, checked. Also: the Alerts switch reaches its route. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const Hub = require('../hub');

const all = (groups) => groups.flatMap((g) => g.items);

test('the description keeps within the core\'s limits, every key once', () => {
  const groups = Hub.describe({});
  assert.ok(groups.length <= 16);
  const items = all(groups);
  assert.ok(items.length <= 128);
  const keys = items.map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length, 'keys unique');
  for (const g of groups) { assert.match(g.id, /^[A-Za-z0-9_.-]{1,40}$/); assert.ok(g.name.length <= 60); }
  for (const i of items) {
    assert.match(i.key, /^[A-Za-z0-9_.-]{1,40}$/, i.key);
    assert.ok(i.name.length <= 60, i.key);
    assert.ok(!i.help || i.help.length <= 200, `${i.key} help ${i.help && i.help.length}`);
    if (i.kind === 'choice') {
      assert.ok(i.choices.length >= 2 && i.choices.length <= 16, i.key);
      assert.ok(i.choices.some(([v]) => v === i.value), `${i.key}: its value is one of its choices`);
    }
    if (i.kind === 'number') assert.ok(i.value >= i.min && i.value <= i.max, i.key);
  }
  // one item per shared setting: the list's Size and its panel
  assert.deepEqual(items.filter((i) => i.shared).map((i) => [i.key, i.shared.id]), [['overlay.size', 'size'], ['overlay.panel', 'solid']]);
  // the plan, the alerts list, the class and the character stay in the app's own windows
  for (const k of ['plan', 'alerts_list', 'class', 'character']) assert.ok(!keys.includes(k), k);
});

test('the values described are the ones kept', () => {
  const s = { currency: 'SAR', cheap_when_below_usual_percent: 8, expensive_when_above_usual_percent: 12, auto_sync: false, shop: { use_inventory: false }, alerts: true,
    overlay: { size: 1.3, panel: 0.35, faces: 'left', auto: false, steps_one: true } };
  const v = Object.fromEntries(all(Hub.describe(s, { goals: 3 })).map((i) => [i.key, i.value]));
  assert.deepEqual(v, { 'plan.goal_all': '3', currency: 'SAR', cheap_when_below_usual_percent: 8, expensive_when_above_usual_percent: 12, auto_sync: false, 'shop.use_inventory': false, alerts: true,
    'overlay.size': '1.3', 'overlay.panel': 0.35, 'overlay.faces': 'left', 'overlay.auto': false, 'overlay.steps_one': true });
  const d = Object.fromEntries(all(Hub.describe({})).map((i) => [i.key, i.value]));
  assert.equal(d['plan.goal_all'], 'each', 'pieces stopping at different tiers');
  assert.equal(d['overlay.size'], '1'); assert.equal(d['overlay.panel'], 1); assert.equal(d.currency, 'USD'); assert.equal(d.alerts, false);
});

test('a change from the hub, checked, becomes what the app does with it', () => {
  assert.deepEqual(Hub.change('plan.goal_all', '2'), { goal_all: 2 });
  assert.equal(Hub.change('plan.goal_all', 'each'), null, 'pieces keep their own stops');
  assert.deepEqual(Hub.change('currency', 'EUR'), { settings: { currency: 'EUR' } });
  assert.deepEqual(Hub.change('cheap_when_below_usual_percent', 9), { settings: { cheap_when_below_usual_percent: 9 } });
  assert.deepEqual(Hub.change('auto_sync', false), { settings: { auto_sync: false } });
  assert.deepEqual(Hub.change('shop.use_inventory', true), { use_inventory: true });
  assert.deepEqual(Hub.change('alerts', true), { alerts: true });
  assert.deepEqual(Hub.change('overlay.size', '1.15'), { prefs: { size: 1.15 } });
  assert.deepEqual(Hub.change('overlay.panel', 0.4), { prefs: { panel: 0.4 } });
  assert.deepEqual(Hub.change('overlay.faces', 'right'), { prefs: { faces: 'right' } });
  assert.deepEqual(Hub.change('overlay.steps_one', true), { prefs: { steps_one: true } });
  for (const [k, v] of [['plan.goal_all', '7'], ['plan.goal_all', 2], ['currency', 'GBP'], ['cheap_when_below_usual_percent', 0], ['cheap_when_below_usual_percent', '9'],
    ['auto_sync', 'yes'], ['alerts', 1], ['overlay.size', '2'], ['overlay.size', 1.15], ['overlay.panel', 1.5], ['overlay.panel', '0.4'], ['overlay.faces', 'up'], ['plan', {}], ['class', 'Ranger'], ['__proto__', true]])
    assert.equal(Hub.change(k, v), null, `${k} = ${JSON.stringify(v)}`);
});

test('the list\'s look: only its own values are kept', () => {
  assert.deepEqual(Hub.cleanPrefs({ size: 1.3, panel: 0.333, faces: 'left', auto: false, steps_one: true, extra: 1 }), { size: 1.3, panel: 0.33, faces: 'left', auto: false, steps_one: true });
  assert.deepEqual(Hub.cleanPrefs({ size: 3, panel: -1, faces: 'x', auto: 'no' }), {});
  assert.deepEqual(Hub.prefsOf({ overlay: { size: 1.5 } }), { prefs: { ...Hub.PREFS, size: 1.5 }, set: ['size'] });
});

test('every POST route is matched once (the Alerts switch was dead behind a second /api/alerts)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const post = src.slice(src.indexOf("if (req.method === 'POST') {"), src.indexOf("if (p === '/api/shopping')"));
  const routes = [...post.matchAll(/if \(p === '([^']+)'/g)].map((m) => m[1]);
  assert.ok(routes.includes('/api/alerts'));
  assert.deepEqual(routes.filter((r, i) => routes.indexOf(r) !== i), [], 'no route twice');
  // and the one /api/alerts turns alerts on and off
  const alerts = post.slice(post.indexOf("if (p === '/api/alerts')"));
  assert.match(alerts.slice(0, 600), /typeof body\.on === 'boolean'[^\n]*setAlerts\(body\.on\)/);
});
