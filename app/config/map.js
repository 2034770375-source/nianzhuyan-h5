/**
 * 首页「风琴本」参数与折面算法
 * ---------------------------------------------------------------------------
 * 首页不再是「一张随便拖的长图」，而是一本和实体书结构一致的六折风琴本：
 *
 *   unfold = 0   合起，屏幕上只有封面（第 0 折）
 *   unfold = 1   完全摊开，版式和原来的长地图逐像素一致（折痕只是额外的一层明暗）
 *
 * 展开不是整张图平移，而是每一折依次从折缝里「长出来」：
 *   第 k 折的生长进度 g(k) = clamp(unfold * panels - k, 0, 1)
 *   第 k 折的宽度     = panelWidth * g(k)
 *   第 k 折的左边缘   = 前面所有折面宽度之和
 *
 * 于是摊开过程中折面首尾相接、从不重叠，完全摊开时 k * panelWidth 的坐标与旧版
 * 完全一致；而折面 k 的本地内容（背景、小猪、菜盘、热区）都只是整体左移 k * 400。
 *
 * 镜头：拉开的过程中整本书始终按「刚好铺满屏幕」来对焦（bookFit），所以六折是一折
 * 一折慢慢在眼前摊开的；等摊开到位，再单独跑一段「镜头推近小猪的脸」（settleMs）。
 */
const base = require('./hotspots.js');
const pigLayers = require('./pigLayers.js');

/* 小秘密的点击内边距 */
const SECRET_PAD = 26;

const FOLD = {
  /* 折数：与实体书一致；实体书若不同，只改这里（panelWidth 要满足 panels * 400 = 画布宽度） */
  panels: 6,
  panelWidth: 400,
  /*
   * 拉到底需要横向拖动多少 px。
   * 手机横屏宽度就 375 左右，一次从最左划到最右约 330px，所以这里取 440：
   * 一次划到底能看到四五折摊开，剩下的交给松手后的补间，六折不会一眨眼就过去。
   */
  dragFull: 440,
  /* 松手时超过这个进度就补间到「摊开」 */
  snapOpen: 0.5,
  /* 甩动速度超过这个值（px/ms）直接摊开 / 合回 */
  snapVelocity: 0.35,
  /* 补间时长 */
  snapMs: 700,
  /* 缩到最小比例后，继续内收超过这个比例 → 自动合起 */
  foldOvershoot: 0.12,
  /* 封面在这个进度前淡出（拉开一点点，封面就该让位给画） */
  coverFade: 0.12,
  /* 折痕暗部宽度（画布单位） */
  creasePx: 14,
  /* 整本书铺进屏幕时留一点边（合起、摊开都用同一个比例，画面才连贯） */
  bookFit: 0.92,
  /* 摊开之后，镜头从小猪的头顶推近到脸上用多久 */
  settleMs: 1100,
  /* 合上之前，先把镜头拉回「整本书摊在眼前」用多久 */
  pullBackMs: 620,
  /* 摊开后镜头对准的位置（小猪的憨笑的脸） */
  focus: { cx: 0.304, cy: 0.52 }
};

/* 小猪（map_pig.png 不透明区域 x 417~1827）只落在中间四折，其余折面不放小猪 */
const PIG_PANELS = [1, 2, 3, 4];

function clamp01(v) {
  if (!(v > 0)) return 0;
  return v > 1 ? 1 : v;
}

/* 第 k 折生长进度：0 = 还叠在折缝里，1 = 完全摊开 */
function growth(unfold, k, panels) {
  const n = panels || FOLD.panels;
  if (k <= 0) return 1;
  return clamp01((unfold || 0) * n - k);
}

function growths(unfold, panels) {
  const n = panels || FOLD.panels;
  const out = [];
  for (let k = 0; k < n; k += 1) out.push(growth(unfold, k, n));
  return out;
}

/* 摊开后整条纸的宽度（画布单位） */
function stripWidth(g) {
  let w = 0;
  for (let i = 0; i < g.length; i += 1) w += FOLD.panelWidth * g[i];
  return w;
}

/* 每折在画布里的位置与宽度；lip 是「这一折正在被拉出来」的强度（0~1） */
function layout(unfold) {
  const g = growths(unfold);
  const out = [];
  let left = 0;
  for (let k = 0; k < g.length; k += 1) {
    const w = FOLD.panelWidth * g[k];
    out.push({
      k: k,
      left: left,
      width: w,
      growth: g[k],
      /* 折面正在长出来时，右缘（被拉起的那条边）加一点阴影 */
      lip: Math.sin(Math.PI * g[k]) * (k === 0 ? 0 : 1)
    });
    left += w;
  }
  return out;
}

/*
 * 拉开过程中的镜头：不管摊开到第几折，都让「已经摊开的那条纸」刚好铺进屏幕，
 * 于是六折是一折一折在眼前慢慢长出来的，而不是被镜头甩出画面。
 * ctx = { vw, vh, artW, artH }
 */
function viewAt(unfold, ctx) {
  const u = clamp01(unfold);
  const g = growths(u);
  const strip = stripWidth(g);
  const s = Math.min(ctx.vw / strip, ctx.vh / ctx.artH) * FOLD.bookFit;
  const x = (ctx.vw - strip * s) / 2;
  const y = (ctx.vh - ctx.artH * s) / 2;
  return { x: x, y: y, scale: s, strip: strip, growths: g };
}

/*
 * 摊开到位之后，镜头最后一次推近：和小猪的头部对齐（与旧版默认视野一致）。
 * ctx = { vw, vh, artW, artH, fitScale }
 */
function openView(ctx) {
  const s = ctx.fitScale;
  const w = ctx.artW * s;
  const h = ctx.artH * s;
  const fx = ctx.vw * 0.42 - FOLD.focus.cx * ctx.artW * s;
  const fy = ctx.vh * 0.5 - FOLD.focus.cy * ctx.artH * s;
  return {
    x: Math.min(0, Math.max(ctx.vw - w, fx)),
    y: Math.min(0, Math.max(ctx.vh - h, fy)),
    scale: s
  };
}

/* 画布坐标 x 落在第几折 */
function panelOf(x) {
  const k = Math.floor(x / FOLD.panelWidth);
  if (k < 0) return 0;
  return k > FOLD.panels - 1 ? FOLD.panels - 1 : k;
}

/* 画布坐标 x 转成第 k 折里的本地坐标 */
function localX(x, k) {
  return x - k * FOLD.panelWidth;
}

/* 一段横向区间 [x, x + w) 覆盖到的折面 */
function panelsCovering(x, w) {
  const first = panelOf(x);
  const last = panelOf(x + Math.max(0, w - 0.001));
  const out = [];
  for (let k = first; k <= last; k += 1) out.push(k);
  return out;
}

/* 折面里所有内容（背景图、小猪）统一用整张画布图 + 负偏移取切片 */
function sliceStyle(k) {
  return 'left:' + (-k * FOLD.panelWidth) + 'px;top:0;' +
    'width:' + base.ART_W + 'px;height:' + base.ART_H + 'px';
}

/**
 * 把整套地图内容分到六个折面上（页面和预览脚本共用这一份）。
 * 热区、菜盘、彩蛋都按「横向压到哪几折」分发：跨折缝的元素会在相邻两折里
 * 各出现一份，各自被折面裁掉一半，拼起来仍然是完整的一条画面。
 *
 * opts = {
 *   visited : { dishId: 1 }    已经进去看过的菜（热区变亮）
 *   plates  : [dishId ...]     桌边要摆哪几道菜
 *   fresh   : { dishId: 1 }    刚上桌、要播落桌动画的那一道
 *   secrets : { key: 1 }       已经找到的小秘密
 * }
 */
function buildPanels(opts) {
  const o = opts || {};
  const visited = o.visited || {};
  const found = o.secrets || {};
  const fresh = o.fresh || {};
  const plateIds = o.plates || [];
  const plateMap = {};
  pigLayers.plates.forEach(function (p) {
    plateMap[p.id] = p;
  });

  const panels = [];
  for (let k = 0; k < FOLD.panels; k += 1) {
    panels.push({
      k: k,
      hasPig: PIG_PANELS.indexOf(k) >= 0,
      layers: {},
      sliceStyle: sliceStyle(k),
      hotspots: [],
      plates: [],
      secrets: []
    });
  }

  /* 热区 */
  for (let k = 0; k < FOLD.panels; k += 1) {
    const boxes = base.buildHotspotBoxes(visited, k * FOLD.panelWidth);
    for (let i = 0; i < boxes.length; i += 1) {
      const b = boxes[i];
      if (b.left >= (k + 1) * FOLD.panelWidth || b.left + b.size <= k * FOLD.panelWidth) continue;
      panels[k].hotspots.push({
        id: b.id,
        boxStyle: b.boxStyle,
        glowStyle: b.glowStyle,
        done: b.done,
        panel: k
      });
    }
  }

  /* 小猪的表情图层：只放进它所在的那几折 */
  for (let i = 0; i < pigLayers.layers.length; i += 1) {
    const L = pigLayers.layers[i];
    const ks = panelsCovering(L.left, L.width);
    for (let j = 0; j < ks.length; j += 1) {
      panels[ks[j]].layers[L.name] = true;
    }
  }

  /* 桌边已经上过的菜 */
  for (let i = 0; i < plateIds.length; i += 1) {
    const p = plateMap[plateIds[i]];
    if (!p) continue;
    const ks = panelsCovering(p.left, p.width);
    for (let j = 0; j < ks.length; j += 1) {
      const k = ks[j];
      panels[k].plates.push({
        id: p.id,
        src: p.src,
        fresh: !!fresh[p.id],
        style: 'left:' + localX(p.left, k) + 'px;top:' + p.top + 'px;width:' +
          p.width + 'px;height:' + p.height + 'px'
      });
    }
  }

  /* 藏在画面里的小家伙 */
  for (let i = 0; i < pigLayers.secrets.length; i += 1) {
    const s = pigLayers.secrets[i];
    const ks = panelsCovering(s.left - SECRET_PAD, s.width + SECRET_PAD * 2);
    for (let j = 0; j < ks.length; j += 1) {
      const k = ks[j];
      panels[k].secrets.push({
        key: s.key,
        src: s.src,
        found: !!found[s.key],
        panel: k,
        boxStyle: 'left:' + localX(s.left - SECRET_PAD, k) + 'px;top:' +
          (s.top - SECRET_PAD) + 'px;width:' + (s.width + SECRET_PAD * 2) + 'px;height:' +
          (s.height + SECRET_PAD * 2) + 'px',
        style: 'width:' + s.width + 'px;height:' + s.height + 'px;animation-delay:' +
          (-(i * 1.7)).toFixed(2) + 's'
      });
    }
  }

  return panels;
}

module.exports = {
  FOLD: FOLD,
  PIG_PANELS: PIG_PANELS,
  clamp01: clamp01,
  growth: growth,
  growths: growths,
  stripWidth: stripWidth,
  layout: layout,
  viewAt: viewAt,
  openView: openView,
  panelOf: panelOf,
  localX: localX,
  panelsCovering: panelsCovering,
  sliceStyle: sliceStyle,
  buildPanels: buildPanels,
  SECRET_PAD: SECRET_PAD
};
