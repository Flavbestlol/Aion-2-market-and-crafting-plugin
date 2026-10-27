'use strict';
/* Where each piece stops ("I want my weapon to T2 only", "my necklace is T1, show me T3"): set per piece or for every
   piece at once; owning more never moves the stop. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Slots = require('../slots');

test('one piece: where it stops, and the tier owned, each on its own', () => {
  const plan = {};
  assert.ok(Slots.changePlan(plan, 'Ranger', { slot: 'MainHand', goal: 2 }));
  assert.deepEqual(Slots.rangeOf(plan, 'MainHand'), { have: 0, goal: 2, skip: false });
  assert.ok(Slots.changePlan(plan, 'Ranger', { slot: 'Necklace', have: 1 }));
  assert.ok(Slots.changePlan(plan, 'Ranger', { slot: 'Necklace', goal: 3 }));
  assert.deepEqual(Slots.rangeOf(plan, 'Necklace'), { have: 1, goal: 3, skip: false });
});

test('owning a piece at or past its stop leaves the stop alone: nothing to craft', () => {
  const plan = { Gloves: { have: 1, goal: 2 } };
  Slots.changePlan(plan, 'Ranger', { slot: 'Gloves', have: 3 });
  assert.deepEqual(Slots.rangeOf(plan, 'Gloves'), { have: 3, goal: 2, skip: true }, 'the stop is still T2, the piece is done');
});

test('every piece to one tier; a piece left out stays out, a piece already past it is done', () => {
  const plan = { Cape: { have: 0, goal: 6, skip: true }, Ring1: { have: 4, goal: 6 } };
  assert.ok(Slots.changePlan(plan, 'Ranger', { goalAll: 2 }));
  for (const s of Slots.slotsFor('Ranger')) assert.equal(Slots.rangeOf(plan, s.id).goal, 2, s.id);
  assert.equal(plan.Cape.skip, true, 'left out stays out');
  assert.deepEqual(Slots.rangeOf(plan, 'Ring1'), { have: 4, goal: 2, skip: true });
  // then one piece on its own
  Slots.changePlan(plan, 'Ranger', { slot: 'MainHand', goal: 5 });
  assert.equal(Slots.rangeOf(plan, 'MainHand').goal, 5);
  assert.equal(Slots.rangeOf(plan, 'Helmet').goal, 2);
});

test('values out of range, unknown slots and other types change nothing', () => {
  const plan = { Gloves: { have: 1, goal: 3 } };
  for (const c of [{ slot: 'Gloves', goal: 0 }, { slot: 'Gloves', goal: 7 }, { slot: 'Gloves', have: -1 }, { slot: 'Gloves', goal: '2' }, { slot: 'Gloves', goal: 2.5 },
    { slot: 'Nope', goal: 2 }, { slot: 42, goal: 2 }, { goalAll: 0 }, { goalAll: 9 }, { goalAll: '3' }, {}])
    assert.equal(Slots.changePlan(plan, 'Ranger', c), false, JSON.stringify(c));
  assert.deepEqual(plan, { Gloves: { have: 1, goal: 3 } });
});

test('a piece left out: its tier owned and All gear to keep it out, choosing its stop takes it back in', () => {
  const plan = { Cape: { have: 0, goal: 6, skip: true }, _default: { have: 0, goal: 6, skip: true } };
  Slots.changePlan(plan, 'Ranger', { slot: 'Cape', have: 2 });
  assert.equal(plan.Cape.skip, true, 'the tier owned leaves it out');
  Slots.changePlan(plan, 'Ranger', { goalAll: 3 });
  assert.equal(plan.Cape.skip, true, 'All gear to leaves it out');
  assert.equal(plan.Helmet.skip, true, 'so does a piece left out through the old one-range plan');
  assert.equal(plan._default, undefined);
  Slots.changePlan(plan, 'Ranger', { slot: 'Cape', have: 2, goal: 3 });
  assert.equal(plan.Cape.skip, true, 'the same stop sent along with the tier owned leaves it out');
  Slots.changePlan(plan, 'Ranger', { slot: 'Cape', goal: 4 });
  assert.deepEqual(plan.Cape, { have: 2, goal: 4, skip: false }, 'a stop chosen: back in');
  assert.ok(Slots.changePlan(plan, 'Ranger', { slot: 'Cape', skip: true }));
  assert.equal(Slots.rangeOf(plan, 'Cape').skip, true, 'left out by hand');
  assert.equal(Slots.changePlan(plan, 'Ranger', { slot: 'Cape', skip: true }), false, 'nothing new');
});
