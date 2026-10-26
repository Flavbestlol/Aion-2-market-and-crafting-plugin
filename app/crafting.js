'use strict';
/* The crafting counter: while the player crafts a batch in game, how many tries, how many came out, how many came out
   Splendent, how many failed, and the streak of Splendent in a row.

   What the game sends for one try (seen on a recorded batch of 15 Orichalcum Greaves, 2026-10-26): first one inventory
   change taking the recipe's materials (2 ingots, 3 leather, 2 refining stones, 1 odyle: exactly its ingredients),
   then, a few seconds later, one change with the new piece: the plain result or, sometimes, the Splendent one (the
   recipe's combo). A try whose materials went and no piece came is a failed try: the next try's materials come first,
   or nothing comes for FAIL_MS. Each change's delta (inventory.js `lastDelta`: item -> net change across bag, storage
   and warehouse) is matched against the recipes with a lucky result.
   A run is one batch: it starts with its first try (or its first piece, when a recipe's materials aren't recognised)
   and goes on while tries keep coming; a try or piece of another recipe, or one after GAP_MS without any, starts a new
   run. Only what lands is counted: what was in hand before the run, moves between bag, storage and warehouse (they net
   to 0) and pieces used up are not.

   Nothing is read but the inventory events the game already sends; nothing is kept on disk. */

const GAP_MS = 15 * 60 * 1000;   // no try or piece for this long: the next one starts a new run
const SHOW_MS = 30 * 60 * 1000;  // a run is shown until this long after its last try or piece (or until cleared)
const FAIL_MS = 45 * 1000;       // a try with no piece after this long failed (a Splendent piece came 23 s after its try)
const KINA = 930100031;          // a fee paid in Kina may ride along with the materials; it is not one of them

class Crafting {
  constructor({ name = id => 'Item ' + id, icon = () => null } = {}) {
    this.name = name;
    this.icon = icon;
    this.byItem = new Map(); // item -> [{ plain, lucky, chance }]: the recipes it is a result of
    this.tries = [];         // [{ pair, needs: [{ ids: Set, qty }] }]: what one try of each recipe takes
    this.run = null;
    this.loose = null;       // a try whose materials fit several recipes, waiting for its piece to say which
    this.seq = 0;            // bumped on every change, so a page can tell a new run or a new result from a redraw
  }

  /* The recipes with a lucky result, from the catalogue (called whenever prices are loaded). */
  learn(catalogue) {
    const by = new Map(), tries = [];
    const put = (item, pair) => { const k = Number(item); if (!by.has(k)) by.set(k, []); if (!by.get(k).some(p => p.plain === pair.plain && p.lucky === pair.lucky)) by.get(k).push(pair); };
    for (const r of (catalogue && catalogue.recipes) || []) {
      const plain = Number(r && r.itemId), lucky = Number(r && r.combo && r.combo.itemId);
      if (!Number.isSafeInteger(plain) || !Number.isSafeInteger(lucky) || plain === lucky || r.isComboResult) continue;
      const pair = { plain, lucky, recipe: String(r.id), chance: chanceOf(r.combo) };
      put(plain, pair);
      put(lucky, pair);
      const needs = [];
      for (const i of Array.isArray(r.ingredients) ? r.ingredients : []) {
        const ids = new Set([i && i.itemId, ...((i && Array.isArray(i.options)) ? i.options.map(o => o && o.itemId) : [])].map(Number).filter(Number.isSafeInteger));
        const qty = Number(i && i.quantity);
        if (!ids.size || !(qty > 0)) { needs.length = 0; break; }
        needs.push({ ids, qty });
      }
      if (needs.length) tries.push({ pair, needs });
    }
    this.byItem = by;
    this.tries = tries;
  }

  /* One inventory change (item -> +n/-n). Returns true when the run changed. */
  take(delta, now = Date.now()) {
    if (!delta || !delta.size || !this.byItem.size) return false;
    let changed = this.tick(now);
    const spent = this.spentOn(delta, -1);
    if (spent.length) return this.started(spent, now) || changed;
    const back = this.spentOn(delta, 1); // the same materials given back: a try that was called off
    if (back.length && this.run && this.run.pending && back.some(p => this.same(p))) {
      this.run.pending = null; this.run.tries = Math.max(0, this.run.tries - 1); this.seq++;
      return true;
    }
    for (const [item, n] of delta) {
      if (!(n > 0) || n > 100) continue; // a craft lands a piece or a few; a bigger jump is a move or a list
      const pairs = this.byItem.get(Number(item));
      if (!pairs) continue;
      const r = this.run;
      const same = r && now - r.lastAt <= GAP_MS && pairs.find(p => this.same(p));
      const pair = same || (this.loose && pairs.find(p => this.loose.pairs.includes(p))) || pairs[0];
      if (!same) this.run = newRun(pair, now, this.loose && this.loose.pairs.includes(pair) ? 1 : 0);
      this.loose = null;
      const run = this.run;
      run.pending = null;
      if (Number(item) === run.lucky) {
        run.luckyN += n; run.streak += n; run.dry = 0; run.best = Math.max(run.best, run.streak);
        run.last = { kind: 'lucky', streak: run.streak };
      } else {
        const ended = run.streak;
        run.plainN += n; run.streak = 0; run.dry += n;
        run.last = { kind: 'plain', dry: run.dry, ended };
      }
      run.lastAt = now;
      changed = true;
    }
    if (changed) this.seq++;
    return changed;
  }

  /* Time passing: a try still waiting for its piece after FAIL_MS failed. Returns true when the run changed. */
  tick(now = Date.now()) {
    const run = this.run;
    if (!run || !run.pending || now - run.pending.at <= FAIL_MS) return false;
    this.failed(run, now);
    this.seq++;
    return true;
  }

  clear() { if (!this.run && !this.loose) return false; this.run = null; this.loose = null; this.seq++; return true; }

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
      tries: Math.max(r.tries, made + r.failed), failed: r.failed, crafting: !!r.pending,
      streak: r.streak, dry: r.dry, best: r.best, chance: r.chance, last: r.last,
      startedAt: r.startedAt, lastAt: r.lastAt, hideAt: r.lastAt + SHOW_MS,
    };
  }

  // ---- inside ----

  same(p) { const r = this.run; return !!r && p.plain === r.plain && p.lucky === r.lucky; }

  /* The recipes one try of which this change is: every entry is one of the recipe's materials, by `sign` (-1 taken,
     +1 given back), each exactly the quantity one try takes. */
  spentOn(delta, sign) {
    const entries = [...delta].filter(([item]) => Number(item) !== KINA);
    if (!entries.length || entries.some(([, n]) => Math.sign(n) !== sign)) return [];
    const out = [];
    for (const t of this.tries) {
      if (t.needs.length !== entries.length) continue;
      const fits = t.needs.every(need => entries.some(([item, n]) => need.ids.has(Number(item)) && Math.abs(n) === need.qty));
      if (fits && !out.includes(t.pair)) out.push(t.pair);
    }
    return out;
  }

  /* A try began: its materials are gone. A try of the run still waiting for its piece failed. */
  started(pairs, now) {
    const r = this.run;
    const ours = r && now - r.lastAt <= GAP_MS && pairs.find(p => this.same(p));
    if (ours) {
      if (r.pending) this.failed(r, now);
      r.tries++; r.pending = { at: now }; r.lastAt = now;
    } else if (pairs.length === 1) {
      this.run = newRun(pairs[0], now, 1);
      this.run.pending = { at: now };
      this.loose = null;
    } else {
      this.loose = { at: now, pairs }; // which recipe it was: the piece will say
      return false;
    }
    this.seq++;
    return true;
  }

  failed(run, now) {
    const ended = run.streak;
    run.failed++; run.streak = 0; run.dry++; run.pending = null; run.lastAt = now;
    run.last = { kind: 'fail', dry: run.dry, ended };
  }
}

function newRun(pair, now, tries) {
  return { plain: pair.plain, lucky: pair.lucky, chance: pair.chance, plainN: 0, luckyN: 0, tries, failed: 0, streak: 0, dry: 0, best: 0, pending: null, last: null, startedAt: now, lastAt: now };
}

/* The combo's chance (0.25 for 25%): its own probability when given, else its raw value in ten-thousandths. */
function chanceOf(combo) {
  const p = Number(combo && combo.probability);
  if (p > 0 && p < 1) return p;
  const raw = Number(combo && combo.probabilityRaw);
  return raw > 0 && raw < 10000 ? raw / 10000 : null;
}

module.exports = { Crafting, GAP_MS, SHOW_MS, FAIL_MS };
