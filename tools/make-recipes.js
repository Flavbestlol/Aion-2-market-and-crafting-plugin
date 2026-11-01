'use strict';
/* Writes app/recipes-metabot.json: the recipe list that comes with the add-on, so a fresh install has one even when
   neither a2-tracker.com nor MetaBot.GG can be read. Run by whoever makes a release, before the version bump:

     node tools/make-recipes.js           asks https://metabot.gg/en/aion-2/crafting, its Substance Morph page
                                          and the six crafting/general NPC shop pages once each, two seconds apart
     node tools/make-recipes.js <folder>  reads copies saved by hand: crafting.html, conversion.html, shop-<shop>.html

   Only what app/metabot.js keeps is written (recipes, item names and icons, success curves, the NPC prices of the
   recipes' materials, conversions to bound copies and which bound copies stand in for a material), checked the same way the app checks it. MetaBot.GG's data is reused on its terms: the app and README credit it with a link to that page. */
const fs = require('fs');
const path = require('path');
const MetaBot = require('../app/metabot');

const OUT = path.join(__dirname, '..', 'app', 'recipes-metabot.json');

async function main() {
  const dir = process.argv[2];
  const UA = { 'User-Agent': 'Flav-Toolkit Dragon Gear Prices release tool (+https://flavbestlol.github.io/flav-toolkit/)', Accept: 'text/html' };
  const get = async (name, url) => {
    if (dir) return fs.readFileSync(path.join(dir, name), 'utf8');
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(url + ': HTTP ' + res.status);
    await new Promise(r => setTimeout(r, 2000));
    return res.text();
  };
  const html = await get('crafting.html', MetaBot.PAGE);
  const raw = MetaBot.parsePage(html);
  let rows = [];
  for (const shop of MetaBot.SHOPS) rows = rows.concat(MetaBot.parseShop(await get('shop-' + shop + '.html', MetaBot.ORIGIN + '/en/aion-2/shops/' + shop)));
  raw.npc = MetaBot.npcFrom(raw, rows);
  Object.assign(raw, MetaBot.parseConversions(await get('conversion.html', MetaBot.ORIGIN + '/en/aion-2/conversion'), raw));
  if (raw.conversions.length < 20 || Object.keys(raw.swaps).length < 40) throw new Error('only ' + raw.conversions.length + ' conversions and ' + Object.keys(raw.swaps).length + ' bound copies: the conversion page changed, check parseConversions');
  if (Object.keys(raw.npc).length < 20) throw new Error('only ' + Object.keys(raw.npc).length + ' NPC prices: the shop pages changed, check parseShop');
  const build = (/client \(build ([0-9.]{5,20})\)/.exec(html) || [])[1] || null;
  const cat = MetaBot.toCatalogue(raw);
  const chains = ['elyos', 'asmodian'].map(f => require('../app/engine').createEngine(cat, { faction: f }).chains(null).length);
  if (chains.some(n => n < 19)) throw new Error('only ' + chains.join(' / ') + ' Dragon Gear pieces: the page changed, check app/metabot.js');
  const out = {
    note: 'Recipe data from MetaBot.GG (https://metabot.gg/en/aion-2/crafting), read from the AION 2 Global client; reused with credit on MetaBot.GG\'s terms. Not covered by this add-on\'s GPL-3.0 licence. Game data belongs to NCSOFT.',
    source: 'MetaBot.GG', page: MetaBot.PAGE, build, fetchedAt: new Date().toISOString(), raw,
  };
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log(`${raw.recipes.length} recipes, ${Object.keys(raw.items).length} items, ${Object.keys(raw.npc).length} NPC prices, ${raw.conversions.length} conversions, ${Object.keys(raw.swaps).length} bound copies, build ${build || '?'}, Dragon Gear pieces ${chains.join(' / ')} -> ${path.relative(process.cwd(), OUT)}`);
}

main().catch(e => { console.error('make-recipes: ' + e.message); process.exit(1); });
