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
    const b = ctx.bottle; if (b) lines.push(`いま見ている一本（蔵DB）: ${b.name}／${b.producer}／${b.sub}／味 ${JSON.stringify(b.taste)}／香り ${(b.aromas || []).join('・')}／飲み方 ${b.kind === 'sake' ? (b.serve.bands || []).join('・') + ' best ' + b.serve.best + '・器 ' + b.serve.vessel : b.serve.tempC.join('–') + '℃・' + b.serve.glass}／合う料理 ${(b.pairings || []).join('・')}／階段 ${E().ladder(b).map(x => x.bottle.name + '(¥' + x.bottle.price.min + ')').join('→')}`);
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
  function prompt(ctx, history) {
    const hist = (history || []).slice(-6).map(t => `${t.role === 'user' ? '客' : 'sui'}: ${t.text}`).join('\n');
    return `あなたは「sui」。酒の相棒で、落ち着いて温かく、少し茶目っ気のある声の持ち主。音声で返事を読み上げるので、話し言葉で、1〜3文・110字以内。敬語は丁寧すぎない「です・ます」。
守ること: 与えた事実（蔵DB・この人の記録）だけを使い、知らないことは「分からない」と言う。健康・酔いにくさ・翌日の体調に触れない。杯数や量を勧めない。造り手の歴史や受賞歴を作らない。合わない組合せは正直に「合わない」と言う。
添付の音声は客の発話。transcript に文字起こし（聞き取れなければ空）。reply に返事。picks に勧める酒（最大2本、収録リストの id を matchId に。収録外なら null。serve は温度帯と器を15字以内）。客が店で頼む場面なら staffLine に店員にそのまま見せる一文（25字以内）、そうでなければ null。source は 蔵DB／推定 のどちらか。
${context(ctx)}
これまでの会話:
${hist || '（最初の発話）'}`;
  }
  async function ask(audio, ctx, history) {
    const d = await AI().call([{ inline_data: { mime_type: audio.mime, data: audio.b64 } }, { text: prompt(ctx, history) }], SCHEMA, { temperature: 0.6, timeoutMs: 25000, thinkingBudget: 0, feature: 'voice' });
    d.reply = AI().clean(d.reply).slice(0, 160); d.transcript = String(d.transcript || '').slice(0, 200);
    d.picks = (d.picks || []).slice(0, 2).map(p => Object.assign(p, { bottle: p.matchId ? E().byId(p.matchId) : null }));
    return d;
  }

  /* ---------- 話す（TTS） ---------- */
  let audioEl = null;
  async function synth(text) {
    const R = Rec().relay(); if (!R) throw new Error('no-relay');
    const body = { contents: [{ parts: [{ text: `次の文を、落ち着いた温かい声で、少しゆっくり自然に読む: ${text}` }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } } };
    const r = await fetch(R.url + '/v1/tts', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sui-token': R.token, 'x-sui-device': AI().deviceId(), 'x-sui-feature': 'voice-tts' }, body: JSON.stringify({ model: TTS_MODEL, body }) });
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    const j = await r.json(); const part = j.candidates && j.candidates[0] && j.candidates[0].content.parts.find(p => p.inlineData);
    if (!part) throw new Error('no-audio');
    const rate = Number((part.inlineData.mimeType.match(/rate=(\d+)/) || [])[1] || 24000);
    const bin = atob(part.inlineData.data); const pcm = new Int16Array(bin.length / 2); for (let i = 0; i < pcm.length; i++) pcm[i] = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) << 16 >> 16;
    return 'data:audio/wav;base64,' + wavBase64(pcm, rate);
  }
  /* 返事を文ごとに分け、最初の文を先に鳴らしながら次を作る */
  function chunks(text) { const parts = String(text).split(/(?<=[。！？!?])/).map(t => t.trim()).filter(Boolean); const out = []; parts.forEach(pt => { if (out.length && (out[out.length - 1] + pt).length < 34) out[out.length - 1] += pt; else out.push(pt); }); return out.length ? out : [String(text)]; }
  let speakGen = 0;
  async function speak(text, onStart) {
    const gen = ++speakGen; const cs = chunks(text); let next = synth(cs[0]);
    for (let i = 0; i < cs.length; i++) {
      let url; try { url = await next; } catch (e) { return false; }
      if (gen !== speakGen) return false;
      next = i + 1 < cs.length ? synth(cs[i + 1]) : null;
      if (i === 0 && onStart) onStart();
      await play(url); if (gen !== speakGen) return false;
    }
    return true;
  }
  const FILLERS = ['assets/voice/filler-1.m4a', 'assets/voice/filler-2.m4a', 'assets/voice/filler-3.m4a'];
  function filler() { return play(FILLERS[Math.floor(Math.random() * FILLERS.length)]); }
  function play(dataUrl) {
    return new Promise(res => { if (!hasDOM) return res(); stopSpeaking(); audioEl = new Audio(dataUrl); audioEl.onended = () => { audioEl = null; res(); }; audioEl.onerror = () => { audioEl = null; res(); }; audioEl.play().catch(() => { audioEl = null; res(); }); });
  }
  function stopSpeaking() { speakGen++; if (audioEl) { try { audioEl.pause(); } catch (e) { /* ignore */ } audioEl = null; } }
  function speaking() { return !!audioEl; }

  SUI.voice = { supported, start, stop, recording, ask, synth, speak, filler, chunks, play, stopSpeaking, speaking, prompt, context, wavBase64, TTS_MODEL, VOICE };
})(globalThis);
