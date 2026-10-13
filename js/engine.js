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
    if (sel.food && sel.food !== 'none') { const fit = pool.filter(b => foodFit(b, sel.food).level !== 'bad'); if (fit.length >= 3) pool = fit; else relaxed.push('料理と合わない酒も含めています'); }
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
    if (sel.food && sel.food !== 'none') { const f = foodFit(b, sel.food); if (f.level === 'bad') reasons.unshift('料理とは合わない: ' + f.reason.replace(/。$/, '')); }
    if (role === 'honmei') return (reasons.slice(0, 2).join('。') || b.one) + '。';
    const head = { bouken: '飲んだことのない造りかもしれない', nichijo: '気負わない価格で、これ', gohobi: '予算の上まで手を伸ばす価値', teiban: '外さない一本' }[role] || '';
    return head + '。' + trim(b.one, 48) + (b.one.endsWith('。') ? '' : '。');
  }

  /* 料理との相性（三値）。tags.food にあれば good。規則は WSET／SSI の基本（同調・補完・対比） */
  function wineStyle(b) { const sub = String(b.sub || ''); if (b.bottle === 'flute' || /泡|スパークリング|シャンパ|Champagne|Sparkling/i.test(sub)) return 'sparkling'; if (/ロゼ|Ros/i.test(sub)) return 'rose'; return C.luminance(b.hue) > 0.5 ? 'white' : 'red'; }
  function foodFit(b, foodId) {
    if (!foodId || foodId === 'none') return { level: 'good', reason: '酒だけを味わう。' };
    if (has(b.tags.food, foodId)) return { level: 'good', reason: '蔵の推す合わせ方。' };
    const t = b.taste || {};
    let r;
    if (b.kind === 'wine') {
      const st = wineStyle(b), sweet = (t.b || 1) >= 4, tannin = t.d || 1, acid = t.c || 3, body = t.a || 3;
      const M = {
        sashimi: st === 'sparkling' ? ['good', '泡と酸が生魚の脂を切る。'] : st === 'white' && acid >= 3 ? ['good', '酸が魚の生臭さを抑える。'] : st === 'red' && tannin >= 3 ? ['bad', '生魚の脂と渋みが鉄っぽくなる。'] : ['neutral', '軽めなら邪魔はしない。'],
        meat: sweet ? ['bad', '甘さが塩とタレを重くする。'] : st === 'red' ? ['good', '炭と脂に渋みが寄り添う。'] : body >= 3 ? ['neutral', '白なら塩で。'] : ['neutral', '軽い白は塩の焼き鳥向き。'],
        nabe: st === 'red' && tannin >= 4 ? ['bad', '出汁の繊細さを渋みが消す。'] : st === 'red' ? ['good', '出汁の旨みに軽い赤。'] : ['neutral', '冷やしすぎなければ寄り添う。'],
        western: sweet ? ['neutral', 'デザート寄りで。'] : ['good', 'バターと旨みに酸か渋み。'],
        asian: sweet || st === 'sparkling' ? ['good', '香辛料には甘みと泡が逃げ道。'] : st === 'red' && tannin >= 4 ? ['bad', '辛味が渋みを強める。'] : ['neutral', '香りの強い料理は酒を選ぶ。'],
        sweet: sweet ? ['good', '菓子より甘い酒が原則。'] : st === 'red' && tannin >= 3 ? ['bad', '菓子より酒が辛いと酒が痩せる。'] : ['neutral', '甘くない泡なら軽い菓子に。'],
      }; r = M[foodId];
    } else {
      const ty = b.type4 || 'so', sweet = (t.a || 3) >= 4;
      const M = {
        sashimi: ty === 'so' ? ['good', '香りを立てず、キレで脂を流す。'] : ty === 'juku' ? ['bad', '熟成香が生魚の繊細さを覆う。'] : ['neutral', '香りが魚と競わない温度で。'],
        meat: ty === 'jun' || ty === 'juku' ? ['good', '濃い旨みには濃い酒。'] : ['neutral', '塩なら冷やで寄り添う。'],
        nabe: ty === 'jun' ? ['good', '出汁には米の旨み。ぬる燗で。'] : ty === 'so' ? ['good', '出汁を邪魔しない。'] : ['neutral', '燗にすると寄る。'],
        western: ty === 'kun' ? ['good', '果実の香りがチーズに寄る。'] : ty === 'juku' ? ['good', '熟成香は熟成チーズと同調。'] : ['neutral', 'クリーム系なら常温で。'],
        asian: ty === 'so' || ty === 'jun' ? ['good', '油と香辛料をキレか旨みで受ける。'] : ['neutral', '香りの強い料理と競う。'],
        sweet: ty === 'juku' || (ty === 'kun' && sweet) ? ['good', '甘みと香りが菓子に負けない。'] : ty === 'so' ? ['bad', '淡麗辛口は菓子に負ける。'] : ['neutral', '甘口なら。'],
      }; r = M[foodId];
    }
    if (!r) return { level: 'neutral', reason: '' };
    return { level: r[0], reason: r[1] };
  }
  function foodFits(b) { return SUI.FOODS.filter(f => f.id !== 'none').map(f => Object.assign({ food: f }, foodFit(b, f.id))); }

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

  /* ④ 原型: 色暦の記録から 12 原型のどれか（端末内で決める。量は数えない） */
  const ARCHETYPES = [
    { id: 'hanabie', name: '花冷えの人', line: '香りが一番美しい10℃で、吟醸の花を開かせる。', when: a => a.sake >= 0.6 && a.cool >= 0.6 && a.aroma >= 0.55 },
    { id: 'nurukan', name: 'ぬる燗の人', line: '40℃で米の旨みがほどける瞬間を知っている。', when: a => a.sake >= 0.6 && a.warm >= 0.4 },
    { id: 'garnet', name: 'ガーネットの人', line: '深い赤の層を、時間をかけて辿る。', when: a => a.wine >= 0.6 && a.dark >= 0.6 && a.heavy >= 0.55 },
    { id: 'straw', name: '麦わらの人', line: '光を透かす白を、冷たいうちに。', when: a => a.wine >= 0.6 && a.light >= 0.5 && a.cool >= 0.5 },
    { id: 'awa', name: '泡の人', line: '始まりはいつも泡から。乾杯の音が好き。', when: a => a.sparkling >= 0.4 },
    { id: 'kiri', name: 'キレの人', line: '淡麗辛口。余韻より切れ味を取る。', when: a => a.sake >= 0.6 && a.heavy <= 0.4 && a.aroma <= 0.45 },
    { id: 'koku', name: 'コクの人', line: '濃醇な旨みと、それに負けない料理。', when: a => a.heavy >= 0.65 },
    { id: 'bouken', name: '冒険の人', line: 'まだ色暦に無い色を、いつも探している。', when: a => a.adventure >= 0.6 },
    { id: 'kaidan', name: '階段の人', line: '同じ造り手の一段上を、必ず試す。', when: a => a.ladder >= 0.4 },
    { id: 'tabi', name: '旅の人', line: '蔵のそば、旅先の一杯が一番うまい。', when: a => a.away >= 0.5 },
    { id: 'kazoku', name: '卓の人', line: '誰と飲むかで酒を選ぶ。', when: a => a.together >= 0.7 },
    { id: 'tousitsu', name: '透明の人', line: 'ほぼ無色の中の、かすかな違いを楽しむ。', when: () => true },
  ];
  function archetype(records) {
    const rs = (records || []).filter(r => r.bottleId && bottleById(r.bottleId));
    if (rs.length < 3) return null;
    const bs = rs.map(r => bottleById(r.bottleId));
    const n = bs.length, frac = f => bs.filter(f).length / n;
    const idx = id => SUI.TEMPS.findIndex(t => t.id === id);
    const sakeRecs = rs.filter(r => r.band);
    const a = {
      sake: frac(b => b.kind === 'sake'), wine: frac(b => b.kind === 'wine'),
      sparkling: frac(b => b.bottle === 'flute' || /泡|発泡|スパークリング/.test(b.sub || '')),
      dark: frac(b => C.luminance(b.hue) < 0.15), light: frac(b => C.luminance(b.hue) > 0.5),
      heavy: bs.reduce((s, b) => s + ((b.kind === 'sake' ? b.taste.b : b.taste.a) || 3), 0) / n / 5,
      aroma: bs.reduce((s, b) => s + ((b.kind === 'sake' ? b.taste.c : (b.taste.e || 3)) || 3), 0) / n / 5,
      cool: sakeRecs.length ? sakeRecs.filter(r => idx(r.band) <= 2).length / sakeRecs.length : frac(b => b.kind === 'wine' && b.serve.tempC && b.serve.tempC[1] <= 12),
      warm: sakeRecs.length ? sakeRecs.filter(r => idx(r.band) >= 4).length / sakeRecs.length : 0,
      adventure: bs.reduce((s, b) => s + (b.originality || 1), 0) / n / 5,
      ladder: (() => { const seen = {}; bs.forEach(b => { const k = b.ladder.join(','); (seen[k] = seen[k] || new Set()).add(b.id); }); return Object.values(seen).filter(st => st.size >= 2).length / Math.max(1, Object.keys(seen).length); })(),
      away: rs.filter(r => r.place === 'onsen' || r.place === 'outdoor' || r.atBrewery).length / n,
      together: rs.filter(r => r.with && r.with !== 'solo').length / n,
    };
    const hit = ARCHETYPES.find(t => t.when(a)) || ARCHETYPES[ARCHETYPES.length - 1];
    return { id: hit.id, name: hit.name, line: hit.line, axes: a };
  }
  /* 月の統計（量は数えない: 種類・色・造り手・場所・初めて） */
  function monthStats(records, ym) {
    const all = records || [];
    const inMonth = r => { const d = new Date(r.ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') === ym; };
    const rs = all.filter(inMonth), before = all.filter(r => !inMonth(r) && r.ts < new Date(ym + '-01').getTime());
    const bottles = rs.map(r => r.bottleId && bottleById(r.bottleId)).filter(Boolean);
    const hues = rs.map(r => { const b = r.bottleId && bottleById(r.bottleId); return b ? b.hue : (C.isHex(r.hue) ? r.hue : '#9FB4BD'); });
    const colorFamilies = new Set(hues.map(h => { const l = C.luminance(h); const hs = C.hexToHsl(h); return l > 0.72 ? 'clear' : l > 0.35 ? (hs.h > 20 && hs.h < 70 ? 'gold' : 'rose') : 'red'; }));
    const producers = [...new Set(bottles.map(b => b.producer))];
    const prevProducers = new Set(before.map(r => r.bottleId && bottleById(r.bottleId)).filter(Boolean).map(b => b.producer));
    const places = [...new Set(rs.map(r => r.place).filter(Boolean))].map(p => (SUI.byIdIn(SUI.PLACES, p) || {}).name).filter(Boolean);
    const firstProducers = producers.filter(p => !prevProducers.has(p));
    const kinds = { sake: bottles.filter(b => b.kind === 'sake').length > 0, wine: bottles.filter(b => b.kind === 'wine').length > 0 };
    const best = rs.filter(r => r.rating >= 4).sort((p, q) => (q.rating - p.rating) || (q.ts - p.ts))[0] || null;
    return { ym, hues, colors: hues.length ? new Set(hues).size : 0, colorFamilies: [...colorFamilies], producers: producers.length, producerNames: producers, places, firstProducers, kinds, best, words: [...new Set(rs.flatMap(r => r.words || []))].slice(0, 6), haiku: (rs.find(r => r.haiku) || {}).haiku || null, empty: rs.length === 0 };
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


  /* 一本の線: 蔵の創業から今夜までの帯。材料は収録DBの創業年・本人の記録・端末の時計だけ（推定なし）。
     ワインは創業年の意味（蔵／銘柄／日本発売）が混ざるため、検証が済むまで出さない。 */
  const YEAR_MS = 365 * 24 * 3600 * 1000;
  function timelineOf(b, records, opts) {
    const o = opts || {};
    if (!b || b.kind !== 'sake' || !b.story || !(b.story.founded > 1000)) return null;
    const tonight = o.tonight || null;
    const nowTs = tonight ? tonight.ts : (o.now || Date.now());
    const nowD = new Date(nowTs), nowY = nowD.getFullYear(), founded = b.story.founded;
    const ids = ladder(b).map(x => x.bottle.id);
    const past = (records || []).filter(r => r && ids.includes(r.bottleId) && !r.quiet && (!tonight || (r.id !== tonight.id && r.ts < tonight.ts))).sort((p, q) => q.ts - p.ts);
    const season = (SUI.SEASONS.find(s => s.id === seasonOf(nowD)) || {}).name || '';
    const line = tonight ? `今夜、あなた。${b.producer}、創業から${nowY - founded}年の${season}。` : null;
    const last = past[0] || null;
    const word = tonight ? (!last ? '初めて' : (nowTs - last.ts >= YEAR_MS ? '久しぶり' : 'また')) : null;
    let recall = null;
    if (tonight && last && o.recall !== false) {
      const lb = bottleById(last.bottleId), d = new Date(last.ts);
      const band = last.band ? (SUI.TEMPS.find(t => t.id === last.band) || {}).name : null;
      const said = last.word && last.word.trim() ? `『${last.word.trim()}』` : '';
      recall = `${word}。前は ${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}、${lb ? lb.name : last.name}${band ? 'を' + band + 'で' : ''}。${said}`;
    }
    /* 折れ尺: 創業〜「自分の雫のいちばん古い年」を幅の60%、そこから今夜までを40%（雫が重ならないように） */
    const yearOf = ts => { const d = new Date(ts); return d.getFullYear() + d.getMonth() / 12; };
    const drops = (tonight ? [Object.assign({ tonight: true }, tonight)] : []).concat(past).slice(0, 2);
    const nowF = yearOf(nowTs), FOLD = 0.6;
    const oldest = drops.length ? Math.min.apply(null, drops.map(r => yearOf(r.ts))) : nowF;
    const recentFrom = Math.max(founded + 1, Math.min(nowY - 1, Math.floor(oldest)));
    const x = y => y <= recentFrom ? FOLD * (y - founded) / Math.max(1, recentFrom - founded) : FOLD + (1 - FOLD) * Math.min(1, (y - recentFrom) / Math.max(0.5, nowF - recentFrom));
    const ticks = [{ y: founded, x: 0, label: String(founded) }].concat((b.story.beats || []).map(bt => Number(bt.y)).filter(y => y > founded && y < nowY).map(y => ({ y, x: x(y), label: String(y) })));
    const mine = drops.map(r => ({ id: r.id, ts: r.ts, hue: r.hue || null, tonight: !!r.tonight, x: r.tonight ? 1 : Math.min(1, x(yearOf(r.ts))) }));
    if (mine.length === 2 && mine[0].x - mine[1].x < 0.05) mine[1].x = Math.max(0, mine[0].x - 0.05); /* 同じ月の雫も並んで見えるように */
    return { founded, nowY, years: nowY - founded, producer: b.producer, line, word, recall, last, ticks, mine, fold: FOLD };
  }
  SUI.engine = { all, byId: bottleById, defaults, seasonOf, daypart, score, propose, serve, why, ladder, ladders, search, similar, colorTokens, mapXY, avgHue, budgetMax, TIER_RANK, norm, foodFit, foodFits, wineStyle, archetype, monthStats, ARCHETYPES, timelineOf };
})(globalThis);
