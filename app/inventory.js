'use strict';
/* The player's own inventory, as Flav-Toolkit read it from the game.

   Flav-Toolkit posts two kinds of update to /api/inventory while the game runs (flav-inventory; ADDONS.md 4b):
     list     every stack in every container, sent when the character enters the world: replaces everything known
     changed  the stacks that just changed (a purchase, a move, loot, a craft): their new counts; 0 = gone
   Each stack carries its own `id` (Flav-Toolkit 0.16.1 and later): the same for the stack's whole life and never shared,
   so stacks are kept by it. Not by container and slot: the game's slot number is not a unique place, two stacks can share
   it (a freshly crafted piece came with the number of a stack of leather already in the bag), and kept by it one hid the
   other. A core older than 0.16.1 sends no id; then stacks are kept by container and slot as before.
   This keeps the latest picture, answers "how many of this do I own, and where" and "how much Kina do I have", and
   saves it so a restart keeps what was seen. A list older than MAX_AGE is not trusted for ticking lines (the player
   may have played without the toolkit since), only shown as "last seen".

   Containers: bag, storage (the character's), warehouse (the account's), and equipped: what the character wears, each
   with the slot it is worn in (`worn`: main-hand, earring-1…) and its enchant level when the login list said them.
   Worn gear is never counted as owned material. Kina is a stack like any other: the unbound Kina the Exchange takes is
   item 930100031 in the bag; bound Kina is another item and is not counted. */

const fs = require('fs');

const MAX_AGE_MS = 12 * 60 * 60 * 1000;  // after this, what was seen is history, not a count to tick lines with
const KINA = 930100031;
const CONTAINERS = ['bag', 'storage', 'warehouse'];

class Inventory {
  constructor(file) {
    this.file = file;
    this.stacks = new Map();  // keyOf(stack) -> { item, count, container, slot, id, at }
    this.listAt = 0;          // when the last full list arrived
    this.changedAt = 0;       // when the last change arrived
    this.updates = 0;
    // what the last change did to each item's count across the bag, storage and warehouse (item -> +n / -n): a craft
    // landing is +1 of its result; a move between containers comes as one change and nets to 0
    this.lastDelta = new Map();
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
    const delta = new Map();
    const add = (item, n) => delta.set(item, (delta.get(item) || 0) + n);
    // what a change empties first, then what it fills: a stack moved whole may come as its old place emptied and its
    // new place filled, both under its id, in either order
    const order = kind === 'changed' ? [...rows.filter(r => r.count === 0), ...rows.filter(r => r.count > 0)] : rows;
    for (const r of order) {
      const key = keyOf(r);
      if (kind === 'changed') {
        const was = this.stacks.get(key) || this.adopt(r);
        if (was && CONTAINERS.includes(was.container)) add(was.item, -was.count);
        if (CONTAINERS.includes(r.container)) add(r.item, r.count);
      }
      if (r.count > 0) this.stacks.set(key, { ...r, at });
      else this.stacks.delete(key);
    }
    for (const [item, n] of delta) if (n === 0) delta.delete(item);
    this.lastDelta = delta; // a list says what is there, not what came: no delta
    if (kind === 'changed') this.changedAt = at;
    this.updates++;
    this.saveSoon();
    return kind;
  }

  /* A stack kept from before ids (a saved picture or a list from an older core) that this change with an id is about: the
     same item at the same container and slot. It is taken out, to be put back under its id; null when there is none. */
  adopt(r) {
    if (r.id == null) return null;
    const old = slotKey(r);
    const was = this.stacks.get(old);
    if (!was || was.id != null || was.item !== r.item) return null;
    this.stacks.delete(old);
    return was;
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

  /* What the character wears, as the last login list said it: [{ worn, item, level }] (level null when unread), or
     null when no list with worn gear was seen. A swap since then shows at the next login or zone change. */
  worn() {
    if (!this.listAt) return null;
    const out = [];
    for (const s of this.stacks.values()) if (s.container === 'equipped' && s.worn) out.push({ worn: s.worn, item: s.item, level: s.level ?? null });
    return out.length ? out : null;
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
        if (r && r.count > 0) this.stacks.set(keyOf(r), { ...r, at: Number(s.at) || this.listAt });
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
  const out = { item, count: Math.floor(count), container, slot };
  const id = Number(s.id);
  if (Number.isInteger(id) && id > 0 && id <= 0xffffffff) out.id = id;
  if (container === 'equipped') {
    if (typeof s.worn === 'string' && /^[a-z0-9-]{1,20}$/.test(s.worn)) out.worn = s.worn;
    if (Number.isInteger(s.level) && s.level >= 0 && s.level <= 40) out.level = s.level;
  }
  return out;
}

/* Where a stack is kept: by its own id; without one (a core older than 0.16.1), by its container and slot, worn items
   also by item. */
const slotKey = r => r.container + ':' + r.slot + (r.container === 'equipped' ? ':' + r.item : '');
const keyOf = r => (r.id != null ? 'id:' + r.id : slotKey(r));

module.exports = { Inventory, KINA, MAX_AGE_MS };
