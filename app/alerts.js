'use strict';
/* The player's own price alerts: "tell me when X is under 8k", "when 50+ are listed", "when it is 20 % pricier than
   usual (time to sell)". Kept in settings.alerts_list; checked whenever the Exchange is seen (Flav-Toolkit hands the
   summary over) and on every hourly refresh. An alert fires once when its condition comes true, and arms again when
   it is false; firing shows a Windows notification, raises a note on Flav-Toolkit's feed (the dock lights the item's
   icon up) and marks the alert for the pages.

   Kinds:  below   price <= value   (a buy)        above    price >= value   (a sale)
           listed  listed >= value  (enough to buy) scarce  listed <= value  (few left)
           cheaper pct <= -value    (vs usual)      pricier  pct >= value     (vs usual)
   where pct = (price - usual) / usual * 100 and `usual` is the game's own 28-day average when the player opened the
   purchase dialog, else a2-tracker's history median. */

const KINDS = {
  below: { words: 'price at or under', unit: 'Kina', test: (n, v) => n.price != null && n.price <= v },
  above: { words: 'price at or over', unit: 'Kina', test: (n, v) => n.price != null && n.price >= v },
  listed: { words: 'at least', unit: 'listed', test: (n, v) => n.listed != null && n.listed >= v },
  scarce: { words: 'at most', unit: 'listed', test: (n, v) => n.listed != null && n.listed <= v },
  cheaper: { words: 'cheaper than usual by', unit: '%', test: (n, v) => n.pct != null && n.pct <= -v },
  pricier: { words: 'pricier than usual by', unit: '%', test: (n, v) => n.pct != null && n.pct >= v },
};
const MAX = 60;

class Alerts {
  /* settings: the app's (alerts_list lives in it); save(): write them; lookup(id) -> { price, listed, usual, source }
     or null; name(id), icon(id); fire({ alert, now, title, text, icon }): what to do when one fires. */
  constructor({ settings, save, lookup, name, icon, fire }) {
    this.settings = settings; this.save = save; this.lookup = lookup; this.nameOf = name; this.iconOf = icon; this.fire = fire;
    if (!Array.isArray(settings.alerts_list)) settings.alerts_list = [];
    this.recent = []; // the last firings, newest first, for the pages
  }

  get all() { return this.settings.alerts_list; }

  /* Adds one: { item, kind, value }. Returns the alert or an error string. */
  add({ item, kind, value }) {
    const id = String(item || '').trim(), v = Number(value);
    if (!/^\d{1,12}$/.test(id)) return 'not an item';
    if (!KINDS[kind]) return 'not a kind of alert';
    if (!Number.isFinite(v) || v < 0 || v > 1e12) return 'not a number';
    if (this.all.length >= MAX) return 'that is enough alerts (' + MAX + ')';
    const a = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), item: id, kind, value: v, on: true, created: new Date().toISOString(), firedAt: null, state: 'armed' };
    this.all.push(a); this.save();
    return a;
  }
  remove(id) { const i = this.all.findIndex(a => a.id === id); if (i < 0) return false; this.all.splice(i, 1); this.save(); return true; }
  toggle(id) { const a = this.all.find(x => x.id === id); if (!a) return false; a.on = !a.on; if (a.on) a.state = 'armed'; this.save(); return true; }

  /* The alerts with what is known now, for the pages. */
  list() {
    return this.all.map(a => {
      const now = this.lookup(a.item) || {};
      const k = KINDS[a.kind];
      return { ...a, name: this.nameOf(a.item), icon: this.iconOf(a.item), words: k.words, unit: k.unit, now: { price: now.price ?? null, listed: now.listed ?? null, usual: now.usual ?? null, pct: pct(now), source: now.source || null }, met: !!(k && k.test(withPct(now), a.value)) };
    });
  }

  /* Checks every alert that is on. `why` says what brought new prices ('exchange' | 'refresh'). Returns the ones that fired. */
  check(why = 'refresh') {
    const fired = [];
    for (const a of this.all) {
      if (!a.on) continue;
      const k = KINDS[a.kind]; if (!k) continue;
      const now = withPct(this.lookup(a.item) || {});
      const met = k.test(now, a.value);
      if (!met) { if (a.state === 'fired') { a.state = 'armed'; this.save(); } continue; }
      if (a.state === 'fired') continue; // still true: said once
      a.state = 'fired'; a.firedAt = new Date().toISOString(); this.save();
      const name = this.nameOf(a.item);
      const title = name + ': ' + k.words + ' ' + fmtVal(a) + (k.unit === '%' ? '' : ' ' + k.unit);
      const text = describe(now);
      const f = { alert: a, now, title, text, icon: this.iconOf(a.item), why };
      this.recent.unshift({ id: a.id, item: a.item, name, title, text, at: a.firedAt }); this.recent = this.recent.slice(0, 20);
      fired.push(f);
      try { this.fire(f); } catch { /* a notification that fails is not the plan's problem */ }
    }
    return fired;
  }
}

const pct = n => (n && n.price != null && n.usual > 0 ? (n.price - n.usual) / n.usual * 100 : null);
const withPct = n => ({ ...n, pct: pct(n) });
const fmtK = v => (v == null ? '—' : v >= 1e6 ? (v / 1e6).toFixed(v >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'k' : String(Math.round(v)));
const fmtVal = a => (KINDS[a.kind].unit === 'Kina' ? fmtK(a.value) : KINDS[a.kind].unit === '%' ? a.value + ' %' : String(a.value));
const describe = n => ['now ' + fmtK(n.price) + ' Kina', n.listed != null ? n.listed + ' listed' : null, n.usual ? 'usual ' + fmtK(n.usual) + (n.pct != null ? ' (' + (n.pct > 0 ? '+' : '') + n.pct.toFixed(0) + ' %)' : '') : null, n.source === 'tracker' ? 'a2-tracker' : n.source ? 'the Exchange' : null].filter(Boolean).join(' · ');

module.exports = { Alerts, KINDS, MAX };
