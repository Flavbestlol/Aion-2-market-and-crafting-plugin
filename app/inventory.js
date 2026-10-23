'use strict';
/* The player's own inventory, as Flav-Toolkit read it from the game.

   Flav-Toolkit posts two kinds of update to /api/inventory while the game runs (flav-inventory; ADDONS.md 4b):
     list     every stack in every container, sent when the character enters the world: replaces everything known
     changed  the stacks that just changed (a purchase, a move, loot, a craft): their new counts; 0 = gone
   This keeps the latest picture, answers "how many of this do I own, and where" and "how much Kina do I have", and
   saves it so a restart keeps what was seen. A list older than MAX_AGE is not trusted for ticking lines (the player
   may have played without the toolkit since), only shown as "last seen".

   Containers: bag, storage (the character's), warehouse (the account's). Kina is a stack like any other: the unbound
   Kina the Exchange takes is item 930100031 in the bag; bound Kina is another item and is not counted. */

const fs = require('fs');

const MAX_AGE_MS = 12 * 60 * 60 * 1000;  // after this, what was seen is history, not a count to tick lines with
const KINA = 930100031;
const CONTAINERS = ['bag', 'storage', 'warehouse'];

class Inventory {
  constructor(file) {
    this.file = file;
    this.stacks = new Map();  // `${container}:${slot}` -> { item, count, container, slot, at }
    this.listAt = 0;          // when the last full list arrived
    this.changedAt = 0;       // when the last change arrived
    this.updates = 0;
    this.saveTimer = null;
    this.load();
  }

  /* One update from the toolkit. Returns 'list' | 'changed' | null. */
  take(event) {
    if (!event || typeof event !== 'object') return null;
    const kind = event.type === 'inventory' ? event.kind : event.type;
    if (!Array.isArray(event.stacks) || (kind !== 'list' && kind !== 'changed')) return null;
    const at = Number(event.at) > 0 ? Number(event.at) * 1000 : Date.now();
    const rows = event.stacks.map(normalize).filter(Boolean);
    if (kind === 'list') {
      this.stacks.clear();
      this.listAt = at;
    } else if (!rows.length) {
      return null;
    }
    for (const r of rows) {
      const key = r.container + ':' + r.slot;
      if (r.count > 0) this.stacks.set(key, { ...r, at });
      else this.stacks.delete(key);
    }
    if (kind === 'changed') this.changedAt = at;
    this.updates++;
    this.saveSoon();
    return kind;
  }

  /* How many of `item` the player owns, by container and in all: { bag, storage, warehouse, total } (0s when unknown). */
  owned(item) {
    const out = { bag: 0, storage: 0, warehouse: 0, total: 0 };
    for (const s of this.stacks.values()) {
      if (s.item !== Number(item) || !CONTAINERS.includes(s.container)) continue;
      out[s.container] += s.count;
      out.total += s.count;
    }
    return out;
  }

  /* The unbound Kina in the bag, or null when no list was seen. */
  kina() {
    if (!this.listAt) return null;
    return this.owned(KINA).bag;
  }

  /* Whether the picture is recent enough to act on (tick lines, subtract from the shopping list). */
  fresh(now = Date.now()) {
    return !!this.listAt && now - Math.max(this.listAt, this.changedAt) <= MAX_AGE_MS;
  }

  status(now = Date.now()) {
    const last = Math.max(this.listAt, this.changedAt);
    return {
      seen: !!this.listAt,
      fresh: this.fresh(now),
      stacks: this.stacks.size,
      updates: this.updates,
      kina: this.kina(),
      lastAt: last ? new Date(last).toISOString() : null,
      ageMin: last ? Math.round((now - last) / 60000) : null,
    };
  }

  saveSoon() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 1500);
  }

  save() {
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ listAt: this.listAt, changedAt: this.changedAt, stacks: [...this.stacks.values()] }));
      fs.renameSync(tmp, this.file);
    } catch (e) { /* the inventory is a convenience; losing it costs one relog */ }
  }

  load() {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.listAt = Number(j.listAt) || 0;
      this.changedAt = Number(j.changedAt) || 0;
      for (const s of j.stacks || []) {
        const r = normalize(s);
        if (r && r.count > 0) this.stacks.set(r.container + ':' + r.slot, { ...r, at: Number(s.at) || this.listAt });
      }
    } catch (e) { /* no file yet */ }
  }
}

/* One stack as the toolkit sends it; null when it isn't one. Unknown containers ({ other: n }) are kept under 'other'. */
function normalize(s) {
  if (!s || typeof s !== 'object') return null;
  const item = Number(s.item), count = Number(s.count), slot = Number(s.slot);
  if (!Number.isInteger(item) || item < 100000000 || item > 999999999 || !Number.isFinite(count) || count < 0 || !Number.isInteger(slot)) return null;
  const container = typeof s.container === 'string' ? s.container : (s.container && s.container.other != null ? 'other' + s.container.other : 'other');
  return { item, count: Math.floor(count), container, slot };
}

module.exports = { Inventory, KINA, MAX_AGE_MS };
