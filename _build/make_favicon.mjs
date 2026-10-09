// 年猪宴 · 站点图标（favicon）
//
// 从封面那只拼豆小猪裁出一个正方形，做成 64×64 的 PNG 图标。
// 直接在浏览器标签页用原图会被缩得看不清，而且原图 638 KB 当图标太浪费。
//
// 需要 sharp（本机运行时里已有）。生成的 favicon.png 是要提交进仓库的，
// 所以 CI 里不需要 sharp —— dist.mjs 只是把它拷进产物。
//
// 用法：node _build/make_favicon.mjs [--size 64] [--test out.png]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const H5_ROOT = path.resolve(HERE, '..');

const argValue = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
};

const SIZE = Number(argValue('--size', '64'));
const TEST_OUT = argValue('--test', null);
const SRC = path.join(H5_ROOT, 'app', 'pages', 'map', 'assets', 'cover_pig.png');
const OUT = TEST_OUT ? path.resolve(TEST_OUT) : path.join(H5_ROOT, 'favicon.png');

// 猪头的框：左右都留在金粉之外（左边界压到金粉上会被切掉半粒，看着像失误），
// 右边多带一点筷子，正好是"筷子穿过小猪"那个构图
const HEAD = { left: 120, top: 20, right: 660, bottom: 580 };

// 纸色底：站点整体就是这个底色，图标里也用它，免得出现一圈突兀的白
const PAPER = { r: 0xff, g: 0xf6, b: 0xe9, alpha: 1 };

const { width: W, height: H } = await sharp(SRC).metadata();

// 补成正方形：短边往两边均摊，超出的部分裁掉，别变形
const side = Math.max(HEAD.right - HEAD.left, HEAD.bottom - HEAD.top);
const cx = (HEAD.left + HEAD.right) / 2;
const cy = (HEAD.top + HEAD.bottom) / 2;

let left = Math.round(cx - side / 2);
let top = Math.round(cy - side / 2);
left = Math.max(0, Math.min(left, W - side));
top = Math.max(0, Math.min(top, H - side));

const box = { left, top, width: side, height: side };

await sharp(SRC)
  .extract(box)
  .resize(SIZE, SIZE, { fit: 'fill', kernel: 'lanczos3' })
  .flatten({ background: PAPER })
  .png({ compressionLevel: 9, palette: true })
  .toFile(OUT);

const bytes = fs.statSync(OUT).size;
console.log('源图：' + W + 'x' + H + '  裁切：' + JSON.stringify(box));
console.log('输出：' + OUT + '  ' + SIZE + 'x' + SIZE + '  ' + bytes + ' B');
