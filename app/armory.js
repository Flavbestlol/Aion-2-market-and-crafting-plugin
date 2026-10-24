'use strict';
/* A character's worn gear from the official AION 2 site — a JavaScript port of Flav-Toolkit's flav-armory
   (same endpoints the site's own character page uses, same manners: one request at a time at least 1 s apart,
   answers kept 10 minutes, and 10 minutes of silence after the site says "too many" (403/429)).
   Only the character name and server are sent, only to the official site. */
const SERVERS = require('./servers.json'); // from Flav-Toolkit (eiruuru/aion2-char-sheet, GPL-3.0)

const SEARCH = 'https://api-search.plaync.com/aion2global/search/v2/character';
const INFO = 'https://aion2.plaync.com/api/character/info';
const EQUIPMENT = 'https://aion2.plaync.com/api/character/equipment';
const GAP = 1000, KEEP = 600000, HOLD = 600000;
// Says who is asking, honestly. No Origin or Referer: the add-on is not the official site's own page.
const HEADERS = { 'User-Agent': 'Flav-Toolkit Dragon Gear Prices (+https://github.com/Flavbestlol/flav-toolkit)', Accept: 'application/json' };

let last = 0, heldUntil = 0;
const cache = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plain = s => String(s || '').replace(/<[^>]*>/g, '').trim();

function server(id) { const s = SERVERS[String(id)]; return s ? { id: Number(id), ...s } : null; }
function serverList() { return Object.entries(SERVERS).map(([id, s]) => ({ id: Number(id), ...s })).sort((a, b) => a.region.localeCompare(b.region) || a.faction.localeCompare(b.faction) || a.name.localeCompare(b.name)); }

let queue = Promise.resolve();
function get(url) {
  const run = async () => {
    if (Date.now() < heldUntil) throw new Error('The official site asked us to slow down; trying again in ' + Math.ceil((heldUntil - Date.now()) / 60000) + ' min.');
    const wait = last + GAP - Date.now(); if (wait > 0) await sleep(wait);
    last = Date.now();
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
    let res;
    try {
      res = await fetch(url, { signal: ctl.signal, headers: HEADERS });
    } finally { clearTimeout(t); }
    if (res.status === 403 || res.status === 429) { heldUntil = Date.now() + HOLD; throw new Error('The official site asked us to slow down; trying again in 10 min.'); }
    if (res.status === 404) throw new Error('Character not found on that server.');
    if (!res.ok) throw new Error('The official site answered ' + res.status + '.');
    return res.json();
  };
  const p = queue.then(run, run); queue = p.catch(() => {}); return p;
}

/* Profile + worn items, by exact name and server id. */
async function lookup(name, serverId, { fresh = false } = {}) {
  const s = server(serverId); if (!s) throw new Error('Unknown server ' + serverId + '.');
  const key = s.id + ':' + name;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < KEEP) return hit.value;
  const search = await get(SEARCH + '?keyword=' + encodeURIComponent(name) + '&region=' + s.region + '&localeInfo=en-US&serverId=' + s.id + '&page=1&size=10');
  const found = (search.list || []).find(h => plain(h.name) === name && Number(h.serverId) === s.id);
  if (!found || !found.characterId) throw new Error('No character called "' + name + '" on ' + s.name + ' (' + s.region.toUpperCase() + ').');
  const id = decodeURIComponent(found.characterId);
  const q = '?lang=en-US&region=' + s.region + '&serverId=' + s.id + '&characterId=' + encodeURIComponent(id);
  const info = await get(INFO + q);
  const p = info.profile || {};
  const stat = ((info.stat || {}).statList || []).find(x => x.type === 'ItemLevel');
  const equip = await get(EQUIPMENT + q);
  const value = {
    profile: { name: p.characterName, serverId: p.serverId, serverName: p.serverName, region: s.region, className: p.className, level: p.characterLevel, combatPower: p.combatPower, gearScore: stat ? stat.value : null, faction: p.raceName, portrait: p.profileImage || null,
      page: 'https://aion2.plaync.com/en-us/characters/' + s.id + '/' + encodeURIComponent(id) + '?region=' + s.region },
    items: ((equip.equipment || {}).equipmentList || []).map(e => ({ slot: e.slotPosName, id: String(e.id), name: e.name, grade: e.grade, enchant: e.enchantLevel || 0, exceed: e.exceedLevel || 0, icon: e.icon })),
    at: Date.now(),
  };
  if (!value.profile.name) throw new Error('The official site answered something unexpected.');
  cache.set(key, { at: Date.now(), value });
  return value;
}

module.exports = { lookup, server, serverList, HEADERS };
