/* sui — 写真認識（Gemini generateContent）。request は差し替え可能な1関数に閉じ込める。 */
(function (global) {
  'use strict';
  const SUI = global.SUI = global.SUI || {};
  const MODELS = ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const KEY_NAME = 'gemini_api_key';

  const SCHEMA = {
    type: 'OBJECT',
    properties: {
      matchId: { type: 'STRING', nullable: true }, confidence: { type: 'NUMBER' }, readText: { type: 'STRING', nullable: true },
      nameJa: { type: 'STRING', nullable: true }, nameEn: { type: 'STRING', nullable: true }, producer: { type: 'STRING', nullable: true },
      kind: { type: 'STRING', nullable: true }, sub: { type: 'STRING', nullable: true }, country: { type: 'STRING', nullable: true }, region: { type: 'STRING', nullable: true },
      grapesOrRice: { type: 'STRING', nullable: true }, vintage: { type: 'STRING', nullable: true }, colorHex: { type: 'STRING', nullable: true }, abv: { type: 'NUMBER', nullable: true },
      oneLine: { type: 'STRING', nullable: true }, notes: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['matchId', 'confidence', 'kind', 'notes'],
  };

  function buildIndex(bottles) {
    return (bottles || []).map(b => `${b.id} | ${b.name} / ${b.nameEn} | ${b.producer} (${b.producerEn}) | ${b.sub} | ${b.cues || ''}`).join('\n');
  }
  function buildPrompt(index) {
    return [
      'あなたは日本酒とワインのラベル読み取りの専門家。写真のボトルまたはラベルを読み、JSON だけを返す。',
      '1) 下の収録リストに同じ銘柄（銘柄名・造り手・グレードまで一致）があれば matchId にその id を入れる。似ているだけ・同じ蔵の別グレードなら null。confidence は 0〜1。',
      '2) readText にはラベルから読めた文字（最大200字）。',
      '3) nameJa（日本語の銘柄名）, nameEn, producer, kind（"wine" か "sake"）, sub（特定名称や品種など短く）, country, region, grapesOrRice, vintage（年またはラベルの製造年月。無ければ null）, colorHex（液体の推定色 #RRGGBB）, abv（度数）, oneLine（40字以内の紹介）, notes（最大3つ、各40字以内。ラベルから読める事実だけ）。',
      '不明は null。造り手の歴史・受賞歴・逸話は書かない。推測で銘柄を断定しない。',
      '収録リスト（id | 名前 / 英名 | 造り手 | 種類 | ラベルの見た目）:',
      index || '(なし)',
    ].join('\n');
  }
  function parseResult(text) {
    if (text == null) return { ok: false, error: 'empty' };
    let s = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const a = s.indexOf('{'), z = s.lastIndexOf('}');
    if (a < 0 || z < a) return { ok: false, error: 'no-json' };
    s = s.slice(a, z + 1);
    const tryParse = str => { try { return JSON.parse(str); } catch (e) { return null; } };
    let data = tryParse(s) || tryParse(s.replace(/,\s*([}\]])/g, '$1'));
    if (!data || typeof data !== 'object') return { ok: false, error: 'bad-json' };
    data.confidence = typeof data.confidence === 'number' ? Math.max(0, Math.min(1, data.confidence)) : 0;
    if (!Array.isArray(data.notes)) data.notes = [];
    data.notes = data.notes.filter(x => typeof x === 'string').slice(0, 3);
    if (data.kind !== 'wine' && data.kind !== 'sake') data.kind = null;
    if (data.colorHex && !/^#[0-9A-Fa-f]{6}$/.test(data.colorHex)) data.colorHex = null;
    return { ok: true, data };
  }
  function maybeList(data, bottles) {
    const E = SUI.engine; const norm = E ? E.norm : (x => String(x || '').toLowerCase());
    const qs = [data.nameJa, data.nameEn, data.producer].filter(Boolean).map(norm).filter(q => q.length >= 2);
    const hits = (bottles || []).map(b => {
      const fields = [b.name, b.nameEn, b.producer, b.producerEn].map(norm); let s = 0;
      qs.forEach(q => fields.forEach((f, i) => { if (f.includes(q) || q.includes(f)) s += i < 2 ? 3 : 2; }));
      return { b, s };
    }).filter(x => x.s > 0).sort((x, y) => y.s - x.s);
    return hits.slice(0, 3).map(x => x.b);
  }
  function resolve(data, bottles) {
    bottles = bottles || (SUI.engine ? SUI.engine.all() : []);
    if (!data) return { kind: 'none', maybe: [] };
    const hit = data.matchId ? bottles.find(b => b.id === data.matchId) : null;
    if (hit && data.confidence >= 0.6) return { kind: 'db', bottle: hit, confidence: data.confidence, data };
    const maybe = maybeList(data, bottles);
    if (hit && !maybe.includes(hit)) maybe.unshift(hit);
    if (data.nameJa || data.nameEn || data.producer) return { kind: 'ai', data, maybe: maybe.slice(0, 3) };
    return { kind: 'none', maybe: maybe.slice(0, 3), data };
  }

  /* --- DOM 側 --- */
  function shrink(file, max) {
    max = max || 1024;
    return new Promise((res, rej) => {
      const done = (w, h, draw) => {
        const k = Math.min(1, max / Math.max(w, h)); const cw = Math.round(w * k), ch = Math.round(h * k);
        const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const g = cv.getContext('2d'); draw(g, cw, ch);
        const dataUrl = cv.toDataURL('image/jpeg', 0.82);
        res({ b64: dataUrl.split(',')[1], mime: 'image/jpeg', dataUrl, width: cw, height: ch });
      };
      if (global.createImageBitmap) {
        createImageBitmap(file, { imageOrientation: 'from-image' }).then(bm => done(bm.width, bm.height, (g, w, h) => g.drawImage(bm, 0, 0, w, h))).catch(() => viaImage());
      } else viaImage();
      function viaImage() {
        const url = URL.createObjectURL(file); const im = new Image();
        im.onload = () => { done(im.naturalWidth, im.naturalHeight, (g, w, h) => g.drawImage(im, 0, 0, w, h)); URL.revokeObjectURL(url); };
        im.onerror = () => rej(new Error('画像を読み込めませんでした')); im.src = url;
      }
    });
  }
  const relay = () => (SUI.CONFIG && SUI.CONFIG.relayUrl) ? { url: SUI.CONFIG.relayUrl.replace(/\/$/, ''), token: SUI.CONFIG.relayToken || '' } : null;
  function available(apiKey) { return !!(relay() || apiKey); }
  /* 中継サーバー（relay/worker.js）があればそこへ、無ければ Gemini を直接呼ぶ。どちらも Gemini の JSON をそのまま返す。 */
  function request(apiKey, model, b64, mime, prompt, opts) {
    opts = opts || {}; const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 20000);
    const body = { contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: prompt }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.2 } };
    const R = relay();
    const target = R ? R.url + '/v1/recognize' : ENDPOINT + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
    const headers = { 'Content-Type': 'application/json' }; if (R && R.token) headers['x-sui-token'] = R.token;
    const payload = R ? { model, body } : body;
    return fetch(target, { method: 'POST', headers, body: JSON.stringify(payload), signal: ctrl.signal })
      .then(async r => { clearTimeout(t); if (!r.ok) { const msg = await r.text().catch(() => ''); const e = new Error('HTTP ' + r.status); e.status = r.status; e.body = msg.slice(0, 300); throw e; } return r.json(); })
      .then(j => { const parts = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts; const text = parts ? parts.map(p => p.text || '').join('') : ''; if (!text) { const e = new Error('empty-response'); e.body = JSON.stringify(j).slice(0, 300); throw e; } return text; })
      .catch(e => { clearTimeout(t); if (e.name === 'AbortError') { const x = new Error('timeout'); x.status = 0; throw x; } throw e; });
  }
  async function run(apiKey, file, bottles, onStatus) {
    if (!available(apiKey)) { const e = new Error('no-recognizer'); e.status = 0; throw e; }
    const status = m => { try { onStatus && onStatus(m); } catch (e) { /* ignore */ } };
    status('写真を整えています');
    const img = await shrink(file, 1024);
    const prompt = buildPrompt(buildIndex(bottles));
    let lastErr = null;
    for (const model of MODELS) {
      status('ラベルを読んでいます');
      try {
        const text = await request(apiKey, model, img.b64, img.mime, prompt, { timeoutMs: 20000 });
        const p = parseResult(text);
        if (!p.ok) { lastErr = new Error('parse:' + p.error); continue; }
        const r = resolve(p.data, bottles); r.model = model; r.image = img.dataUrl; return r;
      } catch (e) {
        lastErr = e;
        if (e.status === 400 || e.status === 401 || e.status === 403) break; /* キーの問題はモデルを変えても直らない */
      }
    }
    throw lastErr || new Error('unknown');
  }
  function errorMessage(e) {
    if (!e) return '読み取れませんでした。';
    if (e.message === 'no-recognizer') return '読み取りの設定がありません。名前で探せます。';
    if (e.status === 400 || e.status === 401 || e.status === 403) return 'APIキーが無効のようです。設定を確認してください。';
    if (e.status === 429) return '少し混み合っています。数秒おいて、もう一度。';
    if (e.message === 'timeout') return '時間がかかりすぎました。電波の良い場所で、もう一度。';
    if (String(e.message).startsWith('parse:')) return '読み取り結果を解釈できませんでした。もう一度。';
    if (e.message === 'Failed to fetch' || e.name === 'TypeError') return 'ネットワークに繋がりませんでした。';
    return '読み取れませんでした。' + (e.message ? '（' + e.message + '）' : '');
  }
  SUI.recognize = { MODELS, KEY_NAME, SCHEMA, buildIndex, buildPrompt, parseResult, resolve, shrink, request, run, errorMessage, available, relay };
})(globalThis);
