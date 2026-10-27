// Dragon Gear over the game: your gear with what each piece costs (click a bar to set the tier you own),
// the shopping list for the pieces you pick with the Quna shop (which Kina Chests to buy), and the crafting
// steps with each step's cost. The Dragon Gear Prices app on this PC works it all out and keeps the plan,
// the currency and the ticks; this page only shows them. Every name and number goes in as text, never as markup.
//
// The app serves this page (overlay.html) and Flav-Toolkit shows it over the game in a window the core owns
// (`overlays` in addon.json). The page talks to the app that served it (its own /api) and to the core only through
// `window.flavOverlay` (what is solid, moving, its height, one line to the clipboard, typing in a field, hiding).
// Opened in a plain browser it still works, without those.

(() => {
  const $ = (id) => document.getElementById(id);
  // Flav-Toolkit's bridge for this window, when it is shown over the game
  const ov = () => window.flavOverlay || null;
  // the app that served this page; a 409 means it is still reading prices
  const api = async (path, opts) => {
    let r;
    try { r = await fetch(path, { cache: "no-store", ...opts }); } catch { throw "offline"; }
    if (r.status === 409) throw "loading";
    if (!r.ok) throw `the app answered ${r.status}`;
    return r.json();
  };
  const get = (path) => api(path, { headers: { accept: "application/json" } });
  const post = (path, body) => api(path, { method: "POST", headers: { "content-type": "application/json", "x-flav": "1" }, body: JSON.stringify(body || {}) });
  const typingTo = (on) => { const o = ov(); if (o) o.typing(on).catch(() => {}); };
  const TIER = ["", "True", "Splendent True", "White", "Splendent White", "Wise", "Splendent Wise"];
  const QUNA = "/icon/quna";
  const KINA = "/icon/930100031";

  let G = null; // gear: one row per slot
  let L = null; // shopping list for the pieces chosen
  let view = localStorage.getItem("shop-view") || "gear";
  let settingsOpen = false; // the ⚙ panel
  let barSets = "stop"; // what a click on a gear bar sets: where the piece stops ("stop") or the tier owned ("own")
  const opened = new Set(); // steps opened for their details
  let folded = localStorage.getItem("shop-folded") === "1";
  document.body.classList.toggle("folded", folded);
  // the most height the window may take (set with the grip, kept in this window's storage); the content decides the rest
  let cap = (() => { try { const v = Number(localStorage.getItem("cap")); return Number.isFinite(v) && v >= 120 ? v : 560; } catch { return 560; } })();
  // which way the list faces: its title, buttons and grip sit toward the middle of the screen. Auto = the half
  // it sits in (a per-screen preference, kept in this window's storage)
  const faces = () => { try { return localStorage.getItem("faces") || "auto"; } catch { return "auto"; } };
  // Size: the whole list larger or smaller (text, pictures, buttons), kept in this window's storage. The window grows
  // and shrinks with it: its width by the same ratio, its height by what the content then needs.
  const SIZES = [[0.9, "90%"], [1, "100%"], [1.15, "115%"], [1.3, "130%"], [1.5, "150%"]];
  const sizeNow = () => { try { const v = Number(localStorage.getItem("size")); return SIZES.some(([z]) => z === v) ? v : 1; } catch { return 1; } };
  let Z = sizeNow();
  document.documentElement.style.zoom = String(Z);
  // Update by itself: redraw when the bag changes or the game shows Exchange prices (nothing is downloaded for it)
  const autoOn = () => { try { return localStorage.getItem("auto") !== "0"; } catch { return true; } };
  let sideSeen = "right"; // the half of the screen the window is in
  const applySide = () => {
    const side = faces() === "auto" ? sideSeen : faces();
    document.body.classList.toggle("side-left", side === "left");
    document.body.classList.toggle("side-right", side !== "left");
  };
  // Where the window is, from the page itself (the window's screen position and the screen it is on)
  const detectSide = () => {
    try {
      const left = Number(window.screen.availLeft ?? window.screen.left ?? 0), w = Number(window.screen.width) || 0;
      if (!w || !Number.isFinite(window.screenX)) return;
      sideSeen = window.screenX - left + window.innerWidth / 2 < w / 2 ? "left" : "right";
      applySide();
    } catch { /* fine */ }
  };

  // ---- helpers -----------------------------------------------------------
  const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  };
  const fmt = (v, d = 0) => (v == null || !isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  // a unit price: exact below 10,000 (kfmt would turn 1,190 into "1k"), shortened above
  const pfmt = (v) => (v == null ? "—" : v < 1e4 ? fmt(v) : kfmt(v));
  const kfmt = (v) => (v == null ? "—" : v >= 1e9 ? `${fmt(v / 1e9, 2)}B` : v >= 1e6 ? `${fmt(v / 1e6, v >= 1e8 ? 0 : 1)}M` : v >= 1e3 ? `${fmt(v / 1e3, 0)}k` : fmt(v));
  const cnt = (v) => (v >= 10 || Math.abs(v - Math.round(v)) < 0.05 ? fmt(v) : fmt(v, 1));
  // Money in the currency picked in the app ($, € or SAR).
  const cur = () => G?.cur || L?.money || { sym: "$", before: true };
  const cash = (v, d) => {
    if (v == null || !isFinite(v)) return "—";
    const c = cur(), n = fmt(v, d ?? (Math.abs(v) < 100 ? 2 : 0));
    return c.before ? `${c.sym}${n}` : `${n} ${c.sym}`;
  };
  const toMoney = (k) => (L?.money?.perKina ? k * L.money.perKina : null);
  // Kina first (what you pay in game); real money small beside it.
  const kina = (v) => [h("b", { text: kfmt(v) }), h("small", { text: " Kina" })];
  const side = (v) => h("small", { class: "usd", text: ` · ${cash(v)}` });
  // The amount as a big number with a small currency mark ("$" before, "SAR" after).
  const money = (v, d) => {
    const c = cur(), n = v == null || !isFinite(v) ? "—" : fmt(v, d ?? (Math.abs(v) < 100 ? 2 : 0));
    return c.before ? [h("small", { class: "pre", text: c.sym }), h("b", { text: n })] : [h("b", { text: n }), h("small", { text: c.sym })];
  };
  // Icons: the game's, kept on this PC by the Dragon Gear app (or the official site's, for worn items).
  const pic = (src, cls = "pic") => {
    const img = src ? h("img", { src, alt: "" }) : null;
    if (img) { img.addEventListener("error", () => { img.style.visibility = "hidden"; }); img.addEventListener("load", () => scheduleFit()); }
    return h("span", { class: cls }, img);
  };
  const b = (text) => h("b", { text });
  const ago = (iso) => {
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    return !iso ? "" : m < 1 ? "just now" : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
  };
  // An item's name to the clipboard, to paste into the Exchange's search.
  let toastT = null;
  const toast = (text) => {
    const t = $("toast");
    t.textContent = text;
    t.classList.add("on");
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove("on"), 1600);
  };
  const copy = (text) => (ov() ? ov().copy(text) : navigator.clipboard.writeText(text)).then(() => toast(`Copied: ${text}`)).catch(() => toast("Couldn't copy"));
  const copyable = (text, cls = "cp-name") => h("span", { class: cls, title: "Click to copy, then paste it in the Exchange search", text, onclick: (e) => { e.stopPropagation(); copy(text); } });
  const chestFull = (kina) => `Kina Chest: ${fmt(kina)} Kina`; // the name the Exchange uses
  const chestName = (kina) => (kina >= 1e6 ? `${fmt(kina / 1e6)}M` : `${fmt(kina / 1e3)}k`);
  const LABEL = { cheap: "Cheap now", pricey: "Pricey now", normal: "Normal", unknown: "No data", done: "Done" };

  // ---- data ----------------------------------------------------------------
  async function load() {
    try {
      [G, L] = await Promise.all([get("/api/gear"), get("/api/shopping").catch(() => null)]);
      render();
    } catch (e) {
      G = L = null;
      message(String(e));
    }
  }
  // A redraw nobody pressed: waits while the player types, drags the chips or has ⚙ open, and keeps the list where
  // it was scrolled. Several changes in a row make one redraw.
  let quietT = null;
  function quietLoad() {
    clearTimeout(quietT);
    quietT = setTimeout(async () => {
      if (!G || G.busy) return; // a download under way reloads at its end anyway
      if (typing || drag || settingsOpen) { quietLoad(); return; }
      const top = $("list").scrollTop;
      try { [G, L] = await Promise.all([get("/api/gear"), get("/api/shopping").catch(() => L)]); } catch { return; }
      render();
      $("list").scrollTop = top;
    }, 400);
  }
  async function change(c) {
    try {
      const r = await post("/api/shop", c);
      if (c.plan || c.goal_all != null || c.refresh || c.currency || c.class || c.auto_sync != null || c.use_inventory != null) [G, L] = await Promise.all([get("/api/gear"), get("/api/shopping").catch(() => null)]);
      else L = r;
      render();
    } catch (e) {
      message(String(e));
    }
  }
  function message(err) {
    $("sub").textContent = "";
    for (const id of ["sum", "chips"]) $(id).replaceChildren();
    const text = err === "loading"
      ? [h("span", { text: "Reading prices…" })]
      : [h("span", { text: "Dragon Gear Prices isn't answering. Start it again from Flav-Toolkit's hub." })];
    $("list").replaceChildren(h("div", { class: "msg" }, ...text));
    // nothing is downloading as far as this page knows: no spinning ↻; ask again in a moment (the app may be starting)
    $("reload").classList.remove("spin");
    clearTimeout(message.retry);
    message.retry = setTimeout(() => { if (!G) load(); }, 3000);
    scheduleFit();
  }

  // ---- render -------------------------------------------------------------
  function render() {
    hideTip(); // the bar under the mouse is about to be redrawn
    if (!G) return message("offline");
    if (folded) view = "steps";
    $("mini").hidden = !folded;
    // who: the official site's read of the character when there is one, else what the game said at login
    const c = G.character || G.me;
    const planned = G.class_mode === "manual" && G.class && c && G.class !== c.className ? ` · gear for a ${G.class}` : "";
    $("sub").replaceChildren(...(c ? [b(c.name), h("span", { text: ` · ${c.className || "class unknown"}${c.gearScore != null ? ` · GS ${fmt(c.gearScore)}` : ""}${planned} · ` })] : []), h("span", { text: G.busy ? `${G.busy.auto ? "Hourly update · " : ""}${G.busy.step}…` : `prices ${ago(G.at)}` }));
    $("reload").classList.toggle("spin", !!G.busy);
    const i = ["gear", "buy", "steps", "alerts"].indexOf(view);
    $("tabs").style.setProperty("--i", i);
    for (const t of document.querySelectorAll(".tabs button")) t.setAttribute("aria-selected", String(t.dataset.v === view));
    let done = 0, all = 0;
    const ticks = L?.ticks || {};
    const tick = (k, inHandAlready = false) => { all++; const on = inHandAlready || !!ticks[k]; if (on) done++; return on; }; // a step whose item is all in hand is done
    const rows = [];
    $("set").classList.toggle("on", settingsOpen);
    document.body.classList.toggle("setting", settingsOpen);

    if (settingsOpen) {
      $("sum").replaceChildren(h("span", { class: "big set-t", text: "Settings" }));
      $("chips").replaceChildren();
      if (folded) rows.push(h("div", { class: "onehead" }, h("div", { class: "oh" }, h("div", { class: "lbl", text: "Settings" }), h("div", { class: "t", text: "Dragon Gear" }))));
      rows.push(...settingsRows());
    } else if (view === "gear") {
      $("sum").replaceChildren(h("span", { text: "Plan" }), h("span", { class: "big" }, ...kina(G.total.kina)), h("span", { class: "r", text: `${G.total.n} pieces · ${cash(G.total.money, 0)}` }));
      $("chips").replaceChildren();
      const titles = { weapon: "Weapons", armor: "Armor", accessory: "Accessories" };
      let last = null;
      if (G.slots.length) rows.push(goalBar());
      for (const s of G.slots) {
        if (s.group !== last) { last = s.group; rows.push(h("div", { class: "group", text: titles[last] })); }
        rows.push(gearRow(s));
      }
    } else if (L && L.pieces) {
      const sel = L.sel || [];
      const chips = [];
      if (L.pieces.length > 1) {
        chips.push(h("button", { type: "button", class: `chip all${sel.length === L.pieces.length ? " on" : ""}`, text: `All ${L.pieces.length}`,
          onclick: () => change({ sel: sel.length === L.pieces.length ? [L.pieces[0].slot] : L.pieces.map((p) => p.slot) }) }));
      }
      for (const p of L.pieces) {
        chips.push(h("button", { type: "button", class: `chip${sel.includes(p.slot) ? " on" : ""}`, title: `${p.item} · ${cash(toMoney(p.kina))}`,
          onclick: (e) => change({ sel: e.ctrlKey || e.shiftKey ? (sel.includes(p.slot) ? sel.filter((x) => x !== p.slot) : [...sel, p.slot]) : [p.slot] }) },
          pic(p.icon, ""), h("span", { text: p.label })));
      }
      $("chips").replaceChildren(...chips);
      requestAnimationFrame(() => { $("chips").querySelector(".chip.on:not(.all)")?.scrollIntoView({ inline: "nearest", block: "nearest" }); arrows(); });
      const ch = L.chosen;
      $("sum").replaceChildren(h("span", { text: ch.length === 1 ? `${ch[0].label} · T${ch[0].have} → T${ch[0].goal}` : `${ch.length} pieces` }),
        h("span", { class: "r" }, b(`${kfmt(L.totalKina)} Kina`), side(toMoney(L.totalKina))));
      $("src").replaceChildren(...priceSource(L.market), ...inventorySource(L.inventory));

      const k = L.kina;
      const kk = k && k.need ? `k:${Math.round(k.need / 1e6)}` : null;
      if (view === "alerts") {
        // The player's own alerts (set in the full app, where typing is possible): paused or removed from here.
        $("chips").replaceChildren();
        $("sum").replaceChildren(h("span", { text: "Alerts" }), h("span", { class: "big", text: String((L.alerts || []).length) }), h("span", { class: "r", text: "live, and hourly" }));
        $("src").replaceChildren();
        rows.push(alertForm());
        if ((L.alerts || []).length) rows.push(h("div", { class: "group", text: "Your alerts" }));
        for (const r of (L.alertsRecent || []).slice(0, 3)) rows.push(h("div", { class: "alrecent" }, b(r.title), h("span", { text: ` · ${r.text}` })));
        for (const a of L.alerts || []) {
          const n = a.now || {};
          const value = ["below", "above"].includes(a.kind) ? `${kfmt(a.value)} Kina` : ["cheaper", "pricier"].includes(a.kind) ? `${a.value} %` : `${fmt(a.value)} listed`;
          const now = [n.price != null ? `now ${kfmt(n.price)}${n.source === "tracker" ? " (a2-tracker)" : ""}` : "no price seen", n.listed != null ? `${fmt(n.listed)} listed` : null, n.usual ? `usual ${kfmt(n.usual)}${n.pct != null ? ` (${n.pct > 0 ? "+" : ""}${fmt(n.pct, 0)} %)` : ""}` : null].filter(Boolean).join(" · ");
          rows.push(h("div", { class: `al${a.on ? "" : " off"}` }, pic(a.icon, "pic sm"),
            h("div", { class: "mid" }, h("div", { class: "nm", text: a.name }), h("div", { class: "cd" }, h("span", { text: `${a.words} ` }), b(value)), h("div", { class: "nw", text: now })),
            h("span", { class: `st${a.on && a.met ? " now" : ""}`, text: !a.on ? "paused" : a.met ? "now" : "armed" }),
            h("button", { type: "button", class: "ab", title: a.on ? "Pause" : "Resume", text: a.on ? "⏸" : "▶", onclick: () => change({ alert_toggle: a.id }) }),
            h("button", { type: "button", class: "ab x", title: "Remove", text: "✕", onclick: () => change({ alert_remove: a.id }) })));
        }
        if (!(L.alerts || []).length) rows.push(h("div", { class: "msg" }, h("span", { text: "No alerts yet. Type an item above: " }), b("Refining Stone"), h("span", { text: " under 3k to buy, or " }), b("Splendent Yggdrasil Bow"), h("span", { text: " 20 % pricier than usual to sell." })));
      } else if (view === "buy") {
        { const w = priceWarning(); if (w) rows.push(w); const mc = marketCheck(L.chosen); if (mc) rows.push(mc); }
        if (k) rows.push(qunaShop(k, kk ? tick(kk) : false, kk));
        for (const it of L.buy) {
          const key = `b:${it.id}:${it.qty}`;
          // owned: the game says the bag, storage and warehouse already hold what the plan needs; no tick needed
          const on = it.owned || tick(key);
          rows.push(h("div", { class: `row${on ? " done" : ""}${it.owned ? " owned" : ""}`, onclick: () => { if (!it.owned) change({ tick: key }); } },
            h("span", { class: "ck" }), pic(it.icon, "pic sm"),
            h("div", { class: "mid" }, h("div", { class: "nm" }, copyable(it.name)),
              h("div", { class: "sb" }, h("span", { text: `${it.npc ? "NPC · " : ""}${pfmt(it.unit)} each` }), liveTag(it), verdictTag(it.plan), shortTag(it), haveTag(it)),
              planLine(it)),
            h("div", { class: "rt" }, it.owned ? h("span", { class: "okc big", text: "✓ covered" }) : b(it.have && it.have.total > 0 ? `×${fmt(it.missing)} more` : `×${fmt(it.qty)}`),
              h("small", { text: it.owned ? `needed ${fmt(it.qty)} · in hand ${fmt(it.have.total)}` : `${kfmt(it.cost)} Kina · ${cash(toMoney(it.cost))}` }))));
        }
      } else if (oneStep() || folded) {
        renderOneStep(rows, ticks, k, kk);
      } else {
        // Steps: one card per step, the item it makes in a round frame, a line down to the next step.
        { const w = priceWarning(); if (w) rows.push(w); const mc = marketCheck(ch); if (mc) rows.push(mc); }
        if (kk) {
          const on = tick(kk);
          rows.push(stepCard({ key: kk, no: "0", on, icon: QUNA, k0: true, last: true,
            title: [h("span", { text: "Get your Kina" })],
            meta: `${k.packs} Quna pack${k.packs === 1 ? "" : "s"} · ${cash(k.money)}, then ${k.exact ? "these Kina Chests:" : "Kina Chests at or under:"}`,
            ins: capChips(k),
            cost: null, details: () => kinaDetails(k) }));
        }
        for (const p of ch) {
          const total = p.steps.reduce((t, s) => t + s.cost, 0);
          rows.push(h("div", { class: "piece" }, pic(p.icon),
            h("div", { class: "mid" }, h("div", { text: p.label }), h("div", { class: "sb", text: `T${p.have} → T${p.goal} · ${p.steps.length} steps` })),
            h("div", { class: "rt" }, h("div", {}, ...kina(total)), h("small", { class: "usd", text: cash(toMoney(total), 0) }))));
          let run = 0;
          p.steps.forEach((st, n) => {
            run += st.cost;
            const key = stepKey(p, n);
            const on = tick(key, !!st.covered);
            rows.push(stepCard({ key, no: String(n + 1), on, icon: st.icon, tier: st.tier, last: n === p.steps.length - 1,
              title: stepTitle(st), meta: stepMeta(st), cob: craftOrBuy(st), ins: inputs(st.covered ? [] : st.rows), details: () => stepDetails(st),
              cost: [h("span", {}, h("span", { text: "This step " }), b(`${kfmt(st.cost)} Kina`), side(toMoney(st.cost))), h("span", { text: `so far ${kfmt(run)} Kina` })] }));
          });
        }
      }
    }
    if (folded) $("chips").replaceChildren();
    const list = $("list"), scroll = list.scrollTop;
    const focused = aform && aform.contains(document.activeElement) ? document.activeElement : null;
    list.replaceChildren(...rows);
    list.scrollTop = scroll;
    if (focused && aform.isConnected) focused.focus(); else if (typing && !(aform && aform.isConnected)) typeOff(true);
    $("prog").style.width = all ? `${(done / all) * 100}%` : "0";
    $("mset").classList.toggle("on", settingsOpen);
    scheduleFit();
  }

  // Where the plan stops: one tier for every piece ("All gear to T2"), or each piece its own (a click on its bars), and
  // what a click on a bar sets: where that piece stops (the usual: what you own comes from the game) or what you own.
  function goalBar() {
    const same = G.slots.every((s) => s.goal === G.slots[0].goal) ? G.slots[0].goal : null;
    const mode = (v, t, tip) => h("button", { type: "button", class: barSets === v ? "on" : "", title: tip, text: t, onclick: () => { if (barSets !== v) { barSets = v; render(); } } });
    return h("div", { class: "goals" },
      h("div", { class: "gl" }, h("b", { text: "All gear to" }),
        h("div", { class: "seg" }, ...[1, 2, 3, 4, 5, 6].map((t) => h("button", { type: "button", class: same === t ? "on" : "", text: `T${t}`,
          title: `Every piece stops at T${t}: what to buy and craft is only what takes it from the tier you own to T${t}. A piece you already own at T${t} or above has nothing to craft`,
          onclick: () => { if (same !== t) change({ goal_all: t }); } })))),
      h("div", { class: "gl sub" }, h("small", { text: same ? "or one piece at a time: a click on its bars" : "each piece stops where its gold bars end" }),
        h("div", { class: "seg sm" }, mode("stop", "Stop here", "A click on a bar sets where that piece stops"), mode("own", "I own", "A click on a bar sets the tier you own (the game sets it by itself when Flav-Toolkit reads it)"))));
  }

  // One gear slot: the tier bars, what you wear, where the tier came from (your gear or set by you), the cost.
  function gearRow(s) {
    const done = s.kind === "done";
    const bars = s.tiers.map((t) => {
      const el = h("i", { class: `${t.tier <= s.have ? "own" : t.tier <= s.goal && !s.skip ? "go" : ""}${t.tier === s.worn ? " worn" : ""}${t.tier === s.goal && s.goal < 6 ? " stop" : ""}` });
      el.addEventListener("mouseenter", () => showTip(el, s, t));
      el.addEventListener("mouseleave", hideTip);
      el.addEventListener("click", (e) => {
        e.stopPropagation(); hideTip();
        if (barSets === "stop") { if (t.tier !== s.goal) change({ plan: { slot: s.slot, goal: t.tier } }); }
        else change({ plan: { slot: s.slot, have: s.have === t.tier ? t.tier - 1 : t.tier } });
      });
      return el;
    });
    let src = null;
    if (s.wear && !s.skip) {
      src = s.auto
        ? h("span", { class: "src auto", title: "Read from your character; it updates by itself when you wear something new", text: "auto" })
        : h("span", { class: "src you", title: `You set T${s.have} by hand; you wear T${s.worn}. It stays until you wear something new.`, text: "set by you" });
    }
    const back = s.wear && !s.skip && !s.auto
      ? h("button", { type: "button", class: "back", title: `Back to the tier you wear (T${s.worn})`, text: "↺", onclick: (e) => { e.stopPropagation(); change({ plan: { slot: s.slot, have: s.worn } }); } })
      : null;
    const wear = s.wear ? h("div", { class: "wear" }, src, h("span", { text: s.wear.name || "nothing worn" }),
      s.wear.exceed ? h("span", { class: "x", text: ` +${s.wear.exceed}` }) : s.wear.enchant ? h("span", { class: "e", text: ` +${s.wear.enchant}` }) : null, back) : null;
    return h("div", { class: `gear${done ? " done" : ""}${L?.sel?.includes(s.slot) ? " sel" : ""}`, title: "Pick it for the shopping list",
      onclick: () => { view = "buy"; localStorage.setItem("shop-view", view); change({ sel: [s.slot] }); } },
      pic(s.icon),
      h("div", { class: "mid" }, h("div", { class: "nm" }, h("span", { text: s.label, style: "color:var(--ink);font:inherit;margin:0" }), h("span", { text: s.have >= s.goal ? `T${s.have} · stops at T${s.goal}` : `T${s.have} → T${s.goal}` })), h("div", { class: "bars" }, ...bars), wear),
      h("div", { class: "rt" }, done ? h("span", { class: "v done", text: s.have < s.goal ? "Left out" : s.goal >= 6 ? "Done" : s.have > s.goal ? `Past T${s.goal}` : `At T${s.goal}` }) : h("div", {}, ...kina(s.kina)),
        done ? null : h("small", { class: "usd blk", text: cash(s.money, 0) }),
        done ? null : h("span", { class: `v ${s.kind}`, text: s.pct == null ? LABEL[s.kind] : `${LABEL[s.kind]} ${s.pct > 0 ? "+" : ""}${fmt(s.pct, 1)}%` })));
  }

  // Where the prices come from: the Exchange as the game saw it (Flav-Toolkit reads it while you play), else a2-tracker.
  const inventorySource = (inv) => (inv && inv.fresh ? [h("span", { text: " · " }), h("span", { class: "live", text: "bag read" }), h("span", { text: inv.kina != null ? ` · ${kfmt(inv.kina)} Kina` : "" })] : []);
  const priceSource = (m) => (m && m.live
    ? [h("span", { class: "live", text: "Exchange prices" }), h("span", { text: ` · seen ${m.ageMin == null || m.ageMin < 1 ? "just now" : `${m.ageMin} min ago`}${m.ladders ? ` · ${m.ladders} list${m.ladders === 1 ? "" : "s"} opened` : ""}` })]
    : [h("span", { text: "a2-tracker prices (hourly) · start the game with Play in Flav-Toolkit for the Exchange's own" })]);
  // "buy 935 in 3 stacks (328 + 367 + 240) ≤ 1,200 each": the whole listings that cover the quantity, cheapest first
  const planLine = (it) => {
    const p = it.plan;
    if (!p || !p.stacks || !p.stacks.length) return null;
    if (p.reference) return h("div", { class: "pl", text: `to buy more: ${fmt(it.qty)} would be ≤ ${pfmt(p.maxUnit)} each` });
    const stacks = p.stacks.map((s) => (s.count > 1 ? `${s.count}×${fmt(s.quantity)}` : fmt(s.quantity))).join(" + ");
    const n = p.stacks.reduce((t, s) => t + s.count, 0);
    return h("div", { class: "pl", title: `The cheapest listings that cover what is still needed, bought whole${it.listings != null ? `, out of the ${fmt(it.listings)} the Exchange has` : ""}. ${p.usual ? `Usual price ${pfmt(Math.round(p.usual))}.` : ""}` },
      h("span", { text: "buy " }), b(fmt(p.bought)), h("span", { text: " ≤ " }), b(pfmt(p.maxUnit)), h("span", { text: ` each · ${it.listings != null && it.listings >= n ? `${n} of ${fmt(it.listings)} listings` : `${n} listing${n === 1 ? "" : "s"}`}${n > 1 || p.stacks[0].quantity > 1 ? `: ${stacks}` : ""}` }),
      p.bought > it.qty ? h("span", { class: "thin", text: ` · ${fmt(p.bought - it.qty)} over` }) : null);
  };
  // not enough on the Exchange: from the ladder, how many its listings hold; from the summary, how many listings there are
  // not enough on the Exchange for what is still needed (`missing`; the whole need when nothing is in hand)
  const askedFor = (it) => (it.missing != null ? it.missing : it.qty);
  const shortTag = (it) => (it.owned ? null : it.plan && it.plan.stacks ? (it.plan.bought < askedFor(it) ? h("span", { class: "thin", text: ` · only ${fmt(it.plan.bought)} on the list` }) : null)
    : it.listings != null && it.listings < askedFor(it) ? h("span", { class: "thin", text: ` · only ${it.listings} listed` }) : null);
  // the verdict against the item's usual price: pricey → wait for the market to settle
  // With only the cheapest listing known (list not opened in game), "pricey" still holds; "cheap" is shown softer.
  const verdictTag = (p) => (!p || p.pct == null || !p.verdict ? null
    : p.verdict === "pricey" ? h("span", { class: "vd pricey", title: p.floor ? "Even the cheapest listing is well above this item's usual price. Wait for the market to settle." : "The dearest listing you'd need sits well above this item's usual price. Buy what's cheap, wait for the rest.", text: `pricey +${fmt(p.pct, 0)}%${p.pct >= 25 ? " · wait" : ""}` })
    : p.verdict === "cheap" ? h("span", { class: `vd ${p.floor ? "floor" : "cheap"}`, title: p.floor ? "The cheapest listing is below the usual price; open its list in game to see how far that goes" : "Below the usual price", text: `${p.floor ? "cheapest" : "cheap"} ${fmt(p.pct, 0)}%` })
    : p.floor ? null : h("span", { class: "vd fair", title: "Around the usual price", text: "fair" }));
  // what the game says is already owned: "have 314 · bag 298 · storage 16"
  const whereHave = (h_) => [["bag", h_.bag], ["storage", h_.storage], ["warehouse", h_.warehouse]].filter(([, n]) => n > 0).map(([w, n]) => `${w} ${fmt(n)}`).join(" · ");
  const haveTag = (it) => (!it.have || it.have.total <= 0 || it.owned ? null
    : h("span", { class: `vd have${it.owned ? " all" : ""}`, title: `Read from the game: ${whereHave(it.have)}`, text: it.owned ? `have ${fmt(it.have.total)}` : `have ${fmt(it.have.total)} of ${fmt(it.qty)}` }));
  const liveTag = (it) => (it.source === "ladder" ? h("span", { class: "tag ex", title: "From the Exchange's own list: the cheapest listings that cover this many", text: it.exact ? "exact" : "list" })
    : it.source === "summary" ? h("span", { class: "tag lv", title: "The cheapest listing the game saw on the Exchange", text: "live" }) : null);

  // The Quna shop. With the chests' real lists (opened in game, read by Flav-Toolkit) the plan is exact: how many of
  // each chest, cheapest Kina per Quna first. Without them, a price cap per chest (one Quna-per-Kina line a little above
  // today's best chest): buy the cheapest listings at or under the caps, best value first; the packs are counted at the
  // caps, so they still cover the Kina once the cheapest listings are gone (the list climbs: 790, 798, 810…).
  const chipText = (k, p) => (k.exact ? (p.seen === false ? `${chestName(p.kina)} not opened` : `${chestName(p.kina)} × ${fmt(p.buy)} ≤ ${fmt(p.cap)}`) : `${chestName(p.kina)} ≤ ${fmt(p.cap)}`);
  const capChips = (k, copies = false) => k.packages.filter((p) => p.quna && (!k.exact || p.buy > 0 || p.seen === false)).sort((a, b) => b.under - a.under || a.qunaPer1m - b.qunaPer1m)
    .map((p) => h("span", { class: `in${p.under ? "" : " off"}${copies ? " cp" : ""}`, title: copies ? `Click to copy "${chestFull(p.kina)}"` : null, onclick: copies ? (e) => { e.stopPropagation(); copy(chestFull(p.kina)); } : null },
      pic(`/icon/${p.id}`, ""), h("span", { text: chipText(k, p) })));
  function qunaShop(k, on, key) {
    const m = L.money || {};
    const rate = m.ratePct == null ? null
      : h("span", { class: `r ${m.ratePct <= -3 ? "good" : m.ratePct >= 3 ? "bad" : "ok"}`, text: `Kina ${m.ratePct <= -3 ? "cheap" : m.ratePct >= 3 ? "pricey" : "normal"} today ${m.ratePct > 0 ? "+" : ""}${fmt(m.ratePct, 1)}%` });
    const tiles = (k.packages || []).map((p) => h("div", { class: `qt${p.best ? " best" : ""}${p.quna && !p.under ? " over" : ""}${p.quna ? "" : " none"}` },
      p.best ? h("span", { class: "qn", text: "start" }) : null,
      pic(`/icon/${p.id}`, "pic sm"),
      h("div", { class: "qs", text: chestName(p.kina) }),
      h("div", { class: "qp" }, pic(QUNA, "coin"), h("span", { text: p.quna ? fmt(p.quna) : "—" })),
      h("div", { class: "qc", text: !p.quna ? "none listed" : k.exact ? (p.seen === false ? "list not opened" : p.buy ? `buy ${fmt(p.buy)} ≤ ${fmt(p.cap)}` : "none needed") : `buy ≤ ${fmt(p.cap)}` }),
      h("div", { class: "qr", text: p.quna ? `${fmt(p.qunaPer1m)} / 1M${k.exact ? (p.seen === false ? " · open it in game" : "") : p.under ? "" : " · above cap"}` : "" })));
    const body = [h("div", { class: "qh" }, key ? h("span", { class: "ck" }) : null, h("span", { class: "lbl", text: "Quna shop" }), rate)];
    if (k.need) {
      body.push(h("div", { class: "qbuy" }, pic(QUNA, "pic sm"),
        h("div", { class: "mid" }, h("div", { class: "nm", text: `${k.packs} × ${fmt(k.pack.quna)} Quna` }), h("div", { class: "sb", text: k.packs === 1 ? "Quna pack to buy" : "Quna packs to buy" })),
        h("div", { class: "rt" }, h("div", { class: "amt" }, ...money(k.money)), cur().code === "EUR" ? null : h("small", { text: `€${fmt(k.eur, 2)}` }))));
    }
    body.push(h("div", { class: "qtiles" }, ...tiles));
    if (k.need) {
      body.push(h("div", { class: "qres" }, pic(KINA, "coin lg"),
        h("span", {}, b(`${kfmt(k.need)} Kina`), h("span", { text: k.exact ? ` needed · these chests give ${kfmt(k.kinaAtCap)} for ${fmt(k.estQuna)} Quna` : ` needed · those packs buy ${kfmt(k.kinaAtCap)}+ even at the caps` }))));
      if (k.short) body.push(h("div", { class: "qnote thin", text: "Fewer chests are listed than you need right now." }));
    } else {
      body.push(h("div", { class: "qres" }, pic(KINA, "coin lg"), h("span", { text: k.have ? "Your Kina covers this list." : "Nothing to buy." })));
    }
    body.push(h("div", { class: "qnote", text: k.exact
      ? `From the Exchange's own lists: buy exactly these, cheapest first. A chest whose list you haven't opened in game isn't counted; open it on the Exchange and it joins the plan. 1 pack (${cash(k.pack.price)}) ≈ ${kfmt(k.onePackKina)} Kina.`
      : `Buy the cheapest listings at or under the caps, the "start" chest first; prices climb as listings go. Spare Quna → more chests under the caps. 1 pack (${cash(k.pack.price)}) ≈ ${kfmt(k.onePackKina)} Kina.` }));
    return h("div", { class: `qshop${on ? " done" : ""}`, onclick: key ? () => change({ tick: key }) : null }, ...body);
  }

  const stepTitle = (st) => (st.lucky && st.base ? [h("span", { text: `Craft ${st.base} until ` }), h("em", { text: st.item })]
    : st.tier ? [h("span", { text: "Craft " }), h("em", { text: `T${st.tier} ${st.item}` })]
      : [h("span", { text: `${st.method === "convert" ? "Convert to" : "Craft"} ${st.item}` })]);
  // What a step still asks: the tries and the count left once what is already made is taken off (`owned`: 10 of the 18
  // crafted before a break are in the bag); a step whose item is all in hand says so instead.
  const stepMeta = (st) => {
    const prof = st.profession ? ` · ${st.profession}${st.mastery ? ` ${st.mastery}` : ""}` : "";
    if (st.covered) return `✓ all ${cnt(st.owned.need)} in hand · nothing to craft${prof}`;
    const own = st.owned ? ` · ${cnt(st.owned.used)} of ${cnt(st.owned.need)} in hand` : "";
    return `${st.tier && st.tier > 1 ? "always succeeds" : `~${cnt(st.attempts)} tries · ${fmt(st.chance * 100, st.chance < 0.1 ? 1 : 0)}%`}${st.makes > 1.01 || st.owned ? ` · makes ${cnt(st.makes)}` : ""}${own}${prof}`;
  };
  // Buy some, craft the rest (the app decides from the item's own Exchange list): a step that is partly or wholly bought
  // says how many to buy, in which listings, up to what price, how many are still crafted and what that saves; a step
  // whose cheapest listing undercuts crafting but whose list is not known (never opened, or older than 45 min) says to
  // open it; a step whose list was seen and crafting wins says so, quietly.
  const minsAgo = (m) => (m == null ? "" : m < 1 ? "just now" : `${m} min ago`);
  const listingsText = (ls) => ls.map((l) => (l.count > 1 ? `${l.count}×` : "") + (l.quantity > 1 ? `${fmt(l.quantity)} @ ${pfmt(l.unit)}` : pfmt(l.unit))).join(" + ");
  const craftOrBuy = (st) => {
    const out = [];
    if (st.split) {
      const x = st.split, all = x.craftRest < 0.05;
      out.push(h("div", { class: "cob buy", title: `From ${x.name}'s own list on the Exchange (seen ${minsAgo(x.ageMin)}): every listing under ${pfmt(Math.round(x.craftUnit))}, what one costs you to craft, is bought. It is on the Buy tab.` },
        h("div", { class: "cbh" }, h("span", { class: "cl", text: all ? "Buy, don't craft" : "Buy some, craft the rest" }), h("span", { class: "sv", text: `saves ${kfmt(x.saves)}` })),
        h("div", { class: "cbr" }, h("span", { class: "k", text: "Exchange" }), b(`${fmt(x.buy)}×`), h("span", { text: ` ≤ ${pfmt(x.maxUnit)} each · ${kfmt(x.cost)} Kina` }), h("small", { text: ` · ${listingsText(x.listings)}` })),
        all ? null : h("div", { class: "cbr" }, h("span", { class: "k", text: "Craft" }), b(`${cnt(x.craftRest)}×`), h("span", { text: ` at ~${pfmt(Math.round(x.craftUnit))} each` }))));
    }
    if (st.compare && !st.split) out.push(compareCard(st.compare));
    const art = st.artisanChoice && artisanCard(st.artisanChoice);
    if (art) out.push(art);
    return out;
  };
  // The Artisan's piece a tier needs (Artisan's Splendent Diamond Earrings): the plan buys it when that costs less than
  // crafting it (the combo's tries included), and then the green, blue and gold steps that make it are not on the list.
  // The card says which the plan does and offers the other: "Craft it myself" puts those steps on the list, with their
  // counts; "Buy it instead" takes them off again. Kept per piece.
  function artisanCard(c) {
    const toggle = (on) => (e) => { e.stopPropagation(); change({ craft_artisan: { slot: c.slot, on } }); };
    const prices = [
      h("div", { class: "cbr" }, h("span", { class: "k", text: "Market" }), h("span", { text: `~${kfmt(c.buyUnit)} each` })),
      h("div", { class: "cbr" }, h("span", { class: "k", text: "Craft" }), h("span", { text: `~${kfmt(c.craftUnit)} each` }), h("small", { text: " · green, blue and gold steps, failed tries included" })),
    ];
    if (!c.crafting) {
      return h("div", { class: "cob buy art" },
        h("div", { class: "cbh" }, h("span", { class: "cl", text: "Bought, not crafted" }), h("span", { class: "sv", text: `saves ~${kfmt(c.craftUnit - c.buyUnit)}` })),
        h("div", { class: "cbn", text: c.name }), ...prices, h("button", { type: "button", class: "artb", onclick: toggle(true), title: "Put the steps that make it on the list (green, blue, then the gold one), with how many of each" }, "Craft it myself"));
    }
    if (!c.mine) return null; // crafting is the cheaper way anyway: nothing to choose
    return h("div", { class: "cob art" },
      h("div", { class: "cbh" }, h("span", { class: "cl", text: "Crafting it yourself" }), c.craftUnit > c.buyUnit ? h("span", { class: "sv dear", text: `~${kfmt(c.craftUnit - c.buyUnit)} more` }) : null),
      h("div", { class: "cbn", text: c.name }), ...prices, h("button", { type: "button", class: "artb", onclick: toggle(false), title: "Buy it on the Exchange instead and take its steps off the list" }, "Buy it instead"));
  }
  // Craft or buy, for what the step still has to make (the app does the sums, `compare`): crafting the rest at today's
  // prices (materials in hand counted at their price: they could go elsewhere) against buying them on the Exchange.
  // Buying cheaper: say so, and to skip the step; from the cheapest listing only (the item's list not opened), that is a
  // floor, so open the list for the exact count. No price seen: open it to compare. A click copies the name.
  const buyTag = (y) => (y.source === "ladder" ? h("span", { class: "tag ex", title: `From its own list on the Exchange, opened in game ${minsAgo(y.ageMin)}: the cheapest listings that cover this`, text: y.exact ? "exact" : "list" })
    : y.source === "live" ? h("span", { class: "tag lv", title: "The cheapest listing the game saw on the Exchange; open the item's list for the exact price of all of them", text: "live" })
      : h("span", { class: "tag old", title: "a2-tracker's hourly price: not the Exchange right now", text: "hourly" }));
  function compareCard(c) {
    const y = c.buy, n = cnt(c.left);
    const craft = h("div", { class: "cbr" }, h("span", { class: "k", text: "Craft" }), b(`${n}×`), h("span", { text: ` ~${pfmt(Math.round(c.craftUnit))} each · ${kfmt(c.craftCost)}` }), h("small", { text: " · failed tries included" }));
    const copyName = (e) => { e.stopPropagation(); copy(c.name); };
    if (!y) {
      return h("div", { class: "cob hint", title: "Open it on the Exchange in game: Flav-Toolkit reads its listings and the plan compares. Click to copy the name for the search.", onclick: copyName },
        h("div", { class: "cbh" }, h("span", { class: "cl", text: "Craft or buy?" }), h("span", { class: "sv", text: "↻ open its list" })),
        h("div", { class: "cbr" }, h("span", { class: "k", text: "Market" }), h("span", { text: "no price seen yet: open it on the Exchange in game" })), craft);
    }
    const floor = y.source !== "ladder";
    const market = h("div", { class: "cbr" }, h("span", { class: "k", text: "Market" }), b(`${fmt(y.count)}×`),
      h("span", { text: ` ${floor ? "from" : "≤"} ${pfmt(floor ? y.from : y.upTo)} each · ${kfmt(y.cost)}${floor ? " or more" : ""}` }), buyTag(y), y.listed != null ? h("small", { text: ` · ${fmt(y.listed)} listed` }) : null);
    if (c.better === "buy") {
      return h("div", { class: `cob ${floor ? "hint" : "buy"}`, title: floor ? "Only the cheapest listing is known: open the item's list on the Exchange in game for the exact cost of all of them. Click to copy the name." : "Buy them on the Exchange and tick this step off.", onclick: copyName },
        h("div", { class: "cbh" }, h("span", { class: "cl", text: "Buy it, skip this step" }), h("span", { class: "sv", text: `saves ~${kfmt(c.saves)}` })),
        market, craft, floor ? h("div", { class: "cbr" }, h("small", { text: "open its list in game for the exact price · click to copy the name" })) : null);
    }
    return h("div", { class: "cob alt2", onclick: copyName, title: "Click to copy the name" },
      h("div", { class: "cbh" }, h("span", { class: "cl", text: "Crafting is cheaper" }), h("span", { class: "sv", text: `saves ~${kfmt(c.saves)}` })), craft, market);
  }
  // A highlighted warning above the Buy and Steps tabs when the prices are not the Exchange's own right now: what is
  // missing (Flav-Toolkit, the game started through it, the Exchange opened) and what to do.
  function priceWarning() {
    const m = L && L.market, f = L && L.feed;
    if (m && m.live) return m.ageMin != null && m.ageMin > 30 ? h("div", { class: "pwarn soft" }, h("b", { text: "Exchange seen " + m.ageMin + " min ago" }), h("span", { text: " · open the Exchange in game to refresh before you buy" })) : null;
    const soft = (bold, rest) => h("div", { class: "pwarn soft" }, h("b", { text: bold }), h("span", { text: rest }));
    let what, todo;
    if (!f || f.state !== "connected") { what = "Flav-Toolkit isn't running"; todo = "Start it, then Play AION 2 from its tray to read the Exchange's own prices."; }
    // Flav-Toolkit 0.12.0 says whether it reads the Exchange: started with Play AION 2 and nothing seen yet is not a fault
    else if (f.exchange === "ready" || f.exchange === "live") return soft("Open the Exchange in game", " to read its own prices · hourly prices meanwhile");
    else if (f.exchange === "off") { what = "The Exchange can't be read"; todo = "AION 2 wasn't started through Flav-Toolkit: quit the game and start it with Play AION 2 in the tray, then open the Exchange."; }
    else if (f.game) { what = "The Exchange can't be read"; todo = "AION 2 wasn't started through Flav-Toolkit: quit the game and start it with Play AION 2 in the tray, then open the Exchange."; }
    else { what = "Prices are a2-tracker's hourly ones"; todo = "Start AION 2 with Play AION 2 in Flav-Toolkit's tray and open the Exchange for its own prices before you buy."; }
    return h("div", { class: "pwarn" }, h("div", { class: "pw1" }, h("span", { class: "ico", text: "!" }), b(what)), h("div", { class: "pw2", text: todo }));
  }
  // Every step that could be cheaper bought, at the top of the Steps and Buy tabs: what is already worked in, and which
  // lists to open on the Exchange to know.
  function marketCheck(chosen) {
    const splits = [], opens = [];
    for (const p of chosen || []) for (const st of p.steps) { if (st.split) splits.push(st.split); if (st.refresh && !opens.some((o) => o.id === st.refresh.id)) opens.push(st.refresh); }
    if (!splits.length && !opens.length) return null;
    const saves = splits.reduce((t, x) => t + x.saves, 0);
    return h("div", { class: "mcheck" },
      h("div", { class: "mh" }, h("span", { class: "lbl", text: "Market check" }), splits.length ? h("span", { class: "sv", text: `buying ${splits.length} step${splits.length === 1 ? "" : "s"} saves ${kfmt(saves)}` }) : null),
      opens.length ? h("div", { class: "mt", text: `Open ${opens.length === 1 ? "this list" : "these lists"} on the Exchange — the cheapest listing beats crafting:` }) : null,
      opens.length ? h("div", { class: "ins" }, ...opens.map((o) => h("span", { class: "in cp", title: `Click to copy "${o.name}" for the Exchange search · from ${pfmt(o.min)} vs ~${pfmt(Math.round(o.craftUnit))} to craft`, onclick: (e) => { e.stopPropagation(); copy(o.name); } }, pic(o.icon, ""), h("span", { text: `${o.name} · ${pfmt(o.min)}` })))) : null);
  }
  // A step's tick key names what the step makes (not its number), so a tick stays on the right step when
  // prices change the route and steps move. Must match the browser list's stepKey.
  const stepKey = (p, n) => {
    const name = (st) => `${st.method || ""}>${st.tier ? `T${st.tier} ` : ""}${st.item}`;
    const me = name(p.steps[n]);
    const nth = p.steps.slice(0, n).filter((x) => name(x) === me).length;
    return `s:${p.slot}:${p.have}-${p.goal}:${me}${nth ? `#${nth + 1}` : ""}`.slice(0, 190);
  };
  const srcClass = (r) => (r.source === "craft" || r.source === "convert" ? "craft" : r.source === "own" ? "own" : r.source === "npc" ? "npc" : "");
  // The things a step uses, as chips. On a step card a click opens the details (names copy there);
  // on the tracker, a chip copies its name.
  // A bought material: `missing` is what is left after the stock in hand was used up step by step (the app does the
  // sums; with "count what I own" off, missing = count and `used` is 0). Fully covered: crossed out as in hand.
  const bought = (r) => r.source === "buy" || r.source === "npc";
  const inHand = (r) => !!(r.have && bought(r) && r.missing != null && r.missing <= 0.05);
  // a line made in an earlier step whose item is already all in hand (`inHand`: what of it the bag holds)
  const madeInHand = (r) => !bought(r) && r.inHand > 0.05 && r.inHand >= r.count - 0.5;
  const haveNote = (r) => (!r.have || !bought(r) || r.have.total <= 0 || inHand(r) ? null
    : h("span", { class: "hv", title: `Read from the game: ${whereHave(r.have)}`, text: r.used > 0 ? `${cnt(r.used)} in hand` : `have ${fmt(r.have.total)}` }));
  // the count to show: what is left to get once the stock in hand is used; a fully covered row keeps its full count, struck out
  const need = (r) => (inHand(r) || r.missing == null || !(r.used > 0) ? r.count : r.missing);
  const inputs = (rs, copies = false) => rs.map((r) => h("span", { class: `in ${srcClass(r)}${inHand(r) || madeInHand(r) ? " covered" : ""}${copies ? " cp" : ""}`, title: inHand(r) ? `Covered by what is in hand: ${whereHave(r.have)}` : copies ? `Click to copy "${r.name}"` : null, onclick: copies ? (e) => { e.stopPropagation(); copy(r.name); } : null },
    pic(r.icon, ""), h("span", { text: `${cnt(need(r))}× ${r.name}` }), inHand(r) || madeInHand(r) ? h("span", { class: "okc", text: "✓" }) : null, haveNote(r),
    !bought(r) && r.inHand > 0.05 && !madeInHand(r) ? h("span", { class: "hv", title: r.have ? `Read from the game: ${whereHave(r.have)}` : null, text: `${cnt(r.inHand)} in hand` }) : null, r.bought > 0.05 ? h("span", { class: "hv bt", title: "Bought on the Exchange instead of crafted (see that step)", text: `${cnt(r.bought)} bought` }) : null));
  // A step: a click on the card opens its details, the round box on the right ticks it off.
  function stepCard({ key, no, on, icon, tier, k0, last, title, meta, ins, cost, details, cob, forceOpen = false }) {
    const open = forceOpen || opened.has(key);
    const toggle = () => { if (forceOpen) return; if (open) opened.delete(key); else opened.add(key); render(); };
    return h("div", { class: `step${on ? " done" : ""}${k0 ? " k0" : ""}${last ? " last" : ""}${open ? " open" : ""}`, onclick: toggle },
      h("div", { class: "rail" }, h("span", { class: `stepic${tier ? " tiered" : ""}` }, pic(icon), h("span", { class: "no", text: no }))),
      h("div", { class: "sbody" }, h("div", { class: "t" }, ...title), h("div", { class: "m", text: meta }), ...(cob || []),
        open ? h("div", { class: "det" }, ...details()) : h("div", { class: "ins" }, ...ins),
        cost ? h("div", { class: "cost" }, ...cost) : null,
        h("div", { class: "more", text: open ? "▴ less · click a name to copy it" : "▾ details" })),
      h("button", { type: "button", class: `tickbox${on ? " on" : ""}`, title: on ? "Done (click to undo)" : "Mark as done", onclick: (e) => { e.stopPropagation(); change({ tick: key }); } }));
  }
  // The step opened: what it makes and each thing it uses, where it comes from and what it costs. Names copy on click.
  // One bought line of a step, as the Buy tab shows it: how many to buy and up to what price, from which source, the
  // verdict against the usual price, and what is in hand. Covered by the bag: the full count stays, marked covered,
  // with the prices still there for buying more.
  const srcTag = (p) => (!p ? null : p.npc ? h("span", { class: "tag lv", text: "NPC" })
    : p.source === "ladder" ? h("span", { class: "tag ex", title: "From the Exchange's own list, opened in game: the cheapest listings that cover this", text: p.exact ? "exact" : "list" })
      : p.source === "summary" ? h("span", { class: "tag lv", title: "The cheapest listing the game saw on the Exchange; open the item's list for exact numbers", text: "live" })
        : h("span", { class: "tag old", title: "a2-tracker's hourly price: not the Exchange right now. Start AION 2 with Play in Flav-Toolkit and open the Exchange", text: "hourly" }));
  const buyLine = (r) => {
    const p = r.plan;
    if (!p && madeInHand(r)) return h("div", { class: "dn cov" }, h("span", { class: "okc", text: "✓ in hand" }), h("span", { text: r.have ? ` · ${whereHave(r.have)}` : "" }));
    if (!p) {
      const parts = [r.inHand > 0.05 ? `${cnt(r.inHand)} in hand` : null, r.bought > 0.05 ? `${cnt(r.bought)} bought on the Exchange` : null];
      const from = parts.some(Boolean) ? `${parts.filter(Boolean).join(" · ")} · the rest made in an earlier step` : "made in an earlier step";
      return h("div", { class: "dn", text: r.source === "own" ? "the one you own" : from });
    }
    if (p.covered) return [
      h("div", { class: "dn cov" }, h("span", { class: "okc", text: "✓ covered" }), h("span", { text: ` · in hand ${whereHave(r.have)}` })),
      h("div", { class: "dn" }, h("span", { text: "more: " }), b(`≤ ${pfmt(p.maxUnit)}`), h("span", { text: " each" }), srcTag(p), verdictTag(p)),
    ];
    return h("div", { class: "dn" }, h("span", { text: `${p.npc ? "NPC shop · " : ""}buy ` }), b(fmt(p.buy)), h("span", { text: " ≤ " }), b(pfmt(p.maxUnit)),
      h("span", { text: ` each · ${kfmt(p.cost)} Kina · ${cash(toMoney(p.cost))}` }), srcTag(p), verdictTag(p));
  };
  function stepDetails(st) {
    // all of it in hand already: what it makes and where it is, and no materials (none are needed)
    if (st.covered) return [
      h("div", { class: "dl" }, h("span", { class: "dk", text: "Makes" }), pic(st.icon, "pic xs"), copyable(st.item)),
      h("div", { class: "dl covered" }, h("span", { class: "dk", text: "In hand" }), h("div", { class: "dm" }, h("div", { class: "dn cov" }, h("span", { class: "okc", text: `✓ ${cnt(st.owned.need)} needed` }), h("span", { text: st.owned.have ? ` · ${whereHave(st.owned.have)}` : "" })))),
    ];
    return [
      h("div", { class: "dl" }, h("span", { class: "dk", text: "Makes" }), pic(st.icon, "pic xs"), copyable(st.lucky && st.base ? st.item : st.item)),
      st.lucky && st.base ? h("div", { class: "dl" }, h("span", { class: "dk", text: "Craft" }), copyable(st.base), h("span", { class: "dn", text: "until it comes out Splendent" })) : null,
      ...st.rows.map((r) => h("div", { class: `dl ${srcClass(r)}${(r.plan && r.plan.covered) || madeInHand(r) ? " covered" : ""}` }, h("span", { class: "dq", text: `${cnt(r.plan && r.plan.covered ? r.count : need(r))}×` }), pic(r.icon, "pic xs"),
        h("div", { class: "dm" }, copyable(r.name), r.plan && r.plan.covered ? null : haveNote(r), buyLine(r)))),
    ];
  }
  function kinaDetails(k) {
    return [
      h("div", { class: "dl" }, h("span", { class: "dq", text: `${k.packs}×` }), pic(QUNA, "pic xs"), h("div", { class: "dm" }, h("span", { text: `${fmt(k.pack.quna)} Quna pack` }), h("div", { class: "dn", text: `${cash(k.pack.price)} each · ${cash(k.money)} in all` }))),
      ...k.packages.filter((p) => p.quna).sort((a, b) => b.under - a.under || a.qunaPer1m - b.qunaPer1m).map((p) => h("div", { class: `dl${p.under ? "" : " off"}` }, h("span", { class: "dq", text: k.exact && p.buy ? `${fmt(p.buy)}×` : "≤" }), pic(`/icon/${p.id}`, "pic xs"),
        h("div", { class: "dm" }, copyable(chestFull(p.kina)), h("div", { class: "dn", text: k.exact
          ? (p.seen === false ? `lowest now ${fmt(p.quna)} · open its list in game to count it` : p.buy ? `${fmt(p.buy)} at up to ${fmt(p.cap)} Quna each · ${fmt(p.spend)} Quna` : `lowest now ${fmt(p.quna)} · none needed`)
          : `buy at or under ${fmt(p.cap)} Quna · lowest now ${fmt(p.quna)}${p.best ? " · start here" : ""}` })))),
    ];
  }

  // ---- how solid the panels are (a per-screen preference, kept in this window's storage) -----------------------
  const panelLevel = () => { try { const v = Number(localStorage.getItem("panel")); return Number.isFinite(v) && v > 0 ? Math.min(1, v) : 1; } catch { return 1; } };
  function setPanel(level) {
    const v = Math.max(0, Math.min(1, level));
    document.documentElement.style.setProperty("--panel", String(v));
    document.body.classList.toggle("clear", v < 0.6);
    try { localStorage.setItem("panel", String(v)); } catch { /* fine */ }
  }
  setPanel(panelLevel());

  // ---- the Steps tab one step at a time (a per-screen preference, kept in this window's storage) ----------------
  const oneStep = () => { try { return localStorage.getItem("steps-one") === "1"; } catch { return false; } };
  const setOneStep = (on) => { try { localStorage.setItem("steps-one", on ? "1" : "0"); } catch { /* fine */ } };
  let peek = 0; // in one-step mode: how many steps past the next undone one is shown (‹ › arrows); reset on a tick

  // ---- adding an alert (the top of the Alerts tab) ---------------------------------------------------------------
  // The list never takes the keyboard, so the game keeps every key. To type here, a field asks Flav-Toolkit to let the
  // window take the keyboard (`flavOverlay.typing`) and gives it back to the game when you leave it (Esc, Add, or a click
  // outside). The form is built once and kept, so a redraw of the list does not lose what you typed.
  const KINDS = [
    ["below", "Price ≤", "Kina", "buy at or under"], ["above", "Price ≥", "Kina", "sell at or over"],
    ["cheaper", "Cheaper than usual", "%", "below its usual price by"], ["pricier", "Pricier than usual", "%", "above its usual price by"],
    ["listed", "Listed ≥", "listings", "at least this many listed"], ["scarce", "Listed ≤", "listings", "at most this many listed"],
  ];
  let typing = false, typingOff = null;
  const typeOn = () => { clearTimeout(typingOff); if (!typing) { typing = true; typingTo(true); } };
  const typeOff = (now = false) => { clearTimeout(typingOff); typingOff = setTimeout(() => { if (typing && !(document.activeElement && document.activeElement.closest && document.activeElement.closest(".aform input"))) { typing = false; typingTo(false); } }, now ? 0 : 150); };
  const af = { picked: null, kind: "below", results: [], searchT: null };
  let aform = null;
  function alertForm() {
    if (aform) return aform;
    const q = h("input", { type: "text", placeholder: "Type an item… e.g. Refining Stone", autocomplete: "off", spellcheck: "false" });
    const res = h("div", { class: "ares" });
    const kinds = h("div", { class: "akinds" });
    const val = h("input", { type: "number", min: "0", step: "any", placeholder: "Kina" });
    const unit = h("span", { class: "aunit", text: "Kina" });
    const add = h("button", { type: "button", class: "sbtn", text: "Add alert" });
    const picked = h("div", { class: "apicked" });
    const second = h("div", { class: "asecond", hidden: true }, picked, kinds, h("div", { class: "aval" }, val, unit, add));
    const drawKinds = () => kinds.replaceChildren(...KINDS.map(([k, t]) => h("button", { type: "button", class: `chip all${af.kind === k ? " on" : ""}`, text: t, onclick: () => { af.kind = k; drawKinds(); suggest(); val.focus(); } })));
    const suggest = () => {
      const k = KINDS.find((x) => x[0] === af.kind); unit.textContent = k[2]; val.placeholder = k[2];
      const now = af.picked && af.picked.now;
      val.value = !now ? "" : af.kind === "below" && now.price ? String(Math.round(now.price * 0.9)) : af.kind === "above" && now.price ? String(Math.round(now.price * 1.1)) : af.kind === "cheaper" || af.kind === "pricier" ? "15" : af.kind === "listed" ? String(Math.max(1, (now.listed || 0) + 10)) : af.kind === "scarce" ? String(Math.max(0, Math.round((now.listed || 10) / 2))) : "";
    };
    const pick = (it) => {
      af.picked = it; q.value = it.name; res.replaceChildren(); second.hidden = false;
      const now = it.now || {};
      picked.replaceChildren(pic(it.icon, "pic sm"), h("div", { class: "mid" }, h("div", { class: "nm", text: it.name }),
        h("div", { class: "nw", text: [now.price != null ? `now ${pfmt(now.price)}` : "no price seen", now.listed != null ? `${fmt(now.listed)} listed` : null, now.usual ? `usual ${pfmt(Math.round(now.usual))}` : null].filter(Boolean).join(" · ") })));
      drawKinds(); suggest(); val.focus(); val.select(); scheduleFit();
    };
    const search = () => {
      clearTimeout(af.searchT);
      const text = q.value.trim();
      if (af.picked && text !== af.picked.name) { af.picked = null; second.hidden = true; }
      if (text.length < 2) { res.replaceChildren(); scheduleFit(); return; }
      af.searchT = setTimeout(async () => {
        try {
          const r = await get(`/api/items?q=${encodeURIComponent(text.slice(0, 60))}`);
          af.results = r.items || [];
          res.replaceChildren(...(af.results.length ? af.results.slice(0, 8).map((it) => h("button", { type: "button", class: "ar", onclick: () => pick(it) }, pic(it.icon, "pic xs"), h("span", { class: "an", text: it.name }),
            h("small", { text: it.now && it.now.price != null ? `${pfmt(it.now.price)}${it.now.listed != null ? ` · ${fmt(it.now.listed)} listed` : ""}` : "no price" }))) : [h("div", { class: "ar none", text: "Nothing called that" })]));
          scheduleFit();
        } catch (e) { toast(String(e)); }
      }, 200);
    };
    const submit = async () => {
      if (!af.picked) return toast("Pick an item first");
      const value = Number(val.value);
      if (val.value === "" || !Number.isFinite(value) || value < 0) return toast("Give it a number");
      try {
        const r = await post("/api/shop", { alert_add: { item: String(af.picked.id), kind: af.kind, value } });
        if (r && r.alertError) return toast(r.alertError);
        toast(`Alert added: ${af.picked.name}`);
        af.picked = null; q.value = ""; val.value = ""; second.hidden = true; res.replaceChildren();
        q.blur(); val.blur(); typeOff(true);
        L = r; render();
      } catch (e) { toast(String(e)); }
    };
    for (const input of [q, val]) {
      input.addEventListener("focus", typeOn);
      input.addEventListener("blur", () => typeOff());
      input.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); input.blur(); typeOff(true); } });
    }
    q.addEventListener("input", search);
    q.addEventListener("keydown", (e) => { if (e.key === "Enter" && af.results[0]) { e.preventDefault(); pick(af.results[0]); } });
    val.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    add.addEventListener("click", submit);
    aform = h("div", { class: "aform" }, h("div", { class: "ah" }, h("span", { class: "lbl", text: "Add an alert" }), h("small", { text: "click to type · Esc gives the keys back to the game" })), q, res, second);
    return aform;
  }

  // ---- settings (⚙) -------------------------------------------------------
  function settingsRows() {
    const code = G?.cur?.code || "USD";
    const seg = h("div", { class: "seg" }, ...[["USD", "$ USD"], ["EUR", "€ EUR"], ["SAR", "SAR"]].map(([c, t]) =>
      h("button", { type: "button", class: c === code ? "on" : "", text: t, onclick: () => { if (c !== code) change({ currency: c }); } })));
    const sw = (on, fn) => h("button", { type: "button", class: `sw${on ? " on" : ""}`, onclick: fn }, h("i"));
    // the class to plan gear for: the player's own (from the game, or the official site), or any other
    const mine = G?.me?.className || G?.character?.className || null;
    const manual = G?.class_mode === "manual";
    const classes = ["Gladiator", "Templar", "Assassin", "Ranger", "Sorcerer", "Spiritmaster", "Cleric", "Chanter"];
    const cls = h("div", { class: "clsrow" },
      h("button", { type: "button", class: `chip all${!manual ? " on" : ""}`, title: mine ? "Your class, as the game says" : "Your class, once the game says it (log in with Flav-Toolkit running)", text: mine ? `Mine · ${mine}` : "Mine", onclick: () => { if (manual) change({ class: "auto" }); } }),
      ...classes.map((k) => h("button", { type: "button", class: `chip all${manual && G?.class === k ? " on" : ""}`, text: k, onclick: () => { if (!(manual && G?.class === k)) change({ class: k }); } })));
    return [
      h("div", { class: "srow" }, h("div", { class: "sl" }, h("b", { text: "Currency" }), h("small", { text: "Every price, here and in the app" })), seg),
      h("div", { class: "srow col" }, h("div", { class: "sl" }, h("b", { text: "Class" }), h("small", { text: "Gear for your class, read from the game when you log in. Pick another to plan for it" })), cls),
      h("div", { class: "srow" }, h("div", { class: "sl" }, h("b", { text: "Faces" }), h("small", { text: "Which way the title, buttons and grip sit. Auto: toward the middle of the screen, from where the list is" })),
        h("div", { class: "seg" }, ...[["auto", "Auto"], ["left", "Left"], ["right", "Right"]].map(([v, t]) =>
          h("button", { type: "button", class: faces() === v ? "on" : "", text: t, onclick: () => { try { localStorage.setItem("faces", v); } catch { /* fine */ } applySide(); render(); } })))),
      h("div", { class: "srow" }, h("div", { class: "sl" }, h("b", { text: "Size" }), h("small", { text: "Everything in this list larger or smaller; the window follows" })),
        h("div", { class: "seg" }, ...SIZES.map(([z, t]) => h("button", { type: "button", class: Z === z ? "on" : "", text: t, onclick: () => setSize(z) })))),
      h("div", { class: "srow" }, h("div", { class: "sl" }, h("b", { text: "Update by itself" }), h("small", { text: "Redraw when your bag changes or the game shows you Exchange prices. Nothing is downloaded, nothing is asked of the game" })),
        sw(autoOn(), () => { try { localStorage.setItem("auto", autoOn() ? "0" : "1"); } catch { /* fine */ } render(); if (autoOn()) quietLoad(); })),
      h("div", { class: "srow" }, h("div", { class: "sl" }, h("b", { text: "Keys" }), h("small", { text: "Refresh prices, and show or hide this list: pick them in Flav-Toolkit's hub (Dragon Gear Prices › Settings › Keys in the game)" }))),
      h("div", { class: "srow" }, h("div", { class: "sl" }, h("b", { text: "Read my gear" }), h("small", { text: "When the game isn't being read: from the official site on every price refresh (the game's own read at login always counts)" })), sw(G?.auto_sync !== false, () => change({ auto_sync: G?.auto_sync === false }))),
      h("div", { class: "srow" }, h("div", { class: "sl" }, h("b", { text: "Count what I own" }), h("small", { text: "Take the bag, storage and warehouse off what to buy and craft. Off: full counts, what you have shown beside them" })),
        sw(L?.inventory?.use_inventory !== false, () => change({ use_inventory: L?.inventory?.use_inventory === false }))),
      h("div", { class: "srow" }, h("div", { class: "sl" }, h("b", { text: "Steps one at a time" }), h("small", { text: "The Steps tab shows only the step you are on; Done moves to the next" })),
        sw(oneStep(), () => { setOneStep(!oneStep()); render(); })),
      h("div", { class: "srow" }, h("div", { class: "sl" }, h("b", { text: "Panel" }), h("small", { text: "Solid ↔ glass. Text keeps a dark halo when the panel goes clear" })),
        h("input", { type: "range", min: "0", max: "100", step: "5", value: String(Math.round(panelLevel() * 100)), oninput: (e) => setPanel(Number(e.target.value) / 100) })),
      h("div", { class: "srow" }, h("div", { class: "sl" }, h("b", { text: "Untick everything" }), h("small", { text: "Start the list over" })), h("button", { type: "button", class: "sbtn", text: "Untick", onclick: () => change({ clear: true }) })),
      h("div", { class: "srow" }, h("div", { class: "sl" }, h("b", { text: "Full app" }), h("small", { text: "Kina and Quna you have, alerts, crafting level: in the browser (typing isn't possible over the game)" })), h("button", { type: "button", class: "sbtn", text: "Open", onclick: () => post("/api/open").catch(() => toast("Couldn't open the browser")) })),
      h("div", { class: "snote", text: "↻ downloads the hourly prices again. What the game shows you on the Exchange, and your bag, come in by themselves. With alerts on, the app also checks every hour (\"Hourly update\")." }),
    ];
  }

  // ---- crafting now: tries, pieces, Splendent, fails and streaks in the batch being crafted ---------------
  // The app counts each try (its materials go in one update) and each piece as it lands (crafting.js). Shown at the
  // top in every view while a batch goes on, and for half an hour after its last try. A Splendent result is cheered, the
  // more the longer the streak (Splendent, Double, Triple, then Dragon's luck: sparks, rings, rays, a gold rain); a
  // failed try or a long dry spell gets a kind word and the honest odds. Each try is its own roll: nothing here says
  // one is "due".
  let CR = null, crHide = null, crBan = null;
  const calm = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
  const oneIn = (p, k) => fmt(Math.round(1 / Math.pow(p, k)));
  const KIND = [
    "The materials are gone, your luck isn't. Fresh odds on the next one.",
    "It happens to every crafter. Shake it off, next try.",
    "That one slipped away. The next roll knows nothing about it.",
  ];
  // What to say about the latest result, or null (a plain piece mostly says nothing)
  function craftWords(v) {
    const l = v.last, p = v.chance;
    if (!l) return null;
    if (l.kind === "lucky") {
      const k = l.streak, title = k === 1 ? "Splendent!" : k === 2 ? "Double Splendent!" : k === 3 ? "Triple Splendent!" : `Dragon's luck ×${k}`;
      const sub = k === 1 ? (p ? `A ${fmt(p * 100)}% hit` : "Lucky hit") : p ? `${k} in a row · 1 in ${oneIn(p, k)} crafters see that` : `${k} in a row`;
      return { tone: `l${Math.min(4, k)}`, title, sub };
    }
    if (l.kind === "fail") return { tone: "calm", title: "That one didn't make it", sub: KIND[(v.failed - 1) % KIND.length] };
    if (l.ended >= 2) return { tone: "end", title: `×${l.ended} streak, what a run`, sub: p ? `Back to ${fmt(p * 100)}% from here` : "" };
    if (l.dry >= 5 && p) {
      const pr = Math.pow(1 - p, l.dry);
      return { tone: "calm", title: `${l.dry} in a row without one`, sub: `Only ${fmt(Math.max(1, Math.round(pr * 100)))}% of crafters get this unlucky. The next try is still ${fmt(p * 100)}%.` };
    }
    return null;
  }
  // The burst on a Splendent result: sparks out of the count, rings, rays from 3 in a row, a gold rain over the list
  function burst(el, level) {
    if (calm()) return;
    const fx = el.querySelector(".cfx");
    fx.replaceChildren();
    const n = [0, 12, 20, 30, 42][level];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6, d = 34 + Math.random() * (level >= 3 ? 110 : 70);
      const sp = h("i", { class: `spark${i % 3 === 1 ? " d" : ""}${level === 4 && i % 2 ? " e" : ""}` });
      sp.style.cssText = `--dx:${Math.round(Math.cos(a) * d)}px;--dy:${Math.round(Math.sin(a) * d * 0.8)}px;--r:${Math.round(Math.random() * 360)}deg;animation-delay:${(Math.random() * 0.12).toFixed(2)}s`;
      fx.append(sp);
    }
    fx.append(h("i", { class: "ring" }));
    if (level >= 2) fx.append(h("i", { class: "ring r2" }), h("i", { class: "ring r3" }));
    if (level >= 3) fx.append(h("i", { class: "rays" }));
    if (level >= 3) {
      const rain = $("craftrain");
      rain.replaceChildren();
      for (let i = 0; i < (level === 4 ? 46 : 26); i++) {
        const d = h("i", { class: "rain" });
        d.style.cssText = `left:${Math.round(Math.random() * 100)}%;animation-delay:${(Math.random() * 0.7).toFixed(2)}s;animation-duration:${(1.4 + Math.random() * 0.9).toFixed(2)}s`;
        rain.append(d);
      }
      setTimeout(() => rain.replaceChildren(), 3200);
    }
    setTimeout(() => fx.replaceChildren(), 2000);
  }
  function drawCraft(v) {
    const el = $("craft"), was = CR;
    CR = v && (v.made > 0 || v.tries > 0) ? v : null;
    clearTimeout(crHide);
    if (!CR) { if (!el.hidden) { el.hidden = true; el.replaceChildren(); clearTimeout(crBan); crBan = null; scheduleFit(); } return; }
    crHide = setTimeout(() => drawCraft(null), Math.max(1000, CR.hideAt - Date.now()));
    const word = /splendent/i.test(CR.lucky.name) ? "Splendent" : "lucky";
    const fresh = !!(was && CR.seq !== was.seq && CR.last && (!was.last || CR.seq > was.seq));
    const kind = fresh ? CR.last.kind : null, level = kind === "lucky" ? Math.min(4, CR.last.streak) : 0;
    const cls = `crow${CR.streak >= 2 ? ` lv${Math.min(4, CR.streak)}` : ""}${kind === "fail" ? " sad" : ""}`;
    const stats = [b(fmt(CR.tries)), h("span", { text: ` ${CR.tries === 1 ? "try" : "tries"} · ` }), b(fmt(CR.made)), h("span", { text: " made" })];
    if (CR.failed) stats.push(h("span", { text: " · " }), h("span", { class: "cf", text: `${fmt(CR.failed)} failed` }));
    const num = h("b", { class: `cn${level ? ` pop l${level}` : ""}` }, fmt(CR.lucky.n), h("em", { text: word }));
    const pips = [];
    for (let i = 0; i < 6; i++) pips.push(h("i", { class: `pip${i < CR.streak ? (CR.streak >= 4 ? " hot" : " on") : ""}` }));
    const oldBan = el.querySelector(".cban");
    el.hidden = false;
    el.replaceChildren(...[
      h("div", { class: cls },
        pic(CR.lucky.icon, "pic sm"),
        h("div", { class: "cw" }, h("div", { class: "cl", text: CR.crafting ? "Crafting now…" : "Crafting now" }), h("div", { class: "ct", text: CR.plain.name, title: `${CR.plain.name}, sometimes ${CR.lucky.name}` }), h("div", { class: "cs" }, ...stats)),
        h("div", { class: "cc", title: `${CR.lucky.n} of the ${CR.made} pieces made in this batch came out ${CR.lucky.name}${CR.chance ? ` (the recipe's chance: ${fmt(CR.chance * 100)}%)` : ""}. A try whose materials went and no piece came counts as failed. Counted from the game's own updates as each try goes; what you had before isn't counted. A new batch starts the count again.` },
          num, h("small", { text: `of ${fmt(CR.made)} made · ${CR.pct}%` })),
        h("button", { type: "button", class: "ic cx", text: "×", title: "Put the count away (the next try starts a new one)", onclick: () => post("/api/craft", { clear: true }).then((r) => drawCraft(r.craft)).catch(() => toast("Couldn't reach Dragon Gear")) }),
        h("div", { class: "cfx", "aria-hidden": "true" })),
      CR.streak >= 1 || CR.best >= 2 ? h("div", { class: "cmeter", title: CR.best >= 2 ? `Best streak this batch: ${CR.best} in a row` : null }, h("span", { text: "Streak" }), ...pips, CR.best >= 2 ? h("small", { text: `best ${CR.best}` }) : null) : null].filter(Boolean));
    // what to say: a new result's words, else the words still showing
    const w = fresh ? craftWords(CR) : null;
    if (w) {
      clearTimeout(crBan);
      el.append(h("div", { class: `cban ${w.tone}`, role: "status" }, h("div", { class: "bt", text: w.title }), w.sub ? h("div", { class: "bs", text: w.sub }) : null));
      crBan = setTimeout(() => { const x = el.querySelector(".cban"); if (x) { x.classList.add("out"); setTimeout(() => { x.remove(); scheduleFit(); }, 400); } crBan = null; }, w.tone === "calm" ? 9000 : 6000);
    } else if (oldBan && crBan) el.append(oldBan);
    if (level) burst(el, level);
    if (kind === "fail" && !calm()) el.querySelector(".cfx").append(h("i", { class: "drift" }));
    scheduleFit();
  }
  const loadCraft = () => get("/api/craft").then((r) => drawCraft(r.craft)).catch(() => {});

  // ---- tracker: only the next thing to do ---------------------------------
  // One step at a time: the step you are on (the first undone one, or ‹ › away from it), as its full open card,
  // with where you are in the whole plan. Done on the card moves to the next.
  function renderOneStep(rows, ticks, k, kk) {
    { const w = priceWarning(); if (w) rows.push(w); }
    const todo = [];
    if (kk) todo.push({ key: kk, kina: true });
    for (const p of L.chosen) p.steps.forEach((st, n) => todo.push({ key: stepKey(p, n), st, p, n }));
    if (!todo.length) return;
    const isDone = (t) => !!ticks[t.key] || !!(t.st && t.st.covered); // all in hand already: nothing to do there
    const first = todo.findIndex((t) => !isDone(t));
    const done = todo.filter(isDone).length;
    if (first < 0) {
      rows.push(h("div", { class: "next" }, h("div", { class: "lbl", text: "All done" }), h("div", { class: "t", text: "Everything on the list is ticked off." })));
      return;
    }
    const at = Math.max(0, Math.min(todo.length - 1, first + peek));
    const t = todo[at];
    const title = t.kina ? "Get your Kina" : `${t.p.label} · step ${t.n + 1} of ${t.p.steps.length}`;
    rows.push(h("div", { class: "onehead" },
      h("button", { type: "button", class: "arrow", text: "‹", title: "Previous step", disabled: at === 0, onclick: () => { peek = at - 1 - first; render(); } }),
      h("div", { class: "oh" }, h("div", { class: "lbl", text: at === first ? "You are here" : at < first ? "Done earlier" : "Later" }), h("div", { class: "t", text: title })),
      h("button", { type: "button", class: "arrow", text: "›", title: "Next step", disabled: at === todo.length - 1, onclick: () => { peek = at + 1 - first; render(); } })));
    if (t.kina) {
      rows.push(stepCard({ key: kk, no: "0", on: !!ticks[kk], icon: QUNA, k0: true, last: true, forceOpen: true,
        title: [h("span", { text: "Get your Kina" })],
        meta: `${k.packs} Quna pack${k.packs === 1 ? "" : "s"} · ${cash(k.money)}, then ${k.exact ? "these Kina Chests:" : "Kina Chests at or under:"}`,
        ins: capChips(k), cost: null, details: () => kinaDetails(k) }));
    } else {
      const st = t.st;
      const run = t.p.steps.slice(0, t.n + 1).reduce((s, x) => s + x.cost, 0);
      rows.push(stepCard({ key: t.key, no: String(t.n + 1), on: isDone(t), icon: st.icon, tier: st.tier, last: true, forceOpen: true,
        title: stepTitle(st), meta: stepMeta(st), cob: craftOrBuy(st), ins: inputs(st.covered ? [] : st.rows), details: () => stepDetails(st),
        cost: [h("span", {}, h("span", { text: "This step " }), b(`${kfmt(st.cost)} Kina`), side(toMoney(st.cost))), h("span", { text: `so far ${kfmt(run)} Kina` })] }));
    }
    rows.push(h("div", { class: "next slim" }, h("div", { class: "bar" }, h("i", { style: `width:${(done / todo.length) * 100}%` })),
      h("div", { class: "foot" }, h("span", { text: `${done} of ${todo.length} done` }), t.st && t.st.covered ? h("span", { class: "done-btn in-hand", text: "In hand ✓" }) : h("button", { type: "button", class: "done-btn", text: ticks[t.key] ? "Undo" : "Done ✓", onclick: () => { peek = 0; change({ tick: t.key }); } }))));
  }

  // ---- the bar tooltip ----------------------------------------------------
  function showTip(bar, s, t) {
    const state = t.tier <= s.have ? ["own", "You own this"] : t.tier <= s.goal && !s.skip ? ["go", "To craft"] : ["out", "Past where it stops"];
    const click = barSets === "stop"
      ? (t.tier === s.goal ? `It stops here${t.tier <= s.have ? ": you own it, nothing to craft" : ""}` : `Click: stop at T${t.tier}${t.tier <= s.have ? " (you own it: nothing to craft)" : s.have + 1 === t.tier ? ` (craft T${t.tier})` : ` (craft T${s.have + 1} → T${t.tier})`}`)
      : s.have === t.tier ? `Click: you own up to ${t.tier > 1 ? `T${t.tier - 1}` : "nothing"}` : `Click: I own up to T${t.tier}`;
    const tip = $("tip");
    tip.replaceChildren(
      h("div", { class: "th" }, pic(t.icon, "pic sm"), h("div", {}, h("div", { class: "tn", text: `Tier ${t.tier} · ${TIER[t.tier]}` }), h("div", { class: "tt", text: t.name }))),
      h("div", { class: "ts" }, h("span", { class: `st ${state[0]}`, text: state[1] }), h("span", { class: "tc" }, t.kina == null ? h("small", { text: "no price" }) : [b(`${kfmt(t.kina)} Kina`), h("small", { text: ` · ${cash(t.money)}` })])),
      h("div", { class: "hint", text: t.tier === s.worn ? `You wear this tier. ${click}` : click }));
    for (const x of bar.parentElement.children) x.classList.toggle("hl", x === bar || [...bar.parentElement.children].indexOf(x) < [...bar.parentElement.children].indexOf(bar));
    tip.hidden = false;
    // rectangles are in the window's pixels, the tip's place in the page's (they differ by the Size)
    const rr = bar.getBoundingClientRect(), r = { left: rr.left / Z, width: rr.width / Z, top: rr.top / Z, bottom: rr.bottom / Z };
    const w = 220, hgt = tip.offsetHeight;
    tip.style.left = `${Math.min(window.innerWidth / Z - w - 6, Math.max(6, r.left + r.width / 2 - w / 2))}px`;
    tip.style.top = `${r.top - hgt - 8 < 4 ? r.bottom + 8 : r.top - hgt - 8}px`;
  }
  function hideTip() { $("tip").hidden = true; for (const x of document.querySelectorAll(".bars i.hl")) x.classList.remove("hl"); }

  // ---- window --------------------------------------------------------------
  // Flav-Toolkit owns the window: the page asks it to move (a drag on the title or the compact handle), to take the
  // height the content needs, and to hide. A drag decides which way the list faces (checked for a few seconds after,
  // since the drag is the system's and the page sees no mouseup). Nothing moves while every overlay is locked.
  let locked = false;
  const dragged = () => { let n = 0; const t = setInterval(() => { detectSide(); if (++n > 10) clearInterval(t); }, 300); };
  const moveWindow = (e) => { if (e.button === 0 && !locked && !e.target.closest("button") && ov()) { ov().drag(); dragged(); } };
  $("top").addEventListener("mousedown", moveWindow);
  // The grip sets the most height the list may take; past it the list scrolls.
  $("grip").addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || locked) return;
    e.preventDefault();
    const grip = $("grip"), y0 = e.screenY, from = heightNow || window.innerHeight;
    grip.setPointerCapture(e.pointerId);
    const most = Math.max(200, (window.screen.availHeight || 1000) - 40);
    const move = (m) => { cap = Math.round(Math.max(120, Math.min(most, from + m.screenY - y0))); heightNow = cap; ask(cap); };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      try { localStorage.setItem("cap", String(cap)); } catch { /* fine */ }
      scheduleFit();
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up, { once: true });
    grip.addEventListener("pointercancel", up, { once: true });
  });
  // Close: the list hides; the dock's icon, the hub or its key brings it back.
  const close = () => { post("/api/overlay", { shown: false }).catch(() => {}); if (ov()) ov().hide().catch(() => {}); };
  $("close").addEventListener("click", close);
  // ↻: download fresh prices (the only time the list refreshes by itself is while that runs).
  const refresh = () => (G ? change({ refresh: true }) : load());
  $("reload").addEventListener("click", refresh);
  // Locked (Flav-Toolkit's padlock, or its key in the game): the mouse goes to the game everywhere but the padlock
  // here, and a click on it unlocks every overlay.
  const setLocked = (on) => { locked = !!on; document.body.classList.toggle("locked", locked); };
  $("unlock").addEventListener("click", () => post("/api/unlock").catch(() => toast("Couldn't unlock")));
  $("set").addEventListener("click", () => { settingsOpen = !settingsOpen; render(); $("list").scrollTop = 0; });
  // The piece chips scroll sideways with the mouse wheel and the arrows.
  const chips = $("chips");
  chips.addEventListener("wheel", (e) => { chips.scrollLeft += e.deltaY + e.deltaX; e.preventDefault(); arrows(); }, { passive: false });
  chips.addEventListener("scroll", () => arrows());
  const arrows = () => {
    const over = chips.scrollWidth > chips.clientWidth + 2;
    $("chl").hidden = !over || chips.scrollLeft < 4;
    $("chr").hidden = !over || chips.scrollLeft + chips.clientWidth > chips.scrollWidth - 4;
  };
  // Hold the left button on the chip row and drag it sideways (a drag doesn't pick a chip).
  let drag = null;
  chips.addEventListener("mousedown", (e) => { if (e.button === 0) drag = { x: e.clientX, left: chips.scrollLeft, moved: false }; });
  window.addEventListener("mousemove", (e) => {
    if (!drag || !(e.buttons & 1)) { drag = null; return; }
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 4) drag.moved = true;
    if (drag.moved) { chips.style.scrollBehavior = "auto"; chips.scrollLeft = drag.left - dx; chips.classList.add("dragging"); }
  });
  window.addEventListener("mouseup", () => { if (drag?.moved) setTimeout(() => chips.classList.remove("dragging"), 0); chips.style.scrollBehavior = ""; if (!drag?.moved) drag = null; });
  chips.addEventListener("click", (e) => { if (drag?.moved) { e.stopPropagation(); e.preventDefault(); } drag = null; }, true);
  $("chl").addEventListener("click", () => chips.scrollBy({ left: -chips.clientWidth * 0.7, behavior: "smooth" }));
  $("chr").addEventListener("click", () => chips.scrollBy({ left: chips.clientWidth * 0.7, behavior: "smooth" }));
  new ResizeObserver(() => arrows()).observe(chips);
  // The window follows its content, in every mode: as tall as what is shown needs, up to the height the player
  // set with the grip (the cap; past it the list scrolls). Measured by letting the page lay itself out unconstrained
  // for one frame, and eased there over a few frames so a step change slides rather than jumps (each frame is one
  // small size call to the window, which answers the cap).
  let heightNow = null, easing = null, fitQueued = false;
  const needed = () => {
    document.body.classList.add("measure");
    const h = ($("app").offsetHeight + 2) * Z; // the page's pixels, times the Size: the window's
    document.body.classList.remove("measure");
    return Math.max(60, Math.ceil(h));
  };
  const ask = (height) => { const o = ov(); if (o) o.fit(height).catch(() => {}); };
  const fit = () => {
    fitQueued = false;
    const want = needed();
    const target = cap ? Math.min(want, Math.floor(cap)) : want;
    if (heightNow == null) { heightNow = target; return ask(target); }
    if (Math.abs(target - heightNow) < 1) return;
    const from = heightNow, t0 = performance.now(), ms = 220;
    cancelAnimationFrame(easing);
    const tick = (now) => {
      const x = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - x, 3);
      heightNow = Math.round(from + (target - from) * e);
      ask(heightNow);
      if (x < 1) easing = requestAnimationFrame(tick);
    };
    easing = requestAnimationFrame(tick);
  };
  const scheduleFit = () => { if (!fitQueued) { fitQueued = true; requestAnimationFrame(fit); } };
  // A new Size: the page scales, the window takes the same ratio in width, then the height the content needs.
  function setSize(z) {
    if (z === Z) return;
    const was = Z;
    Z = z;
    try { localStorage.setItem("size", String(z)); } catch { /* fine */ }
    document.documentElement.style.zoom = String(z);
    const o = ov();
    if (o) o.fit(heightNow || window.innerHeight, Math.round(window.innerWidth * z / was)).catch(() => {});
    render();
    scheduleFit();
  }
  $("mini").addEventListener("mousedown", moveWindow);
  $("unfold").addEventListener("click", () => $("fold").click());
  $("munlock").addEventListener("click", () => $("unlock").click());
  $("mclose").addEventListener("click", close);
  $("mset").addEventListener("click", () => { settingsOpen = !settingsOpen; render(); $("list").scrollTop = 0; });
  $("fold").addEventListener("click", () => {
    folded = !folded;
    localStorage.setItem("shop-folded", folded ? "1" : "0");
    document.body.classList.toggle("folded", folded);
    if (!folded) view = localStorage.getItem("shop-view") || "gear";
    render();
  });
  for (const t of document.querySelectorAll(".tabs button")) {
    t.addEventListener("click", () => {
      view = t.dataset.v;
      localStorage.setItem("shop-view", view);
      const pane = $("pane");
      pane.classList.remove("tabin"); void pane.offsetWidth; pane.classList.add("tabin");
      settingsOpen = false;
      render();
      $("list").scrollTop = 0;
    });
  }
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  // No refreshing on a timer: the list changes only when you press ↻, tick or pick something
  // (it loads once at start, and again if the app wasn't running then).
  const shown = (on) => { if (!on && typing) { typing = false; typingTo(false); } if (on) { detectSide(); loadCraft(); (G && !G.busy ? Promise.resolve() : load()).then(scheduleFit); } };
  // What the app tells this page as it happens: one of Dragon Gear's keys pressed in the game, or "Show in overlay"
  // pressed in its browser page (open on the piece sent, on its shopping list).
  const events = () => {
    if (typeof EventSource !== "function") return;
    const es = new EventSource("/api/events");
    es.addEventListener("open", loadCraft); // again after the app restarted: what it counts now
    // the app finished downloading prices (or reading the gear): load now, so ↻ stops when it is done
    es.addEventListener("state", () => { if (G?.busy || !G) load(); });
    // the bag changed, or the game showed Exchange prices: redraw from what the app holds (no spinner, the scroll kept)
    es.addEventListener("data", () => { if (autoOn()) quietLoad(); });
    // a crafted piece landed: the count at the top, straight away (whatever "Update by itself" says: nothing is reloaded)
    es.addEventListener("craft", (e) => { try { drawCraft(JSON.parse(e.data)); } catch { /* not ours */ } });
    es.addEventListener("hotkey", (e) => { if (e.data === "refresh" && !typing) { toast("Refreshing prices…"); refresh(); } });
    es.addEventListener("sent", () => {
      if (!folded) { view = "buy"; localStorage.setItem("shop-view", view); }
      load().then(() => { $("list").scrollTop = 0; scheduleFit(); });
    });
  };
  // The bridge to Flav-Toolkit: only the panel catches the mouse (only the padlock while locked), the lock, being shown.
  const bridge = () => {
    const o = ov();
    if (!o || bridge.done) return;
    bridge.done = true;
    o.track(() => (locked ? [document.body.classList.contains("folded") ? $("munlock") : $("unlock")] : [$("app")]));
    o.on("lock", setLocked);
    o.on("shown", shown);
    o.state().then((st) => { setLocked(st.locked); if (st.shown) shown(true); }).catch(() => {});
    scheduleFit();
  };
  if (ov()) bridge(); else window.addEventListener("flavoverlay", bridge, { once: true });
  events();
  loadCraft();
  applySide();
  detectSide();
  setInterval(() => { if (G?.busy) load(); }, 3000); // only while prices are downloading
  load();
})();
