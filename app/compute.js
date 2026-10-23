'use strict';
/* Data loading (a2-tracker public JSON, cached on disk) and the full price state for the app. */
const fs = require('fs'), path = require('path');
const { createEngine } = require('./engine');
const FX = require('./fx');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const HIST = path.join(DATA, 'history');
const ICONS = path.join(DATA, 'icons');
const SETTINGS = path.join(ROOT, 'settings.json');
const SITE = 'https://a2-tracker.com';
const CHESTS = { '516130001': 10000000, '516140001': 2000000, '516150001': 400000 };
for (const d of [DATA, HIST, ICONS]) fs.mkdirSync(d, { recursive: true });

const LABELS = {
  Torso: 'Top', Pants: 'Legs', Boots: 'Shoes', Helmet: 'Helm', Shoulder: 'Pauldrons', Cape: 'Cloak', Gloves: 'Gloves',
  Necklace: 'Necklace', Earring: 'Earring', Ring: 'Ring',
  Greatsword: 'Greatsword', Sword: 'Longsword', Guarder: 'Guard', Dagger: 'Dagger', Mace: 'Mace', Bow: 'Bow', Staff: 'Staff', Magicbook: 'Spellbook', Orb: 'Orb',
};
const PROFESSIONS = ['Armorsmithing', 'Blacksmithing', 'Handicrafting', 'Alchemy'];

const DEFAULT_SETTINGS = {
  server: 1304, server_name: 'Kaisinel (EU, Elyos)', faction: 'elyos',
  quna_pack: { quna: 4000, eur: 44.49 }, // the Quna pack's fixed euro price; other currencies use live exchange rates
  currency: 'USD',   // USD, EUR or SAR
  my_kina_rate_quna_per_10m: null,
  class: null,
  class_mode: 'auto',  // 'auto': the class the game says you play (Flav-Toolkit, /api/me); 'manual': one you picked
  plan: {},          // slotId (MainHand, SubHand, Torso, Ring1…) -> { have: 0..6, goal: 1..6, skip: bool }
  character: { name: '', serverId: null }, // whose gear to read from the official site; filled in by the game through Flav-Toolkit, or typed
  auto_sync: true,
  shop: { sel: [], ticks: {}, kina_have: 0, quna_have: 0, use_inventory: true }, // shopping list: chosen pieces, ticked lines, what you already have; use_inventory: subtract what the game says you own   // read the worn gear on every refresh
  sync: null,        // last read: { at, profile, items, detected: { slotId: { tier, name, enchant, icon } } }
  proficiency: { Armorsmithing: null, Blacksmithing: null, Handicrafting: null, Alchemy: null },
  xp_per_craft: {},  // recipeId -> XP you saw in game for one craft
  history_days: 7,
  cheap_when_below_usual_percent: 5,
  expensive_when_above_usual_percent: 5,
  alerts: false,
};

function loadSettings() {
  let s = {};
  if (fs.existsSync(SETTINGS)) { try { s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { s = {}; } }
  const out = { ...DEFAULT_SETTINGS, ...s };
  out.quna_pack = { ...DEFAULT_SETTINGS.quna_pack, ...(s.quna_pack || {}) };
  delete out.quna_pack.sar; // v5 kept a typed SAR price; now SAR comes from the exchange rate
  if (!FX.CURRENCIES[out.currency]) out.currency = 'USD';
  out.proficiency = { ...DEFAULT_SETTINGS.proficiency, ...(s.proficiency || {}) };
  out.plan = s.plan && typeof s.plan === 'object' ? s.plan : {};
  out.xp_per_craft = s.xp_per_craft && typeof s.xp_per_craft === 'object' ? s.xp_per_craft : {};
  out.character = { ...DEFAULT_SETTINGS.character, ...(s.character || {}) };
  out.shop = { ...DEFAULT_SETTINGS.shop, ...(s.shop || {}) };
  delete out.extra_slots;
  // v2 slot ids (Torso#1, Ring#2, Dagger#1…) -> the official site's slot names
  const MAP = { 'Helmet#1': 'Helmet', 'Shoulder#1': 'Shoulder', 'Torso#1': 'Torso', 'Gloves#1': 'Gloves', 'Pants#1': 'Pants', 'Boots#1': 'Boots', 'Cape#1': 'Cape', 'Necklace#1': 'Necklace', 'Earring#1': 'Earring1', 'Earring#2': 'Earring2', 'Ring#1': 'Ring1', 'Ring#2': 'Ring2', 'Guarder#1': 'SubHand' };
  for (const k of Object.keys(out.plan)) {
    if (!k.includes('#')) continue;
    const to = MAP[k] || (k.endsWith('#1') ? 'MainHand' : null);
    if (to && !out.plan[to]) out.plan[to] = out.plan[k];
    delete out.plan[k];
  }
  if (![1, 7, 30].includes(Number(out.history_days))) out.history_days = 7;
  // v1 settings had one global range: carry it over to every slot that has no own setting
  if (s.goal_tier != null && !s.plan) out.plan = { _default: { have: Number(s.i_already_have_tier) || 0, goal: Number(s.goal_tier) || 6 } };
  for (const k of ['goal_tier', 'i_already_have_tier', '_help', '_quna_pack_help', '_my_kina_rate_help', '_tier_help', '_proficiency_help']) delete out[k];
  return out;
}
function saveSettings(s) { fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2)); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJSON(url, tries = 4) {
  let wait = 1500;
  for (let i = 1; ; i++) {
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 60000);
      const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'FlavGearPrices/2.0 (personal price checker)', Accept: 'application/json' } });
      clearTimeout(t);
      if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.json();
      if (!body || body.ok !== true) throw new Error('unexpected answer');
      return body;
    } catch (e) {
      if (i >= tries) throw new Error('Could not load ' + url.replace(SITE, '') + ': ' + e.message);
      await sleep(wait); wait *= 2;
    }
  }
}
const ageMin = f => (fs.existsSync(f) ? (Date.now() - fs.statSync(f).mtimeMs) / 60000 : Infinity);

function isCurrent(q, now) {
  if (!q || q.status !== 'current' || q.price == null) return false;
  if (q.listings != null && Number(q.listings) <= 0) return false;
  const at = Date.parse(q.observedAt);
  return Number.isFinite(at) && now - at - (q.delaySeconds || 300) * 1000 <= 900000;
}

function hourlySeries(h) {
  const byHour = new Map();
  for (const x of (h.hourly && h.hourly.hours) || []) {
    const t = Math.floor(Date.parse(x.hourStart) / 3600000) * 3600000, v = Number(x.average);
    if (Number.isFinite(t) && v > 0) byHour.set(t, { sum: v, n: 1, fixed: true });
  }
  for (const o of h.observations || []) {
    const t = Math.floor(Date.parse(o.observedAt) / 3600000) * 3600000, v = Number(o.price);
    if (!Number.isFinite(t) || !(v > 0) || (o.listings != null && Number(o.listings) <= 0)) continue;
    const b = byHour.get(t);
    if (b && b.fixed) continue;
    if (b) { b.sum += v; b.n++; } else byHour.set(t, { sum: v, n: 1 });
  }
  const m = new Map(); for (const [t, b] of byHour) m.set(t, b.sum / b.n);
  return m;
}
function priceAt(series, t) { for (let k = 0; k <= 6; k++) { const v = series.get(t - k * 3600000); if (v != null) return v; } return null; }

/* Downloads everything that is due. progress(step, done, total) reports to the page. */
async function fetchAll(settings, progress, { force = false } = {}) {
  const now = Date.now();
  const catFile = path.join(DATA, 'catalogue.json');
  let catalogue;
  if (!force && ageMin(catFile) < 24 * 60) catalogue = JSON.parse(fs.readFileSync(catFile, 'utf8'));
  else {
    progress('Recipe list', 0, 1);
    try {
      catalogue = await getJSON(SITE + '/api.crafting.ashx?locale=en-US');
      if (!Array.isArray(catalogue.recipes) || !catalogue.items) throw new Error('recipe list looks wrong');
      fs.writeFileSync(catFile, JSON.stringify(catalogue));
    } catch (e) {
      if (!fs.existsSync(catFile)) throw e;
      catalogue = JSON.parse(fs.readFileSync(catFile, 'utf8'));
    }
  }
  progress('Market prices', 0, 1);
  await FX.update(DATA);
  const quotesBody = await getJSON(SITE + '/api.crafting.ashx?quotes=1&server=' + settings.server);
  const chests = {};
  for (const id of Object.keys(CHESTS)) {
    try {
      const b = await getJSON(SITE + '/api.serverprices.ashx?item=' + id + '&server=' + settings.server + '&compare=');
      const p = (b.prices || []).find(x => String(x.serverId) === String(settings.server));
      if (p && p.status === 'current' && Number(p.price) > 0) chests[id] = { quna: Number(p.price), listings: Number(p.listings) || null };
    } catch { /* fine */ }
  }
  // History for every priced item any Dragon chain reads, plus the Kina Chests.
  const engine = createEngine(catalogue, { faction: settings.faction });
  const quotes = new Map(quotesBody.quotes.map(q => [String(q.itemId), q]));
  const read = new Set();
  const snap = engine.snapshot(id => { read.add(String(id)); const q = quotes.get(String(id)); return isCurrent(q, now) ? Number(q.price) : null; }, () => null);
  for (const c of engine.chains(null)) engine.climb(c, snap);
  const ids = [...[...read].filter(id => quotes.has(id)), ...Object.keys(CHESTS)];
  const todo = ids.filter(id => force || ageMin(path.join(HIST, id + '.json')) >= 55);
  let done = 0;
  const worker = async () => {
    while (todo.length) {
      const id = todo.shift();
      try { fs.writeFileSync(path.join(HIST, id + '.json'), JSON.stringify(await getJSON(SITE + '/api.history.ashx?item=' + id + '&server=' + settings.server + '&days=' + settings.history_days))); } catch { /* keep old copy */ }
      done++; progress('Price history', done, done + todo.length);
      await sleep(250);
    }
  };
  if (todo.length) { progress('Price history', 0, todo.length); await Promise.all([worker(), worker(), worker()]); }
  const hist = new Map();
  for (const id of ids) { const f = path.join(HIST, id + '.json'); if (fs.existsSync(f)) { try { hist.set(id, hourlySeries(JSON.parse(fs.readFileSync(f, 'utf8')))); } catch { /* skip */ } } }
  return { fetchedAt: now, catalogue, quotesBody, quotes, chests, hist };
}

/* Where a price comes from: the Exchange as the game saw it (`market`, while fresh), else a2-tracker's hourly quotes. */
function priceSources(data, market) {
  const now = data.fetchedAt;
  const quote = id => { const q = data.quotes.get(String(id)); return isCurrent(q, now) ? q : null; };
  const tracker = id => { const q = quote(id); return q && q.currency === 'Kinah' && q.marketKind === 'items' ? Number(q.price) : null; };
  const live = id => (market ? market.min(id) : null);
  return {
    now: id => { const l = live(id); return l ? l.price : tracker(id); },
    listings: id => { const l = live(id); if (l && l.count != null) return l.count; const q = quote(id); return q && q.listings != null ? Number(q.listings) : null; },
    source: id => { const l = live(id); return l ? l.source : tracker(id) != null ? 'tracker' : null; },
  };
}

/* The Kina Chests' Quna prices: the cheapest listing of each, from the Exchange's own ladder when it was seen, else a2-tracker. */
function chestRatesOf(data, market) {
  const rates = [];
  for (const [id, kina] of Object.entries(CHESTS)) {
    const live = market && market.min(id, 'quna');
    const c = data.chests[id];
    if (live) rates.push({ id, kina, quna: live.price, listings: live.count, source: 'exchange' });
    else if (c) rates.push({ id, kina, quna: c.quna, listings: c.listings, source: 'tracker' });
  }
  return rates.map(r => ({ ...r, qunaPer10m: r.quna / r.kina * 1e7 })).sort((a, b) => a.qunaPer10m - b.qunaPer10m);
}

/* Everything the page needs, for the current settings (proficiency levels change costs). */
function computeState(data, settings, market = null) {
  const now = data.fetchedAt;
  const { catalogue, quotes, hist } = data;
  const engine = createEngine(catalogue, { faction: settings.faction });
  const level = prof => { const v = Number(settings.proficiency[prof]); return Number.isInteger(v) && v >= 1 ? v : null; };
  const prices = priceSources(data, market), marketNow = prices.now;

  const chestRates = chestRatesOf(data, market);
  const manualRate = Number(settings.my_kina_rate_quna_per_10m) > 0 ? Number(settings.my_kina_rate_quna_per_10m) : null;
  const big = chestRates.find(c => c.id === '516130001');
  const qunaPer10m = manualRate || (big && big.qunaPer10m) || (chestRates[0] && chestRates[0].qunaPer10m) || null;

  const chains = engine.chains(null);
  const snapNow = engine.snapshot(marketNow, level);
  const hours = [], endHour = Math.floor((now - 3600000) / 3600000) * 3600000;
  for (let t = endHour - (settings.history_days * 24 - 1) * 3600000; t <= endHour; t += 3600000) hours.push(t);
  const series = new Map(chains.map(c => [c.gear, []])), qunaSeries = [];
  for (const t of hours) {
    const mk = id => { const s = hist.get(String(id)); return s ? priceAt(s, t) : null; };
    const snap = engine.snapshot(mk, level);
    for (const c of chains) series.get(c.gear).push(engine.climb(c, snap).stages.map(s => (s.cost == null ? null : Math.round(s.cost))));
    const q10 = mk('516130001');
    qunaSeries.push(manualRate || (q10 == null ? null : Math.round(q10)));
  }
  const item = id => catalogue.items[String(id)] || {};
  const icon = id => (item(id).icon ? '/icon/' + id : null);
  const pieces = {};
  for (const ch of chains) {
    const climb = engine.climb(ch, snapNow), t1 = climb.stages[0], q1 = quotes.get(String(t1.itemId));
    pieces[ch.gear] = {
      gear: ch.gear, label: LABELS[ch.gear] || ch.gear, group: ch.group, profession: ch.profession,
      icon: icon(climb.stages[5].itemId),
      stages: climb.stages.map((s, i) => ({
        tier: s.tier, name: engine.name(s.itemId), icon: icon(s.itemId), cost: s.cost == null ? null : Math.round(s.cost), reason: s.reason, chance: s.chance,
        mastery: ch.tiers[i].recipe.requiredMastery,
        artisan: s.artisan ? { name: engine.name(s.artisan.itemId), icon: icon(s.artisan.itemId), source: s.artisan.source, unit: s.artisan.unit && Math.round(s.artisan.unit), count: s.artisan.count } : null,
        materials: [...s.materials,
          ...(s.artisan && s.artisan.source === 'craft' ? s.artisan.ladderMaterials.map(m => ({ ...m, count: m.count * s.artisan.count, cost: m.cost * s.artisan.count })) : []),
          ...(s.artisan && s.artisan.source === 'buy' && s.artisan.line != null ? [{ itemId: s.artisan.itemId, count: s.artisan.count, unit: s.artisan.unit, cost: s.artisan.line }] : [])]
          .map(m => ({ id: m.itemId, name: engine.name(m.itemId), icon: icon(m.itemId), count: m.count, unit: Math.round(m.unit), cost: Math.round(m.cost), npc: !!m.npc, listings: prices.listings(m.itemId), source: m.npc ? 'npc' : prices.source(m.itemId) })),
      })),
      t1Ask: isCurrent(q1, now) ? Number(q1.price) : null,
      series: series.get(ch.gear),
    };
  }
  return {
    generatedAt: new Date(now).toISOString(), asOf: data.quotesBody.asOf, delaySeconds: data.quotesBody.delaySeconds || 300,
    settings: { serverName: settings.server_name, money: FX.money(settings, DATA), manualRate, cheapPct: settings.cheap_when_below_usual_percent, expensivePct: settings.expensive_when_above_usual_percent, historyDays: settings.history_days },
    rate: { qunaPer10m, chests: chestRates, source: manualRate ? 'manual' : chestRates[0] && chestRates[0].source === 'exchange' ? 'exchange' : 'market' },
    market: market ? market.status() : null,
    hours, qunaSeries, pieces, professions: PROFESSIONS,
  };
}

/* Profession side panel: what a higher level saves on your plan, and what leveling might cost. */
const XP_TOTAL = [0, 0, 26, 54, 86, 120, 152, 185, 220, 256, 294, 334, 376, 420, 466, 514, 568, 627, 689, 755, 824, 896, 1009, 1128, 1253, 1384, 1522, 1667, 1818, 1977, 2144, 2319, 2505, 2703, 2913, 3137, 3375, 3628, 3897, 4183, 4487, 4810, 5154, 5519, 5907, 6320, 6759, 7226, 7722, 8249, 8809, 8809, 9411, 10032, 10671, 11331, 12011, 12712, 13434, 14179, 14947, 15739, 16559, 17409, 18290, 19203, 20148, 21128, 22143, 23195, 24284, 25421, 26607, 27843, 29134, 30480, 31884, 33349, 34877, 36470, 38133, 39868, 41677, 43565, 45535, 47588, 49731, 51966, 54296, 56728, 59265, 61910, 64671, 67550, 70552, 73685, 76953, 80359, 83915, 87624, 91489];
// XP_TOTAL[L] = total proficiency XP to reach level L (levels 1..100). Source: aion2data.com table; totals match metabot.gg (8,809 to 50, 91,489 to 100).

function leveling(data, settings, profession, ranges) {
  const engine = createEngine(data.catalogue, { faction: settings.faction });
  const now = data.fetchedAt;
  const marketNow = id => { const q = data.quotes.get(String(id)); return isCurrent(q, now) && q.currency === 'Kinah' && q.marketKind === 'items' ? Number(q.price) : null; };
  const cur = Number(settings.proficiency[profession]);
  const L = Number.isInteger(cur) && cur >= 1 ? cur : null;
  const chains = engine.chains(null).filter(c => c.profession === profession && ranges[c.gear]);
  const planCost = lvl => {
    const snap = engine.snapshot(marketNow, p => (p === profession ? lvl : (Number.isInteger(Number(settings.proficiency[p])) && Number(settings.proficiency[p]) >= 1 ? Number(settings.proficiency[p]) : null)));
    let total = 0, rate = null;
    for (const c of chains) {
      const cl = engine.climb(c, snap);
      for (const r of ranges[c.gear]) for (let t = r.have; t < r.goal; t++) { const v = cl.stages[t].cost; if (v == null) return { total: null, rate: cl.stages[0].chance }; total += v; }
      if (rate == null) rate = cl.stages[0].chance;
    }
    return { total, rate };
  };
  const out = { profession, level: L, gears: chains.map(c => c.gear), rows: [], best: null, recipes: [] };
  if (!chains.length) return out;
  const t1 = chains[0].tiers[0].recipe;
  out.t1Mastery = t1.requiredMastery;
  const best = planCost(null); // the table's best row
  out.best = { total: best.total, rate: best.rate };
  const levels = new Set();
  if (L) levels.add(L);
  for (let x = Math.max(t1.requiredMastery || 1, L || 1); x <= 100; x += 5) levels.add(x);
  levels.add(100);
  for (const x of [...levels].sort((a, b) => a - b)) {
    if (L && x < L) continue;
    const c = planCost(x);
    out.rows.push({ level: x, total: c.total == null ? null : Math.round(c.total), rate: c.rate, xpNeeded: L ? Math.max(0, XP_TOTAL[x] - XP_TOTAL[L]) : null });
  }
  if (L) {
    const snap = engine.snapshot(marketNow, p => (p === profession ? L : null));
    for (const r of engine.professionRecipes(profession)) {
      if ((r.requiredMastery || 0) > L) continue;
      const a = snap.analyze(r);
      if (a.cost == null || !a.perAttempt) continue;
      const perAttempt = a.cost * a.perAttempt, ask = marketNow(r.itemId);
      const resale = ask ? ask * 0.9 * a.perAttempt : 0;
      const q = data.quotes.get(String(r.itemId));
      out.recipes.push({ listings: q && q.listings != null && isCurrent(q, now) ? Number(q.listings) : 0, id: r.id, name: engine.name(r.itemId), icon: engine.items[String(r.itemId)] && engine.items[String(r.itemId)].icon ? '/icon/' + r.itemId : null, mastery: r.requiredMastery, chance: a.chance, costPerTry: Math.round(perAttempt), resalePerTry: Math.round(resale), netPerTry: Math.round(perAttempt - resale), xp: settings.xp_per_craft[r.id] ?? null });
    }
    out.recipes.sort((a, b) => (b.mastery - a.mastery) || (a.costPerTry - b.costPerTry));
    out.recipes = out.recipes.slice(0, 60);
  }
  return out;
}

/* Item icons: the game's own, kept on this PC. First from the official AION 2 CDN (the one the official site uses for
   worn gear); it lacks some (the Dragon armor, Wrathful materials, the Kina Chests), so those come from a2-tracker's copy
   of the same game icon. Quna isn't an item: its icon is a2-tracker's copy of the game's Quna crystal. A drawn mark only
   if neither has it. */
const CDN = 'https://assets.playnccdn.com/static-aion2-gamedata/resources/';
const ICONS_OFFICIAL = path.join(DATA, 'icons-official');
fs.mkdirSync(ICONS_OFFICIAL, { recursive: true });
const ALIAS = { Icon_goldnonbinding: 'Icon_gold' }; // Kina: the CDN keeps it under the plain coin's name
const QUNA_ICON = '/assets/img/quna.webp';
const GRADE = { Common: '#b9b3a4', Rare: '#6fe38a', Legend: '#6fb3ff', Unique: '#f2c35b', Epic: '#c58cff', Mythic: '#ff8a5c' };
const UA = { 'User-Agent': 'FlavGearPrices/2.0 (personal price checker)' };
async function iconFile(data, id) {
  if (id === 'quna') return (await trackerCopy(QUNA_ICON)) || { svg: markSvg('#e9a6e6') };
  const it = data && data.catalogue.items[String(id)];
  if (!it || !it.icon) return null;
  const m = /\/(Icon_[\w-]+)\.(\w+)\.png\.webp$/.exec(it.icon) || /\/(Icon_[\w-]+)\.png/.exec(it.icon);
  const grade = (m && GRADE[m[2]]) || GRADE.Common;
  if (m) {
    const name = ALIAS[m[1]] || m[1];
    const file = path.join(ICONS_OFFICIAL, name + '.png'), miss = path.join(ICONS_OFFICIAL, name + '.miss');
    if (fs.existsSync(file)) return { file, type: 'image/png' };
    if (!(fs.existsSync(miss) && ageMin(miss) < 7 * 24 * 60)) {
      try {
        const res = await fetch(CDN + name + '.png', { headers: UA });
        if (res.status === 404 || res.status === 403) fs.writeFileSync(miss, '');
        else if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length < 2e6 && buf.slice(1, 4).toString() === 'PNG') { fs.writeFileSync(file, buf); return { file, type: 'image/png' }; }
        }
      } catch { /* try the copy */ }
    }
  }
  return (await trackerCopy(it.icon)) || { svg: markSvg(grade) };
}
// a2-tracker's copy of a game icon (webp), kept in data\icons.
async function trackerCopy(icon) {
  if (!/^\/assets\/[\w\-./]+\.webp$/.test(icon)) return null;
  const file = path.join(ICONS, path.basename(icon));
  if (fs.existsSync(file)) return { file, type: 'image/webp' };
  try {
    const res = await fetch(SITE + icon, { headers: UA });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 2e6 || buf.slice(0, 4).toString() !== 'RIFF') return null;
    fs.writeFileSync(file, buf);
    return { file, type: 'image/webp' };
  } catch { return null; }
}
// A drawn mark for an item with no picture: a faceted gem in the item's grade colour.
function markSvg(c) {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="b" cx=".5" cy=".38" r=".7"><stop offset="0" stop-color="#2e3442"/><stop offset="1" stop-color="#0c0f16"/></radialGradient></defs>' +
    '<rect width="64" height="64" fill="url(#b)"/><path d="M32 12 48 28 32 52 16 28z" fill="' + c + '" opacity=".22"/><path d="M32 12 48 28 32 52 16 28z" fill="none" stroke="' + c + '" stroke-width="2.5" stroke-linejoin="round"/>' +
    '<path d="M16 28h32M32 12l-6 16 6 24 6-24z" fill="none" stroke="' + c + '" stroke-width="1.4" stroke-linejoin="round" opacity=".75"/></svg>';
}

/* Gear sync: what the character wears -> the tier owned in every Dragon slot. Only a slot whose worn item changed
   since the last read is updated, so a tier set by hand stays until the game shows something new. */
function applySync(data, settings, result) {
  const Slots = require('./slots');
  const engine = createEngine(data.catalogue, { faction: (result.profile.faction || 'Elyos').toLowerCase() });
  const byId = new Map();
  for (const c of engine.chains(null)) c.tiers.forEach((t, i) => byId.set(String(t.itemId), { gear: c.gear, tier: i + 1 }));
  const cls = Slots.CLASSES.find(c => c.id === result.profile.className);
  if (cls && settings.class_mode !== 'manual') settings.class = cls.id; // a class picked by hand stays
  const detected = {}, prev = (settings.sync && settings.sync.detected) || {};
  let changed = 0;
  for (const s of Slots.slotsFor(settings.class)) {
    const it = result.items.find(x => x.slot === s.id);
    const m = it && byId.get(it.id);
    const tier = m && m.gear === s.gear ? m.tier : 0;
    detected[s.id] = { tier, name: it ? it.name : null, enchant: it ? it.enchant : 0, exceed: it ? it.exceed : 0, icon: it ? it.icon : null, dragon: !!m };
    const before = prev[s.id];
    if (!before || before.tier !== tier || before.name !== detected[s.id].name) {
      const p = settings.plan[s.id] || settings.plan._default || { goal: 6 };
      settings.plan[s.id] = { have: tier, goal: Math.max(1, Number(p.goal) || 6), skip: false };
      changed++;
    }
  }
  delete settings.plan._default;
  settings.sync = { at: result.at, profile: result.profile, detected };
  return changed;
}

/* Shopping list for the plan: what to buy (rounded up) and the crafting steps in order, per piece. */
function shopping(data, settings, market = null, inventory = null) {
  const Slots = require('./slots');
  const engine = createEngine(data.catalogue, { faction: settings.faction });
  const now = data.fetchedAt;
  const prices = priceSources(data, market), marketNow = prices.now;
  const level = prof => { const v = Number(settings.proficiency[prof]); return Number.isInteger(v) && v >= 1 ? v : null; };
  const snap = engine.snapshot(marketNow, level);
  const chains = new Map(engine.chains(null).map(c => [c.gear, c]));
  const item = id => data.catalogue.items[String(id)] || {};
  const icon = id => (item(id).icon ? '/icon/' + id : null);
  // What the player owns of an item (bag + storage + warehouse), when Flav-Toolkit has read the inventory recently;
  // null when it hasn't, so nothing is crossed out on stale knowledge. `useInv` (the "count what I own" setting, on by
  // default) says whether what is owned is subtracted from what to buy and craft; off, it is only shown beside the counts.
  const invFresh = !!(inventory && inventory.fresh());
  const useInv = invFresh && (settings.shop || {}).use_inventory !== false;
  const ownedOf = id => (invFresh ? inventory.owned(id) : null);
  const items = {}, pieces = [];
  let buy = null;
  const addBuy = (id, count, unit, npc) => {
    if (!items[id]) items[id] = { id, name: engine.name(id), icon: icon(id), unit, npc: !!npc, listings: prices.listings(id), source: npc ? 'npc' : prices.source(id) };
    buy.set(id, (buy.get(id) || 0) + count);
  };
  const stepOut = (st, k, label) => ({
    item: engine.name(st.itemId), icon: icon(st.itemId), lucky: st.lucky, base: st.baseItemId ? engine.name(st.baseItemId) : null, method: st.method, profession: st.profession, mastery: st.mastery,
    chance: st.chance, attempts: st.attempts * k, makes: st.makes * k,
    rows: st.rows.map(r => ({ id: r.itemId, name: engine.name(r.itemId), icon: icon(r.itemId), count: r.count * k, source: r.source, unit: r.unit, cost: r.source === 'buy' || r.source === 'npc' ? r.count * k * r.unit : 0, have: ownedOf(r.itemId) })),
  });
  const withCost = st => { st.cost = st.rows.reduce((t, r) => t + (r.cost || 0), 0); return st; };
  for (const s of Slots.slotsFor(settings.class)) {
    const r = Slots.rangeOf(settings.plan, s.id), ch = chains.get(s.gear);
    if (r.skip || !ch) continue;
    const label = (s.pair ? { Earring: 'Earring', Ring: 'Ring' }[s.gear] + ' ' + s.n : s.id === 'MainHand' ? 'Main hand' : s.id === 'SubHand' ? 'Off-hand' : LABELS[s.gear] || s.gear);
    const cl = engine.climb(ch, snap), steps = [];
    buy = new Map();
    let ok = true;
    for (const st of cl.stages) {
      if (st.tier <= r.have || st.tier > r.goal) continue;
      if (st.cost == null) { ok = false; break; }
      const a = st.artisan;
      if (a && a.source === 'craft') for (const x of a.ladderSteps) steps.push(withCost(stepOut(x, a.count, label)));
      for (const x of st.steps.slice(0, -1)) steps.push(withCost(stepOut(x, 1, label)));
      const top = st.steps[st.steps.length - 1];
      const out = stepOut(top, 1, label);
      out.item = engine.name(st.itemId); out.icon = icon(st.itemId); out.tier = st.tier;
      if (a) out.rows.unshift({ name: engine.name(a.itemId), icon: icon(a.itemId), count: a.count, source: a.source === 'craft' ? 'craft' : 'buy', unit: a.unit, cost: a.source === 'craft' ? 0 : a.count * a.unit });
      if (st.previous) out.rows.unshift({ name: engine.name(st.previous), icon: icon(st.previous), count: 1, source: st.tier - 1 === r.have ? 'own' : 'craft' });
      steps.push(withCost(out));
      for (const m of st.materials) addBuy(m.itemId, m.count, m.unit, m.npc);
      if (a && a.source === 'craft') for (const m of a.ladderMaterials) addBuy(m.itemId, m.count * a.count, m.unit, m.npc);
      if (a && a.source === 'buy') addBuy(a.itemId, a.count, a.unit, false);
    }
    pieces.push({ slot: s.id, label, have: r.have, goal: r.goal, icon: icon(ch.tiers[r.goal - 1].itemId), item: engine.name(ch.tiers[r.goal - 1].itemId), ok, steps, buy: [...buy].map(([id, count]) => ({ id, count })), kina: [...buy].reduce((t, [id, c]) => t + c * items[id].unit, 0) });
  }
  // What the chosen pieces need, merged: buy list (rounded up), steps with their cost, and the Kina to buy for it.
  const shop = settings.shop || {};
  const ids = pieces.map(p => p.slot);
  let sel = (Array.isArray(shop.sel) ? shop.sel : []).filter(x => ids.includes(x));
  if (!sel.length && ids.length) sel = [ids[0]];
  // Across the chosen pieces' steps, in order, what is owned is used up as the steps come: a stock of 20 covers the
  // first step that needs it, not every step. Each bought row gets `used` (from stock), `missing` (left to buy) and a
  // cost for the missing part; a step's cost follows. With the setting off, nothing is used and `missing` = `count`.
  const stock = new Map();
  for (const p of pieces) if (sel.includes(p.slot)) for (const st of p.steps) {
    for (const r of st.rows) {
      const bought = r.source === 'buy' || r.source === 'npc';
      if (!bought || !useInv || !r.have) { r.used = 0; r.missing = r.count; continue; }
      if (!stock.has(r.id)) stock.set(r.id, r.have.total);
      const use = Math.min(stock.get(r.id), r.count);
      stock.set(r.id, stock.get(r.id) - use);
      r.used = use; r.missing = r.count - use;
      r.cost = r.missing * r.unit;
    }
    st.cost = st.rows.reduce((t, r) => t + (r.cost || 0), 0);
  }
  const chosen = pieces.filter(p => sel.includes(p.slot));
  const merged = new Map();
  for (const p of chosen) for (const b of p.buy) { const x = merged.get(b.id) || { ...items[b.id], count: 0, for: [] }; x.count += b.count; x.for.push(p.label); merged.set(b.id, x); }
  // Where the Exchange's ladder was seen, the cost of N is the cheapest whole listings that cover N (a stack is bought
  // whole, so `bought` can exceed `qty`), and the plan says up to what unit price and how the stacks split; elsewhere the
  // cheapest price × N. The verdict compares the plan's dearest unit with the item's usual price (a2-tracker history).
  const usualOf = id => { const s = data.hist.get(String(id)); if (!s) return null; const v = [...s.values()].sort((x, y) => x - y); return v.length >= 24 ? v[v.length >> 1] : null; };
  const verdictOf = pct => (pct == null ? null : pct >= settings.expensive_when_above_usual_percent ? 'pricey' : pct <= -settings.cheap_when_below_usual_percent ? 'cheap' : 'fair');
  // `qty` is what the plan needs; `have` what the player owns (null when the inventory isn't known); `missing` what is
  // left to buy, and the cost and the ladder plan are for that. A line whose need is covered is `owned`.
  const buyList = [...merged.values()].map(b => {
    const qty = Math.ceil(b.count - 1e-9);
    const have = ownedOf(b.id);
    const missing = useInv && have ? Math.max(0, qty - have.total) : qty;
    const owned = useInv && !!have && missing === 0;
    const usual = b.npc ? null : usualOf(b.id);
    if (owned) return { ...b, qty, have, missing, owned, cost: 0, exact: true, plan: usual ? { usual, pct: null, verdict: null, floor: true } : null };
    const ladder = !b.npc && market ? market.costOf(b.id, missing, 'kina') : null;
    if (ladder) {
      const pct = usual && ladder.maxUnit ? (ladder.maxUnit - usual) / usual * 100 : null;
      return { ...b, qty, have, missing, owned, cost: ladder.cost, exact: ladder.exact, source: 'ladder', unit: ladder.listings.length ? ladder.listings[0].unit : b.unit,
        plan: { bought: ladder.bought, maxUnit: ladder.maxUnit, stacks: ladder.listings, usual, pct, verdict: verdictOf(pct), floor: false } };
    }
    // Only the cheapest listing is known. "pricey" still holds (even the floor is dear); "cheap" only says the floor is
    // cheap, so the UI shows it softer; `floor: true` tells it so.
    const pct = usual && b.unit ? (b.unit - usual) / usual * 100 : null;
    return { ...b, qty, have, missing, owned, cost: missing * b.unit, exact: false, plan: usual ? { usual, pct, verdict: verdictOf(pct), floor: true } : null };
  }).sort((a, b) => b.cost - a.cost);
  const totalKina = buyList.reduce((t, b) => t + b.cost, 0);
  return {
    at: new Date(now).toISOString(), sel, ticks: shop.ticks || {},
    market: market ? market.status() : null,
    inventory: inventory ? { ...inventory.status(), used: useInv, use_inventory: shop.use_inventory !== false } : null,
    pieces: pieces.map(p => ({ slot: p.slot, label: p.label, icon: p.icon, item: p.item, have: p.have, goal: p.goal, ok: p.ok, kina: p.kina })),
    chosen: chosen.map(p => ({ slot: p.slot, label: p.label, icon: p.icon, item: p.item, have: p.have, goal: p.goal, ok: p.ok, kina: p.kina, steps: p.steps })),
    buy: buyList, totalKina,
    kina: kinaPlan(data, settings, totalKina, market, invFresh ? inventory.kina() : null),
  };
}

/* "Quna shop": turn real money into Kina for `kina`.
   Kina comes in three fixed Kina Chests (400k, 2M, 10M) that players sell on the Exchange for Quna; Quna comes in packs
   with a fixed price (4,000 Quna = 44.49 EUR). Each chest has a ladder of listings (790, 798, 799, 810…), but the
   public data has only the cheapest listing and how many are listed, so the plan sets a price cap instead of exact counts:
   one Quna-per-Kina line (a little above today's best chest) turned into a cap per chest. Buy the cheapest listings at
   or under the caps, best value first; the packs are counted at the cap, so they cover the Kina even after the cheapest
   listings are gone. When Flav-Toolkit has read the chests' ladders in game (`market`), the plan is exact instead:
   the cheapest Kina per Quna across every listing of every chest, taken in order until the Kina is covered. */
const CAP_MARGIN = 0.03; // the cap sits 3% above the best chest's Quna per Kina, and never below the second best's
function kinaPlan(data, settings, kina, market = null, kinaOnHand = null) {
  const shop = settings.shop || {}, m = FX.money(settings, DATA);
  const have = kinaOnHand != null ? Math.max(0, Number(kinaOnHand) || 0) : Math.max(0, Number(shop.kina_have) || 0), qunaHave = Math.max(0, Number(shop.quna_have) || 0);
  const need = Math.max(0, Math.ceil(kina - have));
  const offers = market ? market.chestOffers(CHESTS) : [];
  if (offers.length) return exactKinaPlan(offers, need, have, qunaHave, m, chestRatesOf(data, market));
  const types = Object.entries(CHESTS).map(([id, size]) => {
    const c = data.chests[id];
    return { id, kina: size, quna: c ? c.quna : null, listings: c ? (c.listings || 0) : 0 };
  }).sort((a, b) => b.kina - a.kina);
  const per1m = t => (t.quna && t.listings > 0 ? t.quna / t.kina * 1e6 : null);
  const ranked = types.map(per1m).filter(x => x != null).sort((a, b) => a - b);
  const out = { need, have, qunaHave, packs: 0, qunaToBuy: 0, money: 0, eur: 0, cap1m: null, packages: [], start: null, pack: { quna: m.quna, eur: m.eur, price: m.pack }, cur: { code: m.code, sym: m.sym, before: m.before } };
  if (!ranked.length) return out;
  // Only the first listings sit near the cheapest price, so when the cheap chests can't hold the Kina needed (counting
  // a third of each listing), the cap rises to the next chest's price.
  let deep = ranked[0];
  if (need) {
    let held = 0;
    for (const t of types.filter(x => per1m(x) != null).sort((x, y) => per1m(x) - per1m(y))) { deep = per1m(t); held += t.kina * t.listings / 3; if (held >= need) break; }
  }
  const cap1m = Math.max(ranked[0] * (1 + CAP_MARGIN), ranked[1] || 0, deep * (1 + CAP_MARGIN / 3));
  out.cap1m = cap1m;
  out.packages = types.map(t => {
    const p = per1m(t), cap = Math.floor(cap1m * t.kina / 1e6);
    return { id: t.id, kina: t.kina, quna: t.quna, listings: t.listings, qunaPer1m: p, moneyPer1m: p == null ? null : p * m.pack / m.quna, cap, under: p != null && t.quna <= cap, best: p != null && p === ranked[0] };
  });
  out.start = (out.packages.find(x => x.best) || {}).id || null;
  // What a pack buys at the caps, for a quick feel of the rate.
  out.onePackKina = m.quna / cap1m * 1e6;
  if (need) {
    const quna = need / 1e6 * cap1m; // the most you should pay for that Kina, staying under the caps
    out.packs = Math.ceil(Math.max(0, quna - qunaHave) / m.quna);
    out.qunaToBuy = out.packs * m.quna;
    out.estQuna = Math.ceil(quna);
    out.kinaAtCap = (out.qunaToBuy + qunaHave) / cap1m * 1e6; // Kina those Quna buy even at the caps
    out.spare = Math.max(0, out.kinaAtCap - need);
    out.listedKina = types.reduce((s, t) => s + t.kina * t.listings, 0);
    out.short = out.listedKina < need;
    out.money = out.packs * m.pack; out.eur = out.packs * m.eur;
  }
  return out;
}

/* The exact plan from the Exchange's own ladders: `offers` are every chest listing, cheapest Quna per Kina first.
   Listings are bought whole (a listing of 2 chests is 2 or nothing), in 100k-Kina units. */
const KINA_UNIT = 100_000;
function exactKinaPlan(offers, need, have, qunaHave, m, rates) {
  const { coverCheapest } = require('./market');
  const out = { need, have, qunaHave, packs: 0, qunaToBuy: 0, money: 0, eur: 0, cap1m: null, packages: [], start: null, exact: true, source: 'exchange', pack: { quna: m.quna, eur: m.eur, price: m.pack }, cur: { code: m.code, sym: m.sym, before: m.before } };
  const per = new Map(); // chest id -> what to buy of it
  for (const o of offers) if (!per.has(o.id)) per.set(o.id, { id: o.id, kina: o.kina, quna: o.quna, listings: 0, listed: 0, buy: 0, spend: 0, cap: null });
  for (const o of offers) { const p = per.get(o.id); p.listings += 1; p.listed += o.quantity; }
  const pick = need ? coverCheapest(offers.map(o => ({ units: Math.round(o.kina * o.quantity / KINA_UNIT), cost: o.quna * o.quantity, o })), Math.ceil(need / KINA_UNIT)) : { picked: [], units: 0, cost: 0 };
  let quna = 0, bought = 0, dearest = null;
  for (const x of pick.picked) {
    const o = x.o, p = per.get(o.id);
    p.buy += o.quantity; p.spend += o.quantity * o.quna; p.cap = Math.max(p.cap || 0, o.quna);
    quna += o.quantity * o.quna; bought += o.quantity * o.kina; dearest = Math.max(dearest || 0, o.per1m);
  }
  const left = need - bought;
  const best = offers[0];
  out.cap1m = dearest != null ? dearest : best.per1m;
  out.packages = [...per.values()].sort((a, b) => b.kina - a.kina).map(p => ({
    id: p.id, kina: p.kina, quna: p.quna, listings: p.listings, listed: p.listed, qunaPer1m: p.quna / p.kina * 1e6, moneyPer1m: p.quna / p.kina * 1e6 * m.pack / m.quna,
    cap: p.cap != null ? p.cap : p.quna, under: p.buy > 0, best: p.id === best.id, buy: p.buy, spend: p.spend, seen: true,
  }));
  // chests whose list wasn't opened in game: shown with their cheapest known price, not planned (open the list to include them)
  for (const r of rates) if (!per.has(r.id)) out.packages.push({ id: r.id, kina: r.kina, quna: r.quna, listings: r.listings, qunaPer1m: r.qunaPer10m / 10, moneyPer1m: r.qunaPer10m / 10 * m.pack / m.quna, cap: null, under: false, best: false, buy: 0, spend: 0, seen: false });
  out.packages.sort((a, b) => b.kina - a.kina);
  out.start = best.id;
  out.onePackKina = m.quna / best.per1m * 1e6;
  if (need) {
    out.estQuna = quna;
    out.packs = Math.ceil(Math.max(0, quna - qunaHave) / m.quna);
    out.qunaToBuy = out.packs * m.quna;
    out.kinaAtCap = bought;
    out.spare = Math.max(0, bought - need);
    out.listedKina = offers.reduce((s, o) => s + o.kina * o.quantity, 0);
    out.short = left > 0;
    out.money = out.packs * m.pack; out.eur = out.packs * m.eur;
  }
  return out;
}

module.exports = { kinaPlan, loadSettings, saveSettings, fetchAll, computeState, leveling, iconFile, applySync, shopping, ROOT, DATA, PROFESSIONS, XP_TOTAL };
