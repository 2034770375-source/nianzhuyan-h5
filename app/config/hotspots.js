/**
 * 首页长地图热区（6 道菜）
 * 坐标系：以 2400 x 1200 的画布为基准
 *   cx / cy：相对画布宽 / 高的中心点比例
 *   r      ：点击热区半径占画布宽度的比例（比视觉光晕大，方便小朋友点击）
 *   glow   ：视觉光晕相对点击热区的比例
 */
const ART_W = 2400;
const ART_H = 1200;

/* hex -> rgba()，避免 8 位十六进制在低版本 webview 上不生效 */
function rgba(hex, alpha) {
  const v = hex.replace('#', '');
  const r = parseInt(v.substring(0, 2), 16);
  const g = parseInt(v.substring(2, 4), 16);
  const b = parseInt(v.substring(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

const HOTSPOTS = [
  {
    id: 'HS-01',
    dishId: 'hongyun',
    name: '鸿运当头',
    part: '猪头',
    cx: 0.304,
    cy: 0.523,
    r: 0.085,
    glow: 0.46,
    color: '#d8342a'
  },
  {
    id: 'HS-02',
    dishId: 'shazhucai',
    name: '杀猪菜',
    part: '猪背脊龙骨',
    cx: 0.5375,
    cy: 0.321,
    r: 0.09,
    glow: 0.44,
    color: '#c2673a'
  },
  {
    id: 'HS-03',
    dishId: 'feichang',
    name: '干锅肥肠',
    part: '猪腹部肠道',
    cx: 0.5375,
    cy: 0.636,
    r: 0.09,
    glow: 0.46,
    color: '#f2814b'
  },
  {
    id: 'HS-04a',
    dishId: 'nuomi',
    name: '糯米圆子',
    part: '猪四肢（前腿）',
    cx: 0.251,
    cy: 0.741,
    r: 0.062,
    glow: 0.62,
    color: '#d99a2b'
  },
  {
    id: 'HS-04b',
    dishId: 'nuomi',
    name: '糯米圆子',
    part: '猪四肢（后腿）',
    cx: 0.643,
    cy: 0.741,
    r: 0.062,
    glow: 0.62,
    color: '#d99a2b'
  },
  {
    id: 'HS-05',
    dishId: 'chouguiyu',
    name: '臭鳜鱼',
    part: '身旁独立宴席配菜区',
    cx: 0.87,
    cy: 0.6,
    r: 0.105,
    glow: 0.48,
    color: '#efb84a'
  },
  {
    id: 'HS-06',
    dishId: 'mifu',
    name: '霉豆腐',
    part: '宴席桌上的小食碟',
    cx: 0.1083,
    cy: 0.9133,
    r: 0.05,
    glow: 0.62,
    color: '#cf7a30'
  }
];

/**
 * 计算每个热区在画布坐标系下的样式。
 * offsetX：折面内部的坐标偏移（第 k 折传 k * 400），不传就是整张画布的坐标。
 * cxPx / left / size 都是「画布坐标」，方便按折面切分；boxStyle / glowStyle 已减去偏移。
 */
function buildHotspotBoxes(visited, offsetX) {
  const seen = visited || {};
  const ox = offsetX || 0;
  return HOTSPOTS.map(function (h) {
    const rPx = h.r * ART_W;
    const glowPx = rPx * h.glow;
    const left = h.cx * ART_W - rPx;
    const top = h.cy * ART_H - rPx;
    return {
      id: h.id,
      dishId: h.dishId,
      name: h.name,
      part: h.part,
      color: h.color,
      done: !!seen[h.dishId],
      cxPx: h.cx * ART_W,
      cyPx: h.cy * ART_H,
      left: left,
      top: top,
      size: rPx * 2,
      boxStyle: [
        'left:' + (left - ox) + 'px',
        'top:' + top + 'px',
        'width:' + rPx * 2 + 'px',
        'height:' + rPx * 2 + 'px'
      ].join(';'),
      glowStyle: [
        'width:' + glowPx * 2 + 'px',
        'height:' + glowPx * 2 + 'px',
        'background:radial-gradient(circle, ' + rgba(h.color, 0.95) + ' 0%, ' +
          rgba(h.color, 0.5) + ' 42%, ' + rgba(h.color, 0) + ' 72%)'
      ].join(';')
    };
  });
}

module.exports = {
  ART_W: ART_W,
  ART_H: ART_H,
  HOTSPOTS: HOTSPOTS,
  buildHotspotBoxes: buildHotspotBoxes
};
