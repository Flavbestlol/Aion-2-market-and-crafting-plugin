// A stand-in for Flav-Toolkit's overlay window, so the real shop page runs in a plain browser.
// Each command goes to the demo Dragon Gear app on 127.0.0.1:7317 through the recorder (window.top.host),
// the same routes crates/flav-app/src/shop.rs uses. Nothing here talks to the game.
(() => {
  if (window === window.top) return;
  try { localStorage.clear(); const o = window.top.__opts || {}; for (const [k, v] of Object.entries(o)) localStorage.setItem(k, v); } catch { /* fine */ }
  const CAP = 540;
  const handlers = {};
  window.__calls = [];
  window.__fire = (n, v) => (handlers[n] || []).forEach((f) => f({ payload: v }));
  const host = (m, p, b) => window.top.host(m, p, b === undefined ? null : b);
  const live = (l) => (l && typeof l === 'object' ? { ...l, feed: { ...(l.feed || {}), state: 'connected', game: true } } : l);
  let hk = { key: 'Ctrl+R', choices: ['Ctrl+R', 'Ctrl+Shift+R', 'Alt+R', 'Off'] };
  const invoke = async (cmd, a = {}) => {
    window.__calls.push(cmd);
    switch (cmd) {
      case 'shop_gear': return host('GET', '/api/gear');
      case 'shop_list': return live(await host('GET', '/api/shopping'));
      case 'shop_change': {
        const c = { ...(a.change || {}) };
        delete c.refresh; // no price download in a recording: ↻ just reads the app again
        return live(Object.keys(c).length ? await host('POST', '/api/shop', c) : await host('GET', '/api/shopping'));
      }
      case 'shop_items': return host('GET', '/api/items?q=' + encodeURIComponent(a.q || ''));
      case 'shop_fit': { const f = window.frameElement; if (f) f.style.height = Math.min(CAP, Math.max(60, a.height)) + 'px'; return CAP; }
      case 'shop_hotkey': if (a && a.choice) hk = { ...hk, key: a.choice }; return hk;
      default: return null; // shop_typing, shop_copy, shop_toggle, shop_open_app
    }
  };
  window.__TAURI__ = {
    core: { invoke },
    event: { listen: (n, f) => { (handlers[n] = handlers[n] || []).push(f); return Promise.resolve(() => {}); } },
    window: { getCurrentWindow: () => ({ startDragging: async () => {}, startResizeDragging: async () => {} }) },
  };
  // the recorder's drawn cursor lives in the stage page: tell it where the mouse is over this window too
  const at = (e) => { const f = window.frameElement; return [e.clientX + (f ? f.offsetLeft : 0), e.clientY + (f ? f.offsetTop : 0)]; };
  document.addEventListener('mousemove', (e) => window.top.__cur(...at(e)), true);
  document.addEventListener('mousedown', (e) => window.top.__down(true, ...at(e)), true);
  document.addEventListener('mouseup', (e) => window.top.__down(false, ...at(e)), true);
  // Bahnschrift and Segoe UI are Windows fonts: close stand-ins
  const F = '/fonts/barlow-semi-condensed-latin-';
  const st = document.createElement('style');
  st.textContent = [500, 600, 700].map((w) => `@font-face{font-family:Bahnschrift;font-weight:${w};src:url('${F}${w}-normal.woff2')}`).join('') +
    "@font-face{font-family:'Segoe UI';src:local('Inter')}@font-face{font-family:'Segoe UI';font-weight:600;src:local('Inter SemiBold')}@font-face{font-family:'Segoe UI';font-weight:700;src:local('Inter Bold')}";
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
})();
