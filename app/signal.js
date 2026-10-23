'use strict';
/* Cheap / normal / pricey verdict for one piece, from tier `have` (already owned, 0 = nothing) up to tier `goal`.
   Self-contained on purpose: the report page embeds this exact function, so the page and the alerts always agree. */
function signal(report, piece, have, goal) {
  // money: in the currency picked in settings (report.settings.money: the Quna pack's price in it)
  const m = report.settings.money, perQuna = m.pack / m.quna, eurPerQuna = m.eur / m.quna;
  const sumRange = costs => { let t = 0; for (let k = have; k < goal; k++) { const v = costs[k]; if (v == null) return null; t += v; } return t; };
  const toQuna = (kina, per10m) => (kina == null || !per10m ? null : kina * per10m / 1e7);
  const kina = sumRange(piece.stages.map(s => s.cost));
  const quna = toQuna(kina, report.rate.qunaPer10m);
  const out = { kina, quna, money: quna == null ? null : quna * perQuna, eur: quna == null ? null : quna * eurPerQuna, kind: 'unknown', pct: null, usual: null, spark: [] };
  if (have >= goal) { out.kind = 'done'; return out; }
  const ms = [], kinas = [], rates = [];
  for (let i = 0; i < report.hours.length; i++) {
    const k = sumRange(piece.series[i] || []), r = report.qunaSeries[i] || report.rate.qunaPer10m, q = toQuna(k, r);
    const s = q == null ? null : q * perQuna;
    out.spark.push(s);
    if (s != null) { ms.push(s); kinas.push(k); rates.push(r); }
  }
  const median = a => { const b = a.slice().sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  if (out.money == null || ms.length < 24) { out.why = out.money == null ? 'No price for some material right now' : 'Not enough history yet'; return out; }
  out.usual = median(ms);
  out.pct = (out.money - out.usual) / out.usual * 100;
  out.kinaPct = (kina - median(kinas)) / median(kinas) * 100;
  out.ratePct = (report.rate.qunaPer10m - median(rates)) / median(rates) * 100;
  out.cheaperThan = ms.filter(s => s > out.money).length / ms.length * 100;
  let lo = 0, hi = 0; for (let i = 0; i < out.spark.length; i++) { const s = out.spark[i]; if (s == null) continue; if (out.spark[lo] == null || s < out.spark[lo]) lo = i; if (out.spark[hi] == null || s > out.spark[hi]) hi = i; }
  out.low = { money: out.spark[lo], at: report.hours[lo] }; out.high = { money: out.spark[hi], at: report.hours[hi] };
  const sorted = ms.slice().sort((x, y) => x - y);
  out.good = sorted[Math.floor(sorted.length * 0.1)]; // "good price": the cheapest 10% of hours start here
  out.kind = out.pct <= -report.settings.cheapPct ? 'cheap' : out.pct >= report.settings.expensivePct ? 'pricey' : 'normal';
  return out;
}
if (typeof module === 'object' && module.exports) module.exports = { signal };
