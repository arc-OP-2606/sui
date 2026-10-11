/* sui — SVG レンダラー。器の中の液体、ボトル、温度計、味わい、4タイプ、階段、ラベル解剖、雫、ムードリング。DOM 不要。 */
(function (global) {
  'use strict';
  const SUI = global.SUI = global.SUI || {};
  const C = SUI.color;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f1 = n => Math.round(n * 10) / 10;
  function rng(seed) { let a = (seed >>> 0) || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  let uidN = 0; const uid = p => p + (++uidN).toString(36);

  /* 液体の色: 淡い酒は青白く、濃い酒は縁を沈める */
  function liquidPalette(hue) {
    const lum = C.luminance(hue);
    if (lum > 0.72) return { center: C.mix(hue, '#FFFFFF', 0.35), edge: C.mix(hue, '#8FA6B2', 0.5), surface: C.mix(hue, '#FFFFFF', 0.55), line: C.mix(hue, '#7E95A1', 0.6), opacity: 0.95 };
    if (lum > 0.35) return { center: C.mix(hue, '#FFFFFF', 0.28), edge: C.mix(hue, '#000000', 0.22), surface: C.mix(hue, '#FFFFFF', 0.42), line: C.mix(hue, '#000000', 0.18), opacity: 0.96 };
    return { center: C.mix(hue, '#FFFFFF', 0.18), edge: C.mix(hue, '#000000', 0.38), surface: C.mix(hue, '#FFFFFF', 0.3), line: C.mix(hue, '#000000', 0.3), opacity: 0.98 };
  }
  SUI.liquidPalette = liquidPalette;

  /* ---- 器のプロファイル（右半分: [y, 半幅]。上から下へ） ---- */
  const PROFILES = {
    bordeaux: { pts: [[34, 33], [52, 40], [82, 43], [112, 34], [130, 14]], stem: [130, 176], foot: [178, 34], fill: 0.42 },
    burgundy: { pts: [[40, 35], [56, 50], [80, 56], [108, 44], [128, 16]], stem: [128, 176], foot: [178, 36], fill: 0.38 },
    white: { pts: [[44, 27], [60, 33], [86, 36], [112, 28], [130, 12]], stem: [130, 176], foot: [178, 30], fill: 0.45 },
    flute: { pts: [[22, 15], [50, 18], [90, 20], [126, 16], [144, 7]], stem: [144, 178], foot: [180, 28], fill: 0.62 },
    coupe: { pts: [[52, 62], [62, 58], [74, 44], [84, 24], [90, 8]], stem: [90, 176], foot: [178, 34], fill: 0.6 },
    tumbler: { pts: [[44, 42], [100, 41], [160, 38], [166, 34]], stem: null, foot: null, fill: 0.5 },
    wineglass: { pts: [[44, 27], [60, 33], [86, 36], [112, 28], [130, 12]], stem: [130, 176], foot: [178, 30], fill: 0.4 },
    choko: { pts: [[72, 42], [100, 40], [130, 34], [142, 26]], stem: null, foot: [148, 22], fill: 0.72 },
    guinomi: { pts: [[64, 46], [90, 52], [122, 46], [146, 32]], stem: null, foot: [152, 28], fill: 0.68 },
    kiriko: { pts: [[46, 40], [100, 36], [156, 30], [162, 26]], stem: null, foot: null, fill: 0.62, facets: true },
    hirahai: { pts: [[88, 70], [100, 62], [116, 36], [124, 16]], stem: [124, 150], foot: [152, 30], fill: 0.7 },
    tin: { pts: [[70, 40], [96, 42], [130, 38], [144, 30]], stem: null, foot: [150, 26], fill: 0.7, hammered: true },
    cup: { pts: [[44, 36], [100, 36], [160, 34], [166, 30]], stem: null, foot: null, fill: 0.78 },
  };
  function hwAt(pts, y) {
    if (y <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [y0, w0] = pts[i - 1], [y1, w1] = pts[i];
      if (y <= y1) return w0 + (w1 - w0) * (y - y0) / (y1 - y0);
    }
    return pts[pts.length - 1][1];
  }
  /* Catmull-Rom → cubic Bezier */
  function smooth(points) {
    if (points.length < 2) return '';
    let d = 'M' + f1(points[0][0]) + ' ' + f1(points[0][1]);
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ' C' + [c1, c2, p2].map(p => f1(p[0]) + ' ' + f1(p[1])).join(' ');
    }
    return d;
  }
  function bowlPath(pts) {
    const right = pts.map(([y, w]) => [100 + w, y]);
    const left = pts.slice().reverse().map(([y, w]) => [100 - w, y]);
    const bottomY = pts[pts.length - 1][0];
    const all = right.concat([[100, bottomY + 4]], left);
    return smooth(all) + ' Z';
  }

  /* 器＋液体。opts: {hue, vessel|glass, size, seed, night, fill, sparkle} */
  function glass(opts) {
    opts = opts || {};
    const key = opts.vessel || opts.glass || 'white';
    const hue = C.isHex(opts.hue) ? opts.hue : '#9FB4BD';
    const size = opts.size || 200;
    const id = uid('g');
    const pal = liquidPalette(hue);
    const r = rng(opts.seed || 7);
    if (key === 'masu') return masu(hue, size, id, pal, opts);
    const P = PROFILES[key] || PROFILES.white;
    const pts = P.pts;
    const rimY = pts[0][0], rimW = pts[0][1], botY = pts[pts.length - 1][0];
    const fill = opts.fill == null ? P.fill : opts.fill;
    const levelY = botY - (botY - rimY) * fill;
    const lw = hwAt(pts, levelY);
    const bowl = bowlPath(pts);
    const glow = opts.night ? `<circle cx="100" cy="${f1((rimY + botY) / 2)}" r="${f1(rimW + 30)}" fill="${hue}" opacity="0.32" filter="url(#${id}b)"/>` : '';
    const sparkles = [];
    const n = opts.sparkle === false ? 0 : 3;
    for (let i = 0; i < n; i++) { const x = 100 - lw * 0.7 + r() * lw * 1.4, y = levelY - 1 + r() * 2.5; sparkles.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(0.8 + r() * 1.1)}" fill="#FFFFFF" opacity="${f1(0.45 + r() * 0.4)}"/>`); }
    const stem = P.stem ? `<path d="M100 ${P.stem[0]} L100 ${P.stem[1]}" stroke="var(--ink2)" stroke-width="4" stroke-linecap="round" opacity="0.55"/>` : '';
    const foot = P.foot ? `<ellipse cx="100" cy="${P.foot[0]}" rx="${P.foot[1]}" ry="${f1(P.foot[1] * 0.18)}" fill="none" stroke="var(--ink2)" stroke-width="1.4" opacity="0.7"/>` : '';
    let extras = '';
    if (P.facets) { for (let i = -3; i <= 3; i++) { const x = 100 + i * 10; extras += `<path d="M${x} ${rimY + 10} L${f1(100 + i * 8)} ${botY - 6}" stroke="var(--ink2)" stroke-width="0.8" opacity="0.35"/>`; } }
    if (P.hammered) { for (let i = 0; i < 26; i++) { const y = rimY + 8 + r() * (botY - rimY - 16), w = hwAt(pts, y) - 6; extras += `<circle cx="${f1(100 - w + r() * w * 2)}" cy="${f1(y)}" r="2.2" fill="none" stroke="var(--ink2)" stroke-width="0.6" opacity="0.5"/>`; } }
    return `<svg viewBox="0 0 200 200" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="器の中の酒">
<defs>
<clipPath id="${id}c"><path d="${bowl}"/></clipPath>
<radialGradient id="${id}l" cx="42%" cy="30%" r="80%"><stop offset="0" stop-color="${pal.center}"/><stop offset="0.6" stop-color="${hue}"/><stop offset="1" stop-color="${pal.edge}"/></radialGradient>
<linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${pal.surface}"/><stop offset="0.5" stop-color="${C.mix(pal.surface, hue, 0.35)}"/><stop offset="1" stop-color="${pal.surface}"/></linearGradient>
<filter id="${id}b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
<linearGradient id="${id}sh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000000" stop-opacity="0.16"/><stop offset="0.25" stop-color="#000000" stop-opacity="0"/><stop offset="0.8" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.2"/></linearGradient>
</defs>
${glow}
<g clip-path="url(#${id}c)">
<rect x="0" y="${f1(levelY)}" width="200" height="${f1(botY + 6 - levelY)}" fill="url(#${id}l)" opacity="${pal.opacity}"/>
<rect x="0" y="${f1(levelY)}" width="200" height="${f1(botY + 6 - levelY)}" fill="url(#${id}sh)"/>
<ellipse cx="100" cy="${f1(levelY)}" rx="${f1(lw)}" ry="${f1(lw * 0.17)}" fill="url(#${id}s)" stroke="${pal.line}" stroke-width="0.8" opacity="0.95"/>
${sparkles.join('')}
<path d="M${f1(100 - hwAt(pts, rimY + 10) + 7)} ${rimY + 12} C ${f1(100 - hwAt(pts, (rimY + botY) / 2) + 5)} ${f1((rimY + botY) / 2)} ${f1(100 - hwAt(pts, botY - 14) + 8)} ${botY - 18} ${f1(100 - hwAt(pts, botY - 10) + 12)} ${botY - 8}" stroke="#FFFFFF" stroke-width="3" fill="none" opacity="0.35" stroke-linecap="round"/>
</g>
${extras}
<path d="${bowl}" fill="none" stroke="var(--ink2)" stroke-width="1.4" opacity="0.8"/>
<ellipse cx="100" cy="${rimY}" rx="${rimW}" ry="${f1(rimW * 0.17)}" fill="none" stroke="var(--ink2)" stroke-width="1.2" opacity="0.8"/>
${stem}${foot}
</svg>`;
  }
  function masu(hue, size, id, pal, opts) {
    const x0 = 42, x1 = 158, y0 = 58, y1 = 150, levelY = y1 - (y1 - y0) * 0.78;
    const glow = opts.night ? `<circle cx="100" cy="104" r="80" fill="${hue}" opacity="0.3" filter="url(#${id}b)"/>` : '';
    return `<svg viewBox="0 0 200 200" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="枡の中の酒">
<defs><radialGradient id="${id}l" cx="40%" cy="30%" r="85%"><stop offset="0" stop-color="${pal.center}"/><stop offset="0.6" stop-color="${hue}"/><stop offset="1" stop-color="${pal.edge}"/></radialGradient>
<filter id="${id}b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter></defs>
${glow}
<path d="M${x0} ${y0} L${x1} ${y0} L${x1} ${y1} L${x0} ${y1} Z" fill="#E8D6B8" stroke="#B89468" stroke-width="1.4"/>
<path d="M${x0 + 8} ${y0 + 8} L${x1 - 8} ${y0 + 8} L${x1 - 8} ${y1 - 8} L${x0 + 8} ${y1 - 8} Z" fill="#F3E7D2" stroke="#C9A77A" stroke-width="1"/>
<rect x="${x0 + 8}" y="${f1(levelY)}" width="${x1 - x0 - 16}" height="${f1(y1 - 8 - levelY)}" fill="url(#${id}l)" opacity="${pal.opacity}"/>
<rect x="${x0 + 8}" y="${f1(levelY)}" width="${x1 - x0 - 16}" height="3" fill="${pal.surface}" opacity="0.9"/>
<path d="M${x0} ${y0} L${x0 + 8} ${y0 + 8} M${x1} ${y0} L${x1 - 8} ${y0 + 8} M${x0} ${y1} L${x0 + 8} ${y1 - 8} M${x1} ${y1} L${x1 - 8} ${y1 - 8}" stroke="#B89468" stroke-width="1"/>
<path d="M${x0 + 20} ${y0 + 20} L${x0 + 20} ${y1 - 20}" stroke="#D8C3A2" stroke-width="1" opacity="0.7"/>
</svg>`;
  }

  /* 雫（色の円）。opts: {hue, size, night, rim, label} */
  function drop(opts) {
    opts = opts || {};
    const hue = C.isHex(opts.hue) ? opts.hue : '#9FB4BD';
    const size = opts.size || 48, id = uid('d'), pal = liquidPalette(hue);
    const glow = opts.night ? `<circle cx="50" cy="50" r="40" fill="${hue}" opacity="0.4" filter="url(#${id}b)"/>` : '';
    const rim = opts.rim ? `<circle cx="50" cy="50" r="47" fill="none" stroke="var(--ink2)" stroke-width="1.2" opacity="0.7"/><circle cx="50" cy="50" r="43" fill="none" stroke="var(--ink2)" stroke-width="0.6" opacity="0.4"/>` : '';
    const empty = opts.empty ? `<circle cx="50" cy="50" r="36" fill="none" stroke="${pal.line}" stroke-width="1" stroke-dasharray="2 3" opacity="0.8"/>` : `<circle cx="50" cy="50" r="${opts.rim ? 36 : 44}" fill="url(#${id}l)" opacity="${pal.opacity}"/><ellipse cx="40" cy="36" rx="13" ry="7" fill="#FFFFFF" opacity="0.35" transform="rotate(-30 40 36)"/>`;
    return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(opts.label || '酒の色')}"><defs><radialGradient id="${id}l" cx="38%" cy="32%" r="78%"><stop offset="0" stop-color="${pal.center}"/><stop offset="0.62" stop-color="${hue}"/><stop offset="1" stop-color="${pal.edge}"/></radialGradient><filter id="${id}b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter></defs>${glow}${rim}${empty}</svg>`;
  }

  /* 注ぐアニメ（認識中）。CSS の .liquid / .wave が動かす */
  function pour(opts) {
    opts = opts || {};
    const hue = C.isHex(opts.hue) ? opts.hue : '#9FB4BD', id = uid('p'), pal = liquidPalette(hue);
    return `<svg class="pour" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><clipPath id="${id}c"><circle cx="100" cy="100" r="78"/></clipPath><radialGradient id="${id}l" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="${pal.center}"/><stop offset="0.6" stop-color="${hue}"/><stop offset="1" stop-color="${pal.edge}"/></radialGradient></defs>
<circle cx="100" cy="100" r="84" fill="none" stroke="var(--ink2)" stroke-width="1.2" opacity="0.7"/>
<g clip-path="url(#${id}c)"><g class="liquid"><path class="wave" d="M-60 110 Q-45 100 -30 110 T0 110 T30 110 T60 110 T90 110 T120 110 T150 110 T180 110 T210 110 T240 110 T270 110 V200 H-60 Z" fill="url(#${id}l)" opacity="${pal.opacity}"/></g></g>
<path d="M100 8 v22" stroke="${pal.line}" stroke-width="3" stroke-linecap="round" opacity="0.8"/></svg>`;
  }

  /* ボトル。b: {kind, bottle, hue, label:{main,text,font}, acc} */
  function bottle(b, opts) {
    opts = opts || {}; const size = opts.size || 120; const id = uid('b');
    const shape = b.bottle || (b.kind === 'sake' ? 'yongo' : 'bordeaux');
    const lum = C.luminance(b.hue || '#888888');
    let glassCol = b.glassColor || (b.kind === 'sake' ? (shape === 'cup' ? '#D9E0DC' : '#5F7257') : (lum > 0.5 ? '#B9CDB0' : '#2F3B2C'));
    const label = b.label || { main: '#F2EDE2', text: '#2B2B2B', font: 'serif' };
    const acc = b.acc || label.main;
    let body = '', neck = '', cap = '', labelBox = null, h = 260;
    if (shape === 'bordeaux' || shape === 'yongo' || shape === 'issho') {
      const nTop = shape === 'issho' ? 6 : 14, shoulder = shape === 'yongo' ? 86 : shape === 'issho' ? 70 : 78;
      neck = `<path d="M44 ${nTop} h12 v${shoulder - nTop - 14} h-12 z" fill="${glassCol}" opacity="0.95"/>`;
      body = `<path d="M44 ${shoulder - 14} C44 ${shoulder - 4} 26 ${shoulder - 2} 26 ${shoulder + 10} V240 q0 12 12 12 h24 q12 0 12 -12 V${shoulder + 10} C74 ${shoulder - 2} 56 ${shoulder - 4} 56 ${shoulder - 14} z" fill="${glassCol}"/>`;
      cap = `<rect x="43" y="${nTop - 2}" width="14" height="${shape === 'issho' ? 10 : 22}" rx="2" fill="${acc}"/>`;
      labelBox = { x: 30, y: shape === 'yongo' ? 128 : 124, w: 40, h: shape === 'issho' ? 92 : 84 };
    } else if (shape === 'burgundy' || shape === 'flute') {
      neck = `<path d="M45 14 h10 v46 h-10 z" fill="${glassCol}" opacity="0.95"/>`;
      body = `<path d="M45 58 C45 70 24 76 24 110 V240 q0 12 12 12 h28 q12 0 12 -12 V110 C76 76 55 70 55 58 z" fill="${glassCol}"/>`;
      cap = shape === 'flute' ? `<path d="M43 12 h14 v34 q-7 8 -14 0 z" fill="${acc}"/>` : `<rect x="44" y="12" width="12" height="22" rx="2" fill="${acc}"/>`;
      labelBox = { x: 30, y: 134, w: 40, h: 78 };
    } else { /* cup */
      h = 260;
      body = `<path d="M30 120 h40 v110 q0 8 -8 8 h-24 q-8 0 -8 -8 z" fill="${glassCol}" opacity="0.9"/><path d="M30 120 h40 v110 q0 8 -8 8 h-24 q-8 0 -8 -8 z" fill="none" stroke="var(--ink2)" stroke-width="1" opacity="0.6"/>`;
      cap = `<rect x="28" y="112" width="44" height="10" rx="3" fill="${acc}"/>`;
      labelBox = { x: 34, y: 150, w: 32, h: 60 };
    }
    /* ラベルの文字の雰囲気 */
    let marks = '';
    const L = labelBox, tx = label.text || '#2B2B2B';
    if (label.font === 'brush') marks = `<path d="M${L.x + L.w / 2} ${L.y + 10} q3 14 -2 ${L.h - 24} q-2 8 4 10" stroke="${tx}" stroke-width="5.5" fill="none" stroke-linecap="round"/>`;
    else if (label.font === 'mincho') marks = `<path d="M${L.x + L.w / 2 - 6} ${L.y + 12} v${L.h - 24} M${L.x + L.w / 2 + 6} ${L.y + 16} v${L.h - 32}" stroke="${tx}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    else if (label.font === 'sans') marks = `<rect x="${L.x + 8}" y="${L.y + L.h / 2 - 7}" width="${L.w - 16}" height="6" fill="${tx}"/><rect x="${L.x + 12}" y="${L.y + L.h / 2 + 4}" width="${L.w - 24}" height="3" fill="${tx}" opacity="0.6"/>`;
    else marks = `<path d="M${L.x + 8} ${L.y + L.h / 2 - 8} h${L.w - 16} M${L.x + 12} ${L.y + L.h / 2} h${L.w - 24} M${L.x + 10} ${L.y + L.h / 2 + 8} h${L.w - 20}" stroke="${tx}" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="${L.x + L.w / 2}" cy="${L.y + 12}" r="4" fill="none" stroke="${tx}" stroke-width="1"/>`;
    const labelSvg = `<rect x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" rx="2" fill="${label.main}" stroke="${C.mix(label.main, '#000000', 0.15)}" stroke-width="0.6"/>${marks}`;
    return `<svg viewBox="0 0 100 ${h}" width="${f1(size * 100 / h)}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(b.name || 'ボトル')}"><defs><linearGradient id="${id}g" x1="0" x2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.35"/><stop offset="0.3" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="0.85" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.25"/></linearGradient></defs>${neck}${body}${labelSvg}${cap}<rect x="24" y="10" width="52" height="244" fill="url(#${id}g)" rx="12" pointer-events="none"/></svg>`;
  }

  /* 温度計。opts: {kind:'sake'|'wine', bands:[ids], best:id, tempC:[lo,hi], hue} */
  function thermo(opts) {
    opts = opts || {};
    const W = 360, H = 118, x0 = 18, x1 = 342, y = 48;
    const T = SUI.TEMPS;
    const out = [];
    out.push(`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="おすすめの温度">`);
    out.push(`<rect x="${x0}" y="${y - 6}" width="${x1 - x0}" height="12" rx="6" fill="var(--bg2)" stroke="var(--line)"/>`);
    if (opts.kind === 'sake') {
      const lo = 0, hi = 60; const px = t => x0 + (x1 - x0) * (t - lo) / (hi - lo);
      const bands = opts.bands || [];
      T.forEach((t, i) => {
        const x = px(t.tempC);
        const on = bands.includes(t.id), best = opts.best === t.id;
        if (on) out.push(`<rect x="${f1(x - 14)}" y="${y - 6}" width="28" height="12" rx="6" fill="var(--acc-soft)" stroke="var(--acc-line)"/>`);
        out.push(`<line x1="${f1(x)}" y1="${y + 10}" x2="${f1(x)}" y2="${y + 16}" stroke="var(--ink3)" stroke-width="1"/>`);
        const ty = i % 2 === 0 ? y + 30 : y + 46;
        out.push(`<text x="${f1(x)}" y="${ty}" text-anchor="middle" font-size="10.5" font-family="var(--font-jp-serif)" fill="${best ? 'var(--acc-ink)' : 'var(--ink2)'}" font-weight="${best ? '600' : '400'}">${esc(t.name)}</text>`);
        out.push(`<text x="${f1(x)}" y="${y - 12}" text-anchor="middle" font-size="9.5" font-family="var(--font-latin)" fill="var(--ink3)">${t.tempC}°</text>`);
        if (best) out.push(`<circle cx="${f1(x)}" cy="${y}" r="7" fill="var(--acc)" stroke="var(--bg)" stroke-width="2"/>`);
      });
    } else {
      const lo = 4, hi = 20; const px = t => x0 + (x1 - x0) * (t - lo) / (hi - lo);
      const [a, b] = opts.tempC || [12, 16];
      out.push(`<rect x="${f1(px(a))}" y="${y - 6}" width="${f1(px(b) - px(a))}" height="12" rx="6" fill="var(--acc-soft)" stroke="var(--acc-line)"/>`);
      out.push(`<circle cx="${f1((px(a) + px(b)) / 2)}" cy="${y}" r="7" fill="var(--acc)" stroke="var(--bg)" stroke-width="2"/>`);
      [4, 8, 12, 16, 20].forEach(t => { out.push(`<line x1="${f1(px(t))}" y1="${y + 10}" x2="${f1(px(t))}" y2="${y + 16}" stroke="var(--ink3)" stroke-width="1"/><text x="${f1(px(t))}" y="${y + 32}" text-anchor="middle" font-size="11" font-family="var(--font-latin)" fill="var(--ink2)">${t}°</text>`); });
      const names = [[4, 8, '泡・甘口'], [8, 12, '軽い白・ロゼ'], [12, 16, '濃い白・軽い赤'], [16, 20, 'しっかりした赤']];
      names.forEach(([s, e, n]) => out.push(`<text x="${f1((px(s) + px(e)) / 2)}" y="${y + 50}" text-anchor="middle" font-size="9.5" font-family="var(--font-jp-serif)" fill="var(--ink3)">${esc(n)}</text>`));
      out.push(`<text x="${f1((px(a) + px(b)) / 2)}" y="${y - 14}" text-anchor="middle" font-size="12" font-family="var(--font-latin)" fill="var(--acc-ink)" font-weight="600">${a}–${b}°C</text>`);
    }
    out.push('</svg>');
    return out.join('');
  }

  /* 味わいバー。b.kind で軸名が変わる */
  const AXES = {
    wine: [['a', 'ボディ', '軽い', '重い'], ['b', '甘み', '辛口', '甘口'], ['c', '酸', '穏やか', '鮮やか'], ['d', '渋み', 'なめらか', '力強い']],
    sake: [['a', '甘辛', '辛口', '甘口'], ['b', '濃淡', '淡麗', '濃醇'], ['c', '香り', '穏やか', '華やか'], ['d', '酸', 'やわらか', 'きりっと']],
  };
  function tasteBars(b) {
    const axes = AXES[b.kind] || AXES.wine; const W = 340, rowH = 30, H = axes.length * rowH + 6;
    const out = [`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="味わい">`];
    axes.forEach(([k, name, lo, hi], i) => {
      const y = i * rowH + 18, v = Math.max(1, Math.min(5, b.taste[k] || 3));
      const x0 = 112, x1 = W - 44;
      out.push(`<text x="0" y="${y + 4}" font-size="12" font-family="var(--font-jp-serif)" fill="var(--ink)">${esc(name)}</text>`);
      out.push(`<text x="${x0 - 10}" y="${y + 4}" text-anchor="end" font-size="9" fill="var(--ink3)">${esc(lo)}</text>`);
      out.push(`<text x="${W}" y="${y + 4}" text-anchor="end" font-size="9" fill="var(--ink3)">${esc(hi)}</text>`);
      out.push(`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="var(--line)" stroke-width="1.2"/>`);
      for (let j = 1; j <= 5; j++) { const x = x0 + (x1 - x0) * (j - 1) / 4; const on = j <= v; out.push(`<circle cx="${f1(x)}" cy="${y}" r="${j === v ? 7 : 4.5}" fill="${on ? 'var(--acc)' : 'var(--card)'}" stroke="${on ? 'var(--acc)' : 'var(--line)'}" stroke-width="1.2"/>`); }
    });
    out.push('</svg>');
    return out.join('');
  }

  /* 4タイプ象限。opts: {current:'kun', points:[{x:0-1,y:0-1,hue,label}]} */
  function quadrant(opts) {
    opts = opts || {}; const S = 280, m = 26, inner = S - m * 2; const id = uid('q');
    const out = [`<svg viewBox="0 0 ${S} ${S + 14}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="味の地図">`];
    out.push(`<rect x="${m}" y="${m}" width="${inner}" height="${inner}" rx="18" fill="var(--card)" stroke="var(--line)"/>`);
    out.push(`<line x1="${S / 2}" y1="${m}" x2="${S / 2}" y2="${S - m}" stroke="var(--line)" stroke-dasharray="3 4"/><line x1="${m}" y1="${S / 2}" x2="${S - m}" y2="${S / 2}" stroke="var(--line)" stroke-dasharray="3 4"/>`);
    out.push(`<text x="${S / 2}" y="16" text-anchor="middle" font-size="10.5" fill="var(--ink3)" font-family="var(--font-jp-serif)">香り 華やか</text><text x="${S / 2}" y="${S + 8}" text-anchor="middle" font-size="10.5" fill="var(--ink3)" font-family="var(--font-jp-serif)">香り 穏やか</text>`);
    out.push(`<text x="10" y="${S / 2}" text-anchor="middle" font-size="10.5" fill="var(--ink3)" font-family="var(--font-jp-serif)" transform="rotate(-90 10 ${S / 2})">味 軽い</text><text x="${S - 10}" y="${S / 2}" text-anchor="middle" font-size="10.5" fill="var(--ink3)" font-family="var(--font-jp-serif)" transform="rotate(90 ${S - 10} ${S / 2})">味 重い</text>`);
    SUI.TYPE4.forEach(t => {
      const cx = m + inner * (t.x ? 0.75 : 0.25), cy = m + inner * (t.y ? 0.25 : 0.75);
      if (opts.current === t.id) out.push(`<rect x="${cx - inner / 4 + 6}" y="${cy - inner / 4 + 6}" width="${inner / 2 - 12}" height="${inner / 2 - 12}" rx="14" fill="var(--acc-soft)" stroke="var(--acc-line)" opacity="0.9"/>`);
    });
    (opts.points || []).forEach((p, i) => {
      const cx = m + inner * Math.max(0.04, Math.min(0.96, p.x)), cy = m + inner * (1 - Math.max(0.04, Math.min(0.96, p.y)));
      const pal = liquidPalette(p.hue || '#9FB4BD');
      out.push(`<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${p.big ? 12 : 7}" fill="${p.hue || '#9FB4BD'}" stroke="${pal.line}" stroke-width="1.2" opacity="0.95"><title>${esc(p.label || '')}</title></circle>`);
    });
    SUI.TYPE4.forEach(t => {
      const cx = m + inner * (t.x ? 0.75 : 0.25), cy = m + inner * (t.y ? 0.25 : 0.75);
      const cur = opts.current === t.id;
      out.push(`<text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="18" font-family="var(--font-jp-serif)" fill="${cur ? 'var(--acc-ink)' : 'var(--ink2)'}" paint-order="stroke" stroke="var(--card)" stroke-width="4" stroke-linejoin="round">${esc(t.name)}</text><text x="${cx}" y="${cy + 10}" text-anchor="middle" font-size="9.5" font-family="var(--font-latin)" letter-spacing="1" fill="var(--ink3)" paint-order="stroke" stroke="var(--card)" stroke-width="3">${esc(t.en)}</text>`);
    });
    out.push('</svg>');
    return out.join('');
  }

  /* 階段。items: [{bottle, price}] daily→flagship。currentId の段に class="cur" */
  function ladder(items, currentId) {
    const n = Math.max(1, items.length), W = 340, stepH = 46, baseH = 70, H = baseH + n * stepH;
    const sw = W / n;
    const out = [`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="造り手の階段">`];
    let pathD = `M0 ${H - 1}`;
    items.forEach((it, i) => {
      const x = i * sw, yTop = H - baseH / 2 - (i + 1) * stepH + 20;
      pathD += ` V${f1(yTop)} H${f1(x + sw)}`;
    });
    pathD += ` V${H - 1} Z`;
    out.push(`<path d="${pathD}" fill="var(--bg2)" stroke="var(--line)" stroke-width="1"/>`);
    items.forEach((it, i) => {
      const b = it.bottle || it; const x = i * sw, yTop = H - baseH / 2 - (i + 1) * stepH + 20; const cur = b.id === currentId;
      const cx = x + sw / 2;
      if (cur) out.push(`<rect class="cur" x="${f1(x + 4)}" y="${f1(yTop + 2)}" width="${f1(sw - 8)}" height="${f1(H - 2 - yTop - 2)}" rx="10" fill="var(--acc-soft)" stroke="var(--acc-line)"/>`);
      out.push(`<g transform="translate(${f1(cx - 14)} ${f1(yTop - 34)})">${drop({ hue: b.hue, size: 28 })}</g>`);
      const nm = b.shortName || b.name;
      out.push(`<text x="${f1(cx)}" y="${f1(yTop + 18)}" text-anchor="middle" font-size="${nm.length > 8 ? 10 : 11.5}" font-family="var(--font-jp-serif)" fill="${cur ? 'var(--acc-ink)' : 'var(--ink)'}">${esc(nm)}</text>`);
      const price = it.price || (b.price ? ('¥' + Math.round(b.price.min).toLocaleString('ja-JP') + '〜') : '');
      out.push(`<text x="${f1(cx)}" y="${f1(yTop + 33)}" text-anchor="middle" font-size="11" font-family="var(--font-latin)" fill="var(--ink2)">${esc(price)}</text>`);
      const tier = SUI.byIdIn(SUI.TIERS, b.price && b.price.tier); if (tier) out.push(`<text x="${f1(cx)}" y="${f1(H - 10)}" text-anchor="middle" font-size="9.5" letter-spacing="1" fill="var(--ink3)" font-family="var(--font-jp-serif)">${esc(tier.name)}</text>`);
    });
    out.push('</svg>');
    return out.join('');
  }

  /* ラベル解剖（一般化した図）。番号付きの説明は SUI.ANATOMY に */
  SUI.ANATOMY = {
    sake: [
      { n: 1, name: '銘柄', d: '蔵の看板。同じ銘柄でも特定名称で中身は別物。' },
      { n: 2, name: '特定名称', d: '純米大吟醸・吟醸・本醸造など8種。精米歩合と醸造アルコールの有無で決まる。' },
      { n: 3, name: '精米歩合', d: '米をどこまで磨いたか。50%なら半分を削った。低いほど香り高く軽い傾向。' },
      { n: 4, name: '原材料', d: '米・米麹（＋醸造アルコール）。「純米」はアルコール添加なし。' },
      { n: 5, name: 'アルコール分', d: '多くは15〜16度。原酒は17〜20度。' },
      { n: 6, name: '製造年月', d: '瓶詰めの月。新しいほど良いとは限らず、生酒は冷蔵で早めに。' },
      { n: 7, name: '蔵元・所在地', d: '製造者と住所。水と土地を知る入口。' },
    ],
    wine: [
      { n: 1, name: '生産者', d: 'シャトー、ドメーヌ、ワイナリー。ワインの「誰が」。' },
      { n: 2, name: '原産地呼称', d: 'AOC / DOCG / AVA など。土地が狭いほど格が上がる傾向。' },
      { n: 3, name: 'ヴィンテージ', d: '葡萄を収穫した年。天候が味を決める。NV は複数年の混合。' },
      { n: 4, name: '品種', d: '新世界は品種を大きく書く。旧世界は地名が品種を暗示する。' },
      { n: 5, name: '容量・度数', d: '750ml が標準。度数は温暖な産地ほど高め。' },
      { n: 6, name: '元詰め', d: 'Mis en bouteille au château/domaine。生産者が自分で瓶詰め。' },
      { n: 7, name: '輸入者', d: '裏ラベルの日本語表記。保管と流通の責任者。' },
    ],
  };
  function labelAnatomy(kind) {
    const W = 340, H = 250; const id = uid('a');
    const items = SUI.ANATOMY[kind === 'sake' ? 'sake' : 'wine'];
    const out = [`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="ラベルの読み方">`];
    out.push(`<rect x="60" y="16" width="220" height="218" rx="6" fill="var(--card)" stroke="var(--line)"/>`);
    const spots = kind === 'sake'
      ? [[170, 92, 'big'], [170, 40, 'line'], [230, 150, 'line'], [110, 150, 'line'], [230, 188, 'line'], [110, 188, 'line'], [170, 220, 'line']]
      : [[170, 60, 'big'], [170, 110, 'line'], [170, 140, 'line'], [170, 164, 'line'], [110, 212, 'line'], [230, 212, 'line'], [170, 190, 'line']];
    spots.forEach(([x, y, t], i) => {
      if (t === 'big') out.push(kind === 'sake' ? `<path d="M${x} ${y - 30} q3 14 -2 50 q-2 8 4 10" stroke="var(--ink)" stroke-width="6" fill="none" stroke-linecap="round"/>` : `<text x="${x}" y="${y + 6}" text-anchor="middle" font-size="22" font-family="var(--font-latin)" font-style="italic" fill="var(--ink)">Château</text>`);
      else out.push(`<rect x="${x - 34}" y="${y - 4}" width="68" height="7" rx="3" fill="var(--line)"/>`);
      const nx = x + (x < 170 ? -52 : x > 170 ? 52 : (i % 2 ? 60 : -60)), ny = y;
      out.push(`<line x1="${x + (nx > x ? 36 : -36)}" y1="${y}" x2="${nx}" y2="${ny}" stroke="var(--acc-line)" stroke-width="1"/>`);
      out.push(`<circle cx="${nx}" cy="${ny}" r="10" fill="var(--acc)" /><text x="${nx}" y="${ny + 4}" text-anchor="middle" font-size="11" font-family="var(--font-latin)" font-weight="600" fill="var(--acc-on)">${items[i].n}</text>`);
    });
    out.push('</svg>');
    return out.join('');
  }

  /* ムードリング。8分割の環。各セグメントは data-act="pick" data-key="mood" */
  function moodRing(selectedId) {
    const S = 320, cx = 160, cy = 160, R = 150, r = 92, n = SUI.MOODS.length;
    const out = [`<svg viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="気分を選ぶ">`];
    const sel = SUI.byIdIn(SUI.MOODS, selectedId);
    SUI.MOODS.forEach((m, i) => {
      const a0 = -Math.PI / 2 + (i - 0.5) * 2 * Math.PI / n + 0.02, a1 = -Math.PI / 2 + (i + 0.5) * 2 * Math.PI / n - 0.02;
      const p = (rad, a) => [f1(cx + rad * Math.cos(a)), f1(cy + rad * Math.sin(a))];
      const [x0, y0] = p(R, a0), [x1, y1] = p(R, a1), [x2, y2] = p(r, a1), [x3, y3] = p(r, a0);
      const d = `M${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${r} ${r} 0 0 0 ${x3} ${y3} Z`;
      const am = (a0 + a1) / 2, [tx, ty] = p((R + r) / 2 + 2, am), [dx, dy] = p((R + r) / 2 - 16, am);
      const on = m.id === selectedId;
      out.push(`<g class="ring-seg" role="button" tabindex="0" aria-pressed="${on}" data-act="pick" data-key="mood" data-val="${m.id}"><path d="${d}"/><circle class="dotc" cx="${dx}" cy="${dy}" r="${on ? 6 : 4}" fill="${m.hue}"/><text x="${tx}" y="${ty + 10}" text-anchor="middle">${esc(m.name)}</text></g>`);
    });
    out.push(`<circle cx="${cx}" cy="${cy}" r="${r - 10}" fill="var(--card)" stroke="var(--line)"/>`);
    out.push(`<g class="ring-center">${sel ? `<text class="big" x="${cx}" y="${cy - 6}" text-anchor="middle">${esc(sel.name)}</text><text class="en" x="${cx}" y="${cy + 12}" text-anchor="middle">${esc(sel.en.toUpperCase())}</text><text class="desc" x="${cx}" y="${cy + 32}" text-anchor="middle">${esc(sel.d)}</text>` : `<text class="big" x="${cx}" y="${cy + 2}" text-anchor="middle">どんな気分？</text><text class="desc" x="${cx}" y="${cy + 24}" text-anchor="middle">環をタップ</text>`}</g>`);
    out.push('</svg>');
    return out.join('');
  }

  const ICONS = {
    camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.2"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3"/>',
    drop: '<path d="M12 3s-6 6.5-6 11a6 6 0 0 0 12 0c0-4.5-6-11-6-11z"/>',
    stairs: '<path d="M4 20h4v-4h4v-4h4V8h4"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2.2 5.3-5.3 2.2 2.2-5.3z"/>',
    share: '<path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    next: '<path d="M9 5l7 7-7 7"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    flip: '<path d="M4 8h12l-3-3"/><path d="M20 16H8l3 3"/>',
    thermo: '<path d="M10 4a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/>',
    glass: '<path d="M7 3h10l-1 7a4 4 0 0 1-8 0z"/><path d="M12 14v6M8 20h8"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M15 8l2 2M18 5l2 2"/>',
    download: '<path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><path d="M5 19h14"/>',
    edit: '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="m12 8 4 4"/>',
    book: '<path d="M4 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H4z"/><path d="M20 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    pin: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
    bottle: '<path d="M10 3h4v4l2 3v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10l2-3z"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.5 6.5l2.5 2.5M15 15l2.5 2.5M6.5 17.5 9 15M15 9l2.5-2.5"/>',
    food: '<path d="M4 11h16"/><path d="M5 11a7 7 0 0 1 14 0"/><path d="M3 15h18"/>',
    story: '<path d="M6 4h12v16H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    wow: '<path d="M12 3l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.4 6.7 19.2l1.1-5.9L3.5 9.2l5.9-.8z"/>',
    tag: '<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  };
  function icon(name, cls) { return `<svg class="${cls || 'ic'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.drop}</svg>`; }

  /* 表紙（漆黒の地）のグラス。光は液体だけが放つ。opts: {hue, pour, label}
     pour=true: 斜め上から注ぐ流れ（年齢確認の表紙）／false: スポットライトの中で揺れる液面（ホームの表紙） */
  function cover(opts) {
    opts = opts || {};
    const hue = C.isHex(opts.hue) ? opts.hue : '#B21A36', id = uid('cv');
    const pale = C.luminance(hue) > 0.6;
    const hi = pale ? C.mix(hue, '#FFFFFF', 0.5) : C.mix(hue, '#FFC08A', 0.5);
    const lo = pale ? C.mix(hue, '#7A6A3A', 0.55) : C.mix(hue, '#000000', 0.68);
    const halo = pale ? C.mix(hue, '#D9B870', 0.6) : hue;
    const surf = C.mix(hi, '#FFFFFF', 0.12), edge = C.mix(hi, '#FFFFFF', 0.25), spark = C.mix(hue, '#FFFFFF', 0.75), dropC = C.mix(hue, '#FFFFFF', 0.15);
    const pour = !!opts.pour, cx = pour ? 195 : 250;
    /* 器の内側（縁 y=150・底 y=356）。液体はこの形で切り抜く */
    const bowl = `M${cx - 75} 150 C ${cx - 78} 250 ${cx - 67} 334 ${cx} 356 C ${cx + 67} 334 ${cx + 78} 250 ${cx + 75} 150`;
    const defs = `<radialGradient id="${id}h" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${halo}" stop-opacity="0.58"/><stop offset="0.55" stop-color="${halo}" stop-opacity="0.18"/><stop offset="1" stop-color="${halo}" stop-opacity="0"/></radialGradient>
<linearGradient id="${id}l" x1="0" y1="0" x2="0.2" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="0.35" stop-color="${hue}"/><stop offset="1" stop-color="${lo}"/></linearGradient>
<linearGradient id="${id}e" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${edge}" stop-opacity="0.9"/><stop offset="0.22" stop-color="${edge}" stop-opacity="0"/><stop offset="0.78" stop-color="${edge}" stop-opacity="0"/><stop offset="1" stop-color="${edge}" stop-opacity="0.7"/></linearGradient>
<clipPath id="${id}c"><path d="${bowl} Z"/></clipPath>
<filter id="${id}b" filterUnits="userSpaceOnUse" x="-60" y="400" width="510" height="140"><feGaussianBlur stdDeviation="14"/></filter>
<filter id="${id}s" filterUnits="userSpaceOnUse" x="100" y="440" width="300" height="60"><feGaussianBlur stdDeviation="3"/></filter>`;
    /* 液面: 注ぐ表紙は水平（y=262）、ホームは揺れて右上がりに傾く（左 266 → 右 250） */
    const yl = pour ? 262 : 266, yr = pour ? 262 : 250, ym = (yl + yr) / 2, rot = f1(Math.atan2(yr - yl, 200) * 180 / Math.PI);
    const body = `M${cx - 100} ${yl} L ${cx + 100} ${yr} L ${cx + 100} 380 L ${cx - 100} 380 Z`;
    const ex = f1(70 * Math.cos(rot * Math.PI / 180)), ey = f1(70 * Math.sin(rot * Math.PI / 180));
    const liquid = `<g clip-path="url(#${id}c)">
<path d="${body}" fill="url(#${id}l)"/>
<path d="${body}" fill="url(#${id}e)" opacity="0.6"/>
<ellipse cx="${cx}" cy="${ym}" rx="70" ry="8.5" transform="rotate(${rot} ${cx} ${ym})" fill="${surf}" opacity="0.92"/>
<ellipse cx="${cx}" cy="${ym}" rx="40" ry="3.5" transform="rotate(${rot} ${cx} ${ym})" fill="${spark}" opacity="0.5"/>
<path d="M${f1(cx - ex)} ${f1(ym - ey)} A 70 8.5 ${rot} 0 1 ${f1(cx + ex)} ${f1(ym + ey)}" fill="none" stroke="${edge}" stroke-width="2" stroke-linecap="round"/>
${pour ? '' : `<path d="M${cx - 74} 232 C ${cx - 50} 214 ${cx + 44} 206 ${cx + 74} 220" fill="none" stroke="${hue}" stroke-opacity="0.35" stroke-width="5" stroke-linecap="round"/>`}
</g>`;
    const splash = pour ? `<path d="M${cx - 19} 258 C ${cx - 13} 248 ${cx - 5} 244 ${cx + 2} 246 C ${cx + 9} 244 ${cx + 17} 249 ${cx + 21} 258" fill="none" stroke="${surf}" stroke-width="2" stroke-linecap="round"/>
<circle cx="${cx - 27}" cy="236" r="3.2" fill="${dropC}"/><circle cx="${cx + 27}" cy="228" r="2.4" fill="${dropC}"/><circle cx="${cx - 13}" cy="214" r="1.8" fill="${dropC}"/><circle cx="${cx + 45}" cy="246" r="1.6" fill="${dropC}"/><circle cx="${cx - 43}" cy="250" r="1.4" fill="${dropC}"/>
<circle cx="${cx - 28}" cy="235" r="1" fill="${spark}"/><circle cx="${cx + 26}" cy="227" r="0.8" fill="${spark}"/>` : '';
    const stream = pour ? `<linearGradient id="${id}p" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lo}"/><stop offset="0.5" stop-color="${hue}"/><stop offset="1" stop-color="${hi}"/></linearGradient>` : `<linearGradient id="${id}r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F2EBDD" stop-opacity="0"/><stop offset="0.2" stop-color="#F2EBDD" stop-opacity="0.11"/><stop offset="1" stop-color="#F2EBDD" stop-opacity="0"/></linearGradient>`;
    const backdrop = pour ? `<ellipse cx="${cx}" cy="300" rx="190" ry="170" fill="url(#${id}h)"/>` : `<path d="M${cx - 40} -10 L ${cx + 40} -10 L ${cx + 110} 470 L ${cx - 110} 470 Z" fill="url(#${id}r)"/>
<ellipse cx="${cx}" cy="300" rx="170" ry="180" fill="url(#${id}h)"/>`;
    const pourPath = pour ? `<path d="M352 -10 C 330 70 236 130 ${cx + 5} ${yl} L ${cx - 1} ${yl} C 222 126 316 64 336 -10 Z" fill="url(#${id}p)"/>
<path d="M346 -10 C 326 66 238 128 ${cx + 4} ${yl - 4}" fill="none" stroke="${spark}" stroke-opacity="0.45" stroke-width="1.2"/>` : '';
    const label = esc(opts.label || (pour ? 'グラスに注がれる酒' : 'スポットライトの中のグラス'));
    return `<svg class="cover-art" viewBox="0 0 390 ${pour ? 540 : 500}" preserveAspectRatio="${pour ? 'xMidYMax' : 'xMaxYMax'} meet" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}"><defs>${defs}${stream}</defs>
${backdrop}
<line x1="0" y1="470" x2="390" y2="470" stroke="#F2EBDD" stroke-opacity="0.10" stroke-width="1"/>
<ellipse cx="${cx}" cy="474" rx="140" ry="12" fill="${halo}" opacity="0.35" filter="url(#${id}b)"/>
<ellipse cx="${cx}" cy="468" rx="60" ry="6" fill="#000000" opacity="0.6" filter="url(#${id}s)"/>
${pourPath}
${liquid}
${splash}
<path d="${bowl}" fill="none" stroke="#F2EBDD" stroke-opacity="0.55" stroke-width="1.4"/>
<ellipse cx="${cx}" cy="150" rx="75" ry="9" fill="none" stroke="#F2EBDD" stroke-opacity="0.6" stroke-width="1.2"/>
<path d="M${cx - 62} 168 C ${cx - 65} 232 ${cx - 59} 290 ${cx - 39} 326" fill="none" stroke="#FFFFFF" stroke-opacity="0.55" stroke-width="3" stroke-linecap="round"/>
<path d="M${cx - 55} 176 C ${cx - 56} 206 ${cx - 55} 226 ${cx - 52} 240" fill="none" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="1.5" stroke-linecap="round"/>
<path d="M${cx + 63} 180 C ${cx + 65} 230 ${cx + 60} 280 ${cx + 45} 316" fill="none" stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="2" stroke-linecap="round"/>
<path d="M${cx - 3} 356 L ${cx - 2.4} 460 L ${cx + 2.4} 460 L ${cx + 3} 356 Z" fill="#F2EBDD" fill-opacity="0.28"/>
<line x1="${cx - 1}" y1="360" x2="${cx - 0.6}" y2="458" stroke="#FFFFFF" stroke-opacity="0.6" stroke-width="0.8"/>
<ellipse cx="${cx}" cy="464" rx="58" ry="7" fill="none" stroke="#F2EBDD" stroke-opacity="0.5" stroke-width="1.2"/>
<path d="M${cx - 45} 466 C ${cx - 25} 470 ${cx + 25} 470 ${cx + 45} 466" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="1"/>
</svg>`;
  }

  SUI.render = { glass, drop, pour, bottle, thermo, tasteBars, quadrant, ladder, labelAnatomy, moodRing, icon, cover, PROFILES, esc };
})(globalThis);
