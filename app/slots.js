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
  return { CLASSES, LAYOUT, slotsFor, rangeOf };
});
