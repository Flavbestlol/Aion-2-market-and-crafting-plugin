'use strict';
// The feed client's side of the shopping list over the game: what it asks for at hello, what it hands the app
// (the hub's Open and Settings, a key pressed), and what it sends (show or hide the list, unlock only when granted).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

process.env.FLAV_FEED_FILE = path.join(__dirname, 'no-such-feed.json'); // never connects
const { Feed, FEATURES } = require('../feed');

function feed(opts = {}) {
  const f = new Feed({ version: '9.9.9', ...opts });
  const sent = [];
  f.sock = { readyState: 1, send: (t) => sent.push(JSON.parse(t)), close() {} };
  return { f, sent };
}

test('hello asks for the lock, the keys and the settings in the hub', () => {
  assert.deepStrictEqual(FEATURES, ['lock', 'hotkeys', 'settings']);
  const src = fs.readFileSync(path.join(__dirname, '..', 'feed.js'), 'utf8');
  assert.match(src, /op: 'hello'[^\n]*features: FEATURES/);
});

test('the hub\'s Open and Settings, and the keys, reach the app', () => {
  const shows = [], keys = [];
  const { f } = feed({ onShow: (w) => shows.push(w), onHotkey: (id) => keys.push(id) });
  f.take(JSON.stringify({ op: 'show', what: 'open' }));
  f.take(JSON.stringify({ op: 'show', what: 'settings' }));
  f.take(JSON.stringify({ op: 'show', what: 'format-c' }));
  f.take(JSON.stringify({ op: 'hotkey', id: 'refresh' }));
  f.take(JSON.stringify({ op: 'hotkey', id: 7 }));
  f.take(JSON.stringify({ op: 'hotkey', id: 'x'.repeat(41) }));
  assert.deepStrictEqual(shows, ['open', 'settings']);
  assert.deepStrictEqual(keys, ['refresh']);
  f.close();
});

test('the list is shown or hidden over the feed', () => {
  const { f, sent } = feed();
  f.overlay('list', true);
  f.overlay('list', 0);
  assert.deepStrictEqual(sent, [{ op: 'overlay', id: 'list', shown: true }, { op: 'overlay', id: 'list', shown: false }]);
  f.close();
});

test('unlock is sent only when the core granted the lock', () => {
  const { f, sent } = feed();
  assert.strictEqual(f.unlock(), false);
  f.take(JSON.stringify({ op: 'welcome', core: 'x', events: 1, features: ['lock', 'something-new'] }));
  assert.deepStrictEqual(f.granted, ['lock']);
  sent.length = 0;
  assert.strictEqual(f.unlock(), true);
  assert.deepStrictEqual(sent, [{ op: 'lock', locked: false }]);
  f.take(JSON.stringify({ op: 'lock', locked: true }));
  assert.strictEqual(f.info().locked, true);
  f.close();
});

test('addon.json declares the list as an overlay on this app and its keys', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'addon.json'), 'utf8'));
  assert.deepStrictEqual(m.overlays.map((o) => o.id), ['list']);
  assert.strictEqual(m.overlays[0].page, 'http://127.0.0.1:7317/overlay.html');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'ui', 'overlay.html')));
  const ids = m.hotkeys.map((k) => k.id);
  assert.deepStrictEqual(ids, ['toggle', 'refresh']);
  // Flavbest's pick (2026-10-27): refresh on Ctrl+R by default (the core holds it while the game is in front and this
  // app runs; the player changes or turns it off in the hub)
  assert.strictEqual(m.hotkeys.find((k) => k.id === 'refresh').default, 'Ctrl+R');
  assert.strictEqual(m.hotkeys.find((k) => k.id === 'toggle').default, 'Ctrl+Alt+M');
});

test('the overlay page talks only to this app and the core\'s bridge', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'ui', 'overlay.js'), 'utf8');
  assert.doesNotMatch(js, /__TAURI__|invoke\(/);
  assert.doesNotMatch(js, /https?:\/\//);
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /CSP_OVERLAY = CSP\.replace\("connect-src 'self'", "connect-src 'self' ipc: http:\/\/ipc\.localhost"\)/);
  assert.match(server, /connect-src 'self';/);
});

test('the core says whether it reads the Exchange (0.12.0), and an older core says nothing', () => {
  const { f } = feed();
  f.take(JSON.stringify({ op: 'status', capturing: true, game: true, source: 'live', text: 'x', exchange: 'ready' }));
  assert.strictEqual(f.info().exchange, 'ready');
  f.take(JSON.stringify({ op: 'status', capturing: true, game: true, source: 'live', text: 'x', exchange: 'sideways' }));
  assert.strictEqual(f.info().exchange, null);
  f.take(JSON.stringify({ op: 'status', capturing: true, game: true, source: 'live', text: 'x' }));
  assert.strictEqual(f.info().exchange, null);
  f.close();
});

test('a gear read never puts back a refresh that has ended (the spinning refresh button)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(src, /busy = prev/);
  assert.match(src, /gearRead = null;/);
  assert.match(src, /tell\('state', 'idle'\)/);
});

test('the settings are described once granted, again after a change and after a reconnect, never twice the same', () => {
  const { f, sent } = feed();
  const groups = [{ id: 'g', name: 'G', items: [{ key: 'a', name: 'A', kind: 'switch', value: true }] }];
  assert.strictEqual(f.setSettings(groups), false, 'not granted yet: kept, not sent');
  f.take(JSON.stringify({ op: 'welcome', core: 'x', events: 1, features: ['lock', 'settings'] }));
  assert.deepStrictEqual(sent.filter((m) => m.op === 'settings'), [{ op: 'settings', groups }], 'sent at welcome');
  sent.length = 0;
  assert.strictEqual(f.setSettings(JSON.parse(JSON.stringify(groups))), false, 'the same again: nothing sent');
  const changed = [{ ...groups[0], items: [{ ...groups[0].items[0], value: false }] }];
  assert.strictEqual(f.setSettings(changed), true);
  assert.deepStrictEqual(sent, [{ op: 'settings', groups: changed }]);
  // the core restarts: the next one hears them again at its welcome
  f.drop(); f.sock = { readyState: 1, send: (t) => sent.push(JSON.parse(t)), close() {} }; sent.length = 0;
  f.take(JSON.stringify({ op: 'welcome', core: 'x', events: 1, features: ['settings'] }));
  assert.deepStrictEqual(sent.filter((m) => m.op === 'settings'), [{ op: 'settings', groups: changed }]);
  f.close();
});

test('a setting changed in the hub reaches the app only when settings were granted, and only with a sane key', () => {
  const got = [];
  const { f } = feed({ onSetting: (k, v) => got.push([k, v]) });
  f.take(JSON.stringify({ op: 'setting', key: 'alerts', value: true }));
  assert.deepStrictEqual(got, [], 'not granted: ignored');
  f.take(JSON.stringify({ op: 'welcome', core: 'x', events: 1, features: ['settings'] }));
  f.take(JSON.stringify({ op: 'setting', key: 'alerts', value: true }));
  f.take(JSON.stringify({ op: 'setting', key: 7, value: true }));
  f.take(JSON.stringify({ op: 'setting', key: 'x'.repeat(41), value: true }));
  assert.deepStrictEqual(got, [['alerts', true]]);
  f.close();
});
