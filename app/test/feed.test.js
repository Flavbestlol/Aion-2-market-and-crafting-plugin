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

test('hello asks for the lock and the keys', () => {
  assert.deepStrictEqual(FEATURES, ['lock', 'hotkeys']);
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
  // the refresh key has no default: it is held whenever the game is in front, and Ctrl+R is the game's
  assert.strictEqual(m.hotkeys.find((k) => k.id === 'refresh').default, undefined);
});

test('the overlay page talks only to this app and the core\'s bridge', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'ui', 'overlay.js'), 'utf8');
  assert.doesNotMatch(js, /__TAURI__|invoke\(/);
  assert.doesNotMatch(js, /https?:\/\//);
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /CSP_OVERLAY = CSP\.replace\("connect-src 'self'", "connect-src 'self' ipc: http:\/\/ipc\.localhost"\)/);
  assert.match(server, /connect-src 'self';/);
});
