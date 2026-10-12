/* sui — 端末内の「色」の仕事: 墨流し風の生成アート、月次カード、グラスの色の測定、色帯の言葉。DOM 不要（描画は渡された canvas に）。 */
(function (global) {
  'use strict';
  const SUI = global.SUI = global.SUI || {};
  const C = SUI.color;
  function rng(seed) { let a = (seed >>> 0) || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const hash = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  /* ---------- 墨流し（Jaffer の滴と櫛の変形。同じ材料なら同じ絵） ---------- */
  function marble(w, h, hues, seed, opts) {
    opts = opts || {}; const r = rng(typeof seed === 'number' ? seed : hash(seed || hues.join()));
    const N = 96, drops = [];
    const addDrop = (cx, cy, rad, color) => {
      drops.forEach(d => { for (let i = 0; i < d.pts.length; i += 2) { const dx = d.pts[i] - cx, dy = d.pts[i + 1] - cy; const dist = Math.sqrt(dx * dx + dy * dy) || 0.001; const k = Math.sqrt(1 + (rad * rad) / (dist * dist)); d.pts[i] = cx + dx * k; d.pts[i + 1] = cy + dy * k; } });
      const pts = new Float32Array(N * 2); for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2; pts[i * 2] = cx + rad * Math.cos(a); pts[i * 2 + 1] = cy + rad * Math.sin(a); }
      drops.push({ pts, color });
    };
    const tine = (x0, y0, ux, uy, z, c) => { const nx = -uy, ny = ux; drops.forEach(d => { for (let i = 0; i < d.pts.length; i += 2) { const dist = (d.pts[i] - x0) * nx + (d.pts[i + 1] - y0) * ny; const k = z * Math.exp(-Math.abs(dist) / c); d.pts[i] += ux * k; d.pts[i + 1] += uy * k; } }); };
    const list = hues.length ? hues : ['#9FB4BD'];
    const count = Math.min(60, Math.max(24, list.length * 6));
    const base = Math.min(w, h);
    /* 同心に落とす（墨流しの輪）: 中心をいくつか決め、そこへ色を交互に重ねる */
    const centers = []; for (let i = 0; i < 3 + Math.floor(r() * 2); i++) centers.push([w * (0.2 + 0.6 * r()), h * (0.2 + 0.6 * r())]);
    for (let i = 0; i < count; i++) {
      const color = list[i % list.length]; const c = centers[i % centers.length];
      addDrop(c[0] + (r() - 0.5) * base * 0.06, c[1] + (r() - 0.5) * base * 0.06, base * (0.03 + 0.07 * r()), color);
      if (i % 6 === 5) { const a = r() * Math.PI; tine(w * r(), h * r(), Math.cos(a), Math.sin(a), base * (0.05 + 0.08 * r()), base * (0.06 + 0.08 * r())); }
    }
    /* 仕上げの櫛目: 一方向に等間隔で */
    const a0 = r() * Math.PI, step = base * (0.08 + 0.05 * r());
    for (let k = -4; k <= 4; k++) { const ox = w / 2 + Math.cos(a0 + Math.PI / 2) * step * k, oy = h / 2 + Math.sin(a0 + Math.PI / 2) * step * k; tine(ox, oy, Math.cos(a0), Math.sin(a0), base * (0.12 + 0.1 * r()) * (k % 2 ? 1 : -1), base * 0.05); }
    return drops;
  }
  function drawMarble(ctx, w, h, drops, paper) {
    ctx.save(); ctx.fillStyle = paper; ctx.fillRect(0, 0, w, h);
    drops.forEach(d => { ctx.beginPath(); for (let i = 0; i < d.pts.length; i += 2) { if (i === 0) ctx.moveTo(d.pts[0], d.pts[1]); else ctx.lineTo(d.pts[i], d.pts[i + 1]); } ctx.closePath(); ctx.fillStyle = C.alpha(d.color, 0.86); ctx.fill(); });
    ctx.restore();
  }
  function suminagashi(ctx, w, h, hues, seed, paper) { drawMarble(ctx, w, h, marble(w, h, hues, seed), paper || '#F7F3EE'); }

  /* ---------- 月次カード 1080×1920 ---------- */
  const KANJI_M = ['', '一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
  function monthCard(ctx, o) {
    const W = 1080, H = 1920, night = !!o.night, ink = night ? '#F2ECE4' : '#221E22', ink2 = night ? '#A89DA2' : '#6E6468', bg = night ? '#121014' : '#F7F3EE';
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const [y, m] = o.ym.split('-').map(Number);
    /* 絵: 上 1120px、角丸の板に */
    ctx.save(); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(60, 60, W - 120, 1060, 36) : ctx.rect(60, 60, W - 120, 1060); ctx.clip();
    suminagashi(ctx, W, 1180, o.hues && o.hues.length ? o.hues : ['#9FB4BD'], o.ym + ':' + (o.hues || []).join(), night ? '#1A171C' : '#FFFFFF');
    ctx.restore();
    ctx.strokeStyle = C.alpha(ink, 0.25); ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(60, 60, W - 120, 1060, 36) : ctx.rect(60, 60, W - 120, 1060); ctx.stroke();
    ctx.textAlign = 'left'; ctx.fillStyle = ink2; ctx.font = '600 26px "Cormorant Garamond", serif'; ctx.fillText('IROGOYOMI  ' + y + '.' + String(m).padStart(2, '0'), 72, 1190);
    ctx.fillStyle = ink; ctx.font = '500 76px "Shippori Mincho", serif'; ctx.fillText('色暦　' + KANJI_M[m], 68, 1272);
    let yy = 1360;
    if (o.archetype) { ctx.fillStyle = ink; ctx.font = '500 54px "Shippori Mincho", serif'; ctx.fillText(o.archetype.name, 72, yy); ctx.fillStyle = ink2; ctx.font = '400 30px "Zen Kaku Gothic New", sans-serif'; ctx.fillText(o.archetype.line, 72, yy + 50); yy += 130; }
    const st = o.stats || {};
    const lines = [];
    if (st.colors) lines.push('出会った色　' + st.colors + '種' + (st.colorFamilies && st.colorFamilies.length ? '（' + st.colorFamilies.map(f => ({ clear: '透明', gold: '黄金', rose: '薄紅', red: '深紅' }[f] || f)).join('・') + '）' : ''));
    if (st.producers) lines.push('造り手　' + st.producers + '軒' + (st.firstProducers && st.firstProducers.length ? '　初めて: ' + st.firstProducers.slice(0, 3).join('・') : ''));
    if (st.places && st.places.length) lines.push('場所　' + st.places.join('・'));
    if (st.words && st.words.length) lines.push('言葉　' + st.words.slice(0, 5).join('・'));
    ctx.fillStyle = ink; ctx.font = '400 32px "Zen Kaku Gothic New", sans-serif';
    lines.forEach(l => { ctx.fillText(l.length > 30 ? l.slice(0, 29) + '…' : l, 72, yy); yy += 52; });
    if (st.haiku) { yy += 20; ctx.fillStyle = ink; ctx.font = '500 40px "Shippori Mincho", serif'; ctx.fillText(st.haiku.join('　'), 72, yy); yy += 56; }
    ctx.textAlign = 'center'; ctx.fillStyle = C.ensureContrast((o.hues && o.hues[0]) || '#9FB4BD', bg, 3); ctx.font = '500 44px "Cormorant Garamond", serif'; ctx.fillText('sui', W / 2, H - 110);
    ctx.fillStyle = ink2; ctx.font = '400 22px "Shippori Mincho", serif'; ctx.fillText('酒の色で、世界を知る。', W / 2, H - 70);
  }

  /* ---------- グラスの色の測定 ---------- */
  function avgAround(img, x, y, rad) {
    const { width: w, height: h, data } = img; let r = 0, g = 0, b = 0, n = 0;
    for (let yy = Math.max(0, y - rad); yy <= Math.min(h - 1, y + rad); yy++) for (let xx = Math.max(0, x - rad); xx <= Math.min(w - 1, x + rad); xx++) { if ((xx - x) ** 2 + (yy - y) ** 2 > rad * rad) continue; const i = (yy * w + xx) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
    return n ? [r / n, g / n, b / n] : [128, 128, 128];
  }
  function rgbToLab(rgb) {
    const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const [r, g, b] = rgb.map(f);
    let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = (r * 0.2126 + g * 0.7152 + b * 0.0722), z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    const t = v => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
    x = t(x); y = t(y); z = t(z);
    return { L: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
  }
  /* liquidPt / paperPt: {x,y}（画像座標）。紙を白として補正 */
  function measureColor(img, liquidPt, paperPt, rad) {
    rad = rad || Math.max(4, Math.round(Math.min(img.width, img.height) * 0.02));
    const liq = avgAround(img, Math.round(liquidPt.x), Math.round(liquidPt.y), rad);
    const pap = paperPt ? avgAround(img, Math.round(paperPt.x), Math.round(paperPt.y), rad * 2) : [255, 255, 255];
    const gain = pap.map(v => Math.min(3, 245 / Math.max(40, v)));
    const corr = liq.map((v, i) => Math.max(0, Math.min(255, v * gain[i])));
    const hex = C.rgbToHex(corr[0], corr[1], corr[2]);
    return { hex, lab: rgbToLab(corr), raw: C.rgbToHex(liq[0], liq[1], liq[2]), paper: C.rgbToHex(pap[0], pap[1], pap[2]) };
  }
  /* 色帯（断定しない言葉） */
  function colorBand(kind, hex) {
    const lab = rgbToLab(C.hexToRgb(hex) || [128, 128, 128]); const hsl = C.hexToHsl(hex) || { h: 0, s: 0, l: 50 };
    if (kind === 'sake') {
      if (lab.L > 90 && lab.b < 8) return { id: 'clear', name: '無色', note: '透明に近い。搾りたてか、濾過のしっかりした酒に多い。' };
      if (lab.b < 20) return { id: 'pale', name: '淡い山吹', note: 'かすかに黄み。多くの純米・本醸造はここ。' };
      if (lab.b < 35) return { id: 'yamabuki', name: '山吹', note: 'はっきりした黄み。熟成、原料、保管の光など理由はひとつでない。' };
      return { id: 'amber', name: '琥珀', note: '濃い色。古酒や長期熟成に多いが、色だけで良し悪しは言えない。' };
    }
    if (lab.L > 55) { /* 白・ロゼ系 */
      if (hsl.h > 320 || hsl.h < 25) return { id: 'rose', name: 'ロゼ', note: '薄紅から鮭色。色は品種と果皮に触れた時間で変わる。' };
      if (lab.b < 15) return { id: 'pale-straw', name: 'ほぼ無色〜淡い麦わら', note: '若く、冷涼な産地に多い色。' };
      if (lab.b < 35) return { id: 'straw', name: '麦わら〜黄金', note: '樽や熟成で黄みが増す。' };
      return { id: 'gold', name: '黄金〜琥珀', note: '甘口や長期熟成、あるいは酸化が進んだときの色。' };
    }
    if (hsl.h >= 280 && hsl.h < 336 && lab.L < 35) return { id: 'purple', name: '紫がかった若い色', note: '若い赤。縁に紫。' };
    if (hsl.h >= 10 && hsl.h < 40) return { id: 'brick', name: 'レンガ〜オレンジがかる', note: '熟成が進んだ赤に多い。縁から色が抜ける。' };
    if (lab.L < 27) return { id: 'garnet', name: 'ガーネット', note: '深く、少し褐色を帯びた赤。' };
    return { id: 'ruby', name: 'ルビー', note: '赤の盛り。透けると明るい赤。' };
  }
  function compareBand(kind, measuredHex, refHex) {
    const m = colorBand(kind, measuredHex), r = colorBand(kind, refHex);
    const lm = rgbToLab(C.hexToRgb(measuredHex)), lr = rgbToLab(C.hexToRgb(refHex));
    if (m.id === r.id) return `代表的な色と同じ帯（${m.name}）。`;
    const warmer = lm.b - lr.b > 6, darker = lr.L - lm.L > 8, lighter = lm.L - lr.L > 8;
    if (kind === 'sake') return warmer ? `代表的な色より黄みが強い（${m.name}）。熟成か、光に当たったか、原料の違いか。色だけでは決められない。` : `代表的な色より淡い（${m.name}）。搾りたてや濾過の差かもしれない。`;
    if (lighter && !warmer) return `代表的な色より淡く透ける（${m.name}）。グラスの薄さや光の加減で、こう見えることが多い。`;
    if (warmer) return `代表的な色よりオレンジ寄り（${m.name}）。熟成が進んだ色に近い。照明でもそう見える。`;
    if (darker) return `代表的な色より濃い（${m.name}）。グラスの厚みか、注ぎの深さか。`;
    return `代表的な色に近い（${m.name}）。`;
  }

  SUI.art = { marble, drawMarble, suminagashi, monthCard, measureColor, colorBand, compareBand, rgbToLab, KANJI_M };
})(globalThis);
