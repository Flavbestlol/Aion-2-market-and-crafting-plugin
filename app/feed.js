'use strict';
/* Flav-Toolkit's event feed, read by this app itself (the add-on contract, ADDONS.md section 4).

   The core writes %APPDATA%\com.flavbest.flav-toolkit\feed.json while it runs ({ feed: 1, port, token, ... }) and
   deletes it at quit. This connects to ws://127.0.0.1:<port>/feed?token=<token>, says hello as `market-crafting`
   with the event types it wants, beats every 2 s, and hands every event to the server (the Exchange, the inventory,
   who is playing). It also raises notes (`notify`) the hub and the dock show, with the item's picture from this app.
   Nothing here reaches past this PC: the feed is local, the token is the core's, and a replay (someone's recording)
   is not acted on.

   Needs Node's built-in WebSocket client (Node 22+; the app ships Node 24). Without the core running it just waits:
   feed.json appears, it connects; the core quits, it waits again. */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ID = 'market-crafting';
const TYPES = ['market-summary', 'market-listings', 'item-stats', 'inventory', 'my_profile', 'my_server'];
const LOOK_MS = 3000;     // how often feed.json is looked for while not connected
const HOLD_MS = 30000;    // after a refusal (wrong version, unknown type): wait before trying again
const BEAT_MS = 2000;

const feedFile = () => process.env.FLAV_FEED_FILE || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'com.flavbest.flav-toolkit', 'feed.json');

class Feed {
  /* onEvent(event): one game event; onStatus({ capturing, game, source, text }); version: this add-on's. */
  constructor({ version, onEvent, onStatus = null } = {}) {
    this.version = version || '0.0.0';
    this.onEvent = onEvent || (() => {});
    this.onStatus = onStatus;
    this.sock = null; this.beatTimer = null; this.holdUntil = 0;
    this.state = 'waiting';   // waiting | connecting | connected | refused: … | disconnected
    this.core = null; this.source = null; this.game = false; this.capturing = false; this.text = null;
    this.events = 0; this.connectedAt = 0; this.note = '';
    this.notes = new Map();   // title -> note, re-raised after a reconnect
    this.timer = setInterval(() => this.tick(), LOOK_MS);
    this.timer.unref && this.timer.unref();
    this.tick();
  }

  tick() {
    if (this.sock || Date.now() < this.holdUntil) return;
    const info = this.read();
    if (!info) { if (this.state !== 'disconnected') this.state = 'waiting'; return; }
    this.connect(info);
  }

  read() {
    try {
      const j = JSON.parse(fs.readFileSync(feedFile(), 'utf8'));
      const port = Number(j.port);
      if (Number(j.feed) !== 1 || !Number.isInteger(port) || port <= 0 || typeof j.token !== 'string' || !j.token) return null;
      return { port, token: j.token, core: j.core };
    } catch { return null; }
  }

  connect(info) {
    if (typeof WebSocket !== 'function') { this.state = 'this Node has no WebSocket client'; return; }
    let ws;
    try { ws = new WebSocket('ws://127.0.0.1:' + info.port + '/feed?token=' + encodeURIComponent(info.token)); } catch { this.state = 'cannot connect'; return; }
    this.sock = ws; this.state = 'connecting';
    ws.addEventListener('open', () => this.send({ op: 'hello', addon: ID, version: this.version, events: 1, types: TYPES }));
    ws.addEventListener('message', m => this.take(typeof m.data === 'string' ? m.data : String(m.data)));
    ws.addEventListener('close', () => this.drop());
    ws.addEventListener('error', () => this.drop());
  }

  take(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    switch (msg.op) {
      case 'welcome':
        this.state = 'connected'; this.core = msg.core || null; this.connectedAt = Date.now();
        this.status(msg.status);
        this.beat();
        clearInterval(this.beatTimer); this.beatTimer = setInterval(() => this.beat(), BEAT_MS);
        for (const n of this.notes.values()) this.send(n); // the core forgot them with the connection
        break;
      case 'refused':
        this.state = 'refused: ' + String(msg.reason || 'no reason given');
        this.holdUntil = Date.now() + HOLD_MS;
        break;
      case 'event':
        // a replay is someone's recording: the Exchange, the bag and the character must stay the player's own
        if (this.source === 'replay') return;
        this.events++;
        try { this.onEvent(msg.event); } catch { /* one bad event never ends the feed */ }
        break;
      case 'status':
        this.status(msg);
        break;
      default: break;
    }
  }

  status(s) {
    if (!s || typeof s !== 'object') return;
    this.source = s.source || null; this.game = !!s.game; this.capturing = !!s.capturing; this.text = s.text || null;
    if (this.onStatus) { try { this.onStatus(s); } catch { /* fine */ } }
  }

  beat() { this.send({ op: 'beat', ok: true, note: String(this.note || '').slice(0, 80) }); }

  send(o) {
    if (!this.sock || this.sock.readyState !== 1) return false;
    try { this.sock.send(JSON.stringify(o)); return true; } catch { return false; }
  }

  drop() {
    clearInterval(this.beatTimer); this.beatTimer = null;
    this.sock = null;
    if (!this.state.startsWith('refused')) this.state = 'disconnected';
    this.core = null; this.game = false; this.capturing = false; this.source = null;
  }

  /* A note for the player: the hub lists it, the dock lights the icon up with the picture. `icon` is this app's own
     picture of the item (an http://127.0.0.1:<port>/icon/<id> address) or nothing for the add-on's icon. The same
     title replaces the earlier note; `unnotify` takes it back. */
  notify(title, text, icon = null, level = 'alert') {
    const note = { op: 'notify', level, title: String(title).slice(0, 80), text: String(text || '').slice(0, 160), icon: icon ? { url: icon } : 'addon' };
    this.notes.set(note.title, note);
    if (this.notes.size > 20) this.notes.delete(this.notes.keys().next().value);
    return this.send(note);
  }
  unnotify(title) { this.notes.delete(String(title).slice(0, 80)); return this.send({ op: 'unnotify', title: String(title).slice(0, 80) }); }
  log(level, msg) { return this.send({ op: 'log', level, msg: String(msg).slice(0, 300) }); }

  info() {
    return { state: this.state, core: this.core, source: this.source, game: this.game, capturing: this.capturing, text: this.text, events: this.events, since: this.connectedAt ? new Date(this.connectedAt).toISOString() : null, file: feedFile() };
  }

  close() { clearInterval(this.timer); clearInterval(this.beatTimer); try { this.sock && this.sock.close(); } catch { /* fine */ } this.sock = null; }
}

module.exports = { Feed, ID, TYPES, feedFile };
