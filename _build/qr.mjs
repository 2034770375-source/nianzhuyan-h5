/**
 * 离线二维码编码器（byte 模式，纠错等级 M / L，版本 1–6）
 *
 * 为什么自己写：这台机器上没有任何二维码库（node / python 都没有），
 * 也不联网、不把要编码的地址发给任何在线服务，所以按规范自己实现一份。
 *
 * 用法：
 *   node _build/qr.mjs --selftest                      # 结构自检 + 编码→解码往返
 *   node _build/qr.mjs --text "http://192.168.5.67:8080/" --out 二维码/二维码_LAN_纯码.png
 *   node _build/qr.mjs --text "..." --svg 输出.svg       # 只要矢量
 *
 * 实现范围：byte 模式、纠错等级 M（不够长时降到 L）、版本 1–6、8 种掩码按惩罚分择优、
 *           Reed–Solomon 纠错、格式信息（BCH）。版本信息（v7+ 才有）用不到，不做。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

/* ------------------------------ GF(256) 与 RS ------------------------------ */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;      /* 本原多项式 x^8+x^4+x^3+x^2+1 */
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}
const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsGenerator(n) {
  let g = [1];
  for (let i = 0; i < n; i += 1) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j += 1) {
      next[j] ^= g[j];
      next[j + 1] ^= gmul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}

function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const buf = new Uint8Array(data.length + ecLen);
  buf.set(data);
  for (let i = 0; i < data.length; i += 1) {
    const factor = buf[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j += 1) buf[i + j] ^= gmul(gen[j], factor);
  }
  return Array.from(buf.slice(data.length));
}

/* 校验：RS 码字的全部伴随式必须为 0（真机扫码器也是这么验的） */
function rsSyndromes(codewords, ecLen) {
  const out = [];
  for (let i = 0; i < ecLen; i += 1) {
    let s = 0;
    for (let j = 0; j < codewords.length; j += 1) {
      s = gmul(s, EXP[i]) ^ codewords[j];
    }
    out.push(s);
  }
  return out;
}

/* ------------------------------ 版本 / 纠错表 ------------------------------ */

/* blocks: [块数, 每块数据码字数]；ec = 每块纠错码字数 */
const EC_TABLE = {
  M: {
    1: { ec: 10, blocks: [[1, 16]] },
    2: { ec: 16, blocks: [[1, 28]] },
    3: { ec: 26, blocks: [[1, 44]] },
    4: { ec: 18, blocks: [[2, 32]] },
    5: { ec: 24, blocks: [[2, 43]] },
    6: { ec: 16, blocks: [[4, 27]] }
  },
  L: {
    1: { ec: 7, blocks: [[1, 19]] },
    2: { ec: 10, blocks: [[1, 34]] },
    3: { ec: 15, blocks: [[1, 55]] },
    4: { ec: 20, blocks: [[1, 80]] },
    5: { ec: 26, blocks: [[1, 108]] },
    6: { ec: 18, blocks: [[2, 68]] }
  }
};

const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };
const EC_BITS = { L: 1, M: 0, Q: 3, H: 2 };

const dataCapacity = (version, level) =>
  EC_TABLE[level][version].blocks.reduce((n, [count, per]) => n + count * per, 0);

/* ------------------------------ 编码 ------------------------------ */

function pickVersion(byteLen, level) {
  for (const v of Object.keys(EC_TABLE[level]).map(Number).sort((a, b) => a - b)) {
    const cap = dataCapacity(v, level) * 8 - 4 - 8;       /* 减去模式指示符与字符计数 */
    if (byteLen * 8 <= cap) return v;
  }
  return null;
}

function toCodewords(bytes, version, level) {
  const total = dataCapacity(version, level);
  const bits = [];
  const push = (value, len) => { for (let i = len - 1; i >= 0; i -= 1) bits.push((value >> i) & 1); };
  push(0b0100, 4);                                        /* byte 模式 */
  push(bytes.length, 8);                                  /* 版本 1–9 的字符计数是 8 位 */
  bytes.forEach((b) => push(b, 8));
  const capBits = total * 8;
  for (let i = 0; i < 4 && bits.length < capBits; i += 1) bits.push(0);   /* 终止符 */
  while (bits.length % 8 !== 0) bits.push(0);
  const words = [];
  for (let i = 0; i < bits.length; i += 8) {
    words.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
  }
  const pad = [0xec, 0x11];
  for (let i = 0; words.length < total; i += 1) words.push(pad[i % 2]);
  return words;
}

/* 分块 → 每块算纠错 → 交错（数据在前、纠错在后） */
function makeFinalCodewords(dataWords, version, level) {
  const { ec, blocks } = EC_TABLE[level][version];
  const dataBlocks = [];
  let p = 0;
  blocks.forEach(([count, per]) => {
    for (let i = 0; i < count; i += 1) {
      dataBlocks.push(dataWords.slice(p, p + per));
      p += per;
    }
  });
  const ecBlocks = dataBlocks.map((d) => rsEncode(d, ec));
  const out = [];
  const maxData = Math.max(...dataBlocks.map((d) => d.length));
  for (let i = 0; i < maxData; i += 1) dataBlocks.forEach((d) => { if (i < d.length) out.push(d[i]); });
  for (let i = 0; i < ec; i += 1) ecBlocks.forEach((b) => out.push(b[i]));
  return { codewords: out, dataBlocks, ecBlocks, ec };
}

/* ------------------------------ 矩阵 ------------------------------ */

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r, c) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

function formatBits(level, mask) {
  const data = (EC_BITS[level] << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i -= 1) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  return ((data << 10) | rem) ^ 0x5412;
}

function buildMatrix(version, level, mask, codewords) {
  const size = 17 + 4 * version;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));

  const finder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr += 1) {
      for (let dc = -1; dc <= 7; dc += 1) {
        const r = r0 + dr; const c = c0 + dc;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const on = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6))
          || (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6))
          || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
        mod[r][c] = on; fn[r][c] = true;
      }
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  for (let i = 8; i < size - 8; i += 1) {
    mod[6][i] = i % 2 === 0; fn[6][i] = true;
    mod[i][6] = i % 2 === 0; fn[i][6] = true;
  }

  const centers = ALIGN[version] || [];
  centers.forEach((r) => centers.forEach((c) => {
    if (fn[r][c]) return;
    for (let dr = -2; dr <= 2; dr += 1) {
      for (let dc = -2; dc <= 2; dc += 1) {
        mod[r + dr][c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
        fn[r + dr][c + dc] = true;
      }
    }
  }));

  /* 先占住格式信息的位置（内容稍后填） */
  for (let i = 0; i <= 8; i += 1) {
    if (!fn[8][i]) fn[8][i] = true;
    if (!fn[i][8]) fn[i][8] = true;
  }
  for (let i = size - 8; i < size; i += 1) {
    if (!fn[8][i]) fn[8][i] = true;
    if (!fn[i][8]) fn[i][8] = true;
  }
  mod[size - 8][8] = true; fn[size - 8][8] = true;     /* 固定深色模块 */

  /* 数据按"从右下往左上、两列一组、蛇形"排 */
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (fn[r][c]) continue;
        let dark = false;
        if (bitIndex < totalBits) {
          dark = ((codewords[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1) === 1;
          bitIndex += 1;
        }
        mod[r][c] = dark;
      }
    }
  }

  /* 掩码 */
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!fn[r][c] && MASKS[mask](r, c)) mod[r][c] = !mod[r][c];
    }
  }

  /* 格式信息（两份） */
  const fmt = formatBits(level, mask);
  const bit = (i) => ((fmt >> i) & 1) === 1;
  /* 竖排那一份（col 8）：bits 0–5 → rows 0–5；bits 6–7 → rows 7–8；bits 8–14 → rows size-7…size-1 */
  for (let i = 0; i < 15; i += 1) {
    const v = bit(i);
    if (i < 6) mod[i][8] = v;
    else if (i < 8) mod[i + 1][8] = v;
    else mod[size - 15 + i][8] = v;
  }
  /* 横排那一份（row 8）：bits 0–7 → cols size-1…size-8；bit 8 → col 7；bits 9–14 → cols 5…0 */
  for (let i = 0; i < 15; i += 1) {
    const v = bit(i);
    if (i < 8) mod[8][size - 1 - i] = v;
    else if (i < 9) mod[8][7] = v;
    else mod[8][15 - i - 1] = v;
  }
  mod[size - 8][8] = true;                                  /* 固定深色模块 */

  return { size, mod, fn };
}

function penalty(mod, fn) {
  const size = mod.length;
  let score = 0;
  const runScore = (get) => {
    for (let a = 0; a < size; a += 1) {
      let run = 1;
      for (let b = 1; b < size; b += 1) {
        if (get(a, b) === get(a, b - 1)) {
          run += 1;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  };
  runScore((r, c) => mod[r][c]);
  runScore((c, r) => mod[r][c]);
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = mod[r][c];
      if (v === mod[r][c + 1] && v === mod[r + 1][c] && v === mod[r + 1][c + 1]) score += 3;
    }
  }
  /* 规则三：1:1:3:1:1 的深色-浅色-深色-浅色-深色 图形 */
  const finderLike = (get, a, b) => {
    const p = [true, false, true, true, true, false, true, false, false, false, false];
    const q = [false, false, false, false, true, false, true, true, true, false, true];
    return p.every((v, i) => get(a, b + i) === v) || q.every((v, i) => get(a, b + i) === v);
  };
  for (let a = 0; a < size; a += 1) {
    for (let b = 0; b + 11 <= size; b += 1) {
      if (finderLike((x, y) => mod[x][y], a, b)) score += 40;
      if (finderLike((x, y) => mod[y][x], a, b)) score += 40;
    }
  }
  /* 规则四：深色比例偏离 50% */
  let dark = 0;
  for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) if (mod[r][c]) dark += 1;
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return score;
}

export function encodeQR(text, level = 'M') {
  const bytes = Array.from(Buffer.from(text, 'utf8'));
  let pickedLevel = level;
  let version = pickVersion(bytes.length, pickedLevel);
  if (version === null && pickedLevel === 'M') {
    pickedLevel = 'L';
    version = pickVersion(bytes.length, pickedLevel);
  }
  if (version === null) throw new Error('内容太长，超出了 1–6 版本（byte 模式）的容量');

  const dataWords = toCodewords(bytes, version, pickedLevel);
  const { codewords } = makeFinalCodewords(dataWords, version, pickedLevel);

  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const built = buildMatrix(version, pickedLevel, mask, codewords);
    const score = penalty(built.mod, built.fn);
    if (!best || score < best.score) best = { mask, score, ...built };
  }
  return {
    text,
    level: pickedLevel,
    version,
    mask: best.mask,
    size: best.size,
    modules: best.mod,
    functionModules: best.fn,
    codewords
  };
}

/* ------------------------------ 独立解码（只用于自检） ------------------------------ */

export function decodeQR(result) {
  const { size, functionModules: fn } = result;
  const mod = result.modules.map((row) => row.slice());

  /* 读两份格式信息，两份一致且 BCH 对得上才认 */
  const readFormat = (bits) => {
    let best = null;
    for (const level of Object.keys(EC_BITS)) {
      for (let mask = 0; mask < 8; mask += 1) {
        let same = 0;
        const f = formatBits(level, mask);
        for (let i = 0; i < 15; i += 1) if (((f >> i) & 1) === bits[i]) same += 1;
        if (!best || same > best.same) best = { level, mask, same };
      }
    }
    return best;
  };
  /* 两份格式信息（竖排带 / 横排带），按写入时的同一顺序读回 */
  const copyVertical = [];
  for (let i = 0; i < 15; i += 1) {
    if (i < 6) copyVertical.push(mod[i][8] ? 1 : 0);
    else if (i < 8) copyVertical.push(mod[i + 1][8] ? 1 : 0);
    else copyVertical.push(mod[size - 15 + i][8] ? 1 : 0);
  }
  const copyHorizontal = [];
  for (let i = 0; i < 15; i += 1) {
    if (i < 8) copyHorizontal.push(mod[8][size - 1 - i] ? 1 : 0);
    else if (i < 9) copyHorizontal.push(mod[8][7] ? 1 : 0);
    else copyHorizontal.push(mod[8][15 - i - 1] ? 1 : 0);
  }
  const fa = readFormat(copyVertical);
  const fb = readFormat(copyHorizontal);
  if (!fa || !fb || fa.level !== fb.level || fa.mask !== fb.mask || fa.same !== 15 || fb.same !== 15) {
    const fmt = (x) => (x ? `${x.level}/${x.mask}/same=${x.same}` : 'null');
    throw new Error(`格式信息读取失败：竖排 ${fmt(fa)}，横排 ${fmt(fb)}；竖排比特 ${copyVertical.join('')}，横排比特 ${copyHorizontal.join('')}`);
  }
  const { level, mask } = fa;

  /* 反掩码 */
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!fn[r][c] && MASKS[mask](r, c)) mod[r][c] = !mod[r][c];
    }
  }

  /* 按同样的蛇形顺序取回码字 */
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (fn[r][c]) continue;
        bits.push(mod[r][c] ? 1 : 0);
      }
    }
  }
  const words = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    words.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
  }

  /* 反交错 → 每块做 RS 伴随式校验 → 取数据 */
  const { ec, blocks } = EC_TABLE[level][result.version];
  const totalData = dataCapacity(result.version, level);
  const groupSizes = [];
  blocks.forEach(([count, per]) => { for (let i = 0; i < count; i += 1) groupSizes.push(per); });
  const dataBlocks = groupSizes.map(() => []);
  const ecBlocks = groupSizes.map(() => []);
  let p = 0;
  const maxData = Math.max(...groupSizes);
  for (let i = 0; i < maxData; i += 1) {
    groupSizes.forEach((len, bi) => { if (i < len) dataBlocks[bi].push(words[p++]); });
  }
  for (let i = 0; i < ec; i += 1) {
    groupSizes.forEach((_, bi) => ecBlocks[bi].push(words[p++]));
  }
  const syndromes = [];
  dataBlocks.forEach((d, bi) => {
    const full = d.concat(ecBlocks[bi]);
    syndromes.push(...rsSyndromes(full, ec));
  });
  if (syndromes.some((s) => s !== 0)) throw new Error('RS 校验不过（伴随式非零）');

  /* 解析 byte 段 */
  const flat = dataBlocks.reduce((acc, d) => acc.concat(d), []);
  const outBits = [];
  flat.forEach((w) => { for (let i = 7; i >= 0; i -= 1) outBits.push((w >> i) & 1); });
  const take = (n) => { let v = 0; for (let i = 0; i < n; i += 1) v = (v << 1) | outBits.shift(); return v; };
  const mode = take(4);
  if (mode !== 0b0100) throw new Error('不是 byte 模式：' + mode);
  const count = take(8);
  const bytes = [];
  for (let i = 0; i < count; i += 1) bytes.push(take(8));
  return { level, mask, version: result.version, text: Buffer.from(bytes).toString('utf8'), totalData };
}

/* ------------------------------ 渲染 ------------------------------ */

export function toSVG(modules, quiet = 4) {
  const n = modules.length;
  const N = n + quiet * 2;
  let d = '';
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (modules[r][c]) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${N}" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges">`
    + `<rect width="${N}" height="${N}" fill="#ffffff"/>`
    + `<path d="${d}" fill="#000000"/></svg>`;
}

export function toText(modules) {
  return modules.map((row) => row.map((v) => (v ? '█' : '·')).join('')).join('\n');
}

/* ------------------------------ CLI ------------------------------ */

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

async function main() {
  if (args.includes('--selftest')) {
    const samples = [
      'http://192.168.5.67:8080/',
      'https://example.com/a?b=1&c=年猪宴',
      '年猪宴 · 局域网预览',
      'x'.repeat(60),
      'y'.repeat(120)
    ];
    let pass = 0;
    samples.forEach((s) => {
      const r = encodeQR(s);
      const d = decodeQR(r);
      const ok = d.text === s;
      if (ok) pass += 1;
      console.log(`${ok ? '✓' : '✗'} 版本 ${r.version}-${r.level} 掩码 ${r.mask} 尺寸 ${r.size}×${r.size}  ${JSON.stringify(s.slice(0, 28))}${s.length > 28 ? '…' : ''}`);
    });
    console.log(`往返自检：${pass} / ${samples.length} 通过`);
    if (pass !== samples.length) process.exitCode = 1;
    return;
  }

  if (args.includes('--debug-format')) {
    const r = encodeQR(argOf('text', 'http://192.168.5.67:8080/'));
    const size = r.size;
    const bit = (i) => ((formatBits(r.level, r.mask) >> i) & 1);
    const vert = [];
    for (let i = 0; i < 15; i += 1) {
      if (i < 6) vert.push(r.modules[i][8] ? 1 : 0);
      else if (i < 8) vert.push(r.modules[i + 1][8] ? 1 : 0);
      else vert.push(r.modules[size - 15 + i][8] ? 1 : 0);
    }
    const horiz = [];
    for (let i = 0; i < 15; i += 1) {
      if (i < 8) horiz.push(r.modules[8][size - 1 - i] ? 1 : 0);
      else if (i < 9) horiz.push(r.modules[8][7] ? 1 : 0);
      else horiz.push(r.modules[8][15 - i - 1] ? 1 : 0);
    }
    const want = [];
    for (let i = 0; i < 15; i += 1) want.push(bit(i));
    console.log(`level=${r.level} mask=${r.mask} fmt=0x${formatBits(r.level, r.mask).toString(16)}`);
    console.log('want  ', want.join(''));
    console.log('vert  ', vert.join(''));
    console.log('horiz ', horiz.join(''));
    return;
  }

  const text = argOf('text', null);
  if (!text) {
    console.log('用法：--selftest | --text <内容> [--out 图片.png] [--svg 文件.svg] [--dump]');
    process.exitCode = 1;
    return;
  }
  const r = encodeQR(text);
  const decoded = decodeQR(r);
  if (decoded.text !== text) throw new Error('自检失败：解码回来的内容和原文不一致');
  console.log(`已编码：${text}`);
  console.log(`  版本 ${r.version}-${r.level}，掩码 ${r.mask}，矩阵 ${r.size}×${r.size}（含静区 ${r.size + 8}×${r.size + 8}）`);
  console.log(`  往返校验通过（解码回来一致，RS 伴随式全零）`);

  const svg = toSVG(r.modules, 4);
  const svgOut = argOf('svg', null);
  if (svgOut) {
    fs.mkdirSync(path.dirname(svgOut), { recursive: true });
    fs.writeFileSync(svgOut, svg, 'utf8');
    console.log('  SVG → ' + svgOut);
  }
  const out = argOf('out', null);
  if (out) {
    const N = r.size + 8;
    const scale = Math.max(1, Math.floor(1024 / N));      /* 整数倍，避免任何插值 */
    const png = await sharp(Buffer.from(svg), { density: 72 })
      .resize(N * scale, N * scale, { kernel: 'nearest' })
      .png({ compressionLevel: 9 })
      .toBuffer();
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, png);
    console.log(`  PNG → ${out}（${N * scale}×${N * scale}，每模块 ${scale} 像素）`);
  }
  if (args.includes('--dump')) console.log(toText(r.modules));
}

/* 被别的脚本 import 时不要执行 CLI */
const isCli = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isCli) {
  main().catch((e) => {
    console.error('出错：' + e.message);
    process.exitCode = 1;
  });
}
