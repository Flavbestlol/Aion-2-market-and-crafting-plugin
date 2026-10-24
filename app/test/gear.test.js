'use strict';
/* The worn gear from the game's login list: kept by the inventory, never counted as owned material, and turned into
   the gear read the plan takes, without the official website. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { Inventory } = require('../inventory');
const C = require('../compute');

const T = 1700000000;
const fresh = () => new Inventory(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flav-gear-')), 'inventory.json'));
const list = stacks => ({ type: 'inventory', kind: 'list', at: T, stacks });

test('worn gear is kept with its slot and level, and never counted as owned', () => {
  const inv = fresh();
  inv.take(list([
    { item: 110430104, count: 1, container: 'equipped', slot: 216, worn: 'main-hand', level: 20 },
    { item: 310330113, count: 1, container: 'equipped', slot: 335, worn: 'ring-2', level: 16 },
    { item: 310900001, count: 1, container: 'equipped', slot: 335, worn: 'rune-2', level: 0 }, // the same slot number
    { item: 310330113, count: 2, container: 'bag', slot: 12 },
  ]));
  const worn = inv.worn();
  assert.equal(worn.length, 3, 'two worn items with one slot number are both kept');
  assert.deepEqual(worn.find(w => w.worn === 'main-hand'), { worn: 'main-hand', item: 110430104, level: 20 });
  assert.equal(inv.owned(310330113).total, 2, 'the worn ring is not material in hand');
});

test('a hostile worn value or level is dropped, the stack stays', () => {
  const inv = fresh();
  inv.take(list([
    { item: 110430104, count: 1, container: 'equipped', slot: 1, worn: '<img src=x>', level: 999 },
    { item: 110430105, count: 1, container: 'bag', slot: 2, worn: 'main-hand', level: 5 },
  ]));
  assert.equal(inv.worn(), null, 'no worn slot that reads');
  assert.equal(inv.stacks.size, 2);
  assert.ok(![...inv.stacks.values()].some(s => 'worn' in s && s.container === 'bag'), 'worn is only kept for equipped');
});

test('the game list becomes the gear read the plan takes', () => {
  const data = { catalogue: { items: { 110430104: { name: 'Splendent Wise Dragon Lord Bow' }, 310330113: { name: 'Splendent True Dragon Lord Ring' } } } };
  const who = { name: 'Sampleton', serverId: 1307, serverName: 'Fregion', region: 'eu', className: 'Ranger', level: 40, faction: 'Elyos' };
  const g = C.gearFromGame(data, [
    { worn: 'main-hand', item: 110430104, level: 20 },
    { worn: 'ring-2', item: 310330113, level: 15 },
    { worn: 'torso', item: 210130053, level: null }, // not in the price data: kept as other gear
    { worn: 'arcana-1', item: 810130001, level: 4 }, // not a slot the plan reads
  ], who, 1);
  assert.equal(g.source, 'game');
  assert.deepEqual(g.items.map(i => [i.slot, i.id, i.enchant, i.exceed]), [['MainHand', '110430104', 15, 5], ['Ring2', '310330113', 15, 0], ['Torso', '210130053', 0, 0]]);
  assert.equal(g.items[2].name, 'other gear');
  assert.equal(g.profile.name, 'Sampleton');
  assert.equal(g.profile.portrait, null, 'nothing from the website');
  assert.equal(C.gearFromGame(data, null, who), null);
  assert.equal(C.gearFromGame(data, [], who), null);
});
