/* sui — Gemini の「言葉」係。中継経由で JSON を返させる。落ちたら静かに劣化する。DOM 不要。 */
(function (global) {
  'use strict';
  const SUI = global.SUI = global.SUI || {};
  const Rec = () => SUI.recognize, St = () => SUI.store;
  const FORBID = /(健康|翌日に残|二日酔い|体にいい|体に良|痩せ|ダイエット|薬効|効能)/;
  function clean(text) { return String(text || '').split(/(?<=[。！？!?])/).filter(s => !FORBID.test(s)).join('').trim(); }
  function ok() { const key = St() ? St().getRaw(Rec().KEY_NAME, '') : ''; return Rec().available(key); }
  function consent() { return St() ? !!St().get('sui.aiConsent.v1', false) : false; }
  function setConsent(v) { St().set('sui.aiConsent.v1', !!v); }

  /* 端末ID（中継側で回数や会員を判定するための差し込み口。個人情報は含まない） */
  function deviceId() { let id = St().getRaw('sui.device.v1', ''); if (!id) { id = 'd' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); St().setRaw('sui.device.v1', id); } return id; }
  /* generateContent を中継（or 直接）へ送って本文テキストを返す。recognize.js と独立（同時編集を避けるため）。
     中継経由は model 'auto' で1回だけ（モデルの選択と予備切替は中継がやる）。feature は中継の回数集計用 */
  function send(model, body, timeoutMs, feature) {
    const R = Rec().relay(); const key = St().getRaw(Rec().KEY_NAME, '');
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs || 20000);
    const target = R ? R.url + '/v1/recognize' : 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);
    const headers = { 'Content-Type': 'application/json' }; if (R && R.token) headers['x-sui-token'] = R.token; if (R) { headers['x-sui-device'] = deviceId(); headers['x-sui-feature'] = feature || 'ai'; }
    return fetch(target, { method: 'POST', headers, body: JSON.stringify(R ? { model, body } : body), signal: ctrl.signal })
      .then(async r => { clearTimeout(t); if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; } return r.json(); })
      .then(j => { const parts = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts; const text = parts ? parts.map(p => p.text || '').join('') : ''; if (!text) throw new Error('empty'); return text; })
      .catch(e => { clearTimeout(t); if (e.name === 'AbortError') { const x = new Error('timeout'); x.status = 0; throw x; } throw e; });
  }
  /* parts: [{text}|{inline_data}] / schema: Gemini responseSchema */
  async function call(parts, schema, opts) {
    opts = opts || {};
    const body = { contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: opts.temperature == null ? 0.7 : opts.temperature } };
    if (opts.thinkingBudget != null) body.generationConfig.thinkingConfig = { thinkingBudget: opts.thinkingBudget }; /* 0 = 速さ優先（音声など） */
    let last = null;
    const models = Rec().relay() ? ['auto'] : Rec().MODELS;
    for (const model of models) {
      try {
        const text = await send(model, body, opts.timeoutMs, opts.feature);
        const p = Rec().parseResult(text); if (!p.ok) { last = new Error('parse'); continue; }
        return p.data;
      } catch (e) { last = e; if (e.status === 400 || e.status === 401 || e.status === 403 || e.status === 429) break; }
    }
    throw last || new Error('ai');
  }
  const RULES = '禁止: 健康効果・酔いにくさ・翌日の体調に触れない。造り手の歴史や受賞歴を書かない（与えた事実だけ使う）。敬語は使わず、短く、体言止めか常体。';

  /* ① 香りの三択 */
  async function suggestWords(b, pastWords, draft) {
    const schema = { type: 'OBJECT', properties: { words: { type: 'ARRAY', items: { type: 'STRING' } }, note: { type: 'STRING' } }, required: ['words', 'note'] };
    const facts = `銘柄: ${b.name}（${b.kind === 'sake' ? '日本酒' : 'ワイン'}） 種類: ${b.sub} 香りの候補（蔵DB）: ${(b.aromas || []).join('・')} 味: ${JSON.stringify(b.taste)}`;
    const past = (pastWords || []).slice(0, 30).join('・') || '（まだ無し）';
    const text = `あなたは利き手の語彙を引き出す係。${RULES}\n${facts}\nこの人が過去に使った言葉: ${past}\nいま書きかけの一言: ${draft || '（空）'}\n出力: words = この一本に合いそうで、この人が選びそうな短い言葉を3つ（各8字以内、互いに違う方向: 香り／口当たり／余韻）。note = その3語のどれかを使って、この人の口調で40字以内のテイスティングノート。`;
    const d = await call([{ text }], schema, { temperature: 0.8, feature: 'words' });
    return { words: (d.words || []).map(w => String(w).slice(0, 10)).filter(Boolean).slice(0, 3), note: clean(d.note).slice(0, 60) };
  }
  function fallbackWords(b) { return (b && b.aromas ? b.aromas.slice(0, 3) : ['やわらか', 'すっきり', '余韻が長い']); }

  /* ③ 余韻の一句（端末側で拍を検算） */
  const mora = s => { const k = String(s || '').replace(/[^ぁ-ゖァ-ヺー]/g, ''); let n = 0; for (const ch of k) { if ('ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ'.includes(ch)) continue; n++; } return n; };
  function haikuOk(y) { return Array.isArray(y) && y.length === 3 && mora(y[0]) === 5 && mora(y[1]) === 7 && mora(y[2]) === 5; }
  async function haiku(ctx) {
    const schema = { type: 'OBJECT', properties: { lines: { type: 'ARRAY', items: { type: 'STRING' } }, yomi: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['lines', 'yomi'] };
    const text = `一句を詠む。${RULES}\n素材: 酒「${ctx.name}」（${ctx.kind === 'sake' ? '日本酒' : 'ワイン'}）、本人の一言「${ctx.word || ''}」、場所「${ctx.place || ''}」、季節「${ctx.season || ''}」、色「${ctx.colorName || ''}」。\n条件: 五七五の定型。季語は季節に合うものを一つ。酒の銘柄名は入れなくてよい。説明しない。lines に3行、yomi に各行の読みをひらがなだけで（記号なし）。`;
    for (let i = 0; i < 2; i++) {
      const d = await call([{ text: text + (i ? '\n前回は音数が合わなかった。各行の拍を数え直して。' : '') }], schema, { temperature: 0.9, feature: 'haiku' });
      if (haikuOk(d.yomi) && Array.isArray(d.lines) && d.lines.length === 3) return { lines: d.lines.map(clean), yomi: d.yomi };
    }
    return null;
  }

  /* ④ 原型の物語 */
  async function archetypeStory(arch, stats) {
    const schema = { type: 'OBJECT', properties: { lines: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['lines'] };
    const text = `${RULES}\n原型「${arch.name}」（${arch.line}）の人への、3行の短い物語。各行30字以内。杯数や頻度に触れない。材料: 出会った色 ${stats.colors}種、造り手 ${stats.producers}、場所 ${stats.places.join('・') || '—'}、初めての蔵 ${stats.firstProducers.join('・') || '—'}。`;
    const d = await call([{ text }], schema, { temperature: 0.8, feature: 'arch' });
    return (d.lines || []).slice(0, 3).map(l => clean(l).slice(0, 40));
  }

  /* ⑥ 店で: 品書き→3本＋店員への一言（＋訪日客） */
  async function menuPicks(b64, mime, sel, history, opts) {
    opts = opts || {};
    const E = SUI.engine; const index = Rec().buildIndex(E.all());
    const schema = { type: 'OBJECT', properties: {
      items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, price: { type: 'STRING', nullable: true }, matchId: { type: 'STRING', nullable: true }, kind: { type: 'STRING', nullable: true } }, required: ['name'] } },
      picks: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, role: { type: 'STRING' }, why: { type: 'STRING' }, serve: { type: 'STRING' }, matchId: { type: 'STRING', nullable: true }, source: { type: 'STRING' } }, required: ['name', 'role', 'why', 'serve', 'source'] } },
      staffLine: { type: 'STRING' }, unreadable: { type: 'BOOLEAN' },
      en: { type: 'OBJECT', properties: { lines: { type: 'ARRAY', items: { type: 'STRING' } }, card: { type: 'STRING' } }, required: ['lines', 'card'] },
    }, required: ['items', 'picks', 'staffLine', 'unreadable', 'en'] };
    const text = `居酒屋・レストランの品書きの写真。${RULES}\n1) items: 読めた酒の品名・価格・種類（sake/wine/other）。縦書きや筆文字で読めない行は無理に推測せず、unreadable=true にする。収録リストと同じ銘柄なら matchId。\n2) picks: この人のために3本（role は 本命／冒険／安全）。順位の材料: 状況 ${JSON.stringify(sel)}、この人の履歴（好みの傾向と最近の記録）: ${history}。why は30字以内、serve は温度帯と器を20字以内。source は 蔵DB（収録一致）／品書き（読み取り）／推定 のどれか。品書きに無い酒は勧めない。\n3) staffLine: 店員にそのまま見せる一文（25字以内、例「八海山を冷やで。無ければ淡麗辛口を花冷えで」）。\n4) en: lines = 英語で4行（本命の説明。each ≤ 90 chars）、card = 店員に見せる日本語カード（本命を注文する文、40字以内）。\n収録リスト:\n${index}`;
    const d = await call([{ inline_data: { mime_type: mime, data: b64 } }, { text }], schema, { temperature: 0.4, timeoutMs: 30000, thinkingBudget: 0, feature: 'menu' });
    d.picks = (d.picks || []).slice(0, 3).map(p => Object.assign(p, { why: clean(p.why), serve: clean(p.serve) }));
    d.staffLine = clean(d.staffLine); return d;
  }

  SUI.ai = { ok, consent, setConsent, deviceId, call, clean, suggestWords, fallbackWords, haiku, haikuOk, mora, archetypeStory, menuPicks };
})(globalThis);
