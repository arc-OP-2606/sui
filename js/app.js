/* sui — UI: 状態、ルーティング、画面。 */
(function (global) {
  'use strict';
  const SUI = global.SUI, E = SUI.engine, R = SUI.render, St = SUI.store, Rec = SUI.recognize, C = SUI.color;
  const hasDOM = typeof document !== 'undefined';
  const esc = R.esc;
  const byId = (list, id) => list.find(x => x.id === id) || null;
  const nameOf = (list, id) => (byId(list, id) || {}).name || '';
  const yen = n => '¥' + Math.round(n).toLocaleString('ja-JP');
  const priceText = b => yen(b.price.min) + (b.price.max > b.price.min ? '〜' + yen(b.price.max).slice(1) : '');
  const DEFAULT_ACC = '#9FB4BD';
  const KINDNAME = { wine: 'ワイン', sake: '日本酒' };

  const state = {
    view: 'home', step: 0, sel: E.defaults(), touched: false, seed: 1, current: null, ai: null, panels: {}, ladderTab: 'sake',
    capture: { status: 'idle', image: null, msg: '', error: '' }, searchQ: '', recordId: null, sheet: null, similarOpen: false, wowFlipped: false,
  };

  /* ---------- テーマと色 ---------- */
  function themeNow() { const pref = St.get(St.KEYS.theme, 'auto'); return pref === 'auto' ? E.daypart() : pref; }
  function applyTheme() { if (!hasDOM) return; document.documentElement.dataset.theme = themeNow(); }
  function applyAccent(hex) {
    if (!hasDOM) return; const t = E.colorTokens(hex || DEFAULT_ACC, themeNow()); const s = document.documentElement.style;
    s.setProperty('--acc', t.acc); s.setProperty('--acc-ink', t.accInk); s.setProperty('--acc-soft', t.accSoft); s.setProperty('--acc-line', t.accLine); s.setProperty('--acc-glow', t.accGlow); s.setProperty('--acc-on', t.accOn);
    state.accent = hex || DEFAULT_ACC;
  }
  function recordHue(r) { const b = r.bottleId ? E.byId(r.bottleId) : null; return b ? b.hue : (C.isHex(r.hue) ? r.hue : DEFAULT_ACC); }
  function recordAcc(r) { const b = r.bottleId ? E.byId(r.bottleId) : null; return b ? b.acc : (C.isHex(r.hue) ? r.hue : DEFAULT_ACC); }
  function defaultAccent() { const rs = St.records(); return rs.length ? recordAcc(rs[0]) : DEFAULT_ACC; }
  const isNight = () => themeNow() === 'night';

  /* ---------- ルーティング ---------- */
  const views = {};
  const SNAP = ['view', 'current', 'step', 'recordId', 'searchQ', 'ai', 'ladderTab'];
  const snapshot = () => { const o = {}; SNAP.forEach(k => { o[k] = state[k]; }); return o; };
  state.history = [];
  function go(view, params) {
    if (state.view !== view || (params && params.current && params.current !== state.current)) { state.history.push(snapshot()); if (state.history.length > 40) state.history.shift(); }
    Object.assign(state, params || {}); state.view = view; render(); if (hasDOM) window.scrollTo({ top: 0 });
  }
  /* Android の戻るボタン等から。戻れたら true、根（ホーム）なら false */
  function back() {
    if (state.sheet) { state.sheet = null; renderSheet(); return true; }
    const ov = hasDOM && document.querySelector('.sheet-back'); if (ov) { ov.remove(); return true; }
    const prev = state.history.pop(); if (!prev) { if (state.view !== 'home') { state.view = 'home'; render(); return true; } return false; }
    Object.assign(state, prev); render(); if (hasDOM) window.scrollTo({ top: 0 }); return true;
  }
  /* 表紙（年齢確認とホーム）は昼夜を問わず漆黒の地 */
  function applyCover() {
    const root = document.documentElement, ctx = seasonCtx();
    const cover = !St.get(St.KEYS.age, null) ? 'gate' : state.view === 'home' ? 'home' : '';
    /* 表紙と中のページの切替は一瞬で（地色のフェード中に文字が沈まないように） */
    if ((root.dataset.cover || '') !== cover) { root.classList.add('cover-swap'); requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('cover-swap'))); }
    if (cover) root.dataset.cover = cover; else delete root.dataset.cover;
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = cover ? '#0B0A0C' : isNight() ? '#121014' : '#F7F3EE';
    const issue = document.querySelector('.topbar .issue'); if (issue) issue.textContent = 'NO.' + (new Date().getMonth() + 1) + ' · ' + nameOf(SUI.SEASONS, ctx.season) + (ctx.daypart === 'night' ? 'の夜' : 'の昼');
  }
  function render() {
    if (!hasDOM) return; applyTheme(); applyCover();
    const main = document.getElementById('app'); if (!main) return;
    if (!St.get(St.KEYS.age, null)) { applyAccent(DEFAULT_ACC); main.innerHTML = views.gate(); document.querySelector('.tabbar').hidden = true; return; }
    document.querySelector('.tabbar').hidden = false;
    const b = state.view === 'card' ? E.byId(state.current) : null;
    if (b) applyAccent(b.acc); else if (state.view === 'aicard' && state.ai) applyAccent(state.ai.data.colorHex || DEFAULT_ACC); else if (state.view === 'record' && state.recordId) { const r = St.records().find(x => x.id === state.recordId); applyAccent(r ? recordAcc(r) : defaultAccent()); } else applyAccent(defaultAccent());
    const same = render.last === state.view; render.last = state.view;
    main.innerHTML = (views[state.view] || views.home)();
    if (same) main.querySelectorAll('.view').forEach(v => { v.style.animation = 'none'; });
    const tabView = { card: null, aicard: null, search: null, capture: null, proposals: 'explore', record: 'calendar' }[state.view];
    document.querySelectorAll('.tabbar .tab[data-view]').forEach(t => { const v = tabView === undefined ? state.view : tabView; if (t.dataset.view === v) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
    renderSheet();
  }
  function toast(msg) { if (!hasDOM) return; document.querySelectorAll('.toast').forEach(t => t.remove()); const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2400); }

  /* ---------- 共通部品 ---------- */
  const glassFor = b => b.kind === 'sake' ? { vessel: b.serve.vessel } : { glass: b.serve.glass };
  const dropOf = (b, size, extra) => R.drop(Object.assign({ hue: b.hue, size: size || 48, night: isNight(), label: b.name }, extra || {}));
  function nameHtml(b, cls) { return b.kind === 'sake' ? `<div class="name sake ${cls || ''}">${esc(b.name)}</div>` : `<div class="name wine ${cls || ''}">${esc(b.nameEn)}</div><div class="name-ja">${esc(b.name)}</div>`; }
  function sectionHead(title, en, extra) { return `<div class="section-head"><h2>${esc(title)}</h2>${en ? `<span class="eyebrow">${esc(en)}</span>` : ''}${extra || ''}</div>`; }
  function seasonCtx() { return { season: E.seasonOf(), daypart: E.daypart() }; }
  function situationName(sel, ctx) {
    const parts = [nameOf(SUI.SEASONS, ctx.season) + (ctx.daypart === 'night' ? 'の夜' : 'の昼'), nameOf(SUI.PLACES, sel.place), sel.purpose === 'special' ? (nameOf(SUI.SUBPURPOSES, sel.sub) || '特別な日') : '日常', nameOf(SUI.MOODS, sel.mood), sel.food && sel.food !== 'none' ? nameOf(SUI.FOODS, sel.food) : null];
    return parts.filter(Boolean).join('・');
  }
  function principle(sel, ctx) {
    if (sel.food === 'nabe') return '出汁には、温度を合わせる。ぬる燗か、冷やしすぎない白。';
    if (sel.food === 'sashimi') return '生の魚には、香りを立てすぎない。きりっと冷やして。';
    if (sel.food === 'meat') return 'タレには甘みと渋み、塩には酸とキレ。';
    if (sel.food === 'western') return 'バターと旨みには、酸か渋みをぶつける。';
    if (sel.food === 'asian') return '香辛料には、甘みと泡が逃げ道になる。';
    if (sel.food === 'sweet') return '酒は菓子より甘く。逆だと酒が痩せる。';
    if (sel.mood === 'refresh') return '温度を下げ、器を小さく。香りは閉じて、キレを立てる。';
    if (sel.mood === 'deep') return '大きな器で、少しずつ。温度が上がる変化も味わう。';
    if (sel.mood === 'celebrate') return '泡から始める。注ぐ音まで、ごちそう。';
    if (ctx.season === 'winter') return '寒い夜は、燗か濃い赤。体温に近づける。';
    if (ctx.season === 'summer') return '夏は雪冷えと泡。氷は入れない。';
    return '一杯目は軽く、二杯目で深く。順番が味を決める。';
  }
  function serveLine(sv) { return sv.kind === 'sake' ? `${sv.bandName}（${sv.tempC}℃）・${sv.vesselName}` : `${sv.tempC[0]}–${sv.tempC[1]}℃・${sv.glassName}${sv.decant ? '・' + sv.decant + '分空気に' : ''}`; }
  function generalServe(kind, sub, hue) {
    if (kind === 'sake') {
      const s = String(sub || ''); const t4 = /大吟醸|吟醸/.test(s) ? 'kun' : /純米/.test(s) ? 'jun' : /にごり|発泡|スパークリング/.test(s) ? 'so' : /古酒|熟成/.test(s) ? 'juku' : 'so';
      const t = byId(SUI.TYPE4, t4); return { title: t.name + 'として楽しむなら', text: t.d, temps: t.temps, best: t.temps[Math.floor(t.temps.length / 2)] };
    }
    const lum = C.luminance(hue || '#8B1E3F'); const s = String(sub || '');
    if (/泡|スパークリング|シャンパ|Champagne/i.test(s)) return { title: '泡として楽しむなら', text: '6〜8℃。フルートか、香りを取るなら白ワイン型。', tempC: [6, 8] };
    if (lum > 0.5) return { title: '白・ロゼとして楽しむなら', text: '8〜12℃。冷やしすぎると香りが閉じる。', tempC: [8, 12] };
    return { title: '赤として楽しむなら', text: '15〜18℃。室温が高い日は10分冷蔵庫へ。', tempC: [15, 18] };
  }

  /* ---------- 年齢確認（表紙） ---------- */
  const SEASON_EN = { spring: 'SPRING', summer: 'SUMMER', autumn: 'AUTUMN', winter: 'WINTER' };
  views.gate = () => `<div class="view cover cover-gate">
    <div class="cv-strip"><span>VOL. 01</span><span>WINE &amp; SAKE</span><span>${new Date().getFullYear()} ${SEASON_EN[E.seasonOf()] || ''}</span></div>
    <div class="cg-stage">
      <div class="cg-mast" aria-hidden="true">sui</div>
      <span class="cg-kanji" aria-hidden="true">粋</span>
      ${R.cover({ pour: true, label: 'グラスに注がれる赤ワイン' })}
      <p class="cg-vert">撮るだけで、一杯の物語。</p>
      <p class="cg-side"><span class="en">the colour of</span><span>酒の色で、<br>世界を知る。</span></p>
    </div>
    <div class="cg-foot">
      <h1>あなたは20歳以上ですか</h1>
      <div class="btnrow"><button class="btn brass" data-act="age" data-val="yes">はい、20歳以上です</button><button class="btn ghost" data-act="age" data-val="no">いいえ</button></div>
      ${state.ageDenied ? '<p class="denied">20歳になったら、また。</p>' : ''}
      <p class="law">20歳未満の者の飲酒は法律で禁止されています。このアプリは酒類の情報を扱います。</p>
      <p class="warnings">妊娠中や授乳期の飲酒は、胎児・乳児の発育に悪影響を与えるおそれがあります。飲酒運転は法律で禁止されています。お酒は適量を。</p>
    </div>
  </div>`;

  /* ---------- ホーム（表紙） ---------- */
  views.home = () => {
    const ctx = seasonCtx(), rs = St.records(), season = byId(SUI.SEASONS, ctx.season), night = ctx.daypart === 'night';
    const lastRec = rs[0];
    const quick = E.propose(Object.assign(E.defaults(), { mood: night ? 'quiet' : 'refresh' }), { seed: new Date().getDate(), ctx });
    const pick = quick.items[0];
    const feats = [['01', 'explore', '探す', `場所と気分で、${night ? '今夜' : '今日'}の一本を`], ['02', 'ladders', '階段', '日常の一本から、名酒へ'], ['03', 'calendar', '色暦', '飲んだ色が、一年の暦になる']];
    return `<div class="view cover cover-home">
      <section class="ch-hero">
        ${R.cover({ hue: lastRec ? recordHue(lastRec) : null, label: lastRec ? '最近の一杯の色: ' + lastRec.name : 'スポットライトの中の赤ワイン' })}
        <div class="ch-head"><span class="cv-kicker">${night ? 'TONIGHT’S COLOUR' : 'TODAY’S COLOUR'}</span><h1>${rs.length ? '今日の一杯は、<br>何色？' : '最初の一杯は、<br>何色？'}</h1></div>
        <div class="ch-shoot"><button class="ch-shootbtn" data-act="shoot" aria-label="撮る">${R.icon('camera')}<span>撮る</span></button><p>ラベルを撮って、<br>一杯を記録する</p></div>
      </section>
      <div class="ch-season"><span class="en">Season</span><span>${esc(season.line)}</span></div>
      ${pick ? `<div class="ch-tonight"><button class="ch-pick" data-act="card" data-id="${pick.bottle.id}">${dropOf(pick.bottle, 64, { night: true })}<span class="body"><span class="cv-kicker">${night ? '今夜' : '今日'}の${esc(nameOf(SUI.ROLES, pick.role))} · ${pick.bottle.kind === 'wine' ? 'WINE' : 'SAKE'}</span><span class="nm">${esc(pick.bottle.name)}</span><span class="why">${esc(pick.why)}</span><span class="srv">${esc(serveLine(pick.serve))}</span></span></button><button class="linkbtn" data-act="nav" data-view="explore">条件を変えて探す</button></div>` : ''}
      <div class="ch-features">
        <div class="ch-sechead"><h2>特集</h2><span class="cv-kicker">FEATURES</span></div>
        ${feats.map(([n, v, t, d]) => `<button class="ch-feat" data-act="nav" data-view="${v}"><span class="no">${n}</span><span class="tx"><span class="t">${t}</span><span class="d">${d}</span></span>${R.icon('next')}</button>`).join('')}
      </div>
      ${rs.length ? `<div class="ch-recent"><div class="ch-sechead"><h2>最近の色</h2><span class="cv-kicker">RECENT</span></div><div class="recent-row">${rs.slice(0, 10).map(r => `<button class="drop-btn" data-act="record" data-id="${r.id}">${R.drop({ hue: recordHue(r), size: 48, night: true })}<span class="n">${esc(r.name)}</span></button>`).join('')}</div></div>` : `<div class="ch-empty"><p>最初の一杯を記録すると、ここが色づく。写真を撮るか、名前で探して記録を。</p><button class="btn sm ghost" data-act="nav" data-view="search">名前で探す</button></div>`}
    </div>`;
  };

  /* ---------- 撮る ---------- */
  views.capture = () => {
    const cp = state.capture, key = Rec.available(St.getRaw(St.KEYS.apiKey, ''));
    const body = cp.status === 'working'
      ? `${R.pour({ hue: state.accent })}<p class="status-line">${esc(cp.msg || 'ラベルを読んでいます')}</p>`
      : cp.status === 'error'
        ? `<div class="preview">${cp.image ? `<img src="${cp.image}" alt="">` : ''}</div><p class="status-line">${esc(cp.error)}</p><div class="btnrow"><button class="btn acc" data-act="shoot">もう一度撮る</button><button class="btn ghost" data-act="nav" data-view="search">名前で探す</button>${cp.image ? '<button class="btn ghost" data-act="record-photo">写真だけ記録する</button>' : ''}</div>`
        : key
          ? `<p class="status-line">ボトルかラベルを、正面から。</p><div class="btnrow"><button class="btn acc" data-act="shoot">${R.icon('camera')}撮る</button><button class="btn ghost" data-act="nav" data-view="search">名前で探す</button></div>`
          : `<div class="card tint stack"><p>キーを入れると、写真からラベルが読めます。今は名前で探せます。</p><div class="btnrow"><button class="btn sm" data-act="nav" data-view="settings">${R.icon('key')}キーを入れる</button><button class="btn sm ghost" data-act="nav" data-view="search">名前で探す</button></div></div><div class="btnrow"><button class="btn ghost" data-act="shoot-photo">写真だけ記録する</button></div>`;
    return `<div class="view capture"><div class="eyebrow">Shoot</div><h1>目の前の一本を</h1>${body}</div>`;
  };

  /* ---------- 検索 ---------- */
  /* 収録外の名前: AI に名前で問い合わせる（写真なし）。答えは「AIで調べた結果（要確認）」のカードで出す */
  function notFound(q) {
    const canAI = Rec.available(St.getRaw(St.KEYS.apiKey, '')), lk = state.lookup && state.lookup.q === Rec.cleanName(q) ? state.lookup : null, busy = lk && lk.status === 'working';
    return `<div class="card flat stack">
      <p class="muted">「${esc(q)}」は収録にありません。</p>
      ${busy ? `<p class="status-line">${esc(lk.msg || 'AIが調べています')}</p>` : ''}
      ${lk && lk.status === 'none' ? '<p class="small">AIでも、この名前の銘柄を確かめられませんでした。表記（かな・英字・蔵の名前）を変えるか、ラベルを撮ってください。</p>' : ''}
      ${lk && lk.status === 'error' ? `<p class="small">${esc(lk.error)}</p>` : ''}
      <div class="btnrow">${canAI ? `<button class="btn sm acc" data-act="ai-name"${busy ? ' disabled' : ''}>${R.icon('spark')}AIで調べる</button>` : ''}<button class="btn sm ghost" data-act="record-manual">この名前で記録する</button></div>
      ${canAI ? '<p class="small faint">AIの答えは要確認。蔵の歴史や受賞歴は表示しません。</p>' : ''}
    </div>`;
  }
  function refreshSearch() {
    if (!hasDOM || state.view !== 'search') return; const list = document.querySelector('.result-list'); if (!list) return;
    const tmp = document.createElement('div'); tmp.innerHTML = views.search(); list.innerHTML = tmp.querySelector('.result-list').innerHTML;
  }
  async function lookupName(raw) {
    const q = Rec.cleanName(raw); if (!q || (state.lookup && state.lookup.status === 'working')) return;
    state.lookup = { status: 'working', q, msg: 'AIが調べています' }; refreshSearch();
    const here = () => state.view === 'search' && Rec.cleanName(state.searchQ) === q;
    try {
      const r = await Rec.runText(St.getRaw(St.KEYS.apiKey, ''), q, E.all(), m => { if (state.lookup && state.lookup.q === q) state.lookup.msg = m; const el = document.querySelector('.result-list .status-line'); if (el && here()) el.textContent = m; });
      state.lookup = r.kind === 'none' ? { status: 'none', q } : null;
      if (!here()) return; /* 待つ間に別の画面・別の名前へ移ったら、結果で画面を奪わない */
      if (r.kind === 'db') go('card', { current: r.bottle.id, similarOpen: false, wowFlipped: false });
      else if (r.kind === 'ai') go('aicard', { ai: r });
      else refreshSearch();
    } catch (e) { state.lookup = { status: 'error', q, error: Rec.errorMessage(e) }; if (here()) refreshSearch(); }
  }
  views.search = () => {
    const q = state.searchQ, hits = q ? E.search(q, 12) : [];
    return `<div class="view"><div class="eyebrow">Search</div><h1>名前で探す</h1>
      <div class="search-box">${R.icon('search')}<input id="q" type="search" placeholder="銘柄・蔵・産地（かな・英字）" value="${esc(q)}" autocomplete="off" autofocus></div>
      <div class="result-list">${hits.length ? hits.map(b => `<button class="result" data-act="card" data-id="${b.id}"><span class="sw" style="background:${b.hue}"></span><span><span class="t">${esc(b.name)}</span><br><span class="d">${esc(b.producer)} · ${esc(b.sub)}</span></span></button>`).join('') : q ? notFound(q) : `<p class="small muted">例: 獺祭、Kubota、ペンフォールズ、新潟</p>`}</div>
    </div>`;
  };

  /* ---------- 酒カード ---------- */
  const THEMES = [['taste', '味わい', 'spark'], ['serve', '飲み方', 'thermo'], ['pair', '合わせる', 'food'], ['story', '物語', 'story'], ['wow', 'へぇ', 'wow'], ['ladder', '階段', 'stairs'], ['label', 'ラベル', 'tag']];
  views.card = () => {
    const b = E.byId(state.current); if (!b) return views.home();
    const open = state.panels[b.id] || (state.panels[b.id] = { taste: true });
    const saved = St.saved().includes(b.id);
    const panels = THEMES.filter(([k]) => open[k]).map(([k]) => panel(k, b)).join('');
    return `<div class="view">
      <div class="hero-card">
        <div class="glass">${R.glass(Object.assign({ hue: b.hue, size: 200, seed: b.id.length, night: isNight() }, glassFor(b)))}</div>
        ${nameHtml(b)}
        <div class="maker">${esc(b.producer)}　${esc(b.region)}</div>
        <p class="one">${esc(b.one)}</p>
        <div class="pricebar"><span class="num">${esc(priceText(b))}</span><span>${esc(nameOf(SUI.TIERS, b.price.tier))} · 目安</span></div>
        ${b.price.note ? `<p class="small muted">${esc(b.price.note)}</p>` : ''}
      </div>
      <div class="themes">${THEMES.map(([k, n, ic]) => `<button class="chip ${open[k] ? 'active' : ''}" data-act="panel" data-key="${k}" aria-pressed="${!!open[k]}">${R.icon(ic)}${esc(n)}</button>`).join('')}</div>
      ${panels}
      <div class="actions">
        <button class="btn acc" data-act="record-bottle" data-id="${b.id}">${R.icon('drop')}記録する</button>
        <button class="btn ghost" data-act="save" data-id="${b.id}">${R.icon('heart')}${saved ? '保存済み' : '保存'}</button>
        <button class="btn ghost" data-act="similar">${R.icon('refresh')}似た酒</button>
        <button class="btn ghost" data-act="explore-from" data-id="${b.id}">${R.icon('compass')}この酒で探す</button>
      </div>
      ${state.similarOpen ? `<div class="section">${sectionHead('似た酒', 'Similar')}<div class="result-list">${E.similar(b, 3).map(o => `<button class="result" data-act="card" data-id="${o.id}"><span class="sw" style="background:${o.hue}"></span><span><span class="t">${esc(o.name)}</span><br><span class="d">${esc(o.producer)} · ${esc(priceText(o))}</span></span></button>`).join('')}</div></div>` : ''}
    </div>`;
  };
  function panel(k, b) {
    const H = (t, en) => `<h3>${esc(t)}<span class="en">${esc(en)}</span></h3>`;
    if (k === 'taste') {
      const spec = b.spec || {}; const kv = [];
      if (b.kind === 'sake') { if (spec.rice) kv.push(['酒米', spec.rice]); if (spec.polish) kv.push(['精米歩合', spec.polish + '%']); if (spec.smv != null) kv.push(['日本酒度', (spec.smv > 0 ? '+' : '') + spec.smv]); if (spec.acidity != null) kv.push(['酸度', spec.acidity]); if (spec.abv) kv.push(['度数', spec.abv + '%']); if (spec.yeast) kv.push(['酵母', spec.yeast]); if (spec.water) kv.push(['仕込み水', spec.water]); }
      else { if (spec.grapes && spec.grapes.length) kv.push(['品種', spec.grapes.join('・')]); if (spec.appellation) kv.push(['呼称', spec.appellation]); if (spec.abv) kv.push(['度数', spec.abv + '%']); if (spec.vintageNote) kv.push(['年', spec.vintageNote]); }
      return `<div class="panel card">${H('味わい', 'Taste')}<div class="bars">${R.tasteBars(b)}</div><div class="pairs">${b.aromas.map(a => `<span class="tag">${esc(a)}</span>`).join('')}</div>${b.kind === 'sake' ? `<div class="quad">${R.quadrant({ current: b.type4, points: [Object.assign(E.mapXY(b), { hue: b.hue, big: true, label: b.name })] })}</div><p class="small muted">${esc((byId(SUI.TYPE4, b.type4) || {}).d || '')}</p>` : ''}${kv.length ? `<dl class="kv">${kv.map(([a, c]) => `<dt>${esc(a)}</dt><dd>${esc(c)}</dd>`).join('')}</dl>` : ''}</div>`;
    }
    if (k === 'serve') {
      const sv = E.serve(b, state.touched ? state.sel : E.defaults(), seasonCtx());
      const vessel = b.kind === 'sake' ? byId(SUI.VESSELS, b.serve.vessel) : byId(SUI.GLASSES, b.serve.glass);
      return `<div class="panel card">${H('飲み方', 'Serve')}<div class="thermo">${b.kind === 'sake' ? R.thermo({ kind: 'sake', bands: b.serve.bands, best: b.serve.best }) : R.thermo({ kind: 'wine', tempC: b.serve.tempC })}</div>
        <dl class="kv"><dt>器</dt><dd>${esc(vessel ? vessel.name : '')}<span class="small muted">　${esc(vessel ? vessel.d : '')}</span></dd>${b.kind === 'wine' ? `<dt>開ける</dt><dd>${b.serve.decant ? b.serve.decant + '分前にデカンタへ' : '抜栓してすぐ'}</dd><dt>飲み頃</dt><dd>${esc(b.serve.window || '')}</dd>` : ''}</dl>
        ${b.serve.note ? `<p class="small">${esc(b.serve.note)}</p>` : ''}
        <div class="card flat tint stack"><div class="eyebrow">${state.touched ? 'いまの状況なら' : 'いまの季節なら'}</div><p>${esc(serveLine(sv))}</p><p class="small muted">${esc(sv.note || '')}</p></div>
        <ul class="notes">${b.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
    }
    if (k === 'pair') return `<div class="panel card">${H('合わせる', 'Pair')}<div class="pairs">${b.pairings.map(p => `<span class="tag acc">${esc(p)}</span>`).join('')}</div><ul class="notes">${b.tags.food.filter(f => f !== 'none').slice(0, 3).map(f => `<li>${esc(nameOf(SUI.FOODS, f))}: ${esc((byId(SUI.FOODS, f) || {}).d || '')}</li>`).join('')}</ul></div>`;
    if (k === 'story') return `<div class="panel card">${H('物語', 'Story')}<div class="timeline">${b.story.beats.map(x => `<div class="beat"><div class="y">${esc(x.y)}</div><div>${esc(x.t)}</div></div>`).join('')}</div><dl class="kv"><dt>創業</dt><dd>${b.story.founded}年${b.story.founder ? '　' + esc(b.story.founder) : ''}</dd><dt>土地</dt><dd>${esc(b.country)}　${esc(b.region)}</dd></dl></div>`;
    if (k === 'wow') return `<div class="panel">${H('へぇ', 'Did you know')}<div class="wow ${state.wowFlipped ? 'flipped' : ''}" data-act="flip" role="button" tabindex="0"><div class="face front"><div class="q">この一本の、意外な話。<br><span class="small muted">タップしてめくる</span></div></div><div class="face back"><p>${esc(b.wow)}</p></div></div></div>`;
    if (k === 'ladder') {
      const steps = E.ladder(b); const i = steps.findIndex(s => s.bottle.id === b.id); const next = steps[i + 1];
      return `<div class="panel card">${H('階段', 'Ladder')}<p class="small muted">${esc(b.producer)}の、日常酒から旗艦まで。</p><div class="ladder-wrap">${R.ladder(steps, b.id)}</div><div class="steps-row">${steps.map(s => `<button class="ladder-step" data-act="card" data-id="${s.bottle.id}"><span class="sw" style="background:${s.bottle.hue}"></span><span class="t">${esc(s.bottle.name)}${s.bottle.id === b.id ? '<span class="small muted">　いまここ</span>' : ''}</span><span class="p">${esc(priceText(s.bottle))}</span></button>`).join('')}</div>${next ? `<button class="btn sm acc" data-act="card" data-id="${next.bottle.id}">次の一段、${esc(next.bottle.name)}を見る</button>` : steps.length > 1 ? '<p class="small muted">ここが、この造り手の頂。</p>' : ''}</div>`;
    }
    if (k === 'label') return `<div class="panel card">${H('ラベルの読み方', 'Label')}<div class="anatomy">${R.labelAnatomy(b.kind)}</div><ol class="notes" style="counter-reset:n">${SUI.ANATOMY[b.kind].map(a => `<li><b>${a.n}. ${esc(a.name)}</b>　${esc(a.d)}</li>`).join('')}</ol>${b.vintageHint ? `<p class="small muted">${esc(b.vintageHint)}</p>` : ''}<p class="small muted">見た目: ${esc(b.cues)}</p></div>`;
    return '';
  }

  /* ---------- AI読み取りカード ---------- */
  views.aicard = () => {
    const a = state.ai; if (!a) return views.capture();
    const d = a.data, hue = C.isHex(d.colorHex) ? d.colorHex : (d.kind === 'sake' ? '#F3F0E4' : '#8B1E3F');
    const g = generalServe(d.kind || 'wine', d.sub, hue);
    const name = d.nameJa || d.nameEn || '読み取った銘柄';
    return `<div class="view">
      <div class="hero-card">
        <div class="glass">${R.glass({ hue, size: 180, night: isNight(), vessel: d.kind === 'sake' ? 'guinomi' : undefined, glass: d.kind === 'sake' ? undefined : (g.tempC && g.tempC[0] <= 8 ? 'flute' : C.luminance(hue) > 0.5 ? 'white' : 'bordeaux') })}</div>
        <span class="tag warn">収録外 · ${a.source === 'name' ? 'AIで調べた結果' : 'AIの読み取り'}（要確認）</span>
        <div class="name ${d.kind === 'sake' ? 'sake' : 'wine'}">${esc(name)}</div>
        ${d.nameEn && d.nameJa ? `<div class="name-ja">${esc(d.nameEn)}</div>` : ''}
        <div class="maker">${esc([d.producer, d.region || d.country].filter(Boolean).join('　'))}</div>
        ${d.oneLine ? `<p class="one">${esc(d.oneLine)}</p>` : ''}
        ${a.image ? `<img src="${a.image}" alt="撮った写真" style="width:96px;border-radius:12px;border:1px solid var(--line)">` : ''}
      </div>
      <div class="card stack">
        <dl class="kv">${d.sub ? `<dt>種類</dt><dd>${esc(d.sub)}</dd>` : ''}${d.grapesOrRice ? `<dt>${d.kind === 'sake' ? '酒米' : '品種'}</dt><dd>${esc(d.grapesOrRice)}</dd>` : ''}${d.abv ? `<dt>度数</dt><dd>${esc(d.abv)}%</dd>` : ''}<dt>${d.kind === 'sake' ? '製造年月' : 'ヴィンテージ'}</dt><dd><input id="vintage" type="text" value="${esc(d.vintage || '')}" placeholder="${a.source === 'name' ? '手で入力' : '読み取れず。手で入力'}" style="font:inherit;border:0;border-bottom:1px solid var(--line);background:transparent;color:inherit;width:12em;outline:none"></dd></dl>
        ${d.notes.length ? `<ul class="notes">${d.notes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${d.readText ? `<p class="small faint">読めた文字: ${esc(d.readText.slice(0, 120))}</p>` : ''}
      </div>
      <div class="card tint stack"><div class="eyebrow">${esc(g.title)}</div><p>${esc(g.text)}</p><div class="thermo">${d.kind === 'sake' ? R.thermo({ kind: 'sake', bands: g.temps, best: g.best }) : R.thermo({ kind: 'wine', tempC: g.tempC })}</div><p class="small muted">歴史や逸話は、収録済みの銘柄だけで表示します（AIは蔵元史を間違えるため）。</p></div>
      ${a.maybe && a.maybe.length ? `<div class="section">${sectionHead('もしかして', 'Maybe')}<div class="result-list">${a.maybe.map(o => `<button class="result" data-act="card" data-id="${o.id}"><span class="sw" style="background:${o.hue}"></span><span><span class="t">${esc(o.name)}</span><br><span class="d">${esc(o.producer)} · ${esc(o.sub)}</span></span></button>`).join('')}</div></div>` : ''}
      <div class="actions"><button class="btn acc" data-act="record-ai">${R.icon('drop')}記録する</button><button class="btn ghost" data-act="nav" data-view="search">名前で探す</button><button class="btn ghost" data-act="shoot">もう一度撮る</button></div>
    </div>`;
  };

  /* ---------- 探す ---------- */
  const STEPS = [
    { key: 'kind', label: '種類', title: 'ワインか、日本酒か。', sub: '迷ったら、どちらでも。今夜に合う方を出します。' },
    { key: 'place', label: '場所', title: 'どこで飲む？', sub: '器と温度は、場所で変わる。' },
    { key: 'purpose', label: '用途', title: '今日は、どんな日？', sub: '日常か、特別か。特別なら、どんな。' },
    { key: 'mood', label: '気分', title: 'どんな気分？', sub: '環をタップ。提案の方向が決まります。' },
    { key: 'food', label: '料理', title: '何と合わせる？', sub: '料理が決まると、温度と器まで決まる。' },
    { key: 'budget', label: '予算', title: '一本にかけられるのは？', sub: '安い酒の夜にも、名酒の階段は見える。' },
  ];
  function chipsBar() {
    const s = state.sel;
    const val = k => k === 'kind' ? nameOf(SUI.KINDS, s.kind) : k === 'place' ? nameOf(SUI.PLACES, s.place) : k === 'purpose' ? (s.purpose === 'special' ? (nameOf(SUI.SUBPURPOSES, s.sub) || '特別') : '日常') : k === 'mood' ? nameOf(SUI.MOODS, s.mood) : k === 'food' ? nameOf(SUI.FOODS, s.food) : nameOf(SUI.BUDGETS, s.budget);
    return `<div class="chips">${STEPS.map((st, i) => `<button class="chip ${state.view === 'explore' && state.step === i ? 'active' : ''}" data-act="step" data-i="${i}"><span class="k">${esc(st.label)}</span>${esc(val(st.key) || '未定')}</button>`).join('')}</div>`;
  }
  const optBtn = (o, key, on, extra) => `<button class="opt ${extra || ''}" data-act="pick" data-key="${key}" data-val="${o.id}" aria-pressed="${on}"><span class="t">${esc(o.name)}</span>${o.d ? `<span class="d">${esc(o.d)}</span>` : ''}<span class="check">${R.icon('check')}</span></button>`;
  views.explore = () => {
    const i = state.step, st = STEPS[i], s = state.sel; let body = '';
    if (st.key === 'kind') body = `<div class="opt-grid one">${SUI.KINDS.map(o => optBtn(o, 'kind', s.kind === o.id)).join('')}</div>`;
    else if (st.key === 'place') body = `<div class="opt-grid">${SUI.PLACES.map(o => optBtn(o, 'place', s.place === o.id)).join('')}</div>`;
    else if (st.key === 'purpose') body = `<div class="opt-grid">${SUI.PURPOSES.map(o => optBtn(o, 'purpose', s.purpose === o.id)).join('')}</div>${s.purpose === 'special' ? `<div class="group-label">どんな特別？</div><div class="pills">${SUI.SUBPURPOSES.map(o => `<button class="pill" data-act="pick" data-key="sub" data-val="${o.id}" aria-pressed="${s.sub === o.id}">${esc(o.name)}</button>`).join('')}</div>` : ''}`;
    else if (st.key === 'mood') body = `<div class="ring-wrap">${R.moodRing(s.mood)}</div>`;
    else if (st.key === 'food') body = `<div class="opt-grid">${SUI.FOODS.map(o => optBtn(o, 'food', s.food === o.id)).join('')}</div>`;
    else body = `<div class="opt-grid">${SUI.BUDGETS.map(o => optBtn(o, 'budget', s.budget === o.id)).join('')}</div>`;
    return `<div class="view">${chipsBar()}
      <div class="steps">${STEPS.map((x, j) => `<span class="dot ${j < i ? 'done' : j === i ? 'now' : ''}"></span>`).join('')}</div>
      <div class="step-title"><div class="eyebrow">Step ${i + 1} / ${STEPS.length}</div><h1>${esc(st.title)}</h1><p class="muted small">${esc(st.sub)}</p></div>
      ${body}
      <div class="btnrow between"><div class="btnrow">${i > 0 ? `<button class="btn ghost sm" data-act="step" data-i="${i - 1}">${R.icon('back')}戻る</button>` : ''}<button class="btn ghost sm" data-act="later">あとで決める</button></div><button class="btn acc" data-act="${i < STEPS.length - 1 ? 'step' : 'propose'}" data-i="${i + 1}">${i < STEPS.length - 1 ? '次へ' : '提案を見る'}</button></div>
    </div>`;
  };
  views.proposals = () => {
    const ctx = seasonCtx(); const r = E.propose(state.sel, { seed: state.seed, ctx });
    return `<div class="view">${chipsBar()}
      <div class="card tint situation"><div class="eyebrow">Situation</div><h2>${esc(situationName(state.sel, ctx))}</h2><p class="small">${esc(principle(state.sel, ctx))}</p>${r.relaxed.length ? `<p class="small muted">${esc(r.relaxed.join('。'))}。</p>` : ''}</div>
      <div class="section">${sectionHead('提案', 'Proposals', `<button class="linkbtn" data-act="reseed">ほかの案</button>`)}
      <div class="proposals">${r.items.map(it => `<button class="proposal" data-act="card" data-id="${it.bottle.id}"><span class="sw">${R.glass(Object.assign({ hue: it.bottle.hue, size: 72, seed: 3, night: isNight(), sparkle: false }, glassFor(it.bottle)))}</span><span class="body"><span class="row"><span class="role ${it.role}">${esc(nameOf(SUI.ROLES, it.role))}</span><span class="small muted">${esc(KINDNAME[it.bottle.kind])} · ${esc(priceText(it.bottle))}</span></span><span class="nm ${it.bottle.kind}">${esc(it.bottle.name)}</span><span class="why">${esc(it.why)}</span><span class="srv">${esc(serveLine(it.serve))}</span></span></button>`).join('')}</div></div>
      <p class="small faint">価格は目安（店・時期で変動）。条件は上のチップから、いつでも変えられます。</p>
    </div>`;
  };

  /* ---------- 階段（図鑑） ---------- */
  views.ladders = () => {
    const L = E.ladders(state.ladderTab);
    return `<div class="view"><div class="section-head"><div><div class="eyebrow">Ladders</div><h1>造り手の階段</h1></div></div>
      <p class="muted small">普段のこの一本の造り手は、こんな酒も造っている。下から上へ。</p>
      <div class="tabs"><button data-act="ltab" data-val="sake" aria-pressed="${state.ladderTab === 'sake'}">日本酒</button><button data-act="ltab" data-val="wine" aria-pressed="${state.ladderTab === 'wine'}">ワイン</button></div>
      ${L.map(l => `<div class="card ladder-card"><div class="maker"><h3>${esc(l.producer)}</h3><span class="en">${esc(l.producerEn)}</span></div><div class="ladder-wrap">${R.ladder(l.steps, null)}</div><div class="steps-row">${l.steps.map(s => `<button class="ladder-step" data-act="card" data-id="${s.bottle.id}"><span class="sw" style="background:${s.bottle.hue}"></span><span class="t">${esc(s.bottle.name)}</span><span class="p">${esc(priceText(s.bottle))}</span></button>`).join('')}</div></div>`).join('')}
    </div>`;
  };

  /* ---------- 色暦 ---------- */
  function fmtDate(ts) { const d = new Date(ts); return d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate(); }
  views.calendar = () => {
    const rs = St.records();
    if (!rs.length) return `<div class="view"><div class="eyebrow">Palette</div><h1>色暦</h1><div class="card tint stack"><p>飲んだ酒の色が、ここに並ぶ。最初の一杯を記録すると、あなたの色が生まれる。</p><div class="btnrow"><button class="btn sm acc" data-act="shoot">撮る</button><button class="btn sm ghost" data-act="nav" data-view="search">名前で探す</button></div></div></div>`;
    const avg = E.avgHue(rs.map(recordHue));
    const pts = rs.filter(r => r.bottleId && E.byId(r.bottleId)).map(r => { const b = E.byId(r.bottleId); return Object.assign(E.mapXY(b), { hue: b.hue, label: b.name }); });
    const months = {}; rs.forEach(r => { const d = new Date(r.ts); const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); (months[k] = months[k] || []).push(r); });
    const kinds = rs.reduce((a, r) => { a[r.kind || 'other'] = (a[r.kind || 'other'] || 0) + 1; return a; }, {});
    const tendency = (() => { const bs = rs.map(r => r.bottleId && E.byId(r.bottleId)).filter(Boolean); if (!bs.length) return ''; const avgx = bs.reduce((a, b) => a + E.mapXY(b).x, 0) / bs.length, avgy = bs.reduce((a, b) => a + E.mapXY(b).y, 0) / bs.length; return (avgx > 0.55 ? '重めの味' : avgx < 0.45 ? '軽やかな味' : '中くらいの重さ') + '、' + (avgy > 0.55 ? '華やかな香り' : avgy < 0.45 ? '穏やかな香り' : '香りはほどほど') + 'に寄っている。'; })();
    return `<div class="view"><div class="eyebrow">Palette</div><h1>色暦</h1>
      <div class="card mycolor">${R.drop({ hue: avg, size: 120, night: isNight(), rim: true })}<div class="stack"><div class="eyebrow">あなたの色</div><div class="latin" style="font-size:22px">${esc(avg)}</div><p class="small muted">${esc(tendency || '飲んだ色の平均。')}${kinds.wine && kinds.sake ? 'ワインも日本酒も。' : kinds.wine ? 'いまはワイン寄り。' : kinds.sake ? 'いまは日本酒寄り。' : ''}</p></div></div>
      ${pts.length ? `<div class="card"><div class="eyebrow">好みの地図</div><div class="quad">${R.quadrant({ points: pts })}</div></div>` : ''}
      ${Object.keys(months).sort().reverse().map(k => `<div class="month"><div class="mh"><span class="m">${k.replace('-', '.')}</span></div><div class="drops">${months[k].map(r => `<button class="drop-btn" data-act="record" data-id="${r.id}">${R.drop({ hue: recordHue(r), size: 56, night: isNight() })}<span class="n">${esc(r.name)}</span></button>`).join('')}</div></div>`).join('')}
    </div>`;
  };
  views.record = () => {
    const r = St.records().find(x => x.id === state.recordId); if (!r) return views.calendar();
    const b = r.bottleId ? E.byId(r.bottleId) : null;
    if (hasDOM) setTimeout(() => St.getPhoto(r.id).then(blob => { const el = document.getElementById('rphoto'); if (el && blob) { el.src = URL.createObjectURL(blob); el.hidden = false; } }), 0);
    return `<div class="view record-detail"><button class="linkbtn" data-act="nav" data-view="calendar">${R.icon('back')} 色暦へ</button>
      <div class="hero-card">${R.drop({ hue: recordHue(r), size: 140, night: isNight(), rim: true })}<div class="name ${r.kind === 'sake' ? 'sake' : ''}" style="font-size:${r.kind === 'sake' ? 34 : 24}px">${esc(r.name)}</div><div class="maker">${esc(fmtDate(r.ts))}　${esc(nameOf(SUI.PLACES, r.place))}${r.with ? '　' + esc(nameOf(SUI.WITH, r.with)) + 'と' : ''}</div>
      <div class="rating">${[1, 2, 3, 4, 5].map(i => `<span style="color:${i <= (r.rating || 0) ? 'var(--acc)' : 'var(--line)'}">${R.icon('drop')}</span>`).join('')}</div>${r.word ? `<p class="one">「${esc(r.word)}」</p>` : ''}${r.band ? `<p class="small muted">${esc(nameOf(SUI.TEMPS, r.band))}で</p>` : ''}${r.paid ? `<p class="small muted">${esc(yen(r.paid))}</p>` : ''}</div>
      <img id="rphoto" class="photo" alt="" hidden>
      <div class="actions"><button class="btn acc" data-act="share" data-id="${r.id}">${R.icon('share')}画像で共有</button>${b ? `<button class="btn ghost" data-act="card" data-id="${b.id}">${R.icon('book')}酒カードへ</button>` : ''}<button class="btn ghost" data-act="delete-record" data-id="${r.id}">${state.confirmDelete === r.id ? 'もう一度押すと消えます' : '削除'}</button></div>
    </div>`;
  };

  /* ---------- 設定 ---------- */
  views.settings = () => {
    const key = St.getRaw(St.KEYS.apiKey, ''), theme = St.get(St.KEYS.theme, 'auto');
    return `<div class="view"><div class="eyebrow">Settings</div><h1>設定</h1>
      ${Rec.relay() ? `<div class="card stack"><div class="eyebrow">写真の読み取り</div><p class="small">写真は読み取りのときだけ、sui の中継サーバーを通して Google Gemini に送られます。保存はされません。端末には縮小した写真だけが残ります。</p></div>` : `<div class="card stack"><div class="field"><label>Gemini APIキー（写真の読み取りに使う）</label><input id="apikey" type="password" value="${esc(key)}" placeholder="AIza…" autocomplete="off"></div>
        <div class="btnrow"><button class="btn sm" data-act="save-key">保存</button>${key ? '<button class="btn sm ghost" data-act="clear-key">消す</button>' : ''}</div>
        <ul class="notes"><li>Google AI Studio で「Get API key」→ キーを作成 → ここに貼る。</li><li>写真は読み取りのときだけ Google に送られ、端末には縮小した写真だけが残る。</li><li>キーはこの端末だけに保存される。</li></ul>
        <p class="small"><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a></p></div>`}
      <div class="card stack"><div class="field"><label>地色</label><div class="theme-chips">${[['auto', '自動（18時から夜）'], ['day', '昼・磁器の白'], ['night', '夜・漆黒']].map(([v, n]) => `<button class="theme-chip" data-act="theme" data-val="${v}" aria-pressed="${theme === v}">${esc(n)}</button>`).join('')}</div></div></div>
      <div class="card stack"><div class="btnrow"><button class="btn sm ghost" data-act="export">${R.icon('download')}記録を書き出す（JSON）</button><button class="btn sm ghost" data-act="age-reset">年齢確認をやり直す</button></div><p class="small muted">${St.ok() ? '' : 'この端末では保存ができません（プライベートモード等）。'}</p></div>
      <p class="small" style="text-align:center"><a href="${esc((SUI.CONFIG && SUI.CONFIG.privacyUrl) || 'privacy.html')}" target="_blank" rel="noopener">プライバシーポリシー</a></p>
      <p class="footer-note">sui ${esc((SUI.CONFIG && SUI.CONFIG.version) || '1.0')}　価格は目安（店・時期で変動）。20歳未満の者の飲酒は法律で禁止されています。妊娠中や授乳期の飲酒は、胎児・乳児の発育に悪影響を与えるおそれがあります。お酒は適量を。</p>
    </div>`;
  };

  /* ---------- 記録シート ---------- */
  function openSheet(init) { state.sheet = Object.assign({ name: '', kind: null, bottleId: null, hue: null, image: null, rating: 0, word: '', place: state.sel.place || 'home', with: 'solo', band: null, paid: '' }, init || {}); renderSheet(); }
  function renderSheet() {
    if (!hasDOM) return; let host = document.getElementById('sheet'); if (!state.sheet) { if (host) host.remove(); return; }
    if (!host) { host = document.createElement('div'); host.id = 'sheet'; document.body.appendChild(host); }
    host.innerHTML = sheetHtml();
  }
  function sheetHtml() {
    const s = state.sheet; const b = s.bottleId ? E.byId(s.bottleId) : null;
    return `<div class="sheet-back" data-act="sheet-close"><div class="sheet" data-stop="1">
      <div class="grab"></div>
      <div class="section-head"><h2>記録する</h2><span class="eyebrow">Log</span></div>
      <div class="field"><label>銘柄</label><input id="s-name" type="text" value="${esc(s.name)}" ${b ? 'readonly' : ''} placeholder="銘柄名"></div>
      <div class="photo-pick">${s.image ? `<img class="thumb" src="${s.image}" alt="">` : '<div class="thumb"></div>'}<button class="btn sm ghost" data-act="sheet-photo">${s.image ? '写真を替える' : '写真を付ける'}</button></div>
      <div class="field"><label>評価</label><div class="rate-btns">${[1, 2, 3, 4, 5].map(i => `<button data-act="sheet-rate" data-val="${i}" aria-pressed="${s.rating >= i}" aria-label="${i}">${R.icon('drop')}</button>`).join('')}</div></div>
      <div class="field"><label>ひとこと（20字まで）</label><input id="s-word" type="text" maxlength="20" value="${esc(s.word)}" placeholder="例: 二杯目がうまい"></div>
      <div class="field"><label>場所</label><div class="pills">${SUI.PLACES.filter(p => p.id !== 'gift').map(p => `<button class="pill" data-act="sheet-set" data-key="place" data-val="${p.id}" aria-pressed="${s.place === p.id}">${esc(p.name)}</button>`).join('')}</div></div>
      <div class="field"><label>誰と</label><div class="pills">${SUI.WITH.map(p => `<button class="pill" data-act="sheet-set" data-key="with" data-val="${p.id}" aria-pressed="${s.with === p.id}">${esc(p.name)}</button>`).join('')}</div></div>
      ${(s.kind || (b && b.kind)) === 'sake' ? `<div class="field"><label>飲んだ温度</label><div class="pills">${SUI.TEMPS.map(t => `<button class="pill" data-act="sheet-set" data-key="band" data-val="${t.id}" aria-pressed="${s.band === t.id}">${esc(t.name)}</button>`).join('')}</div></div>` : ''}
      <div class="field"><label>払った額（任意）</label><input id="s-paid" type="number" inputmode="numeric" value="${esc(s.paid)}" placeholder="円"></div>
      <div class="btnrow"><button class="btn acc block" data-act="sheet-save">${R.icon('drop')}色暦に入れる</button></div>
    </div></div>`;
  }
  function saveSheet() {
    const s = state.sheet; const name = (document.getElementById('s-name') || {}).value || s.name; const word = (document.getElementById('s-word') || {}).value || ''; const paid = Number((document.getElementById('s-paid') || {}).value) || null;
    if (!name.trim()) { toast('銘柄名を入れてください'); return; }
    const b = s.bottleId ? E.byId(s.bottleId) : null;
    const rec = { name: name.trim(), bottleId: s.bottleId, kind: s.kind || (b && b.kind) || null, hue: b ? b.hue : (s.hue || DEFAULT_ACC), rating: s.rating, word: word.trim(), place: s.place, with: s.with, band: s.band, paid, hasPhoto: !!s.image, ai: s.ai || null };
    const id = St.addRecord(rec);
    if (!id) { toast('この端末では保存できません'); return; }
    const img = s.image; state.sheet = null; renderSheet();
    const finish = () => { toast('色暦に入れました'); go('calendar'); };
    if (img) { const blob = St.dataUrlToBlob(img); St.putPhoto(id, blob).then(okp => { if (!okp) { St.updateRecord(id, { hasPhoto: false }); toast('写真は保存できず、記録だけ残しました'); } finish(); }); } else finish();
  }

  /* ---------- 共有画像 ---------- */
  function shareRecord(r) {
    const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1350; const g = cv.getContext('2d');
    const night = isNight(); const hue = recordHue(r); const pal = SUI.liquidPalette(hue);
    const ready = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    return ready.then(() => {
      g.fillStyle = night ? '#121014' : '#F7F3EE'; g.fillRect(0, 0, 1080, 1350);
      if (night) { const gl = g.createRadialGradient(540, 560, 60, 540, 560, 420); gl.addColorStop(0, C.alpha(hue, 0.45)); gl.addColorStop(1, C.alpha(hue, 0)); g.fillStyle = gl; g.fillRect(0, 0, 1080, 1350); }
      const rg = g.createRadialGradient(470, 470, 30, 540, 560, 300); rg.addColorStop(0, pal.center); rg.addColorStop(0.62, hue); rg.addColorStop(1, pal.edge);
      g.beginPath(); g.arc(540, 560, 290, 0, Math.PI * 2); g.fillStyle = rg; g.fill();
      g.beginPath(); g.ellipse(460, 440, 80, 42, -0.5, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.32)'; g.fill();
      g.beginPath(); g.arc(540, 560, 312, 0, Math.PI * 2); g.strokeStyle = night ? 'rgba(242,236,228,0.5)' : 'rgba(34,30,34,0.5)'; g.lineWidth = 2; g.stroke();
      g.fillStyle = night ? '#F2ECE4' : '#221E22'; g.textAlign = 'center';
      g.font = (r.kind === 'sake' ? '400 84px "Yuji Syuku", serif' : '500 72px "Shippori Mincho", serif'); g.fillText(r.name.slice(0, 14), 540, 1000);
      g.font = '400 34px "Cormorant Garamond", serif'; g.fillStyle = night ? '#A89DA2' : '#6E6468'; g.fillText(fmtDate(r.ts) + (r.place ? '   ' + nameOf(SUI.PLACES, r.place) : ''), 540, 1060);
      if (r.word) { g.font = '400 40px "Zen Kaku Gothic New", sans-serif'; g.fillStyle = night ? '#F2ECE4' : '#221E22'; g.fillText('「' + r.word + '」', 540, 1140); }
      g.font = '500 40px "Cormorant Garamond", serif'; g.fillStyle = C.ensureContrast(hue, night ? '#121014' : '#F7F3EE', 3); g.fillText('sui', 540, 1270);
      g.font = '400 20px "Shippori Mincho", serif'; g.fillStyle = night ? '#6F6570' : '#A39A9E'; g.fillText('酒の色で、世界を知る。', 540, 1305);
      return new Promise(res => cv.toBlob(res, 'image/png'));
    }).then(async blob => {
      const N = SUI.native; if (N && N.isNative && N.shareImage) { try { await N.shareImage(blob, 'sui-' + r.id + '.png', r.name); return; } catch (e) { /* fall through */ } }
      const file = new File([blob], 'sui-' + r.id + '.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file], title: r.name }).catch(() => {});
      const url = URL.createObjectURL(blob);
      const host = document.createElement('div'); host.className = 'sheet-back'; host.innerHTML = `<div class="sheet" data-stop="1" style="align-items:center"><div class="grab"></div><img src="${url}" alt="共有用の画像" style="width:min(100%,360px);border-radius:16px;border:1px solid var(--line)"><p class="small muted">長押し（または右クリック）で画像を保存。</p><button class="btn ghost sm" data-act="overlay-close">閉じる</button></div>`;
      host.addEventListener('click', e => { if (e.target === host || e.target.closest('[data-act=overlay-close]')) host.remove(); });
      document.body.appendChild(host);
    });
  }

  /* ---------- 写真の流れ ---------- */
  let pendingShot = null; /* 'recognize' | 'record' | 'sheet' */
  function shoot(mode) {
    if (!hasDOM) return; pendingShot = mode || 'recognize';
    const N = SUI.native;
    if (N && N.isNative && N.pickPhoto) { if (mode !== 'sheet') go('capture'); N.pickPhoto().then(file => { if (file) onFile(file); else pendingShot = null; }).catch(() => { pendingShot = null; }); return; }
    const inp = document.getElementById('file'); inp.value = ''; inp.click(); if (mode !== 'sheet') go('capture');
  }
  async function onFile(file) {
    const mode = pendingShot || 'recognize'; pendingShot = null; if (!file) return;
    if (mode === 'sheet') { const img = await Rec.shrink(file, 1024); state.sheet.image = img.dataUrl; renderSheet(); return; }
    const key = St.getRaw(St.KEYS.apiKey, '');
    if (mode === 'record' || !Rec.available(key)) { const img = await Rec.shrink(file, 1024); state.capture = { status: 'idle', image: img.dataUrl }; openSheet({ image: img.dataUrl, hue: DEFAULT_ACC }); return; }
    state.capture = { status: 'working', msg: '写真を整えています', image: null }; render();
    try {
      const r = await Rec.run(key, file, E.all(), m => { state.capture.msg = m; const el = document.querySelector('.status-line'); if (el) el.textContent = m; });
      state.capture = { status: 'idle', image: r.image };
      if (r.kind === 'db') { state.lastImage = r.image; toast('ラベル一致 ' + Math.round(r.confidence * 100) + '%'); go('card', { current: r.bottle.id, similarOpen: false, wowFlipped: false }); }
      else if (r.kind === 'ai') go('aicard', { ai: r });
      else { toast('ラベルを読み取れませんでした'); go('search', { searchQ: (r.data && (r.data.nameJa || r.data.producer)) || '' }); }
    } catch (e) { state.capture = { status: 'error', error: Rec.errorMessage(e), image: state.capture.image || null }; render(); }
  }

  /* ---------- イベント ---------- */
  function act(el) {
    const a = el.dataset.act, s = state.sel;
    switch (a) {
      case 'nav': go(el.dataset.view, el.dataset.view === 'search' ? {} : {}); break;
      case 'age': if (el.dataset.val === 'yes') { St.set(St.KEYS.age, { ok: true, at: Date.now() }); state.ageDenied = false; go('home'); } else { state.ageDenied = true; render(); } break;
      case 'age-reset': St.set(St.KEYS.age, null); go('home'); break;
      case 'shoot': shoot('recognize'); break;
      case 'shoot-photo': shoot('record'); break;
      case 'record-photo': openSheet({ image: state.capture.image, hue: DEFAULT_ACC }); break;
      case 'card': go('card', { current: el.dataset.id, similarOpen: false, wowFlipped: false }); break;
      case 'panel': { const b = E.byId(state.current); const p = state.panels[b.id]; p[el.dataset.key] = !p[el.dataset.key]; render(); break; }
      case 'flip': state.wowFlipped = !state.wowFlipped; render(); break;
      case 'similar': state.similarOpen = !state.similarOpen; render(); break;
      case 'save': { const on = St.toggleSaved(el.dataset.id); toast(on ? '保存しました' : '保存を外しました'); render(); break; }
      case 'record-bottle': { const b = E.byId(el.dataset.id); openSheet({ name: b.name, bottleId: b.id, kind: b.kind, image: state.lastImage || null, band: b.kind === 'sake' ? b.serve.best : null }); state.lastImage = null; break; }
      case 'record-ai': { const d = state.ai.data; const v = (document.getElementById('vintage') || {}).value; openSheet({ name: (d.nameJa || d.nameEn || '') + (v ? ' ' + v : ''), kind: d.kind, hue: C.isHex(d.colorHex) ? d.colorHex : null, image: state.ai.image, ai: { producer: d.producer, sub: d.sub, vintage: v || d.vintage } }); break; }
      case 'record-manual': openSheet({ name: state.searchQ }); break;
      case 'ai-name': lookupName(state.searchQ); break;
      case 'explore-from': { const b = E.byId(el.dataset.id); state.sel = { kind: b.kind, place: b.tags.place[0] || 'home', purpose: b.tags.purpose.includes('daily') ? 'daily' : 'special', sub: b.tags.purpose.find(p => p !== 'daily' && p !== 'special') || null, mood: b.tags.mood[0] || 'cozy', food: b.tags.food[0] || 'none', budget: b.price.tier === 'daily' ? 'b3000' : b.price.tier === 'mid' ? 'b8000' : 'bmax' }; state.touched = true; state.seed++; go('proposals'); break; }
      case 'step': go('explore', { step: Number(el.dataset.i) }); break;
      case 'later': if (state.step < STEPS.length - 1) go('explore', { step: state.step + 1 }); else go('proposals'); break;
      case 'pick': {
        const k = el.dataset.key, v = el.dataset.val; s[k] = v; state.touched = true;
        if (k === 'purpose' && v === 'daily') s.sub = null;
        const stay = (k === 'purpose' && v === 'special');
        if (state.view === 'explore' && !stay) { if (state.step < STEPS.length - 1) go('explore', { step: state.step + 1 }); else go('proposals'); } else render();
        break; }
      case 'propose': state.touched = true; go('proposals'); break;
      case 'reseed': state.seed++; render(); break;
      case 'ltab': state.ladderTab = el.dataset.val; render(); break;
      case 'record': go('record', { recordId: el.dataset.id }); break;
      case 'delete-record': if (state.confirmDelete === el.dataset.id) { St.removeRecord(el.dataset.id); state.confirmDelete = null; toast('消しました'); go('calendar'); } else { state.confirmDelete = el.dataset.id; render(); } break;
      case 'share': { const r = St.records().find(x => x.id === el.dataset.id); if (r) shareRecord(r); break; }
      case 'save-key': { const v = (document.getElementById('apikey') || {}).value || ''; St.setRaw(St.KEYS.apiKey, v.trim()); toast(v.trim() ? 'キーを保存しました' : 'キーを消しました'); render(); break; }
      case 'clear-key': St.setRaw(St.KEYS.apiKey, ''); toast('キーを消しました'); render(); break;
      case 'theme': St.set(St.KEYS.theme, el.dataset.val); render(); break;
      case 'export': { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([St.exportJson()], { type: 'application/json' })); a.download = 'sui-records.json'; a.click(); break; }
      case 'sheet-close': state.sheet = null; renderSheet(); break;
      case 'sheet-rate': state.sheet.rating = Number(el.dataset.val); keepSheetInputs(); renderSheet(); break;
      case 'sheet-set': state.sheet[el.dataset.key] = el.dataset.val; keepSheetInputs(); renderSheet(); break;
      case 'sheet-photo': keepSheetInputs(); shoot('sheet'); break;
      case 'sheet-save': saveSheet(); break;
      default: break;
    }
  }
  function keepSheetInputs() { const s = state.sheet; if (!s) return; const n = document.getElementById('s-name'), w = document.getElementById('s-word'), p = document.getElementById('s-paid'); if (n) s.name = n.value; if (w) s.word = w.value; if (p) s.paid = p.value; }

  /* 開発用: ストア用スクリーンショットの状態を URL から作る（?shot=card:s_dassai_45&theme=night） */
  function devShot(shot, theme) {
    St.set(St.KEYS.age, { ok: true, at: Date.now() }); if (theme) St.set(St.KEYS.theme, theme);
    if (!St.records().length) {
      const d = (dd, h) => new Date(2026, 9, dd, h).getTime();
      [['獺祭 純米大吟醸 45', 's_dassai_45', 'izakaya', 'friends', 4, '二杯目がうまい', 'hanabie', d(9, 20)], ['グランジ', 'w_penfolds_grange', 'home', 'partner', 5, '十年後にまた', null, d(7, 21)], ['久保田 萬寿', 's_kubota_manju', 'home', 'partner', 5, '香りが花', 'hanabie', d(4, 19)], ['モエ アンペリアル ブリュット', 'w_moet_imperial', 'restaurant', 'friends', 4, '乾杯', null, d(1, 19)], ['菊正宗 上撰 本醸造', 's_kikumasamune_josen_honjozo', 'home', 'solo', 3, '', 'nurukan', new Date(2026, 8, 27, 21).getTime()], ['アルパカ カベルネ・メルロー', 'w_santa_helena_alpaca', 'home', 'solo', 3, '平日の赤', null, new Date(2026, 8, 24, 20).getTime()], ['クラウディー・ベイ ソーヴィニヨン・ブラン', 'w_cloudy_bay_sb', 'outdoor', 'friends', 4, '夏の終わり', null, new Date(2026, 8, 13, 16).getTime()]]
        .forEach(([name, id, place, w, rating, word, band, ts]) => { const b = E.byId(id); if (b) St.addRecord({ name, bottleId: id, kind: b.kind, hue: b.hue, rating, word, place, with: w, band, ts }); });
    }
    const [v, id] = shot.split(':');
    state.sel = { kind: 'sake', place: 'izakaya', purpose: 'daily', sub: null, mood: 'cozy', food: 'nabe', budget: 'b3000' }; state.touched = true; state.seed = 2;
    if (v === 'card') { state.panels[id] = { taste: true }; go('card', { current: id }); }
    else if (v === 'mood') go('explore', { step: 3 });
    else if (v === 'proposals') go('proposals');
    else go(v);
  }
  function init() {
    if (!hasDOM) return;
    document.addEventListener('click', e => {
      const stop = e.target.closest('[data-stop]'); const el = e.target.closest('[data-act]');
      if (!el) return; if (el.dataset.act === 'sheet-close' && stop && stop !== el && el.contains(stop)) return;
      e.preventDefault(); act(el);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.ring-seg, .wow')) act(e.target); });
    document.addEventListener('input', e => { if (e.target.id === 'q') { state.searchQ = e.target.value; const list = document.querySelector('.result-list'); if (list) { const tmp = document.createElement('div'); tmp.innerHTML = views.search(); list.innerHTML = tmp.querySelector('.result-list').innerHTML; } } });
    document.getElementById('file').addEventListener('change', e => onFile(e.target.files && e.target.files[0]));
    setInterval(() => { if (St.get(St.KEYS.theme, 'auto') === 'auto') { const t = document.documentElement.dataset.theme; if (t !== E.daypart()) render(); } }, 60000);
    render();
    try { const q = new URLSearchParams(location.search); const shot = q.get('shot'); if (shot) devShot(shot, q.get('theme')); } catch (e) { /* ignore */ }
  }
  if (hasDOM) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init(); }
  SUI.app = { state, views, render, go, back, applyAccent, applyTheme, STEPS, THEMES, openSheet, sheetHtml, situationName, principle, serveLine, defaultAccent, recordHue };
})(globalThis);
