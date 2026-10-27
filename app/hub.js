'use strict';
/* Dragon Gear's settings as Flav-Toolkit's hub shows them (ADDONS.md section 4d, core 0.18.0).

   This app stays their owner: they live in settings.json, the overlay's ⚙ and the browser page change them as
   before, and the hub gets a description of every one with its value now (`describe`), sent again after every change
   from anywhere. A change made in the hub comes back as one key and value (`change` turns it into what the app does
   with it, after checking it). The plan, the alerts list, the class picker and the character stay in the app's own
   windows: they are not settings one simply sets.

   The overlay's own look (its Size, how solid its panel is, which way it faces, updating by itself, steps one at a
   time) moved here from the overlay window's storage, so the hub can show it and Size and the panel can follow the
   hub's *All add-ons* settings (shared `size` and `solid`). */

const SIZES = [['0.9', '90%'], ['1', '100%'], ['1.15', '115%'], ['1.3', '130%'], ['1.5', '150%']];
const FACES = [['auto', 'Auto'], ['left', 'Left'], ['right', 'Right']];
const CURRENCIES = [['USD', '$ USD'], ['EUR', '€ EUR'], ['SAR', 'SAR']];
// the overlay's look when the player never set it
const PREFS = { size: 1, panel: 1, faces: 'auto', auto: true, steps_one: false };

/* The overlay's look as kept, every value checked: what is not one of its values is left out. */
function cleanPrefs(p) {
  const out = {};
  if (!p || typeof p !== 'object') return out;
  if (SIZES.some(([v]) => Number(v) === p.size)) out.size = p.size;
  if (typeof p.panel === 'number' && Number.isFinite(p.panel) && p.panel >= 0 && p.panel <= 1) out.panel = Math.round(p.panel * 100) / 100;
  if (FACES.some(([v]) => v === p.faces)) out.faces = p.faces;
  if (typeof p.auto === 'boolean') out.auto = p.auto;
  if (typeof p.steps_one === 'boolean') out.steps_one = p.steps_one;
  return out;
}
/* The overlay's look now: what was set, the defaults for the rest; and which were set (the page brings its own older
   values over once, for the ones not set here yet). */
function prefsOf(settings) {
  const set = cleanPrefs(settings && settings.overlay);
  return { prefs: { ...PREFS, ...set }, set: Object.keys(set) };
}

const sw = (key, name, help, value) => ({ key, name, help, kind: 'switch', value: !!value });

/* Every group with every value as it is now. `goals`: the tier every planned piece stops at, or null when they
   differ (or nothing is planned). */
function describe(settings, { goals = null } = {}) {
  const { prefs } = prefsOf(settings);
  const pct = (key, name, help) => ({ key, name, help, kind: 'number', min: 1, max: 50, step: 1, unit: '%', value: Math.min(50, Math.max(1, Math.round(Number(settings[key]) || 5))) });
  const sizeNow = SIZES.find(([v]) => Number(v) === prefs.size) || SIZES[1];
  return [
    { id: 'plan', name: 'Your plan', items: [
      { key: 'plan.goal_all', name: 'Every piece stops at', help: 'One tier for all your gear: only what takes each piece from the tier you own to it is bought and crafted. Each piece can also stop at its own tier, in the Gear tab',
        kind: 'choice', choices: [['each', 'Each its own'], ...[1, 2, 3, 4, 5, 6].map(t => [String(t), 'T' + t])], value: goals == null ? 'each' : String(goals) },
    ] },
    { id: 'prices', name: 'Prices', items: [
      { key: 'currency', name: 'Currency', help: 'Every price, in the list over the game and in the app', kind: 'choice', choices: CURRENCIES, value: CURRENCIES.some(([v]) => v === settings.currency) ? settings.currency : 'USD' },
      pct('cheap_when_below_usual_percent', 'Cheap when below usual by', 'A piece or an item is called cheap when its price is this far under its usual price'),
      pct('expensive_when_above_usual_percent', 'Pricey when above usual by', 'And pricey when it is this far over it'),
    ] },
    { id: 'gear', name: 'Your gear', items: [
      sw('auto_sync', 'Read my gear', "When the game isn't being read: from the official site on every price refresh (the game's own read at login always counts)", settings.auto_sync !== false),
      sw('shop.use_inventory', 'Count what I own', 'Take the bag, storage and warehouse off what to buy and craft. Off: full counts, what you have shown beside them', !(settings.shop && settings.shop.use_inventory === false)),
    ] },
    { id: 'alerts', name: 'Alerts', items: [
      sw('alerts', 'Price alerts', 'Check every hour and show a Windows notification when a piece of your plan or an item you watch turns cheap. Starts this app when you log in to Windows', settings.alerts),
    ] },
    { id: 'list', name: 'Shopping list', items: [
      { key: 'overlay.size', name: 'Size', help: 'Everything in the list larger or smaller; the window follows', kind: 'choice', choices: SIZES, value: sizeNow[0], shared: { id: 'size' } },
      { key: 'overlay.panel', name: 'Panel', help: 'Solid ↔ glass. Text keeps a dark halo when the panel goes clear', kind: 'number', min: 0, max: 1, step: 0.05, percent: true, value: prefs.panel, shared: { id: 'solid', scale: 0.01 } },
      { key: 'overlay.faces', name: 'Faces', help: 'Which way the title, buttons and grip sit. Auto: toward the middle of the screen, from where the list is', kind: 'choice', choices: FACES, value: prefs.faces },
      sw('overlay.auto', 'Update by itself', 'Redraw when your bag changes or the game shows you Exchange prices. Nothing is downloaded, nothing is asked of the game', prefs.auto),
      sw('overlay.steps_one', 'Steps one at a time', 'The Steps tab shows only the step you are on; Done moves to the next', prefs.steps_one),
    ] },
  ];
}

/* A change from the hub, checked, as what the app does with it, or null when it isn't one of these settings or its
   value isn't one the setting takes:
   { settings: {...} } (through the app's own checks), { use_inventory }, { alerts }, { prefs: {...} }, { goal_all }. */
function change(key, value) {
  switch (key) {
    case 'plan.goal_all': { const t = Number(value); return typeof value === 'string' && Number.isInteger(t) && t >= 1 && t <= 6 ? { goal_all: t } : null; }
    case 'currency': return CURRENCIES.some(([v]) => v === value) ? { settings: { currency: value } } : null;
    case 'cheap_when_below_usual_percent':
    case 'expensive_when_above_usual_percent':
      return typeof value === 'number' && value >= 1 && value <= 50 ? { settings: { [key]: Math.round(value) } } : null;
    case 'auto_sync': return typeof value === 'boolean' ? { settings: { auto_sync: value } } : null;
    case 'shop.use_inventory': return typeof value === 'boolean' ? { use_inventory: value } : null;
    case 'alerts': return typeof value === 'boolean' ? { alerts: value } : null;
    case 'overlay.size': { const v = typeof value === 'string' && SIZES.some(([s]) => s === value) ? Number(value) : null; return v == null ? null : { prefs: { size: v } }; }
    case 'overlay.panel': { const p = cleanPrefs({ panel: value }); return 'panel' in p ? { prefs: p } : null; }
    case 'overlay.faces': return FACES.some(([v]) => v === value) ? { prefs: { faces: value } } : null;
    case 'overlay.auto': return typeof value === 'boolean' ? { prefs: { auto: value } } : null;
    case 'overlay.steps_one': return typeof value === 'boolean' ? { prefs: { steps_one: value } } : null;
    default: return null;
  }
}

module.exports = { describe, change, cleanPrefs, prefsOf, PREFS, SIZES };
