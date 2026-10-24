Dragon Gear Prices  (Market Crafting add-on, by Flavbest)
=========================================================

Dragon Gear Prices.bat   Double-click: (re)starts the app and opens it in your browser
                         (http://127.0.0.1:7317 - bookmark it; it only works on this PC).

In the page:
  - Your character: with Flav-Toolkit running, logging in to the game tells the app who you are
    (name, server, class, level: the game's own login record, nothing else) - nothing to type.
    Its worn gear is then read from the official AION 2 site on every refresh, the same lookup
    Flav-Toolkit's armory uses. Without Flav-Toolkit, type the name and pick the server there.
    Class: yours, as the game says, by default; click another class to plan gear for it
    ("Back to my class" returns). The overlay's settings have the same choice ("Mine · Ranger").
    Each piece says where its tier comes from: "Auto - your gear" (the default) or
    "Set by you" (you clicked another tier); "Back to Tx" returns to what you wear.
  - Click the gold bars on a piece to set the tier you own; click the card for goal and details.
  - $ / EUR / SAR at the top: the currency for every price (USD by default).
  - Shopping list button: what to buy and the crafting steps in order, one piece at a time
    (Ctrl+click to combine pieces). Tick things off. The Quna shop says how many Quna packs
    to buy and, when you opened the chests' lists in game, exactly how many of each Kina Chest
    (10M / 2M / 400k) at up to what price; otherwise the most Quna to pay per chest (a cap):
    buy the cheapest listings at or under those caps, the "start" chest first.
    Materials work the same: open an item's list in game and its row says how many to buy, up
    to what price each and in which listings (listings are bought whole, cheapest first), with
    a verdict against its usual price: pricey (wait from +25%), fair, cheap. With only the
    cheapest listing known, "cheapest -N%" speaks for that one listing only.
    What you own: when Flav-Toolkit reads your bag, storage and warehouse from the game, a line
    whose need you already hold is ticked for you ("owned"), a partly covered one says how many
    more ("have 314 of 459"), a material in hand is crossed out in the craft steps, and the Quna
    shop counts the Kina you have. Nothing to type, nothing to resync: logging in refreshes it.
    "Count what I own" (overlay settings, on by default) takes what you hold off the counts step by
    step: 158 Strong Leather with 20 in the bag reads "138x · 20 in hand". Off: full counts, what you
    have beside them. "Steps one at a time" and the compact button show just the step you are on.
    Ticking a step ticks every step before it (that is how far you are); unticking one unticks it
    and the steps after it.
    Craft or buy, rung by rung: for the Artisan item's ladder (Splendent → Expert's Splendent →
    Artisan's Splendent), the plan buys a rung ready-made when the Exchange is cheaper than
    crafting it and the rungs before it, for the whole quantity, from the item's own list when
    you opened it in game. The step then says "Bought, not crafted: 18× … · 4.3M vs 5.1M to
    craft", a crafted rung says what buying it would cost, and an hourly a2-tracker price that
    looks cheaper only earns "May be cheaper to buy" - open the item's list to let the plan decide.
  - "Show in overlay" in a piece's details sends it to the Flav-Toolkit overlay in game.
    In game, the overlay has a round helm icon by the minimap: click it to open or shrink
    the list, drag it to move it.
  - Refresh prices, Alerts (hourly check + Windows notification; starts with Windows), Settings.
  - Alerts of your own, on any item: type its name (icons help you pick), then a price to buy at,
    a price to sell at, how many are listed, or cheaper / pricier than usual by a percentage.
    Checked whenever the Exchange is seen in game and on every hourly refresh: a Windows
    notification, the dock's icon lights up with the item's picture, and the overlay's Alerts
    tab shows them (pause, resume, remove there; adding needs typing, so that is on this page).
  - In game, a key refreshes the overlay's prices like its ↻ button: Ctrl+R by default (overlay
    settings: Ctrl+Shift+R, Alt+R or Off). It only works while the list is on screen; with the
    list away the key is the game's.

settings.json            Saved automatically by the page.
data\price-log.csv       One line per piece per refresh. Opens in Excel.
data\icons-official\     Game item icons from the official AION 2 CDN, downloaded once.
data\icons\              The same game icons from a2-tracker.com, where the CDN has none.
data\fx.json             Today's exchange rates (refreshed once a day).
data\market.json         The Exchange as last seen in game (via Flav-Toolkit), item data only.
data\inventory.json      Your bag, storage and warehouse as last read from the game (via Flav-Toolkit):
                         item ids and counts only. Yours; delete it any time.
data\me.json             Who you are as the game last said it (name, server, class, level). Yours too.
The feed: the app reads Flav-Toolkit's event feed itself (feed.json in Flav-Toolkit's data folder, this PC
                         only): the Exchange, your bag, who is playing; and raises its notes there.
app\test\                node --test test\market.test.js test\inventory.test.js test\me.test.js test\alerts.test.js
                         (run with app\node\node.exe)

Prices: the Exchange itself while you play, a2-tracker.com's public data otherwise.
  Live: start the game with "Play AION 2" in Flav-Toolkit's tray menu. Flav-Toolkit reads the
  Exchange pages the game downloads and hands them to this app (POST /api/market, this PC only).
  The list then says "Exchange prices - seen N min ago": every item's cheapest listing ("live")
  from the moment the Exchange opens; an item whose list you opened is priced from its real
  ladder, the cheapest listings that cover the quantity ("exact"). Older than 45 minutes is
  ignored and a2-tracker's hourly prices take over. What was seen is kept in data\market.json
  (item ids, prices, quantities; nothing about you or other players). Flav-Toolkit never sends
  anything to the game or the Exchange: see its docs\SECURITY.md.
  Test the reader on its own: Flav-Toolkit\bin\flav.exe market --live --keys <key file>.
Money: 4,000 Quna = 44.49 EUR (fixed); USD and SAR at today's rate.
  Rates By Exchange Rate API (https://www.exchangerate-api.com), open.er-api.com, no account.
Gear: aion2.plaync.com (official), only your character name and server are sent.
Server list (app\servers.json): from Flav-Toolkit (eiruuru/aion2-char-sheet, GPL-3.0).
Class emblems and banner: made for this app with Higgsfield.
app\node\node.exe is the official Node.js runtime (nodejs.org v24.22.1).
