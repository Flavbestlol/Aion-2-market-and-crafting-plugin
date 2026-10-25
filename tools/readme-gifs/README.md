# The README's GIFs

`docs/gear.gif`, `buy.gif`, `steps.gif` and `alerts.gif` are made here, with no screen recording: the real
overlay page runs in headless Chromium over a clean game screenshot, a demo copy of this app feeds it made-up
data (a character called Sampleton, a Ranger on Fregion), and a script clicks through each feature with a drawn
cursor and captions. Re-run it whenever the overlay changes.

Nothing here talks to the game, and nothing from a real session is used.

> **To redo before the next shoot:** since 0.16.0 the overlay is this app's own `app/ui/overlay.html` (served by the
> demo app, talking to `window.flavOverlay`); the recorder still drives the core's old `shop.html` through
> `fake_host.js`. Point the stage at the demo app's page and give `fake_host.js` a `flavOverlay` instead.

## What you need

- Python 3 with Playwright (`pip install playwright`, then `playwright install chromium`), Node.js, ffmpeg.
- The overlay page: copy `crates/flav-app/ui` from [Flav-Toolkit](https://github.com/Flavbestlol/flav-toolkit)
  into `stage/ui/`.
- Fonts close to the overlay's Windows fonts in `stage/fonts/`: `barlow-semi-condensed-latin-{500,600,700}-normal.woff2`
  (`npm i @fontsource/barlow-semi-condensed`). Inter, if installed, stands in for Segoe UI.
- One or two clean game screenshots as `stage/bg1.png` and `stage/bg2.png`, 1456×818: no chat, no names, no party
  frames. They are not in the repository.
- A demo copy of this add-on in `demo/` (`app/` and `addon.json`), started once with the network on so it
  downloads its catalogue and icons into `demo/data/`.

`stage/ui`, `stage/fonts`, the backgrounds, `demo/` and `out/` stay out of git (see `.gitignore` here).

## Making them

```sh
python3 -m http.server 8766 --directory stage &   # the stage page
python3 rec.py still                              # one picture of each tab, to check the setup
python3 rec.py gear                               # then buy, steps, alerts: out/<name>.gif
./sheet.sh gear 2 7 12 18                          # four frames side by side, to look at before shipping
```

Each run starts from the same state (`reset.sh`: the settings in `demo-settings.json`, the data in `feed.py`).
`scenes.py` holds the four scripts: a caption, an action, time to see the result. The frames come from Chromium's
screencast as PNGs, so the still background stays identical from frame to frame and each GIF stays near 1 MB.
Copy the finished GIFs to `docs/`.

| File | What it is |
|---|---|
| `rec.py` | The recorder: the stage, the cursor, captions, clicks and scrolls, frames to a GIF (two ffmpeg passes) |
| `scenes.py` | One function per GIF |
| `fake_host.js` | Stands in for Flav-Toolkit's overlay window: each command goes to the demo app the way `src/shop.rs` does |
| `stage/index.html` | The background, the overlay's window, the drawn cursor and the caption |
| `feed.py` | Made-up game data posted to the demo app: who you are, your bag and worn gear, Exchange prices |
| `demo-settings.json` | The demo app's settings at the start of each GIF |
| `reset.sh`, `sheet.sh` | Restart the demo; check a GIF |
