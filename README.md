# Dragon Gear Prices

An [AION 2](https://aion2.plaync.com) add-on for [Flav-Toolkit](https://github.com/Flavbestlol/flav-toolkit): your Dragon Gear plan with the Exchange's own prices, what to buy and in which listings, the crafting steps in order, what you already own, and how many Quna packs and Kina Chests it takes. A shopping list sits over the game (through Flav-Toolkit) and ticks itself off as you buy.

By Flavbest. GPL-3.0.

## How it works

- A small local app (`app/server.js`, Node.js) serves a page at `http://127.0.0.1:7317` on your PC only. It fetches prices from [a2-tracker.com](https://a2-tracker.com) and, while you play with Flav-Toolkit, reads its local event feed (`feed.js`): the Exchange as the game itself downloads it, your bag, storage and warehouse, and who you are (name, server, class). Nothing is sent to the game or its servers.
- Alerts (`alerts.js`): any item, a price to buy or sell at, a listing count, or cheaper / pricier than usual; a Windows notification and a note on the feed with the item's picture.
- Flav-Toolkit's hub starts and stops it (`addon.json`), and shows its shopping list over the game.
- Your character's worn gear comes from the game's own login data through Flav-Toolkit (each slot's item and enchant level). Only when the game isn't being read does the app ask the official AION 2 site (on by default with the Auto switch, or with "Read my gear"): it sends the character name, server and region, then the site's own character id.

`README.txt` is the player's guide (it ships with the add-on). Flav-Toolkit's [`docs/SECURITY.md`](https://github.com/Flavbestlol/flav-toolkit/blob/main/docs/SECURITY.md) says what the whole toolkit may and may not do.

## Install

With Flav-Toolkit: put this folder at `Addons\Market Crafting\` next to the `Flav-Toolkit\` folder (the hub finds every `addon.json` there), run `tools\get-node.bat` once after a `git clone` (a release zip already has the runtime), start Flav-Toolkit. On its own: double-click `Dragon Gear Prices.bat`.

## Develop

```
node --test app/test/market.test.js app/test/inventory.test.js app/test/me.test.js app/test/alerts.test.js app/test/armory.test.js app/test/gear.test.js
```

Never commit `settings.json`, `data\`, `captures\`, a `.pcap` or a key file: they are the player's own, and `.gitignore` refuses them. Nothing personal in the code, docs or commits: public name "Flavbest" only.
