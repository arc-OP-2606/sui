/* sui — エンジン: 既定値、季節、スコア、役割付け、飲み方、階段、検索、色派生。DOM 不要。 */
(function (global) {
  'use strict';
  const SUI = global.SUI = global.SUI || {};
  const C = SUI.color;
  const byId = (list, id) => list.find(x => x.id === id) || null;

  function all() { return [].concat(SUI.WINES || [], SUI.SAKES || []); }
  function bottleById(id) { return all().find(b => b.id === id) || null; }
  function defaults() { return { kind: 'any', place: 'home', purpose: 'daily', sub: null, mood: 'cozy', food: 'none', budget: 'b3000' }; }
  function seasonOf(d) { const m = (d || new Date()).getMonth() + 1; return (SUI.SEASONS.find(s => s.months.includes(m)) || SUI.SEASONS[0]).id; }
  function daypart(d) { const h = (d || new Date()).getHours(); return (h >= 18 || h < 5) ? 'night' : 'day'; }
  function rng(seed) { let a = (seed >>> 0) || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  const TIER_RANK = { daily: 0, mid: 1, prestige: 2, legend: 3 };
  function budgetMax(sel) { const b = byId(SUI.BUDGETS, sel.budget); return b ? b.max : Infinity; }
  function affordable(b, sel) { return b.price.min <= budgetMax(sel); }
  function kindOk(b, sel) { return !sel.kind || sel.kind === 'any' || b.kind === sel.kind; }
  const has = (arr, v) => Array.isArray(arr) && arr.includes(v);

  /* 気分同士の近さ（同じ気分=1、隣接=0.5） */
  const MOOD_NEAR = { refresh: ['playful', 'elegant'], cozy: ['quiet', 'deep'], celebrate: ['playful', 'elegant'], deep: ['quiet', 'cozy'], adventurous: ['playful', 'deep'], elegant: ['quiet', 'celebrate'], playful: ['celebrate', 'refresh'], quiet: ['deep', 'elegant'] };
  function moodScore(b, mood) { if (!mood) return 0; if (has(b.tags.mood, mood)) return 1; return (MOOD_NEAR[mood] || []).some(m => has(b.tags.mood, m)) ? 0.5 : 0; }

  function score(b, sel, ctx) {
    ctx = ctx || {}; let s = 0;
    if (has(b.tags.place, sel.place)) s += 2;
    const purposeKey = sel.purpose === 'special' ? (sel.sub || 'special') : 'daily';
    if (has(b.tags.purpose, purposeKey)) s += 2; else if (sel.purpose === 'special' && b.tags.purpose.some(p => p !== 'daily')) s += 0.8;
    s += 3 * moodScore(b, sel.mood);
    if (sel.food && sel.food !== 'none') { if (has(b.tags.food, sel.food)) s += 3; } else s += 0.5;
    if (has(b.tags.season, ctx.season)) s += 1;
    if (ctx.daypart === 'night' && (has(b.tags.mood, 'deep') || has(b.tags.mood, 'quiet'))) s += 0.5;
    if (ctx.daypart === 'day' && (has(b.tags.mood, 'refresh') || has(b.tags.mood, 'playful'))) s += 0.5;
    /* 予算に対する位置: 上限に近いほど少し加点（使い切る提案になりすぎないよう弱く） */
    const max = budgetMax(sel); if (isFinite(max)) s += 0.6 * Math.min(1, b.price.min / max);
    if (sel.purpose === 'special' && TIER_RANK[b.price.tier] >= 1) s += 0.6;
    if (sel.purpose === 'daily' && TIER_RANK[b.price.tier] === 0) s += 0.6;
    return s;
  }

  /* 緩和: 料理 → 気分 → 場所 の順に条件を外す */
  const RELAX = [['food', '料理の条件を外しました'], ['mood', '気分の条件をゆるめました'], ['place', '場所の条件を外しました']];
  function propose(sel, opts) {
    opts = opts || {}; const seed = opts.seed || 1; const ctx = Object.assign({ season: seasonOf(), daypart: daypart() }, opts.ctx || {});
    const r = rng(seed * 7919 + 13);
    let pool = all().filter(b => !b.noRecommend && kindOk(b, sel) && affordable(b, sel));
    const relaxed = [];
    let cur = Object.assign({}, sel);
    const scored = () => pool.map(b => ({ b, s: score(b, cur, ctx) + r() * 0.3 })).sort((x, y) => y.s - x.s);
    let list = scored();
    const good = l => l.filter(x => x.s >= 4).length;
    for (let i = 0; i < RELAX.length && good(list) < 3; i++) { const [k, msg] = RELAX[i]; cur[k] = k === 'mood' ? null : (k === 'food' ? 'none' : null); relaxed.push(msg); list = scored(); }
    const items = [], used = new Set();
    const take = (role, pick) => { const hit = list.find(x => !used.has(x.b.id) && pick(x)); if (hit) { used.add(hit.b.id); items.push({ bottle: hit.b, role, score: hit.s }); } };
    take('honmei', () => true);
    take('bouken', x => x.b.originality >= 4);
    take('nichijo', x => TIER_RANK[x.b.price.tier] === Math.min.apply(null, list.map(y => TIER_RANK[y.b.price.tier])));
    take('gohobi', x => TIER_RANK[x.b.price.tier] === Math.max.apply(null, list.map(y => TIER_RANK[y.b.price.tier])));
    take('teiban', x => x.b.originality <= 2 && x.s >= 3);
    while (items.length < 3 && list.some(x => !used.has(x.b.id))) take('teiban', () => true);
    if (items.length > 5) items.length = 5;
    items.forEach(it => { it.why = why(it.bottle, sel, it.role, ctx); it.serve = serve(it.bottle, sel, ctx); });
    return { items, relaxed, ctx };
  }

  function why(b, sel, role, ctx) {
    const reasons = [];
    const place = byId(SUI.PLACES, sel.place), mood = byId(SUI.MOODS, sel.mood), food = byId(SUI.FOODS, sel.food);
    if (sel.food && sel.food !== 'none' && has(b.tags.food, sel.food)) reasons.push((food ? food.name : '') + 'に合う');
    if (sel.mood && has(b.tags.mood, sel.mood)) reasons.push('「' + (mood ? mood.name : '') + '」の気分に');
    if (place && has(b.tags.place, sel.place)) reasons.push(place.name + 'で映える');
    if (has(b.tags.season, ctx.season)) reasons.push((byId(SUI.SEASONS, ctx.season) || {}).name + 'に向く');
    const trim = (t, n) => t.length > n ? t.slice(0, n - 1) + '…' : t;
    if (role === 'honmei') return (reasons.slice(0, 2).join('。') || b.one) + '。';
    const head = { bouken: '飲んだことのない造りかもしれない', nichijo: '気負わない価格で、これ', gohobi: '予算の上まで手を伸ばす価値', teiban: '外さない一本' }[role] || '';
    return head + '。' + trim(b.one, 48) + (b.one.endsWith('。') ? '' : '。');
  }

  /* この状況での飲み方 */
  function serve(b, sel, ctx) {
    ctx = ctx || { season: seasonOf(), daypart: daypart() };
    const out = { kind: b.kind };
    if (b.kind === 'sake') {
      let band = b.serve.best;
      const bands = b.serve.bands || [band];
      const idx = id => SUI.TEMPS.findIndex(t => t.id === id);
      const warmer = () => { const i = idx(band); const next = bands.filter(x => idx(x) > i).sort((p, q) => idx(p) - idx(q))[0]; if (next) band = next; };
      const cooler = () => { const i = idx(band); const prev = bands.filter(x => idx(x) < i).sort((p, q) => idx(q) - idx(p))[0]; if (prev) band = prev; };
      if (sel.food === 'nabe' || sel.mood === 'cozy' || ctx.season === 'winter') warmer();
      if (sel.mood === 'refresh' || ctx.season === 'summer' || sel.food === 'sashimi') cooler();
      out.band = band; out.bandName = (byId(SUI.TEMPS, band) || {}).name; out.tempC = (byId(SUI.TEMPS, band) || {}).tempC;
      let vessel = b.serve.vessel;
      if (sel.place === 'outdoor') vessel = 'masu'; else if (sel.place === 'bar' && b.type4 === 'kun') vessel = 'wineglass'; else if (sel.place === 'onsen') vessel = 'guinomi';
      if (idx(band) >= idx('hinatakan') && vessel === 'wineglass') vessel = 'hirahai';
      out.vessel = vessel; out.vesselName = (byId(SUI.VESSELS, vessel) || {}).name;
      out.note = idx(band) >= idx('hinatakan') ? '湯煎でゆっくり。' + (byId(SUI.TEMPS, band) || {}).d : (byId(SUI.TEMPS, band) || {}).d;
    } else {
      let [lo, hi] = b.serve.tempC;
      if (ctx.season === 'summer' || sel.mood === 'refresh') { lo -= 2; hi -= 2; }
      if (ctx.season === 'winter' && b.taste.a >= 4) { lo += 1; hi += 1; }
      lo = Math.max(4, lo); hi = Math.max(lo + 1, hi);
      out.tempC = [lo, hi];
      let glass = b.serve.glass; if (sel.place === 'outdoor') glass = 'tumbler';
      out.glass = glass; out.glassName = (byId(SUI.GLASSES, glass) || {}).name;
      let decant = b.serve.decant || 0; if (sel.purpose === 'special' && decant > 0) decant = Math.round(decant * 1.5);
      out.decant = decant;
      out.note = decant > 0 ? '開けて' + decant + '分、空気に触れさせてから。' : (b.serve.note || '抜栓してすぐに。');
    }
    return out;
  }

  function ladder(b) {
    const ids = Array.isArray(b.ladder) && b.ladder.length ? b.ladder : [b.id];
    return ids.map(id => bottleById(id)).filter(Boolean).sort((p, q) => TIER_RANK[p.price.tier] - TIER_RANK[q.price.tier] || p.price.min - q.price.min).map(x => ({ bottle: x, tier: x.price.tier }));
  }
  function ladders(kind) {
    const seen = new Set(), out = [];
    all().forEach(b => { if (kind && b.kind !== kind) return; const key = b.ladder.join(','); if (seen.has(key)) return; seen.add(key); out.push({ producer: b.producer, producerEn: b.producerEn, kind: b.kind, steps: ladder(b) }); });
    return out.sort((a, c) => c.steps.length - a.steps.length);
  }

  /* 検索: かな・漢字・英字（大文字小文字無視）の部分一致。ひらがな→カタカナ正規化 */
  const kata = s => String(s || '').replace(/[ぁ-ゖ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  const norm = s => kata(String(s || '').toLowerCase().normalize('NFKC')).replace(/[\s・\-–—]/g, '');
  function search(q, limit) {
    const n = norm(q); if (!n) return [];
    const hits = all().map(b => {
      const fields = [b.name, b.nameEn, b.producer, b.producerEn, b.region, b.sub, b.kana || '', b.producerKana || ''].map(norm);
      let s = 0; fields.forEach((f, i) => { if (f.includes(n)) s += (i < 2 ? 3 : i < 4 ? 2 : 1); if (f.startsWith(n)) s += 1; });
      return { b, s };
    }).filter(x => x.s > 0).sort((x, y) => y.s - x.s);
    return hits.slice(0, limit || 10).map(x => x.b);
  }
  function similar(b, limit) {
    return all().filter(o => o.id !== b.id && o.kind === b.kind && !o.noRecommend).map(o => {
      let s = 0; ['a', 'b', 'c', 'd'].forEach(k => s -= Math.abs((o.taste[k] || 3) - (b.taste[k] || 3)));
      if (o.type4 && o.type4 === b.type4) s += 2; s += o.tags.mood.filter(m => has(b.tags.mood, m)).length * 0.5;
      if (o.ladder.join() === b.ladder.join()) s -= 2;
      return { o, s };
    }).sort((x, y) => y.s - x.s).slice(0, limit || 3).map(x => x.o);
  }

  /* 色派生 */
  const BG = { day: '#F7F3EE', night: '#121014' };
  function colorTokens(hex, theme) {
    theme = theme === 'night' ? 'night' : 'day';
    const bg = BG[theme];
    const acc = C.isHex(hex) ? hex : '#9FB4BD';
    const hsl = C.hexToHsl(acc);
    /* ボタン等の塗りに使う acc: 地に対して最低 2.2 のコントラストを確保（淡い酒の色は少し深める） */
    let accFill = acc; if (C.contrast(accFill, bg) < 2.2) accFill = C.ensureContrast(acc, bg, 2.2);
    const accInk = C.ensureContrast(theme === 'night' ? C.hslToHex(hsl.h, Math.min(100, hsl.s + 5), Math.max(hsl.l, 58)) : acc, bg, 4.5);
    const accSoft = C.mix(bg, acc, theme === 'night' ? 0.18 : 0.13);
    const accLine = C.alpha(acc, theme === 'night' ? 0.55 : 0.45);
    const accGlow = theme === 'night' ? C.alpha(acc, 0.35) : 'transparent';
    const accOn = C.contrast('#FFFFFF', accFill) >= 3 ? '#FFFFFF' : '#221E22';
    return { acc: accFill, accInk, accSoft, accLine, accGlow, accOn, raw: acc };
  }
  function mapXY(b) { /* 好みの地図: x=味の重さ, y=香り */
    const t = b.taste || {}; const x = b.kind === 'sake' ? t.b : t.a; const y = b.kind === 'sake' ? t.c : (t.e || 3);
    return { x: ((x || 3) - 1) / 4, y: ((y || 3) - 1) / 4 };
  }
  function avgHue(hexes) {
    const rgbs = hexes.map(C.hexToRgb).filter(Boolean); if (!rgbs.length) return null;
    const m = rgbs.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0]).map(v => v / rgbs.length);
    return C.rgbToHex(m[0], m[1], m[2]);
  }

  SUI.engine = { all, byId: bottleById, defaults, seasonOf, daypart, score, propose, serve, why, ladder, ladders, search, similar, colorTokens, mapXY, avgHue, budgetMax, TIER_RANK, norm };
})(globalThis);
