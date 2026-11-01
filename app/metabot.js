'use strict';
/* The recipe list from MetaBot.GG, for when a2-tracker.com can't give it (it refuses the app since 2026-10-30).

   MetaBot.GG reads the recipe tables shipped in the AION 2 Global client and shows them on one public page,
   https://metabot.gg/en/aion-2/crafting, with the recipes, their materials, mastery, combo chance and success curves
   in the page itself. Its terms let anyone reuse that data with a link back to the page it came from (a plain link,
   no "nofollow"); the app shows that link wherever the recipes come from MetaBot.GG, and README credits it.

   What this file does, and nothing more:
   - parsePage(html): finds the recipe data in the page (bounded: a page over MAX_PAGE, or data that doesn't look
     like recipes, is refused with an error, never half-read);
   - toCatalogue(raw): turns it into the shape the engine reads (the same fields a2-tracker's list has), so the
     engine, the plan and the tests don't care where the list came from.

   What MetaBot's page doesn't say, and how it is filled:
   - profession, faction, gear piece and tier: written in the client's recipe id itself (digit 1 the profession,
     digit 2 the side, digits 3-6 the piece, the last three the tier), as a2-tracker's recipe keys showed for every
     recipe both lists have (all 512 of MetaBot's recipes matched a2-tracker's to the last quantity, 2026-11-01);
   - which item a combo gives: the "Splendent" item of the same name (on the recipe's side when there are two);
     cooking combos give one more of the same dish; anything else is left without a combo rather than guessed;
   - NPC prices aren't on the recipe page: the release tool reads them from MetaBot's shop pages into the list that
     comes with the add-on (parseShop), and a list read live takes them from there;
   - conversions (a gathered material into a bound copy: Fine Odyle -> Fine Orichalcum Ore (Bound)) and the bound
     copies a recipe takes in place of a material aren't on the recipe page either: the release tool reads them from
     MetaBot's Substance Morph page (parseConversions) into the same shipped list.
   It never sends anything about the player: one page, asked at most once a day. */

const MAX_PAGE = 12 * 1024 * 1024;
const MAX_RECIPES = 5000, MAX_ITEMS = 20000, MAX_PARTS = 40;
const PAGE = 'https://metabot.gg/en/aion-2/crafting';
const ORIGIN = 'https://metabot.gg';
// the profession as the game shows it (the proficiency settings use these), and as the client's recipe keys spell it
const PROFESSION = { 1: 'Blacksmithing', 2: 'Handicrafting', 3: 'Alchemy', 4: 'Armorsmithing', 5: 'Cooking' };
const KEY_NAME = { Blacksmithing: 'Blacksmithing', Handicrafting: 'Jewelcrafting', Alchemy: 'Alchemy', Armorsmithing: 'Tailoring', Cooking: 'Cooking' };
const SLOT = { 1: 'wp', 2: 'ar', 3: 'acc' };
// The piece, from digits 3-6 of a Dragon Gear recipe id (the names a2-tracker's recipe keys use, which slots.js reads)
const PIECE = {
  1013: 'Sword', 1023: 'Greatsword', 1033: 'Dagger', 1043: 'Bow', 1053: 'Magicbook', 1063: 'Mace', 1083: 'Guarder', 1093: 'Orb', 1103: 'Staff',
  2013: 'Torso', 2023: 'Pants', 2033: 'Helmet', 2043: 'Shoulder', 2053: 'Gloves', 2063: 'Boots', 2073: 'Cape',
  3013: 'Necklace', 3023: 'Earring', 3033: 'Ring',
};
// The Kina Chests aren't recipes, so MetaBot's page doesn't name them; the plan buys Kina with them.
const CHESTS = {
  516130001: { name: 'Kina Chest: 10,000,000 Kina', grade: 'Unique', icon: '/game/Icon_Item_Currency_Box_AchievementGroup_step_4.Unique.png.webp' },
  516140001: { name: 'Kina Chest: 2,000,000 Kina', grade: 'Legend', icon: '/game/Icon_Item_Currency_Box_AchievementGroup_step_3.Legend.png.webp' },
  516150001: { name: 'Kina Chest: 400,000 Kina', grade: 'Rare', icon: '/game/Icon_Item_Currency_Box_AchievementGroup_step_2.Rare.png.webp' },
};

const isId = v => Number.isSafeInteger(v) && v > 0;
const isCount = v => Number.isSafeInteger(v) && v > 0 && v <= 1e6;

/* The page is a Next.js page: its data travels as JSON strings pushed into `self.__next_f`. The recipe component's
   props start with {"lang":..,"recipes":[ ; one JSON value is read from there, nothing is evaluated. */
function flightOf(html) {
  if (typeof html !== 'string' || !html.length) throw new Error('empty page');
  if (html.length > MAX_PAGE) throw new Error('page too large');
  const flight = [];
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let m;
  while ((m = re.exec(html))) {
    try { flight.push(JSON.parse('"' + m[1] + '"')); } catch { /* a chunk that isn't a string: skipped */ }
  }
  return flight.join('');
}
function parsePage(html) {
  const text = flightOf(html);
  const at = text.search(/\{"lang":"[a-z]{2}(?:[-_][A-Za-z]{2})?","recipes":\[/);
  if (at < 0) throw new Error('no recipe data on the page');
  let raw;
  try { raw = readValue(text, at); } catch { throw new Error('recipe data unreadable'); }
  return check(raw);
}

/* One JSON object from position `at`: the shortest prefix that parses (found by matching braces outside strings). */
function readValue(text, at) {
  let depth = 0, inStr = false, esc = false;
  for (let i = at; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return JSON.parse(text.slice(at, i + 1)); }
  }
  throw new Error('unterminated');
}

/* Only what looks exactly like recipes is kept: ids, counts and names inside sane bounds. */
function check(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.recipes) || !raw.items || typeof raw.items !== 'object') throw new Error('recipe data looks wrong');
  if (raw.recipes.length < 50 || raw.recipes.length > MAX_RECIPES) throw new Error('recipe count looks wrong');
  const items = {};
  const listed = Object.entries(raw.items);
  if (listed.length > MAX_ITEMS) throw new Error('item count looks wrong');
  for (const [id, it] of listed) {
    if (!/^[1-9][0-9]{0,15}$/.test(id) || !it || typeof it.name !== 'string' || !it.name || it.name.length > 200) continue;
    items[id] = {
      name: it.name,
      icon: typeof it.icon === 'string' && /^\/web\/aion2\/items\/[a-z0-9_]+\.webp$/.test(it.icon) ? it.icon : null,
      grade: typeof it.grade === 'string' && /^[A-Za-z]{1,20}$/.test(it.grade) ? it.grade : null,
      href: typeof it.href === 'string' && /^\/aion-2\/[a-z0-9\-/#]+$/.test(it.href) ? it.href : null,
    };
  }
  const recipes = [];
  for (const r of raw.recipes) {
    if (!r || !isId(r.id) || !isId(r.product) || !isCount(r.qty) || !Array.isArray(r.parts) || !r.parts.length || r.parts.length > MAX_PARTS) continue;
    if (!/^[1-5][0-9]{8}$/.test(String(r.id))) continue;
    const parts = r.parts.filter(p => Array.isArray(p) && p.length === 2 && isId(p[0]) && isCount(p[1])).map(p => [p[0], p[1]]);
    if (parts.length !== r.parts.length) continue;
    const mastery = Number.isSafeInteger(r.mastery) && r.mastery >= 0 && r.mastery <= 1000 ? r.mastery : null;
    const combo = typeof r.combo === 'number' && r.combo >= 0 && r.combo <= 100 ? r.combo : 0;
    // the base-success curve's name (the page gives [base, with a bonus]; a list already read keeps the first)
    const name = Array.isArray(r.rate) ? r.rate[0] : r.rate;
    const rate = typeof name === 'string' && name.length && name.length <= 10 ? name : null;
    recipes.push({ id: r.id, product: r.product, qty: r.qty, mastery, combo, parts, rate });
  }
  if (recipes.length < 50) throw new Error('too few readable recipes');
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const npc = obj(raw.npc);
  const conversions = (Array.isArray(raw.conversions) ? raw.conversions : []).filter(c => c && isId(c.product) && isId(c.part) && KEY_NAME[c.profession] &&
    Number.isSafeInteger(c.mastery) && c.mastery >= 0 && c.mastery <= 1000 && (c.faction == null || c.faction === 'elyos' || c.faction === 'asmodian')).slice(0, 2000);
  const swaps = {};
  for (const [id, v] of Object.entries(obj(raw.swaps))) if (/^[1-9][0-9]{0,15}$/.test(id) && Array.isArray(v) && v.length && v.length <= 4 && v.every(isId)) swaps[id] = v;
  const names = {};
  for (const [id, n] of Object.entries(obj(raw.names))) if (/^[1-9][0-9]{0,15}$/.test(id) && typeof n === 'string' && n && n.length <= 200) names[id] = n;
  const curves = {};
  for (const [k, v] of Object.entries(raw.curves && typeof raw.curves === 'object' ? raw.curves : {})) {
    if (k.length <= 10 && Array.isArray(v) && v.length && v.length <= 300 && v.every(x => typeof x === 'number' && x >= 0 && x <= 100)) curves[k] = v;
  }
  return { recipes, items, curves, npc, conversions, swaps, names };
}

/* One of MetaBot.GG's NPC shop pages (https://metabot.gg/en/aion-2/shops/<shop>): every row priced in Kina, as
   { href, price, faction } (faction 'elyos' | 'asmodian' | null for both). Only the release tool reads these
   (tools/make-recipes.js): the prices come with the add-on, the app never asks for them. */
const SHOPS = ['blacksmithing-shop', 'armorsmithing-shop', 'handicrafting-shop', 'alchemy-shop', 'cooking-shop', 'general-shop'];
function parseShop(html) {
  const text = flightOf(html);
  const rows = [];
  const re = /"data-k":"((?:[^"\\]|\\.){1,400})"/g;
  const starts = [];
  let m;
  while ((m = re.exec(text))) starts.push([m.index, m[1]]);
  starts.forEach(([at, k], i) => {
    const row = text.slice(at, i + 1 < starts.length ? starts[i + 1][0] : Math.min(text.length, at + 20000));
    let key;
    try { key = JSON.parse(JSON.parse('"' + k + '"')); } catch { return; }
    if (!Array.isArray(key) || !Number.isSafeInteger(key[2]) || key[2] <= 0 || key[2] > 1e9) return;
    const href = (/"href":"\/en(\/aion-2\/items\/[a-z0-9-]{1,150})"/.exec(row) || [])[1];
    // the price cell: the number, then a link to the Kina currency page (a coin or token price links elsewhere)
    const shown = /"children":\["([0-9][0-9,]{0,12})"," ",\["\$","\$L[0-9a-z]{1,6}",null,\{"href":"\/en\/aion-2\/currencies\/kina"/.exec(row);
    if (!href || !shown || Number(shown[1].replace(/,/g, '')) !== key[2]) return; // only rows plainly priced in Kina
    const side = key[4] === 'Light' || key[4] === 'Elyos' ? 'elyos' : key[4] === 'Dark' || key[4] === 'Asmodian' ? 'asmodian' : null;
    rows.push({ href, price: key[2], faction: side });
  });
  if (rows.length > 2000) throw new Error('shop page looks wrong');
  return rows;
}

/* MetaBot.GG's Substance Morph page (https://metabot.gg/en/aion-2/conversion), read by the release tool only:
   - "Gatherable Material": a gathered material turned into its bound copy (Fine Odyle -> Fine Orichalcum Ore (Bound)),
     one for one, at a crafting proficiency; a side when the row names one;
   - "Interchangeable materials": the bound copies a recipe takes in place of a material (Fine Orichalcum Ore (Bound)
     for Fine Orichalcum Ore), which a2-tracker's list calls `combine`.
   Item ids come from the page's own item links (each carries the item's id) and the recipe page's items. Returns
   { conversions: [{ product, part, profession, mastery, faction }], swaps: { id: [ids] }, names: { id: name } }. */
function parseConversions(html, raw) {
  const text = flightOf(html);
  const ids = new Map(Object.entries(raw.items).filter(([, it]) => it.href).map(([id, it]) => [it.href, Number(id)]));
  for (const [, id, href] of text.matchAll(/\["\$","\$L[0-9a-z]{1,6}","([1-9][0-9]{8})",\{"href":"\/en(\/aion-2\/items\/[a-z0-9-]{1,150})"/g)) if (!ids.has(href)) ids.set(href, Number(id));
  const body = html.split('self.__next_f')[0];
  const section = name => { const i = body.indexOf('>' + name + '</h2>'); if (i < 0) return ''; const j = body.indexOf('<h2', i + 10); return body.slice(i, j < 0 ? undefined : j); };
  const rows = s => [...s.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => ({
    text: c[1].replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(),
    links: [...c[1].matchAll(/href="\/en(\/aion-2\/items\/[a-z0-9-]{1,150})"/g)].map(l => ids.get(l[1]) || null),
  })));
  const conversions = [], names = {};
  const named = (id, text) => { const n = text.replace(/ (Elyos|Asmodian)$/, ''); if (id && n && n.length <= 200 && !raw.items[String(id)]) names[id] = n; };
  for (const r of rows(section('Gatherable Material'))) {
    if (r.length !== 3 || r[0].links.length !== 1 || r[1].links.length !== 1) continue;
    const req = /^(Blacksmithing|Handicrafting|Armorsmithing|Alchemy|Cooking) Proficiency Level ([0-9]{1,3})$/.exec(r[2].text);
    const [product] = r[0].links, [part] = r[1].links;
    if (!req || !product || !part || /[0-9]\s*×/.test(r[1].text)) continue; // one for one only: a count is not guessed
    conversions.push({ product, part, profession: req[1], mastery: Number(req[2]), faction: / Elyos$/.test(r[0].text) ? 'elyos' : / Asmodian$/.test(r[0].text) ? 'asmodian' : null });
    named(product, r[0].text);
  }
  const swaps = {};
  for (const r of rows(section('Interchangeable materials'))) {
    if (r.length !== 2 || r[0].links.length !== 1 || !r[0].links[0]) continue;
    const copies = r[1].links.filter(Boolean);
    if (copies.length && copies.length <= 4) { swaps[r[0].links[0]] = copies; if (copies.length === 1) named(copies[0], r[1].text); }
  }
  if (conversions.length > 2000 || Object.keys(swaps).length > 5000) throw new Error('conversion page looks wrong');
  return { conversions, swaps, names };
}

/* NPC prices by item id ({ id: [{ price, faction }] }) from shop rows, by the item's page link in the recipe data. */
function npcFrom(raw, rows) {
  const byHref = new Map(Object.entries(raw.items).filter(([, it]) => it.href).map(([id, it]) => [it.href, id]));
  const out = {};
  for (const r of rows) {
    const id = byHref.get(r.href);
    if (!id) continue;
    (out[id] = out[id] || []);
    if (!out[id].some(o => o.price === r.price && o.faction === r.faction)) out[id].push({ price: r.price, faction: r.faction });
  }
  return out;
}

/* "Expert's Orichalcum Boots" -> "Expert's Splendent Orichalcum Boots"; "Star Dragon Lord Boots" -> "Splendent Star …". */
function splendent(name) {
  const m = /^((?:Apprentice's|Expert's|Artisan's|Master's) )?(.*)$/.exec(name);
  return (m[1] || '') + 'Splendent ' + m[2];
}

/* The engine's shape (a2-tracker's fields) from MetaBot's data. `meta`: { fetchedAt, from: 'live' | 'shipped' }. */
function toCatalogue(raw, meta = {}) {
  const { recipes, items, curves } = raw;
  const byName = new Map();
  for (const [id, it] of Object.entries(items)) { if (!byName.has(it.name)) byName.set(it.name, []); byName.get(it.name).push(Number(id)); }
  const made = new Set(recipes.map(r => r.product));
  const outItems = {};
  for (const [id, it] of Object.entries(items)) {
    outItems[id] = { itemId: Number(id), name: it.name, icon: it.icon, grade: it.grade, category: Number(String(id)[0]) <= 3 ? 'Equip' : 'Misc', marketKind: 'items', currency: 'Kinah', page: it.href ? ORIGIN + '/en' + it.href : PAGE };
  }
  // the bound copies (from the conversion page): named, never on the Exchange
  const boundOf = new Map();
  for (const [id, copies] of Object.entries(raw.swaps || {})) for (const c of copies) if (!boundOf.has(String(c))) boundOf.set(String(c), id);
  for (const [id, name] of Object.entries(raw.names || {})) {
    if (outItems[id]) continue;
    const plain = outItems[boundOf.get(id)]; // a bound copy looks like the material it stands in for
    outItems[id] = { itemId: Number(id), name, icon: plain ? plain.icon : null, grade: plain ? plain.grade : null, category: 'Misc', marketKind: 'items', currency: 'Kinah', page: ORIGIN + '/en/aion-2/conversion' };
  }
  for (const [id, c] of Object.entries(CHESTS)) outItems[id] = { itemId: Number(id), name: c.name, icon: c.icon, grade: c.grade, category: 'Usable', marketKind: 'kina-chests', currency: null };
  const out = [];
  for (const r of recipes) {
    const s = String(r.id);
    const profession = PROFESSION[s[0]];
    const faction = s[1] === '1' || s[1] === '3' ? 'elyos' : s[1] === '2' || s[1] === '4' ? 'asmodian' : null;
    if (!profession || !faction) continue;
    const curve = r.rate && curves[r.rate];
    // which item the combo gives (see the top of the file): never a guess between more than two
    let comboItem = null;
    if (r.combo > 0 && items[String(r.product)]) {
      const all = byName.get(splendent(items[String(r.product)].name)) || [];
      const free = all.filter(id => !made.has(id)).sort((a, b) => a - b);
      if (!all.length) comboItem = profession === 'Cooking' ? r.product : null;
      else if (free.length === 1) comboItem = free[0];
      else if (free.length === 2) comboItem = faction === 'elyos' ? free[0] : free[1];
    }
    const tier = s.slice(6), slot = SLOT[s[2]], piece = PIECE[s.slice(2, 6)], transfer = !!(slot && piece && /^01[1-5]$/.test(tier));
    out.push({
      id: 'craft-' + s, sourceRecipeId: s, itemId: r.product, marketKind: 'items', outputQuantity: r.qty, outputQuantityVerified: true,
      resultEnchantLevel: null,
      ingredients: r.parts.map(([itemId, quantity]) => ({ itemId, quantity, quantityKnown: true, enchantLevel: 0, itemType: String(itemId)[0] <= '3' ? 'Equip' : 'Misc', marketKind: 'items', alternatives: [],
        combine: ((raw.swaps || {})[String(itemId)] || []).map(b => ({ itemId: b, quantity, quantityKnown: true })) })),
      // the transfer tiers (T2-T6) also take the Splendent piece of the tier before, which the page doesn't list: as in
      // a2-tracker's list they cost nothing alone, only in the Dragon Gear chain (engine.js chains), which adds it
      additionalItemReferences: [], isComboResult: false, visibleInClientUi: true, hasUnresolvedAdditionalInputs: transfer,
      method: 'craft', profession, requiredMastery: r.mastery, faction, calculable: !transfer,
      successProbability: null, successVerified: false,
      successRates: curve ? { rates: curve.map(v => Math.round(v * 1e6)), minGap: 0, scale: 1e6 } : null,
      combo: comboItem ? { itemId: comboItem, quantity: 1, probability: null, probabilityVerified: false, probabilityRaw: Math.round(r.combo * 100) } : null,
      // the client's recipe key, as a2-tracker spells it, for the Dragon Gear chains (only the transfer pieces need it)
      client: { recipeKey: slot && piece && /^(001|01[1-5])$/.test(tier) ? 'Recipe_' + KEY_NAME[profession] + '_' + (faction === 'elyos' ? 'L' : 'D') + '_' + slot + '_' + piece + '_Unique_' + tier : null },
    });
  }
  // a gathered material into its bound copy, one for one, always succeeding (a2-tracker's "convert" recipes)
  for (const c of raw.conversions || []) {
    for (const side of c.faction ? [c.faction] : ['elyos', 'asmodian']) {
      out.push({
        id: 'convert-' + c.product + '-' + side, sourceRecipeId: null, itemId: c.product, marketKind: 'items', outputQuantity: 1, outputQuantityVerified: true, resultEnchantLevel: 0,
        ingredients: [{ itemId: c.part, quantity: 1, quantityKnown: true, enchantLevel: 0, itemType: 'Misc', marketKind: 'items', alternatives: [] }],
        additionalItemReferences: [], isComboResult: false, visibleInClientUi: true, hasUnresolvedAdditionalInputs: false,
        method: 'convert', profession: c.profession, requiredMastery: c.mastery, faction: side, calculable: true,
        successProbability: null, successVerified: false, successRates: null, combo: null, client: { recipeKey: null },
      });
    }
  }
  // NPC prices (from the shop pages, with the shipped list): the engine's shape, Kina, one at a time
  const npcPrices = {};
  for (const [id, offers] of Object.entries(raw.npc && typeof raw.npc === 'object' ? raw.npc : {})) {
    if (!/^[1-9][0-9]{0,15}$/.test(id) || !Array.isArray(offers)) continue;
    const ok = offers.filter(o => o && Number.isSafeInteger(o.price) && o.price > 0 && o.price <= 1e9 && (o.faction == null || o.faction === 'elyos' || o.faction === 'asmodian')).slice(0, 4);
    if (ok.length) npcPrices[id] = ok.map(o => ({ price: o.price, bundle: 1, currency: 'GoldCombined', faction: o.faction }));
  }
  return {
    ok: true, game: 'AION2', schemaVersion: 1, locale: 'en-US', recipes: out, items: outItems, npcPrices,
    source: { name: 'MetaBot.GG', page: PAGE, from: meta.from || 'live', fetchedAt: meta.fetchedAt || null },
  };
}

module.exports = { parsePage, parseShop, parseConversions, npcFrom, toCatalogue, check, splendent, SHOPS, PAGE, ORIGIN, MAX_PAGE };
