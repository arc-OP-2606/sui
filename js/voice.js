/* sui — 音声ソムリエ v1: 聞く（端末で録音→WAV）→ 考える（Gemini: 文字起こし＋返答＋提案を JSON）→ 話す（Gemini TTS）。DOM 部分は hasDOM で守る。 */
(function (global) {
  'use strict';
  const SUI = global.SUI = global.SUI || {};
  const hasDOM = typeof document !== 'undefined';
  const Rec = () => SUI.recognize, St = () => SUI.store, E = () => SUI.engine, AI = () => SUI.ai;
  const TTS_MODEL = 'gemini-2.5-flash-preview-tts', VOICE = 'Kore', RATE = 16000;

  /* ---------- 録音（getUserMedia → PCM → 16kHz WAV） ---------- */
  let rec = null;
  function supported() { return hasDOM && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (global.AudioContext || global.webkitAudioContext)); }
  async function start(onLevel) {
    if (!supported()) throw new Error('mic-unsupported');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const Ctx = global.AudioContext || global.webkitAudioContext; const ctx = new Ctx();
    const src = ctx.createMediaStreamSource(stream); const proc = ctx.createScriptProcessor(4096, 1, 1); const chunks = [];
    proc.onaudioprocess = e => { const d = e.inputBuffer.getChannelData(0); chunks.push(new Float32Array(d)); if (onLevel) { let s = 0; for (let i = 0; i < d.length; i += 8) s += d[i] * d[i]; onLevel(Math.min(1, Math.sqrt(s / (d.length / 8)) * 6)); } };
    src.connect(proc); proc.connect(ctx.destination);
    rec = { stream, ctx, src, proc, chunks, t0: Date.now(), timer: setTimeout(() => stop().catch(() => {}), 15000) };
    return true;
  }
  function stop() {
    return new Promise((res, rej) => {
      const r = rec; rec = null; if (!r) return rej(new Error('not-recording'));
      clearTimeout(r.timer);
      try { r.proc.disconnect(); r.src.disconnect(); } catch (e) { /* ignore */ }
      r.stream.getTracks().forEach(t => t.stop());
      const inRate = r.ctx.sampleRate; r.ctx.close().catch(() => {});
      const total = r.chunks.reduce((n, c) => n + c.length, 0); const all = new Float32Array(total); let o = 0; r.chunks.forEach(c => { all.set(c, o); o += c.length; });
      const secs = total / inRate; if (secs < 0.4) return rej(new Error('too-short'));
      const ratio = inRate / RATE, outLen = Math.floor(total / ratio), pcm = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) { const a = Math.floor(i * ratio), b = Math.min(total, Math.floor((i + 1) * ratio)); let s = 0; for (let j = a; j < b; j++) s += all[j]; const v = Math.max(-1, Math.min(1, s / Math.max(1, b - a))); pcm[i] = v < 0 ? v * 32768 : v * 32767; }
      res({ b64: wavBase64(pcm, RATE), mime: 'audio/wav', seconds: secs });
    });
  }
  function recording() { return !!rec; }
  function wavBase64(pcm, rate) {
    const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
    const w = (p, s) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i], true);
    let s = ''; const u8 = new Uint8Array(buf); for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }

  /* ---------- 考える ---------- */
  const SCHEMA = { type: 'OBJECT', properties: {
    transcript: { type: 'STRING' }, reply: { type: 'STRING' },
    picks: { type: 'ARRAY', items: { type: 'OBJECT', properties: { matchId: { type: 'STRING', nullable: true }, name: { type: 'STRING' }, serve: { type: 'STRING' } }, required: ['name', 'serve'] } },
    staffLine: { type: 'STRING', nullable: true }, source: { type: 'STRING' },
  }, required: ['transcript', 'reply', 'picks', 'source'] };
  function context(ctx) {
    ctx = ctx || {}; const lines = [];
    const b = ctx.bottle; if (b) lines.push(`いま見ている一本（蔵DB）: ${b.name}／${b.producer}／${b.sub}／味 ${JSON.stringify(b.taste)}／香り ${(b.aromas || []).join('・')}／いちばんの飲み方 ${serveShort(E().serve(b, ctx.sel || E().defaults(), ctxNow()))}／合う料理 ${(b.pairings || []).join('・')}／階段 ${E().ladder(b).map(x => x.bottle.name + '(¥' + x.bottle.price.min + ')').join('→')}`);
    const rs = (St().records() || []).slice(0, 8).map(r => `${r.name}${r.rating ? '★' + r.rating : ''}${r.word ? '「' + r.word + '」' : ''}${r.band ? '・' + (SUI.byIdIn(SUI.TEMPS, r.band) || {}).name : ''}${r.place ? '・' + (SUI.byIdIn(SUI.PLACES, r.place) || {}).name : ''}`);
    lines.push('この人の最近の記録（色暦）: ' + (rs.join('／') || 'まだ無い'));
    const words = Object.keys(St().get('sui.words.v1', {})).slice(0, 15); if (words.length) lines.push('この人がよく使う言葉: ' + words.join('・'));
    if (ctx.sel) lines.push('いまの状況: ' + JSON.stringify(ctx.sel));
    /* 候補は絞って送る（速さ優先）: 種類・予算・料理で上位 18 本＋見ている一本の階段 */
    const sel = ctx.sel || E().defaults();
    let cand = E().all().filter(x => !x.noRecommend && (!sel.kind || sel.kind === 'any' || x.kind === sel.kind) && x.price.min <= E().budgetMax(sel));
    cand = cand.map(x => ({ x, s: E().score(x, sel, { season: E().seasonOf(), daypart: E().daypart() }) })).sort((p, q) => q.s - p.s).slice(0, 18).map(p => p.x);
    if (b) E().ladder(b).forEach(st => { if (!cand.includes(st.bottle)) cand.push(st.bottle); });
    lines.push('収録リスト（id | 名前 | 造り手 | 種類 | 合う料理 | 目安価格）:\n' + cand.map(x => `${x.id} | ${x.name} | ${x.producer} | ${x.sub} | ${x.tags.food.join('・')} | ¥${x.price.min}`).join('\n'));
    return lines.join('\n');
  }
  function prompt(ctx, history, typed) {
    const hist = (history || []).slice(-6).map(t => `${t.role === 'user' ? '客' : 'sui'}: ${t.text}`).join('\n');
    return `あなたは「sui」。酒の相棒で、落ち着いて温かく、少し茶目っ気のある声の持ち主。音声で返事を読み上げるので、話し言葉で、1〜3文・110字以内。敬語は丁寧すぎない「です・ます」。
守ること: 与えた事実（蔵DB・この人の記録）だけを使い、知らないことは「分からない」と言う。健康・酔いにくさ・翌日の体調に触れない。杯数や量を勧めない。造り手の歴史や受賞歴を作らない。合わない組合せは正直に「合わない」と言う。
${typed ? `客の発言は文字で届いた: 「${String(typed).slice(0, 200)}」。transcript にはこの発言をそのまま入れる。` : '添付の音声は客の発話。transcript に文字起こし（聞き取れなければ空）。'}reply に返事。picks に勧める酒（最大2本、収録リストの id を matchId に。収録外なら null。serve は温度帯と器を15字以内）。客が店で頼む場面なら staffLine に店員にそのまま見せる一文（25字以内）、そうでなければ null。source は、返事の中身がすべて与えた事実（蔵DB・この人の記録）に書いてあるときだけ 蔵DB。自分の推測（料理の相性の広げ方など）を少しでも含むなら 推定。
${context(ctx)}
これまでの会話:
${hist || '（最初の発話）'}`;
  }
  function tidy(d) {
    d.reply = AI().clean(d.reply).slice(0, 160); d.transcript = String(d.transcript || '').slice(0, 200);
    d.picks = (d.picks || []).slice(0, 2).map(p => Object.assign(p, { bottle: p.matchId ? E().byId(p.matchId) : null }));
    return d;
  }
  async function ask(audio, ctx, history) {
    return tidy(await AI().call([{ inline_data: { mime_type: audio.mime, data: audio.b64 } }, { text: prompt(ctx, history) }], SCHEMA, { temperature: 0.6, timeoutMs: 25000, thinkingBudget: 0, feature: 'voice' }));
  }
  /* 文字で聞く（店では声を出さない） */
  async function askText(text, ctx, history) {
    const d = tidy(await AI().call([{ text: prompt(ctx, history, text) }], SCHEMA, { temperature: 0.6, timeoutMs: 25000, thinkingBudget: 0, feature: 'voice-text' }));
    d.transcript = String(text).slice(0, 200); return d;
  }

  /* ---------- ボタンで聞く（蔵DB の事実だけ。AI を呼ばないので速く、正確） ---------- */
  const PHRASE = {
    sake: { a: ['辛口寄り', '甘口寄り'], b: ['淡麗', '濃醇'], c: ['香りは穏やか', '香りが華やか'], d: ['酸はやわらか', '酸がきりっと'] },
    wine: { a: ['軽やか', '重厚'], b: ['辛口', '甘口'], c: ['酸は穏やか', '酸が鮮やか'], d: ['渋みはなめらか', '渋みが力強い'] },
  };
  const yen = n => Math.round(n).toLocaleString('ja-JP') + '円';
  function ctxNow() { return { season: E().seasonOf(), daypart: E().daypart() }; }
  function serveSpeech(sv) { return sv.kind === 'sake' ? `${sv.bandName}、${sv.tempC}度くらいで。器は${sv.vesselName}。` : `${sv.tempC[0]}から${sv.tempC[1]}度。グラスは${sv.glassName}。${sv.decant ? sv.decant + '分ほど空気に触れさせて。' : ''}`; }
  function serveShort(sv) { return sv.kind === 'sake' ? `${sv.bandName}（${sv.tempC}℃）・${sv.vesselName}` : `${sv.tempC[0]}–${sv.tempC[1]}℃・${sv.glassName}`; }
  const BOTTLE_TOPICS = [['one', 'ひと言で'], ['taste', '味わいは？'], ['serve', '温度と器は？'], ['food', '合う料理は？'], ['story', '造り手の話'], ['wow', 'へぇ、を聞く'], ['order', '店でどう頼む？'], ['next', '一段上の一本は？']];
  const PICK_TOPICS = [['honmei', '今夜の本命は？'], ['bouken', '冒険するなら？'], ['nichijo', '気負わない一本は？'], ['gohobi', 'ご褒美なら？'], ['teiban', '定番は？']];
  function topics(ctx) { return ((ctx && ctx.bottle) ? BOTTLE_TOPICS : PICK_TOPICS).map(([id, label]) => ({ id, label })); }
  function answer(id, ctx) {
    ctx = ctx || {}; const b = ctx.bottle, sel = ctx.sel || E().defaults();
    if (b) {
      const sv = E().serve(b, sel, ctxNow());
      if (id === 'one') return { text: b.one };
      if (id === 'taste') { const ph = PHRASE[b.kind] || PHRASE.wine; const w = Object.keys(ph).map(k => { const v = b.taste[k] || 3; return v <= 2 ? ph[k][0] : v >= 4 ? ph[k][1] : null; }).filter(Boolean); return { text: `${w.length ? w.join('、') : 'どこにも偏らない、穏やかな釣り合い'}。香りは${(b.aromas || []).slice(0, 3).join('、')}。` }; }
      if (id === 'serve') return { text: serveSpeech(sv) + (b.kind === 'sake' && b.serve.note ? b.serve.note : '') };
      if (id === 'food') { const bad = E().foodFits(b).find(f => f.level === 'bad'); return { text: `合うのは、${(b.pairings || []).slice(0, 3).join('、')}。` + (bad ? `${bad.food.name}とは合いません。${bad.reason}` : '') }; }
      if (id === 'story') { const beats = (b.story && b.story.beats) || []; return { text: beats.slice(0, 2).map(x => x.t).join('') || 'この一本の物語は、まだ収録していません。' }; }
      if (id === 'wow') return { text: b.wow || 'この一本の「へぇ」は、まだ収録していません。' };
      if (id === 'order') return { text: b.kind === 'sake' ? `店では「${b.name}を、${sv.bandName}で」と伝えると通じます。` : `店では「${b.name}を、${sv.tempC[0]}度くらいで」と伝えると通じます。`, staffLine: b.kind === 'sake' ? `${b.name}を、${sv.bandName}で` : `${b.name}を、${sv.tempC[0]}℃くらいで` };
      if (id === 'next') { const lad = E().ladder(b); const i = lad.findIndex(x => x.bottle.id === b.id); const nx = i >= 0 ? lad[i + 1] : null; if (nx) return { text: `同じ造り手の一段上は、${nx.bottle.name}。目安は${yen(nx.bottle.price.min)}から。`, picks: [{ bottle: nx.bottle, name: nx.bottle.name, serve: serveShort(E().serve(nx.bottle, sel, ctxNow())) }] }; return { text: lad.length > 1 ? 'これが、この造り手の頂です。' : 'この造り手の階段は、この一本だけ収録しています。' }; }
      return null;
    }
    const r = E().propose(sel, { seed: new Date().getDate(), ctx: ctxNow() });
    const it = (r.items || []).find(x => x.role === id);
    if (!it) return { text: 'いまの条件では、ぴったりの一本が見つかりませんでした。条件を少し変えてみてください。' };
    const role = (SUI.byIdIn(SUI.ROLES, id) || {}).name || '';
    return { text: `${role}は、${it.bottle.name}。${String(it.why || '').replace(/。$/, '')}。${serveSpeech(it.serve)}`, picks: [{ bottle: it.bottle, name: it.bottle.name, serve: serveShort(it.serve) }] };
  }

  /* 読み上げ（イヤホンで聞く想定）。切ると文字だけ */
  function readOn() { return St() ? St().get('sui.voice.read.v1', true) !== false : true; }
  function setRead(v) { if (St()) St().set('sui.voice.read.v1', !!v); }

  /* ---------- 話す（TTS） ---------- */
  async function synth(text, voice) {
    const R = Rec().relay(); if (!R) throw new Error('no-relay');
    const body = { contents: [{ parts: [{ text: `次の文を、落ち着いた温かい声で、少しゆっくり自然に読む: ${text}` }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || VOICE } } } } };
    const r = await fetch(R.url + '/v1/tts', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sui-token': R.token, 'x-sui-device': AI().deviceId(), 'x-sui-feature': 'voice-tts' }, body: JSON.stringify({ model: TTS_MODEL, body }) });
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    const j = await r.json(); const part = j.candidates && j.candidates[0] && j.candidates[0].content.parts.find(p => p.inlineData);
    if (!part) throw new Error('no-audio');
    if (/mpeg|mp3/.test(part.inlineData.mimeType)) return 'data:audio/mpeg;base64,' + part.inlineData.data; /* 中継の自然な声（Google Cloud・MP3） */
    const rate = Number((part.inlineData.mimeType.match(/rate=(\d+)/) || [])[1] || 24000);
    const bin = atob(part.inlineData.data); const pcm = new Int16Array(bin.length / 2); for (let i = 0; i < pcm.length; i++) pcm[i] = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) << 16 >> 16;
    return 'data:audio/wav;base64,' + wavBase64(pcm, rate);
  }
  /* 返事を文ごとに分け、最初の文を先に鳴らしながら次を作る */
  function chunks(text) { const parts = String(text).split(/(?<=[。！？!?])/).map(t => t.trim()).filter(Boolean); const out = []; parts.forEach(pt => { if (out.length && (out[out.length - 1] + pt).length < 34) out[out.length - 1] += pt; else out.push(pt); });
    /* 声ができるまでの待ちは文の長さにほぼ比例する（2026-10-12 計測: 28字で約4.5秒）。最初が長いときは最初の読点で切り、早く鳴らし始める */
    if (out.length && out[0].length > 18) { const i = out[0].indexOf('、'); if (i >= 4 && i <= 16) out.splice(0, 1, out[0].slice(0, i + 1), out[0].slice(i + 1)); }
    return out.length ? out : [String(text)]; }
  /* 読み上げ用に記号を言葉へ（画面の文字はそのまま） */
  /* 読み違えやすい語を、かなに直して声にする（画面の文字はそのまま）。2026-10-13 塾長: 「米」をベイ、「一段上」をイチダンジョウと読んでいた。
     長い語を先に置く（「精米歩合」を「米」より先に直す）。test/voice.test.js と store/readings-check の検査で足していく */
  const READINGS = [['一段上', 'いちだんうえ'], ['精米歩合', 'せいまいぶあい'], ['酒造好適米', 'しゅぞうこうてきまい'], ['酒米', 'さかまい'],
    ['生酛', 'きもと'], ['山廃', 'やまはい'], ['杜氏', 'とうじ'], ['猪口', 'ちょこ'], ['旨み', 'うまみ'], ['旨味', 'うまみ'], ['渋み', 'しぶみ'],
    ['旗艦', 'きかん'], ['生魚', 'なまざかな'], ['日常酒', 'にちじょうしゅ'], ['蔵元', 'くらもと'], ['涼冷え', 'すずひえ'], ['冷奴', 'ひややっこ'],
    ['獺祭', 'だっさい'], ['田酒', 'でんしゅ'], ['十四代', 'じゅうよんだい'], ['百寿', 'ひゃくじゅ'], ['千寿', 'せんじゅ'], ['萬寿', 'まんじゅ'],
    ['五大シャトー', 'ごだいシャトー'], ['第一級', 'だいいっきゅう'], ['第二級', 'だいにきゅう'], ['豪州', 'ごうしゅう'], ['新樽', 'しんだる'], ['小樽', 'こだる'],
    ['仔羊', 'こひつじ'], ['熟成牛', 'じゅくせいぎゅう'], ['格下', 'かくした'], ['黒鉛', 'こくえん'], ['洋梨', 'ようなし'], ['塩田千春', 'しおたちはる'],
    ['藍茜', 'あいあかね'], ['三楽酒造', 'さんらくしゅぞう'], ['桔梗ヶ原', 'ききょうがはら'], ['寿屋', 'ことぶきや'], ['小山新助', 'こやましんすけ'], ['登美村', 'とみむら'], ['登美', 'とみ'],
    ['天保元年', 'てんぽうがんねん'], ['越路', 'こしじ'], ['平澤亨', 'ひらさわとおる'], ['嶋悌司', 'しまていじ'], ['大坂屋長兵衛', 'おおさかやちょうべえ'],
    ['一ノ蔵', 'いちのくら'], ['無鑑査', 'むかんさ'], ['真澄', 'ますみ'], ['奥伝寒造り', 'おくでんかんづくり'], ['夢殿', 'ゆめどの'], ['袋搾り', 'ふくろしぼり'],
    ['雫酒', 'しずくざけ'], ['粕取り焼酎', 'かすとりしょうちゅう'], ['玉返し', 'たまがえし'], ['朝日鷹', 'あさひたか'], ['高木顕統', 'たかぎあきつね'], ['龍泉', 'りゅうせん'],
    ['華吹雪', 'はなふぶき'], ['油川', 'あぶらかわ'], ['新政厚徳', 'あらまさこうとく'], ['新政', 'あらまさ'], ['佐藤卯兵衛', 'さとううへえ'], ['初瀬街道', 'はせかいどう'],
    ['名張', 'なばり'], ['木屋正', 'きやしょう'], ['大西唯克', 'おおにしただよし'], ['而今', 'じこん'], ['山田錦', 'やまだにしき'], ['五峰山', 'ごほうざん'],
    ['神結', 'かみむすび'], ['嘉宝蔵', 'かほうぐら'], ['麹米', 'こうじまい'], ['（タレ）', '、タレ'], ['上燗', 'じょうかん'], ['熱燗', 'あつかん'], ['ぐい呑', 'ぐいのみ'], ['特A地区', 'とくエーちく'], ['冷や', 'ひや'], ['燗', 'かん'], ['No.1', 'ナンバーワン']];
  /* 「米」「器」は単独のときだけ（純米・精米・南米・酒器などの熟語は、そのまま正しく読まれる） */
  const ALONE = [[/(?<![\u4e00-\u9fff])米(?![\u4e00-\u9fff])/g, 'こめ'], [/(?<![\u4e00-\u9fff])器(?![\u4e00-\u9fff])/g, 'うつわ']];
  function readings(t) { return ALONE.reduce((a, [re, r]) => a.replace(re, r), READINGS.reduce((a, [w, r]) => a.split(w).join(r), t)); }
  /* 数字は漢数字にして読ませる（2026-10-13: 「16,500円」を「じゅうろく、ごひゃくえん」と読んでいた。カンマや桁で区切られて読まれるため） */
  function kanjiNum(n) {
    if (n === 0) return '零'; const D = '〇一二三四五六七八九', U = ['', '十', '百', '千'], B = ['', '万', '億', '兆']; let out = '', b = 0;
    while (n > 0) { const g = n % 10000; if (g) { let w = ''; String(g).padStart(4, '0').split('').forEach((c, i) => { const d = +c, u = U[3 - i]; if (d) w += (d === 1 && u ? '' : D[d]) + u; }); out = w + B[b] + out; } n = Math.floor(n / 10000); b++; }
    return out;
  }
  const DIG = '〇一二三四五六七八九';
  function numbers(t) {
    return t.replace(/CO2/g, 'シーオーツー').replace(/BBQ/g, 'バーベキュー').replace(/AOC/g, 'エーオーシー').replace(/Tボーン/g, 'ティーボーン').replace(/S-type/g, 'エスタイプ').replace(/(\d)\s?m(?![A-Za-z])/g, '$1メートル').replace(/No\.\s?/g, 'ナンバー').replace(/\+(?=\d)/g, 'プラス').replace(/(\d)\s?ha\b/g, '$1ヘクタール').replace(/%/g, 'パーセント')
      .replace(/(\d+)\.(\d+)/g, (m, a, b) => kanjiNum(Number(a)) + '点' + b.split('').map(d => DIG[+d]).join('')) /* 17.5 → 十七点五 */
      .replace(/(\d{1,3}(?:,\d{3})+|\d+)/g, x => kanjiNum(Number(x.replace(/,/g, ''))));
  }
  function forSpeech(t) { return numbers(readings(String(t || '').replace(/（[◎○△×]）/g, '').replace(/燗は×/g, '燗は向きません').replace(/(\d+)\s*[〜~–-]\s*(\d+)\s*℃/g, '$1から$2度').replace(/℃/g, '度').replace(/[◎○△×]/g, '').replace(/・/g, '、'))); }
  let speakGen = 0;
  async function speak(text, onStart, voice) {
    const gen = ++speakGen; problemNow = ''; const cs = chunks(forSpeech(text)); const jobs = [];
    /* 最初の2つは同時に作り始め、i 番目を鳴らし始めたら i+2 番目を作る（文と文のあいだを空けない） */
    const job = i => { if (i < cs.length && !jobs[i]) { jobs[i] = synth(cs[i], voice); jobs[i].catch(() => {}); } return jobs[i]; };
    job(0); job(1);
    for (let i = 0; i < cs.length; i++) {
      let url; try { url = await job(i); } catch (e) {
        if (gen !== speakGen) return false;
        /* Gemini の声が使えない（1日の上限・通信）→ 残りを端末の声で読む */
        if (canDevice()) {
          if (i === 0 && onStart) onStart('device');
          const ok = await sayDevice(cs.slice(i).join('')); if (gen !== speakGen) return false;
          if (!ok) { problemNow = 'play'; return false; }
          return true;
        }
        problemNow = 'synth'; return false;
      }
      if (gen !== speakGen) return false;
      job(i + 2);
      if (i === 0 && onStart) onStart('gemini');
      const ok = await play(url); if (gen !== speakGen) return false;
      if (!ok) { problemNow = 'play'; return false; }
    }
    return true;
  }
  const FILLERS = ['assets/voice/filler-1.m4a', 'assets/voice/filler-2.m4a', 'assets/voice/filler-3.m4a'];
  function filler() { return play(FILLERS[Math.floor(Math.random() * FILLERS.length)]); }
  /* 鳴らす: audio 要素は1つを使い回す。Safari（Mac・iPhone）は「ボタンを押した瞬間に一度鳴らした要素」でないと、
     声ができあがった数秒後に鳴らせない。だからボタンの click の中で unlock() を同期で呼び、無音を一度鳴らしておく。
     navigator.audioSession を playback にすると、iPhone の消音（マナーモード）でも鳴る（iOS 17 以降の Safari・アプリ内表示） */
  const SILENT = 'data:audio/wav;base64,' + wavBase64(new Int16Array(480), 24000);
  let el = null, pending = null, unlocked = false, unlockGen = 0, problemNow = '';
  function element() { if (!el) { el = new Audio(); el.preload = 'auto'; try { el.setAttribute('playsinline', ''); } catch (e) { /* ignore */ } } return el; }
  /* 端末の声（Web Speech API。iPhone・Mac の内蔵音声）。Gemini の読み上げには1日の回数の上限があるので、その代わりに使う */
  let primed = false;
  function canDevice() { return !!(global.speechSynthesis && global.SpeechSynthesisUtterance); }
  function deviceVoice() {
    try { const vs = global.speechSynthesis.getVoices().filter(v => /^ja/i.test(v.lang) && !/Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley/i.test(v.name)); /* 遊びの声（おばあちゃん等）は使わない */ return vs.find(v => /enhanced|premium|拡張/i.test(v.name)) || vs.find(v => /Kyoko|O-ren/i.test(v.name)) || vs[0] || null; } catch (e) { return null; }
  }
  function sayDevice(text) {
    return new Promise(res => {
      try {
        const u = new global.SpeechSynthesisUtterance(text); u.lang = 'ja-JP'; const v = deviceVoice(); if (v) u.voice = v;
        u.onend = () => res(true); u.onerror = e => res(!!(e && /interrupted|canceled/.test(e.error)));
        global.speechSynthesis.speak(u);
      } catch (e) { res(false); }
    });
  }
  function unlock() {
    if (canDevice() && !primed) { try { const u = new global.SpeechSynthesisUtterance(' '); u.volume = 0; global.speechSynthesis.speak(u); primed = true; } catch (e) { /* ignore */ } } /* iPhone は最初の1回をボタンの中で鳴らす必要がある */
    if (!hasDOM) return;
    try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
    if (unlocked || pending) return;
    const a = element(), g = ++unlockGen;
    try { a.src = SILENT; const p = a.play(); if (p && p.then) p.then(() => { unlocked = true; if (g === unlockGen && !pending) a.pause(); }, () => {}); } catch (e) { /* ignore */ }
  }
  function play(url) {
    return new Promise(res => {
      if (!hasDOM) return res(true);
      halt(); unlockGen++;
      const a = element();
      const fin = ok => { if (pending !== fin) return; pending = null; a.onended = a.onerror = null; res(ok); };
      pending = fin;
      a.onended = () => fin(true); a.onerror = () => fin(false);
      try { a.src = url; const p = a.play(); if (p && p.catch) p.catch(() => fin(false)); } catch (e) { fin(false); }
    });
  }
  /* 鳴っている音だけ止める（play が次の文を鳴らすときに使う。speak の世代は進めない） */
  function halt() { if (pending) { const f = pending; try { el.pause(); } catch (e) { /* ignore */ } f(true); } }
  function stopSpeaking() { speakGen++; halt(); if (canDevice()) { try { global.speechSynthesis.cancel(); } catch (e) { /* ignore */ } } }
  function speaking() { return !!pending || !!(canDevice() && global.speechSynthesis.speaking); }
  function problem() { return problemNow; } /* 直前の speak が失敗した理由: 'synth'（声を作れない）／'play'（鳴らせない）／''（成功・止めた） */

  SUI.voice = { supported, start, stop, recording, ask, askText, topics, answer, readOn, setRead, forSpeech, synth, speak, readings, filler, chunks, play, unlock, problem, stopSpeaking, speaking, prompt, context, wavBase64, TTS_MODEL, VOICE };
})(globalThis);
