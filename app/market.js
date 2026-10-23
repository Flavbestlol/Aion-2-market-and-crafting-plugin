'use strict';
/* The Exchange as the game itself saw it.

   Flav-Toolkit's market reader posts three kinds of update to /api/market while the game runs:
     market-summary   the cheapest listing and the number of listings for every item (when the Exchange opens)
     market-listings  one page of an item's listings, as the player browses it (the real price ladder)
     item-stats       the 28-day statistics shown in the purchase dialog
   This keeps the latest of each, answers price questions from them while they are fresh, and saves them so a restart
   keeps what was seen. Anything older than MAX_AGE is ignored and the app falls back to a2-tracker's hourly data.

   Two things the game does, seen 2026-10-23: it uses one "server id" per market — 11304 for the Kina Exchange (624
   items when it opens) and 1304 for the Quna Exchange (the three Kina Chests) — and it sends a summary for the whole
   Exchange when it opens, then one per category while browsing. So summaries are kept per server id and merged row by
   row, and each server id's currency is learned from the listings seen under it (a summary of 50+ rows before any
   listings is taken to be the Kina Exchange). */

const fs = require('fs');

const MAX_AGE_MS = 45 * 60 * 1000;   // the Exchange moves; after this, the public hourly data is as good
const PAGE_SIZE = 100;               // the game's page size; a complete ladder has every page up to has_next_page=false

class Market {
  constructor(file) {
    this.file = file;
    this.summaries = new Map();                    // server id -> Map(item -> { min, count, at })
    this.currencyOf = new Map();                   // server id -> 'kina' | 'quna' (learned from listings)
    this.ladders = new Map();                      // `${item}:${currency}` -> ladder
    this.stats = new Map();                        // item -> stats
    this.updates = 0;
    this.saveTimer = null;
    this.load();
  }

  /* One update from the reader. Returns what changed: 'summary' | 'listings' | 'stats' | null. */
  take(event) {
    if (!event || typeof event !== 'object') return null;
    const at = Number(event.at) > 0 ? Number(event.at) * 1000 : Date.now();
    switch (event.type) {
      case 'market-summary': {
        if (!Array.isArray(event.rows)) return null;
        const server = String(event.server ?? '');
        if (!this.summaries.has(server)) this.summaries.set(server, new Map());
        const rows = this.summaries.get(server);
        for (const r of event.rows) {
          const item = String(r.item), min = Number(r.min_unit_price), count = Number(r.sale_count);
          if (item && min > 0) rows.set(item, { min, count: Number.isFinite(count) ? count : null, at });
        }
        break;
      }
      case 'market-listings': {
        if (!Array.isArray(event.listings)) return null;
        const page = Number(event.page) || 1, next = !!event.has_next_page, sort = String(event.sort || '');
        const byKey = new Map();
        for (const l of event.listings) {
          const cur = currencyOf(l.currency);
          if (event.server != null && (cur === 'kina' || cur === 'quna')) this.currencyOf.set(String(event.server), cur);
          const key = String(l.item) + ':' + cur;
          if (!byKey.has(key)) byKey.set(key, []);
          byKey.get(key).push({ id: String(l.id || ''), quantity: Math.max(1, Number(l.quantity) || 1), unit: Number(l.unit_price), total: Number(l.sale_price) });
        }
        // the items asked for with no listings at all are known to be empty
        for (const item of event.items || []) for (const cur of ['kina', 'quna']) {
          const key = String(item) + ':' + cur;
          if (!byKey.has(key) && page === 1) this.ladders.set(key, { at, sort, pages: new Map(), complete: !next, listings: [] });
        }
        for (const [key, listings] of byKey) {
          let ladder = this.ladders.get(key);
          // page 1 starts a fresh browse; a later page joins the browse it belongs to
          if (page === 1 || !ladder || ladder.sort !== sort || at - ladder.at > MAX_AGE_MS) ladder = { at, sort, pages: new Map(), complete: false, listings: [] };
          ladder.at = at;
          ladder.pages.set(page, listings.filter(l => l.unit > 0));
          ladder.complete = !next && [...ladder.pages.keys()].sort((a, b) => a - b).every((p, i) => p === i + 1);
          ladder.listings = [...ladder.pages.keys()].sort((a, b) => a - b).flatMap(p => ladder.pages.get(p)).sort((a, b) => a.unit - b.unit);
          this.ladders.set(key, ladder);
        }
        break;
      }
      case 'item-stats': {
        const item = String(event.item);
        if (!item) return null;
        this.stats.set(item, { at, average: Number(event.average_unit_price), min: Number(event.min_unit_price), max: Number(event.max_unit_price), quantity: Number(event.quantity), from: event.from, to: event.to });
        break;
      }
      default: return null;
    }
    this.updates++;
    this.scheduleSave();
    return event.type.replace('market-', '').replace('item-', '');
  }

  /* The cheapest listing seen for an item in a currency, or null if nothing fresh: { price, count, at, source }.
     A fresh ladder beats the summary (it is newer and exact); the summary covers every item of its market. */
  min(item, currency = 'kina', now = Date.now()) {
    const l = this.ladder(item, currency, now);
    if (l && l.listings.length) return { price: l.listings[0].unit, count: l.listings.length, at: l.at, source: 'ladder' };
    if (l && l.complete && !l.listings.length) return null; // browsed and empty: no listing, no price
    let best = null;
    for (const [server, rows] of this.summaries) {
      if (this.marketOf(server) !== currency) continue;
      const r = rows.get(String(item));
      if (r && now - r.at <= MAX_AGE_MS && (!best || r.at > best.at)) best = { price: r.min, count: r.count, at: r.at, source: 'summary' };
    }
    return best;
  }

  /* Which market a server id is: learned from listings, else guessed from the size of its summary. */
  marketOf(server) {
    const known = this.currencyOf.get(String(server));
    if (known) return known;
    const rows = this.summaries.get(String(server));
    return rows && rows.size >= 50 ? 'kina' : null;
  }

  /* The ladder of an item in a currency, cheapest first, if fresh and usable: pages sorted by unit price starting
     from the first (the cheapest listings are on page 1), or every page of any order. */
  ladder(item, currency = 'kina', now = Date.now()) {
    const l = this.ladders.get(String(item) + ':' + currency);
    if (!l || now - l.at > MAX_AGE_MS) return null;
    if (!l.complete && !(/^UnitPrice ASC$/i.test(l.sort) && l.pages.has(1))) return null;
    return l;
  }

  /* What `units` of an item cost from the real ladder: the cheapest set of listings that covers them, each listing
     bought whole (a stack of 20 is 20 or nothing). Returns null without a usable ladder, else
       { units, bought, cost, maxUnit, exact, listings: [{ unit, quantity, count }], at }
     `bought` >= `units` when stacks force an overshoot; `maxUnit` is the dearest unit price in the set ("buy at or
     under"); `exact` is false when the ladder ran out (then the shortfall is priced at the dearest listing seen,
     a floor rather than a price, and `bought` is what the ladder could give). */
  costOf(item, units, currency = 'kina', now = Date.now()) {
    const l = this.ladder(item, currency, now);
    if (!l) return null;
    const need = Math.ceil(units);
    const pick = coverCheapest(l.listings.map(x => ({ units: x.quantity, cost: x.unit * x.quantity, unit: x.unit })), need);
    const grouped = new Map();
    for (const x of pick.picked) { const k = x.unit + ':' + x.units; const g = grouped.get(k) || { unit: x.unit, quantity: x.units, count: 0 }; g.count++; grouped.set(k, g); }
    const listings = [...grouped.values()].sort((a, b) => a.unit - b.unit || a.quantity - b.quantity);
    const exact = pick.units >= need;
    let cost = pick.cost;
    if (!exact && listings.length) cost += (need - pick.units) * listings[listings.length - 1].unit;
    return { units: need, bought: pick.units, cost, maxUnit: listings.length ? listings[listings.length - 1].unit : null, exact, listings, at: l.at };
  }

  /* The Kina Chests' Quna ladders, cheapest Quna per Kina first: [{ id, kina, quna, quantity }]. */
  chestOffers(chests, now = Date.now()) {
    const out = [];
    for (const [id, kina] of Object.entries(chests)) {
      const l = this.ladder(id, 'quna', now);
      if (!l) continue;
      for (const x of l.listings) out.push({ id, kina, quna: x.unit, quantity: x.quantity, per1m: x.unit / kina * 1e6 });
    }
    return out.sort((a, b) => a.per1m - b.per1m);
  }

  /* For the page: when the Exchange was last seen and how much of it. */
  status(now = Date.now()) {
    const fresh = [...this.ladders.values()].filter(l => now - l.at <= MAX_AGE_MS);
    let items = 0, summaryAt = 0;
    for (const rows of this.summaries.values()) for (const r of rows.values()) if (now - r.at <= MAX_AGE_MS) { items++; summaryAt = Math.max(summaryAt, r.at); }
    const last = Math.max(summaryAt, ...[...this.ladders.values()].map(l => l.at), ...[...this.stats.values()].map(s => s.at), 0);
    return {
      live: !!(items || fresh.length),
      summary: items ? { at: new Date(summaryAt).toISOString(), items } : null,
      ladders: fresh.length, updates: this.updates,
      lastAt: last ? new Date(last).toISOString() : null, ageMin: last ? Math.round((now - last) / 60000) : null,
    };
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, 2000);
  }

  save() {
    if (!this.file) return;
    const plain = {
      summaries: [...this.summaries].map(([server, rows]) => [server, [...rows]]),
      currencyOf: [...this.currencyOf],
      ladders: [...this.ladders].map(([k, l]) => [k, { at: l.at, sort: l.sort, complete: l.complete, pages: [...l.pages] }]),
      stats: [...this.stats],
    };
    try { fs.writeFileSync(this.file, JSON.stringify(plain)); } catch { /* a read-only folder: keep going in memory */ }
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const p = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.summaries = new Map((p.summaries || []).map(([server, rows]) => [server, new Map(rows)]));
      this.currencyOf = new Map(p.currencyOf || []);
      for (const [k, l] of p.ladders || []) {
        const pages = new Map(l.pages || []);
        const listings = [...pages.keys()].sort((a, b) => a - b).flatMap(x => pages.get(x)).sort((a, b) => a.unit - b.unit);
        this.ladders.set(k, { at: Number(l.at) || 0, sort: l.sort || '', complete: !!l.complete, pages, listings });
      }
      this.stats = new Map(p.stats || []);
    } catch { /* a damaged file is ignored; the next update replaces it */ }
  }
}

/* The cheapest set of whole listings whose units add up to at least `need`: { picked, units, cost }.
   A small knapsack over units (need plus the biggest stack, so an overshoot can be chosen when it is cheaper). */
function coverCheapest(listings, need) {
  if (need <= 0 || !listings.length) return { picked: [], units: 0, cost: 0 };
  const cap = need + Math.max(...listings.map(x => x.units));
  const INF = Infinity;
  const best = new Array(cap + 1).fill(INF); best[0] = 0;        // best[u]: cheapest cost for exactly u units
  const choice = new Array(cap + 1).fill(-1);
  const from = new Array(cap + 1).fill(-1);
  listings.forEach((x, i) => {
    for (let u = cap; u >= x.units; u--) {
      const c = best[u - x.units] + x.cost;
      if (c < best[u]) { best[u] = c; choice[u] = i; from[u] = u - x.units; }
    }
  });
  let at = -1;
  for (let u = need; u <= cap; u++) if (best[u] < INF && (at < 0 || best[u] < best[at])) at = u;
  if (at < 0) {
    // the ladder can't cover it: take everything
    return { picked: listings.slice(), units: listings.reduce((s, x) => s + x.units, 0), cost: listings.reduce((s, x) => s + x.cost, 0) };
  }
  const picked = [];
  for (let u = at; u > 0 && choice[u] >= 0; u = from[u]) picked.push(listings[choice[u]]);
  return { picked, units: at, cost: best[at] };
}

function currencyOf(c) {
  if (c === 'kina' || c === 'quna') return c;
  if (c && typeof c === 'object' && c.item != null) return 'item' + c.item;
  return 'other';
}

module.exports = { Market, coverCheapest, MAX_AGE_MS, PAGE_SIZE };
