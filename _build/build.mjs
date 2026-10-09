/**
 * 年猪宴 · H5 构建
 *
 * 把「年猪宴小程序」工程变成浏览器能直接吃的形态，输出到 ../app/：
 *   1. 原样镜像工程源码与素材（pages/ packageDish/ components/ utils/ config/ assets/ app.js app.wxss app.json）
 *   2. 生成 app/bundle.js：把每个 JS 包成模块、每个 WXML/WXSS/JSON 存成字符串，
 *      由 runtime/np-runtime.js 在浏览器里解释执行
 *   3. 把分享卡要用到的几张图内联成 data URI —— file:// 下 canvas 画本地图会被判跨域，
 *      只有 data URI 才能 toDataURL（也就是"保存分享卡"能不能用的关键）
 *   4. 写 app/build-info.json：源工程指纹，用来判断要不要重新构建
 *
 * 用法：node _build/build.mjs
 *
 * 规则：工程里 / 开头的路径 = 工程根；否则相对当前文件。运行时按同一规则解析，
 *      所以这里不需要改写任何源码里的路径。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const H5_ROOT = path.resolve(HERE, '..');
const SRC = path.resolve(H5_ROOT, '..', '年猪宴小程序');
const OUT = path.join(H5_ROOT, 'app');

/* 镜像的顶层条目 */
const MIRROR = ['pages', 'packageDish', 'components', 'utils', 'config', 'assets'];
const ROOT_FILES = ['app.js', 'app.wxss', 'app.json'];

/* 分享卡要画到 canvas 上的图：必须内联，否则 file:// 下导不出来 */
const INLINE_FOR_CANVAS = [
  'pages/map/assets/map_pig.png',
  'packageDish/assets/dish_mifu.png',
  'packageDish/assets/dish_shazhucai.png',
  'packageDish/assets/dish_chouguiyu.png',
  'packageDish/assets/dish_hongyun.png',
  'packageDish/assets/dish_nuomi.png',
  'packageDish/assets/dish_feichang.png'
];

const rel = (p) => path.relative(SRC, p).split(path.sep).join('/');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/* ------------------------------ 收集文件 ------------------------------ */

const files = [];
for (const name of MIRROR) {
  const dir = path.join(SRC, name);
  if (fs.existsSync(dir)) files.push(...walk(dir));
}
for (const name of ROOT_FILES) {
  const f = path.join(SRC, name);
  if (fs.existsSync(f)) files.push(f);
}
files.sort();

const jsFiles = files.filter((f) => f.endsWith('.js'));
const wxmlFiles = files.filter((f) => f.endsWith('.wxml'));
const wxssFiles = files.filter((f) => f.endsWith('.wxss'));
const jsonFiles = files.filter((f) => f.endsWith('.json'));
const assetFiles = files.filter((f) => /\.(png|jpg|jpeg|gif|svg|webp|mp3|wav|ttf|otf|woff2?)$/i.test(f));

/* ------------------------------ 输出目录 ------------------------------ */

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

/* 1. 原样镜像（源码 + 素材），路径与工程一一对应 */
for (const f of files) {
  const dest = path.join(OUT, rel(f));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(f, dest);
}

/* 2. bundle.js */
const key = (f) => rel(f).replace(/\.(js|wxml|wxss|json)$/, '');
const parts = [];
parts.push('/* 年猪宴 · H5 包（由 _build/build.mjs 生成，勿手改） */');
parts.push('window.NP_DEFS = window.NP_DEFS || { modules: {}, wxml: {}, wxss: {}, json: {}, dataURI: {}, manifest: {} };');
parts.push('(function (D) {');

/* 模块 */
parts.push('  /* ---------- 模块 ---------- */');
for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  parts.push(`  D.modules[${JSON.stringify(key(f))}] = function (module, exports, require) {\n${src}\n  };`);
}

/* 模板 */
parts.push('  /* ---------- WXML ---------- */');
for (const f of wxmlFiles) {
  parts.push(`  D.wxml[${JSON.stringify(key(f))}] = ${JSON.stringify(fs.readFileSync(f, 'utf8'))};`);
}

/* 配置 json */
parts.push('  /* ---------- 页面/组件配置 ---------- */');
for (const f of jsonFiles) {
  const raw = fs.readFileSync(f, 'utf8');
  try {
    parts.push(`  D.json[${JSON.stringify(key(f))}] = ${JSON.stringify(JSON.parse(raw))};`);
  } catch (e) {
    console.warn('  ! JSON 解析失败，已跳过：' + rel(f));
  }
}

/* 样式：app 先注入，其次组件，最后页面，保证同权重时页面样式在后面 */
parts.push('  /* ---------- WXSS（注入顺序：app → components → pages） ---------- */');
const wxssOrder = wxssFiles.slice().sort((a, b) => {
  const rank = (p) => {
    const r = rel(p);
    if (r === 'app.wxss') return 0;
    if (r.includes('components/')) return 1;
    return 2;
  };
  return rank(a) - rank(b) || rel(a).localeCompare(rel(b));
});
for (const f of wxssOrder) {
  const name = rel(f) === 'app.wxss' ? 'app' : key(f);
  parts.push(`  D.wxss[${JSON.stringify(name)}] = ${JSON.stringify(fs.readFileSync(f, 'utf8'))};`);
}

/* 内联图片 */
parts.push('  /* ---------- 内联图（分享卡要画进 canvas） ---------- */');
for (const name of INLINE_FOR_CANVAS) {
  const f = path.join(SRC, name);
  if (!fs.existsSync(f)) { console.warn('  ! 缺少内联素材：' + name); continue; }
  const ext = path.extname(f).slice(1).toLowerCase();
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/' + ext;
  const uri = 'data:' + mime + ';base64,' + fs.readFileSync(f).toString('base64');
  parts.push(`  D.dataURI[${JSON.stringify(name)}] = ${JSON.stringify(uri)};`);
}

/* 清单 */
const appJson = JSON.parse(fs.readFileSync(path.join(SRC, 'app.json'), 'utf8'));
const pages = [...(appJson.pages || [])];
(appJson.subpackages || []).forEach((pkg) => {
  (pkg.pages || []).forEach((p) => pages.push(pkg.root + '/' + p));
});
parts.push('  /* ---------- 清单 ---------- */');
parts.push(`  D.manifest = ${JSON.stringify({ entry: pages[0], pages }, null, 2)};`);
parts.push('})(window.NP_DEFS);');

fs.writeFileSync(path.join(OUT, 'bundle.js'), parts.join('\n'), 'utf8');

/* 3. 指纹 */
const hash = crypto.createHash('sha1');
let bytes = 0;
files.forEach((f) => {
  const st = fs.statSync(f);
  bytes += st.size;
  hash.update(rel(f) + '|' + st.size + '|' + Math.round(st.mtimeMs));
});
const info = {
  source: SRC,
  builtAt: new Date().toISOString(),
  fingerprint: hash.digest('hex').slice(0, 12),
  counts: { files: files.length, js: jsFiles.length, wxml: wxmlFiles.length, wxss: wxssFiles.length, assets: assetFiles.length },
  sourceBytes: bytes,
  bundleBytes: fs.statSync(path.join(OUT, 'bundle.js')).size,
  pages
};
fs.writeFileSync(path.join(OUT, 'build-info.json'), JSON.stringify(info, null, 2), 'utf8');

console.log('源工程：' + SRC);
console.log('输出到：' + OUT);
console.log(`  文件 ${info.counts.files} 个（js ${info.counts.js} / wxml ${info.counts.wxml} / wxss ${info.counts.wxss} / 素材 ${info.counts.assets}）`);
console.log(`  bundle.js ${(info.bundleBytes / 1024).toFixed(0)} KB，指纹 ${info.fingerprint}`);
console.log('  页面：' + pages.join(' → '));
