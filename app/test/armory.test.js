'use strict';
/* The gear lookup on the official site: what it sends, and what it keeps from the answers. The network is faked. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Armory = require('../armory');

test('the lookup sends an honest User-Agent and no Origin or Referer', async () => {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    seen.push({ url: String(url), headers: opts.headers });
    const u = new URL(url);
    const body = u.hostname === 'api-search.plaync.com'
      ? { list: [{ name: '<b>Sampleton</b>', serverId: 1307, characterId: 'abc%3D' }] }
      : u.pathname.endsWith('/info')
        ? { profile: { characterName: 'Sampleton', serverId: 1307, serverName: 'Fregion', className: 'Ranger', characterLevel: 40 }, stat: { statList: [] } }
        : { equipment: { equipmentList: [{ slotPosName: 'Helmet', id: 1, name: 'A helm', grade: 'Rare', enchantLevel: 3, icon: 'https://assets.playnccdn.com/x.png' }] } };
    return { ok: true, status: 200, json: async () => body };
  };
  try {
    const r = await Armory.lookup('Sampleton', 1307, { fresh: true });
    assert.equal(r.profile.name, 'Sampleton');
    assert.equal(r.items.length, 1);
  } finally { globalThis.fetch = real; }
  assert.equal(seen.length, 3, 'search, profile, equipment');
  for (const s of seen) {
    const keys = Object.keys(s.headers).map(k => k.toLowerCase());
    assert.ok(!keys.includes('origin'), s.url + ' sends no Origin');
    assert.ok(!keys.includes('referer'), s.url + ' sends no Referer');
    assert.match(s.headers['User-Agent'], /^Flav-Toolkit Dragon Gear Prices/);
    assert.ok(s.url.startsWith('https://'), 'HTTPS only');
  }
});
