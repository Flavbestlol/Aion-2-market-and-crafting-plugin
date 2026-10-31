'use strict';
/* Dragon Gear Prices — local app. Serves the page on http://127.0.0.1:7317 (this PC only), refreshes prices on demand,
   and while alerts are on, checks every hour and shows a Windows notification when one of your pieces turns cheap. */
const http = require('http'), fs = require('fs'), path = require('path'), { execFile } = require('child_process');
const C = require('./compute');
const { signal } = require('./signal');
const Slots = require('./slots');
const Armory = require('./armory');
const FX = require('./fx');
const { Market } = require('./market');
const { Inventory } = require('./inventory');
const { Crafting } = require('./crafting');
const { Me } = require('./me');
const { Feed } = require('./feed');
const { Alerts } = require('./alerts');
const Hub = require('./hub');

const PORT = 7317, HOST = '127.0.0.1';
const UI = path.join(__dirname, 'ui');
const NODE = process.execPath, SERVER_JS = __filename;
const TASK = 'Flav Dragon Gear Prices (app)', OLD_TASK = 'Flav Dragon Gear Prices';
const LOG = path.join(C.DATA, 'price-log.csv'), ALERT_STATE = path.join(C.DATA, 'alert-state.json'), ERR = path.join(C.DATA, 'errors.log');

let settings = C.loadSettings();
const market = new Market(path.join(C.DATA, 'market.json')); // the Exchange as the game saw it, from Flav-Toolkit
const inventory = new Inventory(path.join(C.DATA, 'inventory.json')); // the bag, storage and warehouse, from Flav-Toolkit
const me = new Me(path.join(C.DATA, 'me.json')); // who is playing (name, server, class), from Flav-Toolkit
const VERSION = (() => { try { return String(JSON.parse(fs.readFileSync(path.join(C.ROOT, 'addon.json'), 'utf8')).version || '0'); } catch { return '0'; } })();
let gearRead = null; // the official site's gear read while it runs (its own state: it never holds or restores a refresh's)
const busyNow = () => busy || gearRead; // what the pages are told: a refresh or a gear read under way
let data = null, report = null, busy = null, lastError = null, lastRefresh = 0, syncError = null, overlaySeq = 0; // overlaySeq: bumped by "Show in overlay"

/* Money in the chosen currency: "$1,234", "€1,234", "1,234 SAR". */
const cash = (v, m, d) => { if (v == null || !isFinite(v)) return '—'; const n = Number(v).toLocaleString('en-US', { minimumFractionDigits: d ?? (Math.abs(v) < 100 ? 2 : 0), maximumFractionDigits: d ?? (Math.abs(v) < 100 ? 2 : 0) }); return m.before ? m.sym + n : n + ' ' + m.sym; };
const curOf = m => ({ code: m.code, sym: m.sym, before: m.before });

const logLine = msg => { try { if (fs.existsSync(ERR) && fs.statSync(ERR).size > 1e6) fs.renameSync(ERR, ERR + '.old'); fs.appendFileSync(ERR, new Date().toISOString() + ' ' + msg + '\n'); } catch { /* ignore */ } };
const logErr = e => { lastError = e.message || String(e); logLine(lastError); };

async function refresh({ force = false, quiet = false } = {}) {
  if (busy) return;
  // auto: the hourly check started it, not the player (the list says so, so a refresh nobody pressed isn't a mystery)
  const auto = !!quiet;
  busy = { step: 'Starting', done: 0, total: 1, auto }; lastError = null;
  try {
    const before = data && data.tracker ? data.tracker.state : 'ok';
    data = await C.fetchAll(settings, (step, done, total) => { busy = { step, done, total, auto }; }, { force });
    // a2-tracker saying no is written down once, when it starts, not on every refresh
    if (data.tracker.state !== before && data.tracker.state !== 'ok') logLine('a2-tracker ' + data.tracker.state + (data.tracker.why ? ': ' + data.tracker.why : '') + '; prices come from the Exchange in game only');
    crafting.learn(data.catalogue);
    // the worn gear: from the game's login list when it has been seen; the official site only when it hasn't and the
    // game isn't being read now (then the next login brings the list)
    if (!applyGameGear() && settings.auto_sync && settings.character && settings.character.name && !readingGame()) await syncGear(false);
    busy = { step: 'Calculating', done: 0, total: 1, auto };
    report = C.computeState(data, settings, market);
    lastRefresh = Date.now();
    writeLog();
    alerts.check('refresh');
    if (quiet || settings.alerts) await checkAlerts(quiet);
  } catch (e) { logErr(e); }
  busy = null;
  tell('state', 'idle'); // the overlay reloads at once (it no longer waits on its own timer to see the end)
}
async function syncGear(fresh) {
  if (gearRead) return;
  gearRead = { step: 'Reading your gear', done: 0, total: 1 };
  try {
    const r = await Armory.lookup(settings.character.name, settings.character.serverId, { fresh });
    C.applySync(data, settings, r); syncError = null; C.saveSettings(settings); describeSettings();
  } catch (e) { syncError = e.message; }
  gearRead = null;
  if (!busy) tell('state', 'idle');
}
/* The worn gear as the game's last login list said it, in applySync's shape, or null. */
function gameGear() {
  const worn = inventory.worn();
  if (!worn || !inventory.fresh() || !data || !me.known()) return null;
  const sv = Armory.server(me.serverId);
  return C.gearFromGame(data, worn, { name: me.name, serverId: me.serverId, serverName: sv ? sv.name : null, region: sv ? sv.region : '', className: me.class, level: me.level, faction: sv ? sv.faction : 'Elyos' }, inventory.listAt);
}
/* Sets the owned tiers from the game's worn gear. True when it could. */
function applyGameGear() {
  const g = gameGear();
  if (!g) return false;
  try { C.applySync(data, settings, g); syncError = null; C.saveSettings(settings); describeSettings(); } catch (e) { logErr(e); return false; }
  return true;
}
/* Flav-Toolkit is reading the game right now: its login list will say what is worn, no website needed. */
const readingGame = () => feed.state === 'connected' && !!feed.game;
function setServer(id) {
  const sv = Armory.server(id); if (!sv) return false;
  const changed = settings.server !== sv.id;
  settings.server = sv.id; settings.server_name = sv.name + ' (' + sv.region.toUpperCase() + ', ' + sv.faction + ')'; settings.faction = sv.faction.toLowerCase();
  return changed;
}
/* The game said who is playing (me.js). The character becomes the one to read gear for (as if typed in), and the class
   follows the game unless one was picked by hand. The two events come within a moment of each other at login, so the
   work waits a second and runs once. */
let meTimer = null;
function applyMe() {
  clearTimeout(meTimer);
  meTimer = setTimeout(async () => {
    let moved = false, who = false;
    if (me.known() && (settings.character.name !== me.name || Number(settings.character.serverId) !== me.serverId)) {
      settings.character = { name: me.name, serverId: me.serverId };
      moved = setServer(me.serverId); who = true;
      settings.sync = null; // the gear read was another character's
    }
    if (settings.class_mode !== 'manual' && me.class && settings.class !== me.class) settings.class = me.class;
    C.saveSettings(settings); describeSettings(); // another class: other pieces behind "every piece stops at"
    try {
      if (moved) await refresh({});
      else if (who && data && !busyNow() && !applyGameGear() && settings.auto_sync && !readingGame()) await syncGear(true);
    } catch (e) { logErr(e); }
  }, 1000);
}
/* One event from Flav-Toolkit, whichever way it came (its feed, or the tray's older posts to /api/market, /api/inventory
   and /api/me): the Exchange, the bag, who is playing. Returns what changed, or null. */
function fromCore(ev) {
  if (!ev || typeof ev !== 'object') return null;
  if (ev.type === 'inventory') {
    const kind = inventory.take(ev);
    if (kind === 'list' && applyGameGear()) recompute(); // a login: what is worn now
    if (kind === 'changed' && crafting.take(inventory.lastDelta)) tell('craft', JSON.stringify(crafting.view()));
    if (kind) changedSoon('inventory');
    return kind ? 'inventory' : null;
  }
  if (ev.type === 'my_profile' || ev.type === 'my_server') { const ch = me.take(ev); if (ch) applyMe(); return ch ? 'me' : null; }
  const changed = market.take(ev);
  if (changed === 'summary' || changed === 'stats') { recompute(); alerts.check('exchange'); }
  if (changed) changedSoon('market');
  return changed;
}
/* Tells the open overlay pages that what they show has changed (the bag, or the Exchange as the game showed it), once
   things settle: a purchase is two events, an Exchange page several. Nothing is downloaded for it; each page redraws
   from what this app already holds, if the player lets it ("Update by itself"). */
let changedTimer = null, changedWhat = new Set();
function changedSoon(what) {
  changedWhat.add(what);
  clearTimeout(changedTimer);
  changedTimer = setTimeout(() => { const w = [...changedWhat].join(','); changedWhat = new Set(); tell('data', w); }, 700);
}
/* What is known about an item right now, for the alerts: the Exchange's cheapest listing and count when seen within
   the hour, else a2-tracker's hourly price; "usual" from the game's own 28-day average (the purchase dialog) or
   a2-tracker's history median. */
function lookup(id) {
  const live = market.min(id, 'kina');
  const q = data && data.quotes.get(String(id));
  const tracker = q && q.currency === 'Kinah' ? Number(q.price) : null;
  const price = live ? live.price : tracker > 0 ? tracker : null;
  const listed = live && live.count != null ? live.count : q && q.listings != null ? Number(q.listings) : null;
  const st = market.stats.get(String(id));
  const hist = data && data.hist.get(String(id));
  const med = hist ? [...hist.values()].sort((a, b) => a - b) : null;
  const usual = st && st.average > 0 && Date.now() - st.at < 7 * 86400000 ? st.average : med && med.length >= 24 ? med[med.length >> 1] : null;
  return price == null && listed == null ? null : { price, listed, usual, source: live ? live.source : tracker > 0 ? 'tracker' : null };
}
const itemName = id => (data && data.catalogue.items[String(id)] && data.catalogue.items[String(id)].name) || 'Item ' + id;
const itemIcon = id => (data && data.catalogue.items[String(id)] && data.catalogue.items[String(id)].icon ? '/icon/' + id : null);
// while the player crafts a batch: how many came out Splendent so far (crafting.js), shown at the top of the overlay
const crafting = new Crafting({ name: itemName, icon: itemIcon });
// a try whose piece never came is a failed try: noticed when the next try starts, or here once enough time passed
setInterval(() => { if (crafting.tick()) tell('craft', JSON.stringify(crafting.view())); }, 5000).unref();
const alerts = new Alerts({
  settings, save: () => C.saveSettings(settings), lookup, name: itemName, icon: itemIcon,
  fire: f => { toast(f.title, f.text); feed.notify(f.title, f.text, f.icon ? 'http://' + HOST + ':' + PORT + f.icon : null, 'alert'); },
});
/* The core's feed: this app reads it itself (feed.js). The tray's posts still arrive too for now; both land in fromCore. */
const feed = new Feed({ version: VERSION, onEvent: fromCore, onShow: show => fromHub(show), onHotkey: id => pressed(id), onSetting: (k, v) => { fromHubSetting(k, v).catch(logErr); }, onStatus: () => { feed.note = report ? 'prices ' + Math.round((Date.now() - lastRefresh) / 60000) + ' min old' : 'loading prices'; } });

/* The shopping list over the game: overlay.html, served here and shown by Flav-Toolkit (`overlays` in addon.json).
   The core keeps its window; this app says when to show or hide it (over the feed) and tells the page what happens
   (a key pressed, "Show in overlay" from the browser page) on one local event stream, /api/events. */
const LIST = 'list'; // the overlay's id in addon.json
// The list is on screen while its page listens here: the core closes the window when the player hides it (the dock's
// icon, the hub's switch, its own button), so the open pages are the truth for a show-or-hide key.
const listOpen = () => pages.size > 0;
const pages = new Set(); // the overlay pages listening on /api/events
const tell = (name, value) => { for (const res of pages) { try { res.write('event: ' + name + '\ndata: ' + String(value) + '\n\n'); } catch { /* gone */ } } };
function showList(on) { feed.overlay(LIST, !!on); }
// the hub's Open shows the list; its Settings › Its own settings opens the full page in the browser
function fromHub(what) { if (what === 'open') showList(true); else if (what === 'settings') openPage(); }
/* Dragon Gear's settings in Flav-Toolkit's hub (hub.js; ADDONS.md 4d): described now and after every change from
   anywhere (the overlay's ⚙, the browser page, the hub itself), and a change made in the hub applied like the same
   change made here. The overlay page hears it (`settings`) and redraws with it. */
function describeSettings() {
  try {
    const goals = Slots.slotsFor(settings.class).map(s => Slots.rangeOf(settings.plan, s.id).goal);
    feed.setSettings(Hub.describe(settings, { goals: goals.length && goals.every(g => g === goals[0]) ? goals[0] : null }));
  } catch (e) { logErr(e); }
}
async function fromHubSetting(key, value) {
  const c = Hub.change(key, value);
  if (c) {
    if (c.settings) applySettings(c.settings);
    if ('use_inventory' in c) settings.shop.use_inventory = c.use_inventory;
    if (c.prefs) settings.overlay = { ...Hub.cleanPrefs(settings.overlay), ...c.prefs };
    if (c.goal_all) Slots.changePlan(settings.plan, settings.class, { goalAll: c.goal_all });
    C.saveSettings(settings);
    if ('alerts' in c) await setAlerts(c.alerts);
    tell('settings', JSON.stringify(Hub.prefsOf(settings).prefs));
  }
  describeSettings(); // nothing is sent when nothing changed: the core believes what it was last told
}
// Dragon Gear's keys in the game (addon.json `hotkeys`; the player picks them in the hub, the core holds them)
function pressed(id) {
  if (id === 'toggle') return showList(!listOpen());
  if (id === 'refresh') { if (pages.size) tell('hotkey', 'refresh'); else if (!busy) refresh({}); }
}
// this app's own page in the player's browser (the address is fixed: nothing from a request goes into the command)
function openPage() {
  if (process.platform !== 'win32') return false;
  ps('Start-Process ' + psq('http://' + HOST + ':' + PORT + '/'));
  return true;
}

/* Items by name, for the alerts' search box: up to 20, with the icon and what is known now. */
function searchItems(q) {
  if (!data) return [];
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
  if (!words.length) return [];
  const out = [];
  for (const [id, it] of Object.entries(data.catalogue.items)) {
    const n = String(it.name || '').toLowerCase();
    if (!words.every(w => n.includes(w))) continue;
    out.push({ id, name: it.name, icon: it.icon ? '/icon/' + id : null, now: lookup(id) });
    if (out.length >= 60) break;
  }
  out.sort((a, b) => (b.now ? 1 : 0) - (a.now ? 1 : 0) || a.name.length - b.name.length);
  return out.slice(0, 20);
}

/* Everything the in-game overlay's Gear tab shows, small: one row per slot with its tiers' costs and verdict. */
function gearNow() {
  const m = FX.money(settings, C.DATA);
  const out = { at: report ? report.generatedAt : null, busy: busyNow(), error: lastError, syncError, show: overlaySeq, cur: curOf(m), auto_sync: !!settings.auto_sync, class: settings.class, class_mode: settings.class_mode === 'manual' ? 'manual' : 'auto', me: me.known() ? { name: me.name, className: me.class || me.gameClass, level: me.level } : null, synced: !!(settings.sync && settings.sync.detected), ...(() => { const x = Hub.prefsOf(settings); return { prefs: x.prefs, prefsSet: x.set }; })(), character: settings.sync && settings.sync.profile ? { name: settings.sync.profile.name, className: settings.sync.profile.className, gearScore: settings.sync.profile.gearScore } : null, slots: [], total: { money: 0, kina: 0, n: 0 } };
  if (!report) return out;
  const perKina = report.rate.qunaPer10m / 1e7 * m.pack / m.quna;
  for (const s of Slots.slotsFor(settings.class)) {
    const p = report.pieces[s.gear]; if (!p) continue;
    const r = Slots.rangeOf(settings.plan, s.id), v = signal(report, p, r.skip ? r.goal : r.have, r.goal);
    const w = settings.sync && settings.sync.detected && settings.sync.detected[s.id];
    // worn: the tier the gear read found in this slot; auto: the plan uses it (false = you set another tier by hand)
    out.slots.push({ slot: s.id, group: s.group, label: s.id === 'SubHand' ? 'Guard' : p.label + (s.pair ? ' ' + s.n : ''), have: r.have, goal: r.goal, skip: r.skip,
      icon: p.stages[r.goal - 1].icon, item: p.stages[r.goal - 1].name, wear: w ? { name: w.name, enchant: w.enchant, exceed: w.exceed, dragon: w.dragon, tier: w.tier } : null,
      worn: w ? w.tier : null, auto: w ? w.tier === r.have : null,
      tiers: p.stages.map(st => ({ tier: st.tier, name: st.name, icon: st.icon, kina: st.cost, money: st.cost == null ? null : st.cost * perKina })),
      money: v.money, kina: v.kina, kind: v.kind, pct: v.pct, good: v.good });
    if (v.kind !== 'done' && v.money != null) { out.total.money += v.money; out.total.kina += v.kina; out.total.n++; }
  }
  return out;
}

/* The shopping list plus what the page needs to show money, and whether Kina is cheap today. */
function shoppingNow() {
  const out = C.shopping(data, settings, market, inventory);
  out.alerts = alerts.list(); out.alertsRecent = alerts.recent;
  // whether the Exchange can be read now: Flav-Toolkit running, the game read, its Exchange seen (for the warning)
  out.feed = feed.info();
  out.tracker = data.tracker || { state: 'ok' }; // a2-tracker's hourly prices: 'ok', 'refused' (since…), 'unreachable'
  const m = FX.money(settings, C.DATA), rate = report && report.rate.qunaPer10m;
  const series = (report && report.qunaSeries || []).filter(x => x != null).sort((a, b) => a - b);
  const usual = series.length > 24 ? series[series.length >> 1] : null;
  out.money = { qunaPer10m: rate, usualQunaPer10m: usual, ratePct: usual && rate ? (rate - usual) / usual * 100 : null, perKina: rate ? rate / 1e7 * m.pack / m.quna : null, eurPerKina: rate ? rate / 1e7 * m.eur / m.quna : null, ...curOf(m), pack: m.pack, quna: m.quna, eur: m.eur, fxAt: m.fxAt, fxSource: m.fxSource };
  return out;
}
function recompute() {
  if (!data) return;
  try { report = C.computeState(data, settings, market); } catch (e) { logErr(e); }
}

function planVerdicts() {
  if (!report) return [];
  const out = [];
  for (const s of Slots.slotsFor(settings.class)) {
    const r = Slots.rangeOf(settings.plan, s.id), p = report.pieces[s.gear];
    if (r.skip || !p) continue;
    out.push({ slot: s, p, v: signal(report, p, r.have, r.goal) });
  }
  return out;
}
function writeLog() {
  if (!settings.class) return;
  const head = 'time,slot,from_tier,to_tier,kina,quna,money,currency,eur,usual_money,vs_usual_percent,verdict\n';
  if (fs.existsSync(LOG)) { const first = fs.readFileSync(LOG, 'utf8').split('\n')[0].replace(/^\uFEFF/, ''); if (first + '\n' !== head) fs.renameSync(LOG, path.join(C.DATA, first.includes('slot,') ? 'price-log-v2.csv' : 'price-log-v1.csv')); }
  if (!fs.existsSync(LOG)) fs.writeFileSync(LOG, '﻿' + head);
  const t = new Date().toLocaleString('sv-SE'), r = (x, d) => (x == null ? '' : x.toFixed(d)), code = report.settings.money.code;
  const rows = planVerdicts().map(({ slot, p, v }) => { const g = Slots.rangeOf(settings.plan, slot.id); return [t, p.label + (slot.pair ? ' ' + slot.n : ''), g.have, g.goal, r(v.kina, 0), r(v.quna, 0), r(v.money, 2), code, r(v.eur, 2), r(v.usual, 2), r(v.pct, 1), v.kind].join(','); });
  if (rows.length) fs.appendFileSync(LOG, rows.join('\n') + '\n');
}
async function checkAlerts() {
  let state = {};
  try { state = JSON.parse(fs.readFileSync(ALERT_STATE, 'utf8')); } catch { /* first time */ }
  const fresh = [], next = {};
  for (const { slot, p, v } of planVerdicts()) {
    const key = slot.id + ':' + JSON.stringify(Slots.rangeOf(settings.plan, slot.id));
    next[key] = v.kind;
    if (v.kind === 'cheap' && state[key] !== 'cheap') fresh.push(p.label + (slot.pair ? ' ' + slot.n : '') + ': ' + cash(v.money, report.settings.money, 0) + ' (' + Math.abs(v.pct).toFixed(0) + '% below usual)');
  }
  fs.writeFileSync(ALERT_STATE, JSON.stringify(next, null, 2));
  if (fresh.length) await toast('Dragon Gear is cheap right now', fresh.slice(0, 3).join('\n') + (fresh.length > 3 ? '\n+' + (fresh.length - 3) + ' more' : ''));
}

function ps(script) {
  return new Promise(res => {
    if (process.platform !== 'win32') return res({ ok: false, out: 'not Windows' });
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 30000 }, (err, stdout, stderr) => res({ ok: !err, out: String(stdout || '') + String(stderr || '') }));
  });
}
const psq = s => "'" + String(s).replace(/'/g, "''") + "'";
function toast(title, body) {
  const esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const xml = '<toast activationType="protocol" launch="http://127.0.0.1:' + PORT + '/"><visual><binding template="ToastGeneric"><text>' + esc(title) + '</text>' +
    body.split('\n').map(l => '<text>' + esc(l) + '</text>').join('') + '</binding></visual></toast>';
  return ps([
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null',
    '$x = New-Object Windows.Data.Xml.Dom.XmlDocument', '$x.LoadXml(' + psq(xml) + ')',
    "$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
    '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($x))',
  ].join('; '));
}
/* Alerts need the app running, so turning them on also starts it (hidden) when you log in to Windows. */
function setAutostart(on) {
  const drop = 'Unregister-ScheduledTask -TaskName ' + psq(TASK) + ' -Confirm:$false -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName ' + psq(OLD_TASK) + ' -Confirm:$false -ErrorAction SilentlyContinue';
  if (!on) return ps(drop);
  return ps([
    drop,
    '$a = New-ScheduledTaskAction -Execute ' + psq('conhost.exe') + ' -Argument ' + psq('--headless "' + NODE + '" "' + SERVER_JS + '"') + ' -WorkingDirectory ' + psq(C.ROOT),
    '$t = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME',
    '$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew',
    'Register-ScheduledTask -TaskName ' + psq(TASK) + ' -Action $a -Trigger $t -Settings $s -Description ' + psq('Dragon Gear Prices app (price alerts). Turn off from the app.') + ' -Force | Out-Null',
  ].join('; '));
}

/* Price alerts on or off: the hourly check, and this app started at Windows logon while they are on. */
async function setAlerts(on) {
  settings.alerts = !!on; C.saveSettings(settings);
  const r = await setAutostart(settings.alerts);
  if (settings.alerts) await toast('Dragon Gear alerts are on', 'You will get a message like this when one of your pieces turns cheap. Click it to open the app.');
  return r;
}

// Hourly check while alerts are on (and keep data fresh for an open page).
setInterval(() => { if (settings.alerts && !busy && Date.now() - lastRefresh > 55 * 60000) refresh({ quiet: true }); }, 5 * 60000);

const ALLOWED = ['class', 'class_mode', 'plan', 'auto_sync', 'currency', 'proficiency', 'quna_pack', 'my_kina_rate_quna_per_10m', 'xp_per_craft', 'cheap_when_below_usual_percent', 'expensive_when_above_usual_percent'];
const RECOMPUTE = ['currency', 'proficiency', 'quna_pack', 'my_kina_rate_quna_per_10m', 'cheap_when_below_usual_percent', 'expensive_when_above_usual_percent'];
function applySettings(patch) {
  let needs = false;
  for (const k of ALLOWED) if (k in patch) {
    const v = patch[k];
    if (k === 'class' && v !== null && !Slots.CLASSES.some(c => c.id === v)) continue;
    if (k === 'class') { settings.class = v; settings.class_mode = 'manual'; continue; } // picked by hand: stays until "my class" again
    if (k === 'class_mode') {
      if (v === 'auto') { settings.class_mode = 'auto'; const mine = me.class || (settings.sync && settings.sync.profile && Slots.CLASSES.some(c => c.id === settings.sync.profile.className) ? settings.sync.profile.className : null); if (mine) settings.class = mine; }
      else if (v === 'manual') settings.class_mode = 'manual';
      continue;
    }
    if (k === 'currency' && !FX.CURRENCIES[v]) continue;
    if (k === 'proficiency') { for (const p of C.PROFESSIONS) if (p in v) { const n = v[p] === null || v[p] === '' ? null : Math.round(Number(v[p])); settings.proficiency[p] = n >= 1 && n <= 100 ? n : null; } }
    else if (k === 'quna_pack') { for (const f of ['quna', 'eur']) if (Number(v[f]) > 0) settings.quna_pack[f] = Number(v[f]); }
    else if (k === 'xp_per_craft') { for (const [id, x] of Object.entries(v)) { const n = Number(x); if (n > 0) settings.xp_per_craft[id] = n; else delete settings.xp_per_craft[id]; } }
    else if (k === 'my_kina_rate_quna_per_10m') settings[k] = Number(v) > 0 ? Number(v) : null;
    else if (k.endsWith('_percent')) { const n = Math.round(Number(v)); if (n >= 1 && n <= 99) settings[k] = n; } // whole percents, as the hub shows them
    else if (k === 'plan') { // slot id -> { have 0..6, goal 1..6, skip }; nothing else is kept
      if (!v || typeof v !== 'object') continue;
      const plan = {};
      for (const [id, r] of Object.entries(v).slice(0, 64)) { if (typeof id !== 'string' || id.length > 40 || !r || typeof r !== 'object') continue; const { have, goal, skip } = Slots.rangeOf({ [id]: r }, id); plan[id] = { have, goal, skip: !!r.skip && skip }; }
      settings.plan = plan;
    }
    else settings[k] = v;
    if (RECOMPUTE.includes(k)) needs = true;
  }
  C.saveSettings(settings);
  if (needs) recompute();
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
/* What the pages may load and talk to: this app, and pictures from the official AION 2 CDN and portrait host. No frames
   around the pages (another site cannot embed them), no plugins, no forms. */
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://assets.playnccdn.com https://profileimg.plaync.com https://fizz-download.playnccdn.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'";
/* The overlay page also talks to Flav-Toolkit's window through its bridge (Tauri's IPC, on its own local scheme). */
const CSP_OVERLAY = CSP.replace("connect-src 'self'", "connect-src 'self' ipc: http://ipc.localhost");
function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': CSP, ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((ok, bad) => { let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) { bad(new Error('too big')); req.destroy(); } }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { bad(e); } }); });
}
const status = () => ({ busy: busyNow(), error: lastError, syncError, lastRefresh, hasReport: !!report, alerts: !!settings.alerts, market: market.status(), inventory: inventory.status(), me: me.status(), feed: feed.info(), version: VERSION });

const server = http.createServer(async (req, res) => {
  try {
    // Only this PC, only this page: other websites cannot drive the app.
    const host = String(req.headers.host || '');
    if (host !== HOST + ':' + PORT && host !== 'localhost:' + PORT) return send(res, 403, { error: 'forbidden' });
    const url = new URL(req.url, 'http://' + host), p = url.pathname;
    if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'method' }, undefined, { Allow: 'GET, POST' });
    if (req.method === 'POST') {
      if (req.headers['x-flav'] !== '1' || !String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 403, { error: 'forbidden' });
      res.on('close', describeSettings); // any change here, answered or not: the hub shows it (nothing is sent when nothing changed)
      const body = await readBody(req);
      if (p === '/api/refresh') { refresh({ force: !!body.force }); return send(res, 200, status()); }
      if (p === '/api/market' || p === '/api/inventory' || p === '/api/me') {
        // from Flav-Toolkit's tray (the older path; the feed brings the same events): the Exchange, the bag, who is playing
        const changed = fromCore(body);
        return send(res, changed ? 200 : 400, { ok: !!changed, market: market.status(), inventory: inventory.status(), me: me.status() });
      }
      if (p === '/api/alerts') {
        // alerts on or off ({ on }), and the player's own alerts: add { add: { item, kind, value } }, { remove: id },
        // { toggle: id }. One route: a second `/api/alerts` further down was never reached, so the switch did nothing.
        if (typeof body.on === 'boolean') { const autostart = await setAlerts(body.on); return send(res, 200, { ...status(), autostart }); }
        let error = null;
        if (body.add) { const r = alerts.add(body.add); if (typeof r === 'string') error = r; else alerts.check('refresh'); }
        if (typeof body.remove === 'string') alerts.remove(body.remove.slice(0, 40));
        if (typeof body.toggle === 'string') alerts.toggle(body.toggle.slice(0, 40));
        return send(res, error ? 400 : 200, { error, alerts: alerts.list(), recent: alerts.recent });
      }
      if (p === '/api/settings') { applySettings(body); return send(res, 200, { settings, report }); }
      if (p === '/api/leveling') {
        if (!data) return send(res, 409, { error: 'no data yet' });
        if (!C.PROFESSIONS.includes(body.profession)) return send(res, 400, { error: 'profession' });
        return send(res, 200, C.leveling(data, settings, body.profession, body.ranges || {}));
      }
      if (p === '/api/sync') {
        if (body.name != null) settings.character.name = String(body.name).trim().slice(0, 40);
        let moved = false;
        if (body.serverId != null) { settings.character.serverId = Number(body.serverId); moved = setServer(Number(body.serverId)); }
        C.saveSettings(settings);
        if (moved) { await refresh({}); return send(res, 200, { ...status(), settings, report }); }
        if (!data) return send(res, 409, { error: 'Prices are still loading; try again in a moment.' });
        await syncGear(true);
        return send(res, 200, { ...status(), settings, report });
      }
      if (p === '/api/shop') {
        const sh = settings.shop;
        if (Array.isArray(body.sel)) sh.sel = body.sel.map(String).slice(0, 20);
        if (typeof body.tick === 'string' && body.tick.length < 200) C.tickStep(sh.ticks, body.tick, data ? C.stepKeys(C.shopping(data, settings, market, inventory)) : []);
        if (body.clear) sh.ticks = {};
        if (body.show) { overlaySeq++; showList(true); tell('sent', overlaySeq); }
        // the plan from the overlay's Gear tab: one piece's tier owned or where it stops, or every piece to one tier
        if (body.plan && typeof body.plan === 'object') Slots.changePlan(settings.plan, settings.class, { slot: body.plan.slot, have: body.plan.have, goal: body.plan.goal, skip: body.plan.skip });
        if (body.goal_all != null) Slots.changePlan(settings.plan, settings.class, { goalAll: body.goal_all });
        if (body.refresh && !busy) refresh({});
        // from the overlay's ⚙: the currency and reading the gear on its own (same checks as /api/settings)
        const s2 = {};
        if (typeof body.currency === 'string') s2.currency = body.currency;
        if (typeof body.auto_sync === 'boolean') s2.auto_sync = body.auto_sync;
        if (typeof body.class === 'string') { if (body.class === 'auto') s2.class_mode = 'auto'; else s2.class = body.class; }
        if (Object.keys(s2).length) applySettings(s2);
        if (typeof body.use_inventory === 'boolean') sh.use_inventory = body.use_inventory;
        // the overlay's own look (hub.js): Size, panel, faces, update by itself, steps one at a time
        if (body.prefs && typeof body.prefs === 'object') settings.overlay = { ...Hub.cleanPrefs(settings.overlay), ...Hub.cleanPrefs(body.prefs) };
        // "Craft it myself" for one planned piece: its Artisan's piece is crafted even when buying it costs less
        const ca = body.craft_artisan;
        if (ca && typeof ca.slot === 'string' && typeof ca.on === 'boolean' && Slots.LAYOUT.some(x => x.id === ca.slot)) {
          sh.craft_artisan = { ...(sh.craft_artisan && typeof sh.craft_artisan === 'object' ? sh.craft_artisan : {}) };
          if (ca.on) sh.craft_artisan[ca.slot] = true; else delete sh.craft_artisan[ca.slot];
        }
        let alertError = null;
        if (body.alert_add && typeof body.alert_add === 'object') { const r = alerts.add(body.alert_add); if (typeof r === 'string') alertError = r; else alerts.check('refresh'); }
        if (typeof body.alert_toggle === 'string') alerts.toggle(body.alert_toggle.slice(0, 40));
        if (typeof body.alert_remove === 'string') alerts.remove(body.alert_remove.slice(0, 40));
        if (body.kina_have != null) sh.kina_have = Math.max(0, Number(body.kina_have) || 0);
        if (body.quna_have != null) sh.quna_have = Math.max(0, Number(body.quna_have) || 0);
        const keys = Object.keys(sh.ticks); if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete sh.ticks[k];
        C.saveSettings(settings);
        if (body.gear) return send(res, 200, gearNow());
        return data ? send(res, 200, { ...shoppingNow(), alertError }) : send(res, 409, { error: 'no data yet' });
      }
      if (p === '/api/overlay') return send(res, 200, { shown: listOpen() });
      if (p === '/api/craft') { if (body.clear === true && crafting.clear()) tell('craft', 'null'); return send(res, 200, { craft: crafting.view() }); }
      if (p === '/api/unlock') return send(res, 200, { ok: feed.unlock() });
      if (p === '/api/open') return send(res, 200, { ok: openPage() });
      if (p === '/api/quit') { send(res, 200, { ok: true }); setTimeout(() => process.exit(0), 200); return; }
      return send(res, 404, { error: 'not found' });
    }
    if (p === '/api/state') return send(res, 200, { ...status(), settings, report });
    if (p === '/api/status') return send(res, 200, status());
    if (p === '/api/servers') return send(res, 200, Armory.serverList());
    if (p === '/api/shopping') return data ? send(res, 200, shoppingNow()) : send(res, 409, { error: 'no data yet' });
    if (p === '/api/gear') return send(res, 200, gearNow());
    if (p === '/api/craft') return send(res, 200, { craft: crafting.view() });
    if (p === '/api/overlay-seq') return send(res, 200, { show: overlaySeq });
    if (p === '/api/events') {
      // what the overlay page hears as it happens; a few pages at most, a comment every 25 s keeps it open
      if (pages.size >= 8) return send(res, 429, { error: 'too many' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': CSP });
      res.write(': hello\n\n');
      pages.add(res);
      const keep = setInterval(() => { try { res.write(': still here\n\n'); } catch { /* gone */ } }, 25000);
      req.on('close', () => { clearInterval(keep); pages.delete(res); });
      return;
    }
    if (p === '/api/alerts') return send(res, 200, { alerts: alerts.list(), recent: alerts.recent, kinds: Object.fromEntries(Object.entries(require('./alerts').KINDS).map(([k, v]) => [k, { words: v.words, unit: v.unit }])) });
    if (p === '/api/items') return send(res, 200, { items: searchItems(url.searchParams.get('q')) });
    if (p.startsWith('/icon/')) {
      const id = p.slice(6);
      if (!/^\d{1,12}$/.test(id) && id !== 'quna') return send(res, 404, '');
      const f = await C.iconFile(data, id).catch(() => null);
      if (!f) return send(res, 404, '');
      return f.svg ? send(res, 200, f.svg, 'image/svg+xml', { 'Cache-Control': 'max-age=86400' }) : send(res, 200, fs.readFileSync(f.file), f.type, { 'Cache-Control': 'max-age=604800' });
    }
    const rel = p === '/' ? 'index.html' : p === '/list' ? 'list.html' : p.replace(/^\/+/, '');
    if (rel === 'app/signal.js' || rel === 'app/slots.js') return send(res, 200, fs.readFileSync(path.join(__dirname, path.basename(rel))), TYPES['.js']);
    const file = path.resolve(UI, rel);
    if (!file.startsWith(UI + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'not found', 'text/plain');
    return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream', rel.startsWith('art/') ? { 'Cache-Control': 'max-age=86400' } : rel === 'overlay.html' ? { 'Content-Security-Policy': CSP_OVERLAY } : {});
  } catch (e) { logErr(e); send(res, 500, { error: e.message }); }
});
server.on('error', e => { if (e.code === 'EADDRINUSE') process.exit(0); logErr(e); process.exit(1); }); // already running: the launcher just opens the page
server.listen(PORT, HOST, () => {
  refresh();
  describeSettings(); // kept for the hub: sent once the core says hello
  // v1 used a separate hourly task; the app replaces it.
  ps('Unregister-ScheduledTask -TaskName ' + psq(OLD_TASK) + ' -Confirm:$false -ErrorAction SilentlyContinue');
  // With alerts on, the logon task must start this copy: a copy installed from the hub's Get add-ons lives in another
  // folder than one run from a repository, and a task still naming the old one would hold the port at the next login.
  if (settings.alerts) setAutostart(true);
});
