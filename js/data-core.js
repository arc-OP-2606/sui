/* sui — 辞書と色ユーティリティ。DOM 不要。 */
(function (global) {
  'use strict';
  const SUI = global.SUI = global.SUI || {};

  SUI.KINDS = [
    { id: 'wine', name: 'ワイン', en: 'Wine', d: '葡萄の土地と年を飲む。' },
    { id: 'sake', name: '日本酒', en: 'Sake', d: '米と水と、蔵の手を飲む。' },
    { id: 'any', name: 'どちらでも', en: 'Either', d: '今夜に合う方を。' },
  ];
  SUI.PLACES = [
    { id: 'home', name: '家', en: 'Home', d: 'いつもの食卓、ソファ、ベランダ。' },
    { id: 'izakaya', name: '居酒屋', en: 'Izakaya', d: '焼き鳥と、おでんと、賑わい。' },
    { id: 'restaurant', name: 'レストラン', en: 'Restaurant', d: 'コースの流れに合わせて。' },
    { id: 'bar', name: 'バー', en: 'Bar', d: '一杯ずつ、ゆっくり。' },
    { id: 'outdoor', name: '屋外・BBQ', en: 'Outdoor', d: '光と風の中で。割れない器で。' },
    { id: 'onsen', name: '温泉・旅先', en: 'Trip', d: 'その土地の酒を、その土地で。' },
    { id: 'gift', name: '贈る', en: 'Gift', d: '相手の好みと、箱の佇まい。' },
  ];
  SUI.PURPOSES = [
    { id: 'daily', name: '日常', en: 'Everyday', d: '今日もおつかれさま。' },
    { id: 'special', name: '特別', en: 'Special', d: '忘れたくない日に。' },
  ];
  SUI.SUBPURPOSES = [
    { id: 'anniversary', name: '記念日', d: '二人の日付に。' },
    { id: 'celebration', name: 'お祝い', d: '乾杯の音を良く。' },
    { id: 'date', name: 'デート', d: '会話の邪魔をしない一本。' },
    { id: 'business', name: '接待', d: '説明できる、格のある一本。' },
    { id: 'parents', name: '親と', d: '親の世代が知っている名前を。' },
    { id: 'reward', name: 'ご褒美', d: '自分にだけ、少し良いものを。' },
    { id: 'solo', name: '一人の夜', d: '誰にも合わせない一杯。' },
    { id: 'friends', name: '友人と', d: '話の種になる一本。' },
  ];
  SUI.MOODS = [
    { id: 'refresh', name: '爽やか', en: 'Fresh', d: '軽く、冷たく、すっと。', hue: '#8FB7C9' },
    { id: 'cozy', name: 'ほっとする', en: 'Cozy', d: '温かく、やわらかく。', hue: '#D9A66B' },
    { id: 'celebrate', name: '祝う', en: 'Celebrate', d: '泡と、光と、乾杯。', hue: '#E6C86E' },
    { id: 'deep', name: '深く味わう', en: 'Deep', d: '時間をかけて、層を辿る。', hue: '#6E1F2E' },
    { id: 'adventurous', name: '冒険', en: 'Adventure', d: '飲んだことのない方へ。', hue: '#C96A3B' },
    { id: 'elegant', name: '上品に', en: 'Elegant', d: '背筋の伸びる一杯。', hue: '#B9AFC9' },
    { id: 'playful', name: '遊ぶ', en: 'Playful', d: '笑いながら、気軽に。', hue: '#E89AA6' },
    { id: 'quiet', name: 'しっとり', en: 'Quiet', d: '灯りを落として。', hue: '#4F5B73' },
  ];
  /* 料理（2026-10-13: 和に寄りすぎていたので、フレンチ・イタリアン・スパニッシュ・ステーキを足し、洋の名前をおしゃれに） */
  SUI.FOODS = [
    { id: 'french', name: 'フレンチ', d: 'ソースのコクには、酸か渋みか厚み。' },
    { id: 'italian', name: 'イタリアン', d: 'トマトとオリーブオイルには、酸のある酒。' },
    { id: 'spanish', name: 'スパニッシュ', d: 'タパスと魚介には、冷えた泡と白。' },
    { id: 'steak', name: 'ステーキ・ジビエ', d: '赤身の肉汁には、渋みとコク。' },
    { id: 'western', name: 'チーズ・シャルキュトリー', d: 'バターと旨みには、酸か渋み。' },
    { id: 'sashimi', name: '刺身・寿司', d: '生の魚は、香りの強い酒を嫌う。' },
    { id: 'meat', name: '焼き鳥・肉', d: 'タレか塩かで、合う酒が変わる。' },
    { id: 'nabe', name: '鍋・おでん', d: '出汁には、温度を合わせる。' },
    { id: 'asian', name: '中華・エスニック', d: '香辛料には、甘みと泡。' },
    { id: 'sweet', name: 'デザート・ショコラ', d: '酒は菓子より甘く、が原則。' },
    { id: 'none', name: 'なし', d: '酒だけを味わう。' },
  ];
  SUI.BUDGETS = [
    { id: 'b1500', name: '〜1,500円', max: 1500, d: 'コンビニとスーパーで。' },
    { id: 'b3000', name: '〜3,000円', max: 3000, d: '酒屋で、少し選んで。' },
    { id: 'b8000', name: '〜8,000円', max: 8000, d: '記念日の一本。' },
    { id: 'bmax', name: '上限なし', max: Infinity, d: '一度は飲んでみたい名酒まで。' },
  ];
  SUI.SEASONS = [
    { id: 'spring', name: '春', line: '春は、新酒と、淡い白。', months: [3, 4, 5] },
    { id: 'summer', name: '夏', line: '夏は、雪冷えと、泡。', months: [6, 7, 8] },
    { id: 'autumn', name: '秋', line: '秋は、ひやおろしと、燗の季節。', months: [9, 10, 11] },
    { id: 'winter', name: '冬', line: '冬は、鍋と、ぬる燗と、深い赤。', months: [12, 1, 2] },
  ];
  /* 日本酒の温度帯 10 段（日本酒造組合中央会の慣用名） */
  SUI.TEMPS = [
    { id: 'yukibie', name: '雪冷え', tempC: 5, d: '香りは閉じ、キレが立つ。' },
    { id: 'hanabie', name: '花冷え', tempC: 10, d: '吟醸香がいちばん美しい。' },
    { id: 'suzubie', name: '涼冷え', tempC: 15, d: '冷蔵庫から出して少し置いた温度。' },
    { id: 'joon', name: '常温', tempC: 20, d: '酒の素顔。「冷や」はこの温度。' },
    { id: 'hinatakan', name: '日向燗', tempC: 30, d: '香りがほどけ始める。' },
    { id: 'hitohadakan', name: '人肌燗', tempC: 35, d: '米の甘みが、やわらかく。' },
    { id: 'nurukan', name: 'ぬる燗', tempC: 40, d: '旨みの頂点。鍋と出汁に。' },
    { id: 'jokan', name: '上燗', tempC: 45, d: '引き締まって、キレる。' },
    { id: 'atsukan', name: '熱燗', tempC: 50, d: '辛口が際立つ。寒い夜に。' },
    { id: 'tobikiri', name: '飛び切り燗', tempC: 55, d: '酒の輪郭が強く、香りは飛ぶ。' },
  ];
  SUI.VESSELS = [
    { id: 'choko', name: '猪口', d: '小さく注いで、温度が変わる前に。' },
    { id: 'guinomi', name: 'ぐい呑', d: '口が広く、米の香りが立つ。' },
    { id: 'masu', name: '枡', d: '檜の香りが移る。屋外と祝いの席に。' },
    { id: 'kiriko', name: '切子', d: '光を割る。冷やした酒を美しく。' },
    { id: 'hirahai', name: '平盃', d: '面で香りを受ける。燗酒に。' },
    { id: 'tin', name: '錫', d: '熱が早く伝わり、味がまろやかに。' },
    { id: 'wineglass', name: 'ワイングラス', d: '吟醸香を集める。薫酒に。' },
    { id: 'cup', name: 'カップ', d: 'そのまま、気取らず。' },
  ];
  SUI.GLASSES = [
    { id: 'bordeaux', name: 'ボルドー型', d: '背が高く、渋みをなだめる。' },
    { id: 'burgundy', name: 'ブルゴーニュ型', d: '丸く大きく、香りを溜める。' },
    { id: 'white', name: '白ワイン型', d: '小ぶりで、冷たさを保つ。' },
    { id: 'flute', name: 'フルート', d: '泡の筋を長く見せる。' },
    { id: 'coupe', name: 'クープ', d: '広く浅く、華やか。' },
    { id: 'tumbler', name: 'タンブラー', d: '割れない。屋外の一杯に。' },
  ];
  SUI.BOTTLES = [
    { id: 'bordeaux', name: 'ボルドー型' }, { id: 'burgundy', name: 'ブルゴーニュ型' }, { id: 'flute', name: 'シャンパーニュ型' },
    { id: 'yongo', name: '四合瓶' }, { id: 'issho', name: '一升瓶' }, { id: 'cup', name: 'カップ' },
  ];
  /* SSI 4タイプ。x: 味 0=軽 1=重、y: 香り 0=低 1=高 */
  SUI.TYPE4 = [
    { id: 'kun', name: '薫酒', en: 'Kun-shu', x: 0, y: 1, d: '華やかな香り。冷やして、ワイングラスで。', temps: ['yukibie', 'hanabie', 'suzubie'] },
    { id: 'so', name: '爽酒', en: 'So-shu', x: 0, y: 0, d: '軽快でなめらか。よく冷やして。', temps: ['yukibie', 'hanabie', 'suzubie'] },
    { id: 'jun', name: '醇酒', en: 'Jun-shu', x: 1, y: 0, d: '米の旨み。常温からぬる燗が映える。', temps: ['joon', 'hitohadakan', 'nurukan', 'jokan'] },
    { id: 'juku', name: '熟酒', en: 'Juku-shu', x: 1, y: 1, d: '熟成の香りと甘み。常温か、ぬる燗で。', temps: ['suzubie', 'joon', 'nurukan'] },
  ];
  SUI.ROLES = [
    { id: 'honmei', name: '本命', d: 'この状況に最も合う一本。' },
    { id: 'bouken', name: '冒険', d: '飲んだことがない方へ。' },
    { id: 'nichijo', name: '日常', d: '気負わず、今日も。' },
    { id: 'gohobi', name: 'ご褒美', d: '予算の上まで、手を伸ばす。' },
    { id: 'teiban', name: '定番', d: '外さない、安心の一本。' },
  ];
  SUI.TIERS = [
    { id: 'daily', name: '日常酒', rank: 0 }, { id: 'mid', name: '少し良い日', rank: 1 },
    { id: 'prestige', name: '旗艦', rank: 2 }, { id: 'legend', name: '伝説', rank: 3 },
  ];
  SUI.WITH = [
    { id: 'solo', name: '一人' }, { id: 'partner', name: 'パートナー' }, { id: 'friends', name: '友人' },
    { id: 'family', name: '家族' }, { id: 'work', name: '仕事' },
  ];
  SUI.LABEL_FONTS = ['serif', 'brush', 'mincho', 'sans'];

  /* ---- 色ユーティリティ ---- */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  function hexToHsl(hex) {
    const rgb = hexToRgb(hex); if (!rgb) return null;
    const [r, g, b] = rgb.map(v => v / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h, s: s * 100, l: l * 100 };
  }
  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
    return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }
  function mix(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b); if (!A || !B) return a;
    return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }
  function luminance(hex) {
    const rgb = hexToRgb(hex); if (!rgb) return 0;
    const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  /* 地色に対して min 以上のコントラストになるまで明度を動かす（色相・彩度は保つ） */
  function ensureContrast(fg, bg, min) {
    min = min || 4.5;
    if (contrast(fg, bg) >= min) return fg;
    const hsl = hexToHsl(fg); if (!hsl) return fg;
    const darker = luminance(bg) > 0.4;
    let out = fg;
    for (let i = 0; i < 60; i++) {
      hsl.l += darker ? -1.5 : 1.5;
      if (hsl.l < 0 || hsl.l > 100) break;
      out = hslToHex(hsl.h, hsl.s, hsl.l);
      if (contrast(out, bg) >= min) return out;
    }
    return darker ? '#221E22' : '#F2ECE4';
  }
  function alpha(hex, a) {
    const rgb = hexToRgb(hex); if (!rgb) return hex;
    return 'rgba(' + rgb.join(',') + ',' + a + ')';
  }
  const isHex = v => /^#[0-9A-Fa-f]{6}$/.test(String(v));
  SUI.color = { hexToRgb, rgbToHex, hexToHsl, hslToHex, mix, luminance, contrast, ensureContrast, alpha, isHex, clamp };

  SUI.byIdIn = (list, id) => list.find(x => x.id === id) || null;
})(globalThis);
