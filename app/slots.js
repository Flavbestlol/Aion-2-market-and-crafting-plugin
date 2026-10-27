/* Which Dragon Gear slots a class wears. Shared by the server (alerts, gear sync) and the page. */
(function (root, factory) { const api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; else root.Slots = api; })(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  // One main weapon per class, and a Guard in the off-hand for every class (lum.gg weapon list, wikily.gg classes,
  // and the official site's own MainHand/SubHand equipment slots).
  const CLASSES = [
    { id: 'Gladiator', main: 'Greatsword' },
    { id: 'Templar', main: 'Sword' },
    { id: 'Assassin', main: 'Dagger' },
    { id: 'Ranger', main: 'Bow' },
    { id: 'Sorcerer', main: 'Magicbook' },
    { id: 'Spiritmaster', main: 'Orb' },
    { id: 'Cleric', main: 'Mace' },
    { id: 'Chanter', main: 'Staff' },
  ];
  // slot id -> the official site's slotPosName
  const LAYOUT = [
    { id: 'MainHand', group: 'weapon', name: 'Main hand' },
    { id: 'SubHand', group: 'weapon', gear: 'Guarder', name: 'Off-hand' },
    { id: 'Helmet', group: 'armor', gear: 'Helmet' }, { id: 'Shoulder', group: 'armor', gear: 'Shoulder' },
    { id: 'Torso', group: 'armor', gear: 'Torso' }, { id: 'Gloves', group: 'armor', gear: 'Gloves' },
    { id: 'Pants', group: 'armor', gear: 'Pants' }, { id: 'Boots', group: 'armor', gear: 'Boots' },
    { id: 'Cape', group: 'armor', gear: 'Cape' },
    { id: 'Necklace', group: 'accessory', gear: 'Necklace' },
    { id: 'Earring1', group: 'accessory', gear: 'Earring', n: 1 }, { id: 'Earring2', group: 'accessory', gear: 'Earring', n: 2 },
    { id: 'Ring1', group: 'accessory', gear: 'Ring', n: 1 }, { id: 'Ring2', group: 'accessory', gear: 'Ring', n: 2 },
  ];
  function slotsFor(classId) {
    const c = CLASSES.find(x => x.id === classId);
    return LAYOUT.map(s => ({ ...s, gear: s.gear || (c ? c.main : null), pair: !!s.n })).filter(s => s.gear);
  }
  function rangeOf(plan, slotId) {
    const p = (plan && (plan[slotId] || plan._default)) || {};
    const goal = Math.min(6, Math.max(1, Math.round(Number(p.goal) || 6)));
    const have = Math.min(6, Math.max(0, Math.round(Number(p.have) || 0)));
    return { have, goal, skip: !!p.skip || have >= goal };
  }
  /* A change to the plan from a click: one piece's tier owned ({ slot, have }), where it stops ({ slot, goal }) or
     whether it is left out ({ slot, skip }), or every piece of the class stopping at one tier ({ goalAll }). Where a
     piece stops is the player's: owning more never moves it, and a piece owned at or past its stop has nothing to craft.
     Choosing a stop takes a piece left out back in; the tier owned and "All gear to" leave that alone. Values out of
     range are ignored. Changes `plan` in place; whether anything changed. */
  function changePlan(plan, classId, { slot, have, goal, skip, goalAll } = {}) {
    const tier = (v, lo) => (Number.isInteger(v) && v >= lo && v <= 6 ? v : null);
    const leftOut = id => { const p = plan[id] || plan._default; return !!(p && p.skip); };
    let changed = false;
    if (typeof slot === 'string' && LAYOUT.some(x => x.id === slot)) {
      const cur = rangeOf(plan, slot), h = tier(have, 0), g = tier(goal, 1), was = leftOut(slot);
      const next = { have: h == null ? cur.have : h, goal: g == null ? cur.goal : g, skip: typeof skip === 'boolean' ? skip : g != null && g !== cur.goal ? false : was };
      if (next.have !== cur.have || next.goal !== cur.goal || next.skip !== was) { plan[slot] = next; changed = true; }
    }
    const all = tier(goalAll, 1);
    if (all != null) {
      for (const s of slotsFor(classId)) { const cur = rangeOf(plan, s.id); plan[s.id] = { have: cur.have, goal: all, skip: leftOut(s.id) }; }
      delete plan._default; changed = true;
    }
    return changed;
  }
  return { CLASSES, LAYOUT, slotsFor, rangeOf, changePlan };
});
