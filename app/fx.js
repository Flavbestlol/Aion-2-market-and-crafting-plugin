'use strict';
/* Money: the Quna pack's fixed euro price turned into the currency you pick (USD, EUR or SAR).
   Exchange rates: ExchangeRate-API's free open endpoint (open.er-api.com, no key), updated once a day, kept on
   disk for a day as its terms ask. If it can't be reached, the last rates kept are used, then built-in ones. */
const fs = require('fs'), path = require('path');

const CURRENCIES = {
  USD: { code: 'USD', sym: '$', before: true },
  EUR: { code: 'EUR', sym: '€', before: true },
  SAR: { code: 'SAR', sym: 'SAR', before: false },
};
// Built-in fallback (ECB-ish rates of 2026-10-22; the riyal is pegged at 3.75 per dollar).
const FALLBACK = { at: Date.parse('2026-10-22T00:00:00Z'), source: 'built-in', rates: { EUR: 1, USD: 1.1232, SAR: 4.2121 } };
const URL_EUR = 'https://open.er-api.com/v6/latest/EUR';

function file(dataDir) { return path.join(dataDir, 'fx.json'); }
function readCache(dataDir) {
  try {
    const c = JSON.parse(fs.readFileSync(file(dataDir), 'utf8'));
    if (c && c.rates && c.rates.USD > 0 && c.rates.SAR > 0) return c;
  } catch { /* none yet */ }
  return null;
}

/* Fetch new rates when the kept ones are past their next update (or a day old). Never throws. */
async function update(dataDir) {
  const kept = readCache(dataDir);
  const due = !kept || Date.now() > Math.min(kept.next || Infinity, kept.at + 24 * 3600e3);
  if (!due) return kept;
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
    const res = await fetch(URL_EUR, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(t);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const b = await res.json();
    const usd = Number(b && b.rates && b.rates.USD), sar = Number(b && b.rates && b.rates.SAR);
    if (b.result !== 'success' || !(usd > 0.5 && usd < 3) || !(sar > 2 && sar < 10)) throw new Error('unexpected answer');
    const c = { at: (Number(b.time_last_update_unix) || Date.now() / 1000) * 1000, next: (Number(b.time_next_update_unix) || 0) * 1000 || null, fetched: Date.now(), source: 'open.er-api.com', rates: { EUR: 1, USD: usd, SAR: sar } };
    fs.writeFileSync(file(dataDir), JSON.stringify(c, null, 2));
    return c;
  } catch {
    // Keep what we have; try again in an hour rather than on every refresh.
    if (kept) { kept.next = Date.now() + 3600e3; try { fs.writeFileSync(file(dataDir), JSON.stringify(kept, null, 2)); } catch { /* fine */ } }
    return kept;
  }
}

/* What a Quna pack costs in the chosen currency, and how to write money in it. */
function money(settings, dataDir) {
  const fx = readCache(dataDir) || FALLBACK;
  const cur = CURRENCIES[settings.currency] || CURRENCIES.USD;
  const eur = Number(settings.quna_pack.eur) || 44.49, quna = Number(settings.quna_pack.quna) || 4000;
  const rate = fx.rates[cur.code] || 1;
  return { ...cur, rate, quna, eur, pack: eur * rate, fxAt: fx.at, fxSource: fx.source };
}

module.exports = { CURRENCIES, update, money };
