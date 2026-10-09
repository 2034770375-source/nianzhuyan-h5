// 年猪宴 · H5 发布产物组装
//
// 把站点需要的三个东西拷进 dist/：
//   index.html   外壳
//   runtime/     小程序运行时
//   app/         从「年猪宴小程序」生成的产物（含 bundle.js 与全部素材）
//
// 其余一概不进 dist：_build/ 与 说明.md 是工程侧的东西，没必要对外；
// _smoke*/ 是截图；二维码/ 里是局域网地址的印刷稿，更不该混进公开站点。
//
// 只用 Node 内置模块，不装任何依赖，因此在 GitHub Actions 里可以直接跑。
//
// 用法：node _build/dist.mjs [--out dist]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const H5_ROOT = path.resolve(HERE, '..');

const argOut = (() => {
  const i = process.argv.indexOf('--out');
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : 'dist';
})();

const OUT = path.resolve(H5_ROOT, argOut);

// 生成物只允许落在工程目录里面：避免一个手滑的 --out ..\..\ 把别处删了
const rel = path.relative(H5_ROOT, OUT);
if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
  console.error('拒绝执行：输出目录必须在工程目录内 —— ' + OUT);
  process.exit(1);
}

const ENTRIES = ['index.html', 'runtime', 'app'];

for (const name of ENTRIES) {
  const src = path.join(H5_ROOT, name);
  if (!fs.existsSync(src)) {
    console.error('缺少必要文件：' + src);
    process.exit(1);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const name of ENTRIES) {
  fs.cpSync(path.join(H5_ROOT, name), path.join(OUT, name), { recursive: true });
}

// GitHub Pages 走 Jekyll 构建时才需要它（我们用 Actions 直传，留着是为了
// 万一以后改成"从分支发布"，下划线开头的路径也不会被吞掉）。
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

// 清点一下产物，顺便把源工程指纹带出来——线上和本地是不是同一份，看这行就行
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });

const files = walk(OUT);
const bytes = files.reduce((n, f) => n + fs.statSync(f).size, 0);

let fingerprint = '(未找到 app/build-info.json)';
try {
  fingerprint = JSON.parse(fs.readFileSync(path.join(OUT, 'app', 'build-info.json'), 'utf8')).fingerprint;
} catch { /* 指纹只是给人看的，读不到不算失败 */ }

console.log('产物目录：' + OUT);
console.log('文件数：' + files.length + '，合计 ' + (bytes / 1024 / 1024).toFixed(2) + ' MB');
console.log('源工程指纹：' + fingerprint);
