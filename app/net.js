'use strict';
/* Every web request the app makes goes through get() here, so three rules hold everywhere (ADDONS.md section 8):

   - only the hosts addon.json lists in permissions.network (or their subdomains), only over HTTPS;
   - a redirect is followed only on the same host, at most HOPS times; a redirect to another host is refused,
     never followed (so the list in addon.json is what the app can reach, not just what it asks first);
   - an answer is read in chunks up to a limit, and refused once it passes it: nothing is read whole first.

   It sends only what the caller gives it (the URL and headers): nothing about the player is added here. */

const path = require('path');
const fs = require('fs');

const HOPS = 3;
const MAX = 8 * 1024 * 1024;   // the default limit; callers that know their answer is small pass a smaller one
const TIMEOUT_MS = 30000;

let hosts = null;
function allowedHosts() {
  if (!hosts) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'addon.json'), 'utf8'));
      hosts = (m.permissions && Array.isArray(m.permissions.network) ? m.permissions.network : []).filter(h => typeof h === 'string' && /^[a-z0-9.-]{1,253}$/.test(h));
    } catch { hosts = []; }
  }
  return hosts;
}
const allowed = host => allowedHosts().some(h => host === h || host.endsWith('.' + h));

/* GET `url`. Returns { status, ok, headers, url, body: Buffer, text(), json() } for any HTTP answer (the caller
   decides what a 403 or 404 means); throws for a host not listed, a redirect elsewhere, a timeout or an answer over
   `max` bytes. */
async function get(url, { headers = {}, max = MAX, timeoutMs = TIMEOUT_MS } = {}) {
  let at = new URL(url);
  const first = at.hostname;
  if (at.protocol !== 'https:') throw new Error('only HTTPS is asked');
  if (!allowed(first)) throw new Error(first + ' is not in addon.json permissions.network');
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    for (let hop = 0; ; hop++) {
      const res = await fetch(at, { signal: ctl.signal, headers, redirect: 'manual' });
      if (res.status >= 300 && res.status < 400) {
        const to = res.headers.get('location');
        try { await res.body?.cancel(); } catch { /* nothing to drop */ }
        if (!to) throw new Error('HTTP ' + res.status + ' without a location');
        const next = new URL(to, at);
        if (next.hostname !== first || next.protocol !== 'https:') throw new Error('redirected to ' + next.hostname + ': refused (another host)');
        if (hop >= HOPS) throw new Error('too many redirects');
        at = next;
        continue;
      }
      const len = Number(res.headers.get('content-length'));
      if (len > max) { try { await res.body?.cancel(); } catch { /* fine */ } throw new Error('answer too large'); }
      const chunks = []; let size = 0;
      if (res.body) {
        for await (const c of res.body) {
          size += c.length;
          if (size > max) { ctl.abort(); throw new Error('answer too large'); }
          chunks.push(Buffer.from(c));
        }
      }
      const body = Buffer.concat(chunks);
      return {
        status: res.status, ok: res.ok, headers: res.headers, url: at.href, body,
        text: () => body.toString('utf8'),
        json: () => JSON.parse(body.toString('utf8')),
      };
    }
  } finally { clearTimeout(t); }
}

module.exports = { get, allowed, HOPS, MAX };
