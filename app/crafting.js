'use strict';
/* The crafting counter: while the player crafts a batch in game, how many came out Splendent so far.

   A craft with a lucky result (the recipe's combo: Orichalcum Gloves, and sometimes Splendent Orichalcum Gloves
   instead) lands in the bag as one inventory change. Each change's delta (inventory.js `lastDelta`) is matched
   against the recipes: +1 of a recipe's plain result or of its Splendent result is one craft of that recipe.
   A run is one batch: it starts with the first piece that lands and goes on while pieces keep coming; a piece of
   another recipe, or one after GAP without any, starts a new run. Only what lands is counted: what was in hand
   before the run, moves between bag, storage and warehouse (they net to 0) and pieces used up are not.

   Nothing is read but the inventory events the game already sends; nothing is kept on disk. */

const GAP_MS = 15 * 60 * 1000;   // no piece for this long: the next one starts a new run
const SHOW_MS = 30 * 60 * 1000;  // a run is shown until this long after its last piece (or until cleared)

class Crafting {
  constructor({ name = id => 'Item ' + id, icon = () => null } = {}) {
    this.name = name;
    this.icon = icon;
    this.byItem = new Map(); // item -> [{ plain, lucky, recipe }]: the recipes it is a result of
    this.run = null;
    this.seq = 0;            // bumped on every change, so a page can tell a new run from an update
  }

  /* The recipes with a lucky result, from the catalogue (called whenever prices are loaded). */
  learn(catalogue) {
    const by = new Map();
    const put = (item, pair) => { const k = Number(item); if (!by.has(k)) by.set(k, []); if (!by.get(k).some(p => p.plain === pair.plain && p.lucky === pair.lucky)) by.get(k).push(pair); };
    for (const r of (catalogue && catalogue.recipes) || []) {
      const plain = Number(r && r.itemId), lucky = Number(r && r.combo && r.combo.itemId);
      if (!Number.isSafeInteger(plain) || !Number.isSafeInteger(lucky) || plain === lucky || r.isComboResult) continue;
      const pair = { plain, lucky, recipe: String(r.id) };
      put(plain, pair);
      put(lucky, pair);
    }
    this.byItem = by;
  }

  /* One inventory change (item -> +n/-n). Returns true when the run changed. */
  take(delta, now = Date.now()) {
    if (!delta || !delta.size || !this.byItem.size) return false;
    let changed = false;
    for (const [item, n] of delta) {
      if (!(n > 0) || n > 100) continue; // a craft lands a piece or a few; a bigger jump is a move or a list
      const pairs = this.byItem.get(Number(item));
      if (!pairs) continue;
      const r = this.run;
      const same = r && now - r.lastAt <= GAP_MS && pairs.find(p => p.plain === r.plain && p.lucky === r.lucky);
      const pair = same || pairs[0];
      if (!same) this.run = { plain: pair.plain, lucky: pair.lucky, plainN: 0, luckyN: 0, startedAt: now, lastAt: now };
      const run = this.run;
      if (Number(item) === run.lucky) run.luckyN += n; else run.plainN += n;
      run.lastAt = now;
      changed = true;
    }
    if (changed) this.seq++;
    return changed;
  }

  clear() { if (!this.run) return false; this.run = null; this.seq++; return true; }

  /* What the overlay shows, or null when nothing is being crafted. */
  view(now = Date.now()) {
    const r = this.run;
    if (!r || now - r.lastAt > SHOW_MS) return null;
    const made = r.plainN + r.luckyN;
    return {
      seq: this.seq,
      lucky: { id: r.lucky, name: this.name(r.lucky), icon: this.icon(r.lucky), n: r.luckyN },
      plain: { id: r.plain, name: this.name(r.plain), icon: this.icon(r.plain), n: r.plainN },
      made, pct: made ? Math.round(r.luckyN / made * 100) : 0,
      startedAt: r.startedAt, lastAt: r.lastAt, hideAt: r.lastAt + SHOW_MS,
    };
  }
}

module.exports = { Crafting, GAP_MS, SHOW_MS };
