/**
 * 「我的年猪宴」分享卡绘制
 *
 * 抽成纯函数，方便小程序画布与预览工具共用同一份逻辑：
 *   drawCard(ctx, list, loadImage)
 *     ctx       画布 2d 上下文
 *     list      [{ title, src }] 六道菜
 *     loadImage (src) => Promise<Image|null>
 */
const pigLayers = require('../config/pigLayers.js');

const CARD_W = 750;
const CARD_H = 1200;

/* 小猪在卡片上的取景（源区域 → 目标区域） */
const SRC = { x: 40, y: 250, w: 2320, h: 840 };
const DST = { x: 44, y: 196, w: 662 };

function fitRect(img, x, y, w, h) {
  const k = Math.min(w / img.width, h / img.height);
  const dw = img.width * k;
  const dh = img.height * k;
  return { x: x + (w - dw) / 2, y: y + (h - dh) / 2, w: dw, h: dh };
}

async function drawCard(ctx, list, loadImage, opts) {
  const o = opts || {};
  /* 底：暖光米白 */
  const g = ctx.createRadialGradient(CARD_W / 2, 430, 60, CARD_W / 2, 540, 720);
  g.addColorStop(0, '#ffe4b6');
  g.addColorStop(0.45, '#fff2dc');
  g.addColorStop(1, '#fff6e9');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  ctx.strokeStyle = 'rgba(239,184,74,0.9)';
  ctx.lineWidth = 4;
  ctx.strokeRect(20, 20, CARD_W - 40, CARD_H - 40);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#d8342a';
  ctx.font = 'bold 54px sans-serif';
  ctx.fillText('我的年猪宴', CARD_W / 2, 108);
  ctx.fillStyle = 'rgba(58,43,37,0.66)';
  ctx.font = '26px sans-serif';
  ctx.fillText('六 道 菜 · 一 桌 年 味', CARD_W / 2, 152);

  /* 小猪（底 + 各个可动图层） */
  const base = await loadImage('/pages/map/assets/map_pig.png');
  const k = DST.w / SRC.w;
  if (base) {
    ctx.drawImage(base, SRC.x, SRC.y, SRC.w, SRC.h, DST.x, DST.y, DST.w, SRC.h * k);
    /* 拼豆猪自带表情，分享卡只画本体，不叠加眨眼 / 哈欠这些瞬时表情层 */
  }

  /* 六道菜 */
  const cell = 218;
  const gap = 22;
  const startX = (CARD_W - cell * 3 - gap * 2) / 2;
  const rows = [470, 762];

  for (let i = 0; i < list.length; i += 1) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = startX + col * (cell + gap);
    const y = rows[row];

    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,253,248,0.96)';
    ctx.arc(x + cell / 2, y + cell / 2, cell / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(239,184,74,0.9)';
    ctx.lineWidth = 3;
    ctx.stroke();

    const img = await loadImage(list[i].src);
    if (img) {
      const r = fitRect(img, x + 10, y + 10, cell - 20, cell - 20);
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
    }

    ctx.fillStyle = '#8e1b14';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(list[i].title, x + cell / 2, y + cell + 36);
  }

  /* 落款印章 */
  ctx.beginPath();
  ctx.fillStyle = '#d8342a';
  ctx.arc(CARD_W - 92, 160, 42, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(255,231,168,0.95)';
  ctx.lineWidth = 3;
  ctx.arc(CARD_W - 92, 160, 33, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ffe7a8';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText('宴', CARD_W - 92, 173);

  /* 祝福与出处 */
  ctx.fillStyle = '#3a2b25';
  ctx.font = 'bold 32px sans-serif';
  ctx.fillText('六道菜齐了，新年开席！', CARD_W / 2, 1104);
  ctx.fillStyle = 'rgba(58,43,37,0.6)';
  ctx.font = '24px sans-serif';
  ctx.fillText('扫一扫绘本上的二维码，来吃一桌徽州年宴', CARD_W / 2, 1148);
}

module.exports = {
  CARD_W: CARD_W,
  CARD_H: CARD_H,
  drawCard: drawCard
};
