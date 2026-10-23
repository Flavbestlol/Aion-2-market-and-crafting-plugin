'use strict';
/* Who is playing, as Flav-Toolkit read it from the game at world entry.

   Flav-Toolkit posts two events to /api/me (the same JSON its event feed carries):
     my_server   { server: 1107 }                                       the server's id (servers.json)
     my_profile  { name: 'Sampleton', class: 'Ranger', level: 40 }      the character; class as the game's parser
                                                                         names it (the global game calls Elementalist
                                                                         "Spiritmaster"), level when the packet had it
   This keeps the latest, maps the class to the one this app plans gear for, and tells the server what changed, so it
   can set the character (name + server → the gear read from the official site, no typing) and the class. Nothing else
   about the player arrives here: no character id, no account. */

const fs = require('fs');

// the game's class names (Flav-Toolkit, from the meter's parser) → the names this app and the official site use
const CLASS_OF = { Gladiator: 'Gladiator', Templar: 'Templar', Assassin: 'Assassin', Ranger: 'Ranger', Sorcerer: 'Sorcerer', Elementalist: 'Spiritmaster', Spiritmaster: 'Spiritmaster', Cleric: 'Cleric', Chanter: 'Chanter' };
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // older than this, "last seen" is history

class Me {
  constructor(file) {
    this.file = file;
    this.name = null;      // the character's name
    this.serverId = null;  // its server (servers.json id)
    this.class = null;     // mapped: one of Slots.CLASSES, or null when the game's class is not one this app plans for
    this.gameClass = null; // as the game said it
    this.level = null;
    this.at = 0;           // when the last event arrived (ms)
    this.load();
  }

  /* One event from Flav-Toolkit. Returns what changed, { name, server, class } (each a boolean), or null for anything
     that is not one of the two events. */
  take(event) {
    if (!event || typeof event !== 'object') return null;
    const at = Number(event.at_ms) > 0 ? Number(event.at_ms) : Date.now();
    const changed = { name: false, server: false, class: false };
    if (event.type === 'my_server') {
      const id = Number(event.server);
      if (!Number.isInteger(id) || id <= 0) return null;
      changed.server = id !== this.serverId;
      this.serverId = id;
    } else if (event.type === 'my_profile') {
      const name = String(event.name || '').trim().slice(0, 40);
      if (!name) return null;
      changed.name = name !== this.name;
      this.name = name;
      if (event.class != null) {
        const game = String(event.class);
        const cls = CLASS_OF[game] || null;
        changed.class = cls !== this.class;
        this.class = cls; this.gameClass = game;
      }
      if (Number.isInteger(Number(event.level)) && Number(event.level) > 0) this.level = Number(event.level);
    } else return null;
    this.at = at;
    this.save();
    return changed;
  }

  /* The character is known: a name and a server. */
  known() { return !!(this.name && this.serverId); }
  fresh(now = Date.now()) { return this.at > 0 && now - this.at <= MAX_AGE_MS; }

  status(now = Date.now()) {
    return { seen: this.at > 0, fresh: this.fresh(now), name: this.name, serverId: this.serverId, class: this.class, gameClass: this.gameClass, level: this.level, at: this.at ? new Date(this.at).toISOString() : null, ageMin: this.at ? Math.round((now - this.at) / 60000) : null };
  }

  save() {
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ name: this.name, serverId: this.serverId, class: this.class, gameClass: this.gameClass, level: this.level, at: this.at }));
      fs.renameSync(tmp, this.file);
    } catch (e) { /* a convenience; the next login brings it back */ }
  }

  load() {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.name = j.name ? String(j.name).slice(0, 40) : null;
      this.serverId = Number.isInteger(Number(j.serverId)) && Number(j.serverId) > 0 ? Number(j.serverId) : null;
      this.class = CLASS_OF[j.class] || null;
      this.gameClass = j.gameClass ? String(j.gameClass) : null;
      this.level = Number(j.level) > 0 ? Number(j.level) : null;
      this.at = Number(j.at) || 0;
    } catch (e) { /* no file yet */ }
  }
}

module.exports = { Me, CLASS_OF, MAX_AGE_MS };
