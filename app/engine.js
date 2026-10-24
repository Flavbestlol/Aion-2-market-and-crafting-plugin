'use strict';
/* Dragon Gear cost engine — Flavbest's own implementation of the craft-or-buy model that
   a2-tracker.com's Dragon Gear tab describes (cheapest path, client success rates, NPC prices,
   lucky-result ladder for the Artisan's Splendent item, transfer tiers 2-6 always succeed).
   No code from the site is used; only its public JSON data. */

const DEPTH = 8;
const RULE = /^Recipe_(Blacksmithing|Tailoring|Jewelcrafting|Alchemy)_([LD])_(wp|ar|acc)_(.+)_Unique_0(01|1[1-5])$/;
const TIERS = {
  elyos: ['True Dragon', 'Splendent True Dragon', 'White Dragon', 'Splendent White Dragon', 'Wise Dragon', 'Splendent Wise Dragon'],
  asmodian: ['Star Dragon', 'Splendent Star Dragon', 'Dark Dragon', 'Splendent Dark Dragon', 'Ebony Dragon', 'Splendent Ebony Dragon'],
};
const SLOT = { wp: 'weapon', ar: 'armor', acc: 'accessory' };
const SIDE = { L: 'elyos', D: 'asmodian' };

const num = v => (v == null || v === '' ? null : Number(v));

/* Combo outcomes become their own "lucky result" recipes (crafting X and hitting the combo gives the Splendent item). */
function recipeViews(source) {
  const linked = new Set(source.filter(r => r.combo && r.combo.recipeId).map(r => r.combo.recipeId));
  const list = source.filter(r => !r.isComboResult || !linked.has(r.id))
    .map(r => (r.isComboResult ? { ...r, calculable: false, visibleInClientUi: false } : { ...r }));
  for (const r of source) {
    if (!r.combo || !r.combo.itemId) continue;
    const verified = r.combo.probabilityVerified !== false && r.combo.probability != null;
    list.push({
      ...r, id: 'outcome-' + r.id, itemId: r.combo.itemId, outputQuantity: r.combo.quantity ?? null,
      parentRecipeId: r.id, viewKind: 'conditional-outcome', isComboResult: false,
      requiresConditionalProbability: true, outcomeProbabilityRaw: r.combo.probabilityRaw ?? null,
      outcomeProbability: verified ? r.combo.probability : null, outcomeVerified: verified, combo: null,
    });
  }
  return list;
}

function createEngine(catalogue, opts) {
  const items = catalogue.items || {};
  const faction = opts.faction;
  const recipes = recipeViews(catalogue.recipes || []);
  const byItem = new Map();
  for (const r of recipes) { const k = String(r.itemId); if (!byItem.has(k)) byItem.set(k, []); byItem.get(k).push(r); }
  const recipeById = new Map(recipes.map(r => [r.id, r]));
  const isChest = id => items[String(id)] && items[String(id)].marketKind === 'kina-chests';

  function blocked(r) {
    if (r.visibleInClientUi === false) return true;
    if (r.hasUnresolvedAdditionalInputs || (r.additionalItemReferences || []).some(i => i.quantity == null)) return true;
    if (r.isComboResult || r.calculable === false || !(r.ingredients || []).length) return true;
    if (r.resultEnchantLevel > 0 || r.ingredients.some(i => i.enchantLevel > 0)) return true;
    if ((r.marketKind && r.marketKind !== 'items') || isChest(r.itemId) ||
      r.ingredients.some(i => i.itemType === 'Currency' || (i.marketKind && i.marketKind !== 'items') || isChest(i.itemId))) return true;
    if (r.ingredients.some(i => !Number.isSafeInteger(Number(i.quantity)) || Number(i.quantity) < 1)) return true;
    return false;
  }
  const applicable = r => !r.faction || r.faction === 'all' || r.faction === 'both' || !faction || r.faction === faction;
  const usable = r => !blocked(r);

  function npcPrice(id) {
    const offers = (catalogue.npcPrices || {})[String(id)];
    if (!Array.isArray(offers)) return null;
    let best = null;
    for (const o of offers) {
      if (o.faction && faction && o.faction !== faction) continue;
      const unit = Number(o.price) / Number(o.bundle);
      if (unit > 0 && Number.isFinite(unit) && (best == null || unit < best)) best = unit;
    }
    return best;
  }
  const npcCache = new Map();
  const npcOf = id => { const k = String(id); if (!npcCache.has(k)) npcCache.set(k, npcPrice(k)); return npcCache.get(k); };

  function successOf(r, level) {
    let base = r.successVerified && r.successProbability != null ? Number(r.successProbability) : null;
    if (base == null) {
      const t = r.successRates;
      if (t && Array.isArray(t.rates) && t.rates.length) {
        const min = Number(t.minGap) || 0, last = min + t.rates.length - 1, scale = Number(t.scale || 1000000);
        let gap;
        if (level == null) gap = last;
        else { if (!(level >= 1)) return null; gap = Math.floor(level) - Number(r.requiredMastery || 0); }
        if (gap < min) return null; // proficiency below the recipe's mastery: cannot craft
        if (gap > last) gap = last;
        base = Number(t.rates[gap - min]) / (scale * 100);
      } else base = 1;
    }
    const conditional = r.viewKind === 'conditional-outcome' || r.requiresConditionalProbability === true;
    if (!conditional) return base;
    const own = r.outcomeVerified && r.outcomeProbability != null ? Number(r.outcomeProbability) : null;
    const lucky = own != null ? own : (r.outcomeProbabilityRaw != null && Number(r.outcomeProbabilityRaw) > 0 ? Number(r.outcomeProbabilityRaw) / 10000 : null);
    if (!lucky || lucky <= 0) return null;
    return base * lucky;
  }

  /* One price snapshot: market(id) -> Kinah ask or null. Returns analysis functions bound to it. */
  function snapshot(market, level) {
    const lvl = r => (level ? level(r.profession) : null);
    const buyOf = id => {
      const m = isChest(id) ? null : market(id), n = npcOf(id);
      if (n != null && (m == null || n < m)) return { price: n, npc: true };
      return m != null ? { price: m, npc: false } : null;
    };
    const yieldOf = r => {
      const p = successOf(r, lvl(r)), out = r.outputQuantity;
      if (p == null || !(p > 0) || p > 1 || out == null || !Number.isSafeInteger(Number(out)) || Number(out) < 1) return null;
      return { chance: p, perAttempt: Number(out) * p };
    };
    const optionsOf = input => [input, ...(input.alternatives || []), ...(input.combine || [])]
      .filter(x => x && x.quantityKnown !== false && Number(x.quantity) > 0);
    const candidates = id => (byItem.get(String(id)) || []).filter(r => r.calculable !== false && applicable(r) && usable(r) && (r.ingredients || []).length);

    /* What one more of an item costs to craft right now, by the cheapest path for its inputs (bought at their cheapest
       listing or crafted, as the plan does): null when it can't be crafted. For the buy-or-craft split of a step. */
    function craftUnit(id) {
      let best = null;
      for (const r of candidates(id)) {
        const a = analyze(r);
        if (a.cost != null && (best == null || a.cost < best)) best = a.cost;
      }
      return best;
    }
    function analyze(target) {
      const memo = new Map(), busy = new Set();
      function craftCost(r, depth) {
        const y = yieldOf(r); if (!y) return null;
        let attempt = 0; const picks = [];
        for (const input of r.ingredients || []) {
          let best = null;
          for (const opt of optionsOf(input)) {
            const b = resolve(String(opt.itemId), depth + 1);
            if (b.unit == null) continue;
            const line = Number(opt.quantity) * b.unit;
            if (!best || line < best.line) best = { opt, line };
          }
          if (!best) return null;
          attempt += best.line; picks.push(best.opt);
        }
        if (!picks.length) return null;
        return { recipe: r, unit: attempt / y.perAttempt, picks, yield: y };
      }
      function resolve(key, depth) {
        if (memo.has(key)) return memo.get(key);
        const b = buyOf(key);
        const out = { itemId: key, buy: b ? b.price : null, unit: b ? b.price : null, source: b ? 'buy' : null, npc: !!(b && b.npc), craft: null };
        if (busy.has(key) || depth > DEPTH) return out;
        busy.add(key);
        for (const r of candidates(key)) { const c = craftCost(r, depth); if (c && (!out.craft || c.unit < out.craft.unit)) out.craft = c; }
        busy.delete(key);
        if (out.craft) {
          const tier = out.craft.recipe.viewKind === 'conditional-outcome', convert = out.craft.recipe.method === 'convert';
          const craft = tier && !convert ? true : (!convert && out.unit != null ? false : (out.unit == null || out.craft.unit < out.unit));
          if (craft) { out.unit = out.craft.unit; out.source = convert ? 'convert' : 'craft'; }
        }
        memo.set(key, out);
        return out;
      }
      const res = { cost: null, chance: null, blocker: null, materials: [] };
      busy.add(String(target.itemId)); const top = craftCost(target, 0); busy.delete(String(target.itemId));
      if (target.calculable === false || !usable(target)) { res.blocker = 'reference'; return res; }
      const ty = yieldOf(target); res.chance = ty ? ty.chance : null;
      if (!ty) { res.blocker = 'chance'; return res; }
      if (!top) {
        res.blocker = 'prices';
        res.missing = [...new Set((target.ingredients || []).filter(i => !optionsOf(i).some(x => resolve(String(x.itemId), 1).unit != null)).map(i => String(i.itemId)))];
        return res;
      }
      res.cost = top.unit; res.perAttempt = ty.perAttempt;
      // Expand the chosen path into bought leaf materials (for the "what you need" list).
      // Also the crafting steps, deepest first (crafting order), as a2-tracker's recipe page lists them.
      const leaves = new Map(), active = new Set(), steps = new Map(), order = [];
      (function expand(plan, count) {
        if (active.has(plan.recipe.id)) return; active.add(plan.recipe.id);
        const attempts = count / plan.yield.perAttempt;
        let st = steps.get(plan.recipe.id);
        if (!st) { st = { recipeId: plan.recipe.id, itemId: String(plan.recipe.itemId), method: plan.recipe.method, profession: plan.recipe.profession, mastery: plan.recipe.requiredMastery, lucky: plan.recipe.viewKind === 'conditional-outcome', baseItemId: plan.recipe.parentRecipeId && recipeById.get(plan.recipe.parentRecipeId) ? String(recipeById.get(plan.recipe.parentRecipeId).itemId) : null, chance: plan.yield.chance, output: plan.yield.output, attempts: 0, makes: 0, rows: new Map() }; steps.set(plan.recipe.id, st); }
        st.attempts += attempts; st.makes += count;
        for (const opt of plan.picks) {
          const need = attempts * Number(opt.quantity), k = String(opt.itemId), info = memo.get(k) || resolve(k, 1);
          const crafted = !(info.source === 'buy' || !info.craft);
          const row = st.rows.get(k) || { itemId: k, perAttempt: Number(opt.quantity), count: 0, source: crafted ? info.source : (info.npc ? 'npc' : 'buy'), unit: info.unit, recipeId: crafted ? info.craft.recipe.id : null };
          row.count += need; st.rows.set(k, row);
          if (!crafted) {
            const l = leaves.get(k) || { itemId: k, count: 0, unit: info.unit, npc: info.npc, cost: 0 };
            l.count += need; l.cost += need * info.unit; leaves.set(k, l);
          } else expand(info.craft, need);
        }
        if (!order.includes(plan.recipe.id)) order.push(plan.recipe.id);
        active.delete(plan.recipe.id);
      })(top, 1);
      res.materials = [...leaves.values()].sort((a, b) => b.cost - a.cost);
      res.steps = order.map(id => { const s = steps.get(id); return { ...s, rows: [...s.rows.values()] }; });
      return res;
    }
    return { analyze, market, craftUnit };
  }

  /* Dragon Gear chains: one per gear piece, six tiers each. */
  function chains(group) {
    const ladders = new Map(), groups = new Map();
    for (const r of recipes) if (r.viewKind === 'conditional-outcome' && (!r.faction || r.faction === faction) && !ladders.has(String(r.itemId))) ladders.set(String(r.itemId), r);
    for (const r of recipes) {
      if (r.viewKind === 'conditional-outcome') continue;
      const m = RULE.exec(String((r.client && r.client.recipeKey) || '')); if (!m) continue;
      const p = { tier: m[5] === '01' ? 1 : Number(m[5].slice(1)) + 1, profession: m[1], faction: SIDE[m[2]], group: SLOT[m[3]], gear: m[4] };
      if (p.faction !== faction || (r.faction && r.faction !== faction)) continue;
      if (group && p.group !== group) continue;
      const key = p.profession + '_' + p.gear;
      if (!groups.has(key)) groups.set(key, { key, gear: p.gear, group: p.group, byTier: new Map() });
      const g = groups.get(key); if (!g.byTier.has(p.tier)) g.byTier.set(p.tier, r);
    }
    const out = [];
    for (const g of groups.values()) {
      if (g.byTier.size !== 6) continue;
      const tiers = [];
      for (let t = 1; t <= 6; t++) {
        const r = g.byTier.get(t), gear = (r.ingredients || []).find(i => i && i.itemType === 'Equip');
        let skipped = false;
        const stage = {
          ...r, id: 'dragon:' + r.id,
          ingredients: (r.ingredients || []).filter(i => { if (!skipped && gear && i === gear) { skipped = true; return false; } return true; }),
          additionalItemReferences: [], hasUnresolvedAdditionalInputs: false, calculable: true, combo: null,
        };
        if (t > 1) { stage.successProbability = '1'; stage.successVerified = true; stage.successRates = null; }
        tiers.push({
          tier: t, name: (TIERS[faction] || [])[t - 1] || 'Tier ' + t, itemId: String(r.itemId), recipe: r, stage,
          artisan: gear ? { itemId: String(gear.itemId), quantity: Number(gear.quantity), ladder: ladders.get(String(gear.itemId)) || null } : null,
        });
      }
      out.push({ key: g.key, gear: g.gear, group: g.group, profession: tiers[0].recipe.profession, tiers });
    }
    return out.sort((a, b) => (a.key < b.key ? -1 : 1));
  }

  /* Cost of the whole climb for one chain against one snapshot. */
  function climb(chain, snap) {
    const stages = []; let running = 0, unknownFrom = null;
    for (const step of chain.tiers) {
      const a = snap.analyze(step.stage);
      let materials = null, cost = null, artisan = null, reason = null;
      if (a.cost != null) materials = a.cost;
      else if (!step.stage.ingredients.length && a.blocker === 'prices' && a.chance) materials = 0;
      else reason = a.blocker === 'prices' ? 'missing prices' : a.blocker === 'chance' ? 'cannot craft at your proficiency' : 'not calculable';
      const perAttempt = a.chance ? Math.max(1, Number(step.stage.outputQuantity) || 1) * a.chance : null;
      if (step.artisan) {
        const buy = snap.market(step.artisan.itemId);
        const lad = step.artisan.ladder ? snap.analyze(step.artisan.ladder) : null;
        const craft = lad && lad.cost != null ? lad.cost : null;
        const useCraft = craft != null && (buy == null || craft < buy);
        const unit = useCraft ? craft : buy;
        const count = perAttempt ? step.artisan.quantity / perAttempt : null;
        artisan = { itemId: step.artisan.itemId, buy, craft, unit, source: useCraft ? 'craft' : buy != null ? 'buy' : null, count, line: unit != null && count != null ? unit * count : null, ladderMaterials: lad ? lad.materials : [], ladderSteps: lad && lad.steps ? lad.steps : [] };
        if (!reason && unit == null) reason = 'Artisan item has no price';
      }
      if (!reason && materials != null && perAttempt) cost = materials + (artisan ? artisan.line : 0);
      if (cost == null && unknownFrom == null) unknownFrom = step.tier;
      if (unknownFrom == null) running += cost;
      stages.push({ tier: step.tier, name: step.name, itemId: step.itemId, previous: chain.tiers[step.tier - 2] ? chain.tiers[step.tier - 2].itemId : null, chance: a.chance, materialsCost: materials, materials: a.materials, steps: a.steps || [], artisan, cost, reason, cumulative: unknownFrom == null ? running : null });
    }
    return { chain, stages };
  }

  /* Recipes a profession can use to level (for the leveling estimator). */
  function professionRecipes(profession) {
    return recipes.filter(r => r.profession === profession && r.viewKind !== 'conditional-outcome' && applicable(r) && usable(r));
  }
  return { items, recipes, chains, snapshot, climb, professionRecipes, successOf, name: id => (items[String(id)] && items[String(id)].name) || 'Item ' + id };
}

module.exports = { createEngine, TIERS };
