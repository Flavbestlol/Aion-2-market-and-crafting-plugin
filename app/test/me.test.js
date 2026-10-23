'use strict';
/* node --test test/me.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Me, CLASS_OF } = require('../me');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'me-')), 'me.json');

test('the two login events make a known character; the class follows the app\'s names', () => {
  const me = new Me(tmp());
  assert.equal(me.known(), false);
  assert.deepEqual(me.take({ type: 'my_server', at_ms: 1700000000000, server: 1107 }), { name: false, server: true, class: false });
  assert.equal(me.known(), false, 'a server alone is not a character');
  assert.deepEqual(me.take({ type: 'my_profile', at_ms: 1700000000001, name: 'Sampleton', class: 'Elementalist', level: 40 }), { name: true, server: false, class: true });
  assert.equal(me.known(), true);
  assert.equal(me.class, 'Spiritmaster', 'the global game calls the Elementalist a Spiritmaster');
  assert.equal(me.gameClass, 'Elementalist');
  assert.equal(me.level, 40);
  // the same again: nothing changed
  assert.deepEqual(me.take({ type: 'my_profile', name: 'Sampleton', class: 'Elementalist', level: 40 }), { name: false, server: false, class: false });
  // a level-up keeps the class; a profile without a class keeps the last one
  me.take({ type: 'my_profile', name: 'Sampleton', level: 41 });
  assert.equal(me.class, 'Spiritmaster');
  assert.equal(me.level, 41);
});

test('a class the app has no gear plan for is kept as the game said it, but is not a plan class', () => {
  const me = new Me(tmp());
  me.take({ type: 'my_profile', name: 'Sampleton', class: 'Fighter' });
  assert.equal(me.class, null);
  assert.equal(me.gameClass, 'Fighter');
  for (const k of Object.keys(CLASS_OF)) assert.ok(['Gladiator', 'Templar', 'Assassin', 'Ranger', 'Sorcerer', 'Spiritmaster', 'Cleric', 'Chanter'].includes(CLASS_OF[k]), k);
});

test('anything else is refused, and nothing beyond name, server, class and level is kept', () => {
  const me = new Me(tmp());
  assert.equal(me.take({ type: 'me', id: 100000000000000001, name: 'Sampleton' }), null, 'the entity-id event is not taken');
  assert.equal(me.take({ type: 'my_profile', name: '' }), null);
  assert.equal(me.take({ type: 'my_server', server: 0 }), null);
  assert.equal(me.take('x'), null);
  me.take({ type: 'my_profile', name: 'Sampleton', class: 'Ranger', level: 12, account: 'secret', id: 5 });
  const saved = JSON.parse(fs.readFileSync(me.file, 'utf8'));
  assert.deepEqual(Object.keys(saved).sort(), ['at', 'class', 'gameClass', 'level', 'name', 'serverId']);
  assert.equal(JSON.stringify(saved).includes('secret'), false);
});

test('what was seen survives a restart', () => {
  const file = tmp();
  const me = new Me(file);
  me.take({ type: 'my_server', server: 1107 });
  me.take({ type: 'my_profile', name: 'Sampleton', class: 'Cleric', level: 7 });
  const again = new Me(file);
  assert.equal(again.known(), true);
  assert.deepEqual([again.name, again.serverId, again.class, again.level], ['Sampleton', 1107, 'Cleric', 7]);
  assert.equal(again.status().seen, true);
});
