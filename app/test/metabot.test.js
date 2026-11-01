'use strict';
/* The recipe list from MetaBot.GG (app/metabot.js) and the order the app takes its recipe list in (compute.js
   loadRecipes): a fresh install starts while a2-tracker.com refuses the app. The pages here are made up, in the shape of
   MetaBot.GG's crafting page; the list shipped with the add-on (app/recipes-metabot.json) is checked as it is. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DRAGON_GEAR_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'flav-metabot-'));
const C = require('../compute');
const MetaBot = require('../metabot');
const { createEngine } = require('../engine');

/* A made-up page: one Elyos and one Asmodian Gloves chain (six tiers each, ids as the client spells them), the Artisan's
   piece they need with its Splendent combo, a cooking recipe whose combo gives the same dish, and filler dishes. */
function props() {
  const items = {
    210540015: { name: "Artisan's Orichalcum Gloves", icon: '/web/aion2/items/icon_gm_0050_t04_gloves.webp', grade: 'Legend', href: '/aion-2/items/artisans-orichalcum-gloves' },
    210530013: { name: "Artisan's Splendent Orichalcum Gloves", grade: 'Unique' },
    210530014: { name: "Artisan's Splendent Orichalcum Gloves", grade: 'Unique' },
    610710009: { name: 'Tanned Thick Balaur Leather', grade: 'Rare' },
    610511013: { name: 'Wrathful Mind', grade: 'Unique' },
    510716008: { name: "Artisan's Fruit Salad", grade: 'Legend' },
    610610015: { name: 'Odyle', grade: 'Common' },
  };
  const recipes = [
    { id: 412054001, product: 210540015, qty: 1, mastery: 40, combo: 25, parts: [[610710009, 3]], rate: ['c1', 'c1'] },
    { id: 422054001, product: 210540015, qty: 1, mastery: 40, combo: 25, parts: [[610710009, 3]], rate: ['c1', 'c1'] },
    { id: 514085002, product: 510716008, qty: 2, mastery: 30, combo: 30, parts: [[610610015, 4]] },
  ];
  for (const [side, artisan, base] of [['1', 210530013, 210530015], ['2', 210530014, 210530115]]) {
    ['001', '011', '012', '013', '014', '015'].forEach((tier, i) => {
      const id = Number('4' + side + '2053' + tier), product = base + i * 2;
      items[product] = { name: `Test Dragon Gloves ${side} T${i + 1}`, grade: 'Unique' };
      recipes.push({ id, product, qty: 1, mastery: i ? 0 : 55, combo: 0, parts: i ? [[base + (i - 1) * 2, 1], [610511013, 1]] : [[artisan, 1], [610710009, 9], [610511013, 5]], rate: ['c1', 'c1'] });
    });
  }
  for (let i = 0; i < 60; i++) { items[510700100 + i] = { name: 'Filler dish ' + i }; recipes.push({ id: 514080100 + i, product: 510700100 + i, qty: 1, mastery: 1, combo: 0, parts: [[610610015, 1]] }); }
  return { lang: 'en', recipes, items, gather: {}, strings: {}, curves: { c1: [67.5062, 68.1982, 70, 90, 100] }, maxMastery: 100 };
}
// The page: the props as a JSON string pushed into self.__next_f, the way Next.js sends them
const page = (p = props()) => '<html><script>self.__next_f.push([1,' + JSON.stringify('1:["$","$L74",null,' + JSON.stringify(p) + ']\n') + '])</script></html>';

test('the page is read: recipes, items, curves; profession, side, piece and tier from the recipe id', () => {
  const raw = MetaBot.parsePage(page());
  assert.equal(raw.recipes.length, 3 + 12 + 60);
  const cat = MetaBot.toCatalogue(raw, { from: 'live', fetchedAt: '2026-11-01T11:00:00.000Z' });
  const r = cat.recipes.find(x => x.sourceRecipeId === '412053011');
  assert.equal(r.profession, 'Armorsmithing', 'the name the proficiency settings use');
  assert.equal(r.faction, 'elyos');
  assert.equal(r.client.recipeKey, 'Recipe_Tailoring_L_ar_Gloves_Unique_011');
  assert.equal(cat.recipes.find(x => x.sourceRecipeId === '422053001').client.recipeKey, 'Recipe_Tailoring_D_ar_Gloves_Unique_001');
  // success: the curve in percent becomes a2-tracker's scale (rate / 1,000,000 per cent)
  assert.deepEqual(r.successRates.rates.slice(0, 2), [67506200, 68198200]);
  assert.equal(cat.items['210540015'].page, 'https://metabot.gg/en/aion-2/items/artisans-orichalcum-gloves');
  assert.equal(cat.items['516130001'].marketKind, 'kina-chests', 'the Kina Chests are named');
  assert.deepEqual(cat.source, { name: 'MetaBot.GG', page: 'https://metabot.gg/en/aion-2/crafting', from: 'live', fetchedAt: '2026-11-01T11:00:00.000Z' });
});

test('a list already read reads the same again (the copy kept on disk, the shipped one)', () => {
  const once = MetaBot.parsePage(page());
  assert.deepEqual(MetaBot.check(JSON.parse(JSON.stringify(once))), once);
  const r = MetaBot.toCatalogue(MetaBot.check(once)).recipes.find(x => x.sourceRecipeId === '412053001');
  assert.ok(r.successRates && r.successRates.rates.length === 5, 'the success curve survives');
});

test('a combo gives the Splendent item on the recipe\'s side, a dish gives one more of itself, anything else no combo', () => {
  const cat = MetaBot.toCatalogue(MetaBot.parsePage(page()));
  const combo = id => (cat.recipes.find(x => x.sourceRecipeId === id).combo || {}).itemId || null;
  assert.equal(combo('412054001'), 210530013, 'Elyos: the first of the two');
  assert.equal(combo('422054001'), 210530014, 'Asmodian: the second');
  assert.equal(combo('514085002'), 510716008, 'a dish: the same dish');
  assert.equal(cat.recipes.find(x => x.sourceRecipeId === '412054001').combo.probabilityRaw, 2500);
  // three items of that name: no guess
  const p = props(); p.items[210530099] = { name: "Artisan's Splendent Orichalcum Gloves" };
  assert.equal((MetaBot.toCatalogue(MetaBot.parsePage(page(p))).recipes.find(x => x.sourceRecipeId === '412054001').combo), null);
  // an alchemy recipe without a Splendent item: no combo (its outcome isn't known)
  const q = props(); q.recipes.push({ id: 314016001, product: 610610015, qty: 1, mastery: 1, combo: 25, parts: [[610511013, 1]] });
  assert.equal(MetaBot.toCatalogue(MetaBot.parsePage(page(q))).recipes.find(x => x.sourceRecipeId === '314016001').combo, null);
});

test('the engine builds the Dragon Gear chains from it, the Artisan\'s piece with its lucky-result ladder', () => {
  const cat = MetaBot.toCatalogue(MetaBot.parsePage(page()));
  for (const [faction, artisan] of [['elyos', '210530013'], ['asmodian', '210530014']]) {
    const chains = createEngine(cat, { faction }).chains('armor');
    assert.equal(chains.length, 1);
    assert.equal(chains[0].key, 'Tailoring_Gloves');
    assert.equal(chains[0].tiers.length, 6);
    assert.equal(chains[0].tiers[0].artisan.itemId, artisan);
    assert.ok(chains[0].tiers[0].artisan.ladder, 'crafting the Artisan\'s piece until Splendent');
  }
});

test('a page that isn\'t the recipe page, or is too large, or looks wrong, is refused whole', () => {
  assert.throws(() => MetaBot.parsePage(''), /empty/);
  assert.throws(() => MetaBot.parsePage('<html>hello</html>'), /no recipe data/);
  assert.throws(() => MetaBot.parsePage('x'.repeat(MetaBot.MAX_PAGE + 1)), /too large/);
  const few = props(); few.recipes = few.recipes.slice(0, 10);
  assert.throws(() => MetaBot.parsePage(page(few)), /count looks wrong/);
  // bad rows are dropped, not half-read: a negative quantity, an unknown profession digit, a broken part
  const bad = props();
  bad.recipes.push({ id: 412053099, product: 1, qty: -1, parts: [[1, 1]] }, { id: 912053001, product: 2, qty: 1, parts: [[1, 1]] }, { id: 412053098, product: 3, qty: 1, parts: [[1]] });
  assert.equal(MetaBot.parsePage(page(bad)).recipes.length, 75);
  // an item name or icon path out of shape is not kept
  const odd = props(); odd.items[1234] = { name: 'x'.repeat(201) }; odd.items[1235] = { name: 'Ok', icon: '/../../etc/passwd' };
  const raw = MetaBot.parsePage(page(odd));
  assert.equal(raw.items['1234'], undefined);
  assert.equal(raw.items['1235'].icon, null);
});

/* The release tool's pages, made up in MetaBot.GG's shape: a shop's rows, and the Substance Morph page's two tables. */
const kinaCell = n => '["$","td","2",{"children":["$","span","p0",{"children":[["$","span","0",{"children":[false,["$","span",null,{"children":["' + n + '"," ",["$","$L66",null,{"href":"/en/aion-2/currencies/kina","prefetch":false,"children":"Kina"}]]}]]}]]}]}]';
const shopRow = (key, slug, cell) => '["$","tr","0",{"data-k":' + JSON.stringify(JSON.stringify(key)) + ',"children":[["$","th","0",{"children":["$","$L66","n0",{"href":"/en/aion-2/items/' + slug + '"}]}],' + cell + ']}]';
const flightPage = (text, before = '') => '<html>' + before + '<script>self.__next_f.push([1,' + JSON.stringify(text) + '])</script></html>';

test('a shop page gives the NPC prices in Kina, by the item\'s page link, with the side when it has one', () => {
  const p = props(); p.items[610511013].href = '/aion-2/items/wrathful-mind'; p.items[610610015].href = '/aion-2/items/odyle';
  const raw = MetaBot.parsePage(page(p));
  const html = flightPage('1:[' + [
    shopRow(['Wrathful Mind', 0, 400, null], 'wrathful-mind', kinaCell('400')),
    shopRow(['Odyle', 0, 880, null, 'Dark'], 'odyle', kinaCell('880')),
    shopRow(['Coin thing', 0, 5, null], 'odyle', '["$","td","2",{"children":["5"," ",["$","$L66",null,{"href":"/en/aion-2/currencies/oath-coin"}]]}]'),
  ].join(',') + ']\n');
  const rows = MetaBot.parseShop(html);
  assert.deepEqual(rows, [{ href: '/aion-2/items/wrathful-mind', price: 400, faction: null }, { href: '/aion-2/items/odyle', price: 880, faction: 'asmodian' }], 'a coin price is not a Kina price');
  const npc = MetaBot.npcFrom(raw, rows);
  assert.deepEqual(npc, { 610511013: [{ price: 400, faction: null }], 610610015: [{ price: 880, faction: 'asmodian' }] });
  const cat = MetaBot.toCatalogue(MetaBot.check({ ...raw, npc }));
  assert.deepEqual(cat.npcPrices['610511013'], [{ price: 400, bundle: 1, currency: 'GoldCombined', faction: null }]);
});

test('the Substance Morph page gives conversions to bound copies and which copies stand in for a material', () => {
  const p = props(); p.items[610710009].href = '/aion-2/items/tanned-thick-balaur-leather'; p.items[610610015].href = '/aion-2/items/odyle';
  const raw = MetaBot.parsePage(page(p));
  const link = (slug, name) => '<a href="/en/aion-2/items/' + slug + '">' + name + '</a>';
  const ssr = '<h2 class="x">Gatherable Material</h2><table><tr><th>Result</th><th>Materials</th><th>Acquisition Requirements</th></tr>' +
    '<tr><th>' + link('tanned-thick-balaur-leather-bound', 'Tanned Thick Balaur Leather (Bound)') + '<span>Elyos</span></th><td>' + link('odyle', 'Odyle') + '</td><td>Armorsmithing Proficiency Level 30</td></tr>' +
    '<tr><th>' + link('tanned-thick-balaur-leather-bound', 'Tanned Thick Balaur Leather (Bound)') + '</th><td>' + link('odyle', '3×Odyle') + '</td><td>Armorsmithing Proficiency Level 30</td></tr></table>' +
    '<h2>Interchangeable materials</h2><table><tr><th>Material</th><th>Interchangeable copies</th></tr>' +
    '<tr><th>' + link('tanned-thick-balaur-leather', 'Tanned Thick Balaur Leather') + '</th><td>' + link('tanned-thick-balaur-leather-bound', 'Tanned Thick Balaur Leather (Bound)') + '</td></tr></table><h2>Decor</h2>';
  const html = flightPage('2:["$","$L64","630710009",{"href":"/en/aion-2/items/tanned-thick-balaur-leather-bound"}]\n', ssr);
  const cv = MetaBot.parseConversions(html, raw);
  assert.deepEqual(cv.conversions, [{ product: 630710009, part: 610610015, profession: 'Armorsmithing', mastery: 30, faction: 'elyos' }], 'three for one is not guessed as one');
  assert.deepEqual(cv.swaps, { 610710009: [630710009] });
  assert.equal(cv.names[630710009], 'Tanned Thick Balaur Leather (Bound)');
  const cat = MetaBot.toCatalogue(MetaBot.check({ ...raw, ...cv }));
  const conv = cat.recipes.filter(r => r.method === 'convert');
  assert.deepEqual(conv.map(r => [r.itemId, r.faction, r.profession, r.requiredMastery]), [[630710009, 'elyos', 'Armorsmithing', 30]]);
  const leather = cat.recipes.find(r => r.sourceRecipeId === '412053001').ingredients.find(i => i.itemId === 610710009);
  assert.deepEqual(leather.combine, [{ itemId: 630710009, quantity: 9, quantityKnown: true }]);
  assert.equal(cat.items['630710009'].name, 'Tanned Thick Balaur Leather (Bound)');
});

test('the list shipped with the add-on reads, credits MetaBot.GG and has every Dragon Gear piece on both sides', () => {
  const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'recipes-metabot.json'), 'utf8'));
  assert.equal(shipped.source, 'MetaBot.GG');
  assert.equal(shipped.page, 'https://metabot.gg/en/aion-2/crafting');
  assert.match(shipped.note, /MetaBot\.GG.*credit/);
  assert.ok(Date.parse(shipped.fetchedAt) > Date.parse('2026-11-01'));
  const cat = MetaBot.toCatalogue(MetaBot.check(shipped.raw), { from: 'shipped', fetchedAt: shipped.fetchedAt });
  for (const faction of ['elyos', 'asmodian']) assert.equal(createEngine(cat, { faction }).chains(null).length, 19, faction);
  assert.ok(cat.recipes.filter(r => r.successRates).length >= 300, 'success curves');
  assert.ok(Object.keys(cat.npcPrices).length >= 20, 'NPC prices for the materials shops sell');
  assert.equal(cat.npcPrices['630541001'][0].price, 400, 'Orichalcum Solvent: 400 Kina at the Blacksmithing Shop');
  assert.ok(cat.recipes.filter(r => r.method === 'convert').length >= 40, 'conversions to bound copies');
  assert.equal(cat.items['630620002'].name, 'Fine Orichalcum Ore (Bound)');
});

test('every web address the app asks is a host addon.json declares', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'addon.json'), 'utf8'));
  const allowed = new Set(m.permissions.network);
  const hosts = new Set();
  for (const f of fs.readdirSync(path.join(__dirname, '..')).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    for (const [, host] of src.matchAll(/'https:\/\/([a-z0-9.-]+)[/']/g)) hosts.add(host);
  }
  hosts.delete('flavbestlol.github.io'); // the User-Agent names the download page; nothing is asked of it
  for (const h of hosts) assert.ok(allowed.has(h) || [...allowed].some(a => h.endsWith('.' + a)), h + ' is not in permissions.network');
  assert.ok(hosts.has('metabot.gg'));
});

/* The order: a2-tracker (fresh or its copy under 14 days), MetaBot.GG (once a day), then the newest left. */
const catFile = path.join(C.DATA, 'catalogue.json'), mbFile = path.join(C.DATA, 'metabot.json');
const settings = { server: 1304, faction: 'elyos', history_days: 7, alerts_list: [], proficiency: {} };
let calls = [];
function net({ a2t = 'refuse', metabot = 'offline' } = {}) {
  calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url); calls.push(u);
    if (u.startsWith('https://a2-tracker.com/')) {
      if (a2t === 'refuse') return new Response(JSON.stringify({ ok: false, error: 'access_restricted' }), { status: 403 });
      if (u.includes('quotes=1')) return new Response(JSON.stringify({ ok: true, quotes: [] }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, items: { 1: { name: 'A' } }, recipes: [] }), { status: 200 });
    }
    if (u === 'https://metabot.gg/en/aion-2/crafting' && metabot === 'page') return new Response(page(), { status: 200, headers: { 'content-type': 'text/html' } });
    throw new Error('offline');
  };
}
const asked = host => calls.filter(u => u.startsWith('https://' + host + '/')).length;
const reset = () => { for (const f of [catFile, mbFile, path.join(C.DATA, 'tracker.json')]) fs.rmSync(f, { force: true }); };

test('a fresh install while a2-tracker refuses: MetaBot.GG\'s page, kept, and not asked again the same day', async () => {
  reset();
  net({ metabot: 'page' });
  let data = await C.fetchAll(settings, () => {});
  assert.equal(data.catalogue.source.name, 'MetaBot.GG');
  assert.equal(data.catalogue.source.from, 'live');
  assert.equal(data.tracker.state, 'refused');
  assert.ok(fs.existsSync(mbFile));
  net({ metabot: 'page' });
  data = await C.fetchAll(settings, () => {});
  assert.equal(asked('metabot.gg'), 0, 'its copy is used for a day');
  assert.equal(asked('a2-tracker.com'), 0, 'and a2-tracker is left alone while its refusal stands');
  assert.equal(data.catalogue.source.from, 'kept');
});

test('neither answers on a fresh install: the list that came with the add-on', async () => {
  reset();
  net();
  const data = await C.fetchAll(settings, () => {});
  assert.equal(data.catalogue.source.from, 'shipped');
  assert.equal(asked('metabot.gg'), 1);
});

test('a2-tracker\'s copy under 14 days is kept before MetaBot.GG; an older one gives way to it', async () => {
  reset();
  fs.writeFileSync(catFile, JSON.stringify({ ok: true, items: { 1: { name: 'A' } }, recipes: [] }));
  C.Tracker.refused('HTTP 403 access_restricted');
  net({ metabot: 'page' });
  let data = await C.fetchAll(settings, () => {});
  assert.equal(data.catalogue.source.name, 'a2-tracker.com');
  assert.equal(asked('metabot.gg'), 0);
  const old = new Date(Date.now() - 15 * 86400000);
  fs.utimesSync(catFile, old, old);
  net({ metabot: 'page' });
  data = await C.fetchAll(settings, () => {});
  assert.equal(data.catalogue.source.name, 'MetaBot.GG');
});

test('a2-tracker answering again gives its list back, fresh', async () => {
  reset();
  net({ a2t: 'answer' });
  const data = await C.fetchAll(settings, () => {});
  assert.equal(data.catalogue.source.name, 'a2-tracker.com');
  assert.equal(data.catalogue.source.from, 'live');
  assert.equal(asked('metabot.gg'), 0);
});
