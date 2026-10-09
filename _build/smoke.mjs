/**
 * 年猪宴 · H5 冒烟测试
 *
 * 用真实 Chrome 以 file:// 打开 index.html，**鼠标与触摸各跑一遍**，
 * 覆盖桌面和手机两条输入路径，最后再跑一次完整回归并截图到 _smoke/。
 *
 * 用法：
 *   node _build/smoke.mjs                                  # 本地 file:// 跑，截图进 _smoke/
 *   node _build/smoke.mjs --url https://xxx.github.io/yy/  # 对着线上地址跑，截图进 _smoke-online/
 *
 * 线上跑时同一套断言不变——它验收的就是"部署出去的那一份是不是和本地同一份行为"。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const H5_ROOT = path.resolve(HERE, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_W = 375;

/* --url 给了就测线上，没给就测本地 file://。截图目录跟着分家，
   免得线上跑一遍就把本地那套基准截图盖掉了（两套都用像素比对看过）。 */
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const REMOTE_URL = argValue('--url');
const SHOT_DIR = path.join(H5_ROOT, argValue('--out') || (REMOTE_URL ? '_smoke-online' : '_smoke'));
const INDEX = REMOTE_URL ? REMOTE_URL : pathToFileURL(path.join(H5_ROOT, 'index.html')).href;

fs.mkdirSync(SHOT_DIR, { recursive: true });

/* 浏览器自动播放策略会提示 AudioContext 起于 suspended —— 入口页本来就是"轻触进入"，
   第一下点击后 audio.unlock() 会把它 resume 回来，这条属于预期提示。 */
const IGNORE = [/AudioContext was not allowed to start/i];

const checks = [];
const problems = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '   ' + detail : ''));
}

/* ------------------------------ 页面工具 ------------------------------ */

function watch(page, tag) {
  page.on('console', (m) => {
    const text = m.text();
    if (IGNORE.some((re) => re.test(text))) return;
    if (m.type() === 'error' || m.type() === 'warning') problems.push('[' + tag + '][' + m.type() + '] ' + text);
  });
  page.on('pageerror', (e) => problems.push('[' + tag + '][pageerror] ' + e.message));
  page.on('requestfailed', (r) => problems.push('[' + tag + '][失败] ' + r.url().split('/').slice(-2).join('/')));
}

const shot = (page, name) => page.screenshot({ path: path.join(SHOT_DIR, name + '.png') });

/* 逻辑坐标（375×812）↔ 屏幕坐标 */
async function toScreen(page, lx, ly) {
  const box = await page.evaluate(() => {
    const r = document.getElementById('np-device').getBoundingClientRect();
    return { x: r.x, y: r.y, s: r.width / 375 };
  });
  return { x: box.x + lx * box.s, y: box.y + ly * box.s, s: box.s };
}

async function tapAt(page, touch, lx, ly) {
  const p = await toScreen(page, lx, ly);
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

async function dragAt(page, touch, fromLx, fromLy, dx, steps = 16) {
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    const a = await toScreen(page, fromLx, fromLy);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
    for (let i = 1; i <= steps; i += 1) {
      const q = await toScreen(page, fromLx + (dx * i) / steps, fromLy);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: q.x, y: q.y }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    const a = await toScreen(page, fromLx, fromLy);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i += 1) {
      const q = await toScreen(page, fromLx + (dx * i) / steps, fromLy);
      await page.mouse.move(q.x, q.y);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  }
}

async function longPressAt(page, touch, lx, ly, ms) {
  const p = await toScreen(page, lx, ly);
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
    await page.waitForTimeout(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForTimeout(ms);
    await page.mouse.up();
  }
}

async function doubleTapAt(page, touch, lx, ly) {
  await tapAt(page, touch, lx, ly);
  await page.waitForTimeout(120);
  await tapAt(page, touch, lx, ly);
}

const state = (page) => page.evaluate(() => {
  const el = document.querySelector('#np-screen page:last-child');
  const inst = el && el.__np;
  const num = (v, n) => (typeof v === 'number' ? Number(v.toFixed(n)) : null);
  return {
    route: el && el.getAttribute('data-np-route'),
    pages: document.querySelectorAll('#np-screen page').length,
    unfold: inst ? num(inst.unfold, 3) : null,
    isOpen: inst ? !!inst.data.isOpen : null,
    x: inst && typeof inst.x === 'number' ? Math.round(inst.x) : null,
    scale: inst ? num(inst.scale, 3) : null,
    fullView: inst ? !!inst.data.fullView : null,
    patting: inst ? !!inst.data.patting : null
  };
});

/* 某个元素中心点的逻辑坐标（用于点热区 / 长按猪头） */
const centerOf = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const d = document.getElementById('np-device').getBoundingClientRect();
  const k = d.width / 375;
  return { x: (r.x + r.width / 2 - d.x) / k, y: (r.y + r.height / 2 - d.y) / k, w: Math.round(r.width / k) };
}, sel);

/* 找一个"当前真的在画面里"的元素（摊开后热区散在 2400 宽的长图上） */
const visibleOf = (page, sel, minSize = 20) => page.evaluate(([s, min]) => {
  const d = document.getElementById('np-device').getBoundingClientRect();
  const k = d.width / 375;
  const list = Array.from(document.querySelectorAll(s)).map((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    return {
      x: (cx - d.x) / k,
      y: (cy - d.y) / k,
      w: r.width / k,
      inside: cx > d.x + 8 && cx < d.x + d.width - 8 && cy > d.y + 60 && cy < d.y + d.height - 40
    };
  }).filter((a) => a.inside && a.w > min);
  return list.sort((a, b) => b.w - a.w)[0] || null;
}, [sel, minSize]);

/* ------------------------------ 输入走查（鼠标/触摸各一遍） ------------------------------ */

async function inputPass(browser, touch) {
  const label = touch ? '触摸' : '鼠标';
  const context = await browser.newContext({ viewport: { width: 900, height: 900 }, hasTouch: touch, deviceScaleFactor: 1 });
  const page = await context.newPage();
  watch(page, label);
  await page.goto(INDEX);
  await page.waitForTimeout(700);

  /* 入口：点一下进地图 */
  await tapAt(page, touch, 187, 500);
  await page.waitForTimeout(1200);
  let st = await state(page);
  check(`${label}：点入口进地图`, st.route === 'pages/map/index', st.route);

  /* 合着的书不响应滚轮（只有鼠标有滚轮） */
  if (!touch) {
    const closed = (await state(page)).scale;
    await page.mouse.move(...Object.values(await toScreen(page, 187, 430)).slice(0, 2));
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(300);
    check('鼠标：合着的书滚轮不缩放', (await state(page)).scale === closed, `scale ${closed} → ${(await state(page)).scale}`);
  }

  /* 拖开风琴本 */
  await dragAt(page, touch, 120, 430, 360, 18);
  await page.waitForTimeout(2600);
  st = await state(page);
  check(`${label}：拖开风琴本`, st.unfold > 0.99 && st.isOpen === true, `unfold=${st.unfold} isOpen=${st.isOpen}`);
  await shot(page, `30-${label}-地图摊开`);

  /* 摊开后拖动平移 */
  const x0 = (await state(page)).x;
  await dragAt(page, touch, 200, 430, -140, 12);
  await page.waitForTimeout(500);
  const x1 = (await state(page)).x;
  check(`${label}：拖动平移地图`, x0 !== x1, `x ${x0} → ${x1}`);

  /* 只有鼠标能验证滚轮：摊开后缩放，且光标下的画布点基本不动。
     放在双击之前测，因为双击会把镜头还原成"整只猪"，那时 clamp 会把手感拉走。 */
  if (!touch) {
    const before = await page.evaluate(() => {
      const i = document.querySelector('#np-screen page:last-child').__np;
      return { ax: (187 - i.x) / i.scale, ay: (430 - i.y) / i.scale, s: i.scale };
    });
    const c = await toScreen(page, 187, 430);
    await page.mouse.move(c.x, c.y);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => {
      const i = document.querySelector('#np-screen page:last-child').__np;
      return { ax: (187 - i.x) / i.scale, ay: (430 - i.y) / i.scale, s: i.scale };
    });
    const drift = Math.round(Math.hypot(after.ax - before.ax, after.ay - before.ay));
    check('鼠标：滚轮缩放地图', before.s !== after.s, `scale ${before.s.toFixed(3)} → ${after.s.toFixed(3)}`);
    check('鼠标：滚轮锚定在光标处', drift < 30, `画布偏移 ${drift}px`);
  }

  /* 双击快速放大 / 还原（选一个没有热区的点，否则两下点击会先点进菜品页） */
  const safe = await page.evaluate(() => {
    const d = document.getElementById('np-device').getBoundingClientRect();
    const k = d.width / 375;
    const spots = Array.from(document.querySelectorAll('.hotspot')).map((el) => {
      const r = el.getBoundingClientRect();
      return { x: (r.x + r.width / 2 - d.x) / k, y: (r.y + r.height / 2 - d.y) / k, w: r.width / k };
    });
    const cands = [[60, 700], [315, 700], [60, 120], [315, 120], [187, 740]];
    for (const [cx, cy] of cands) {
      const far = spots.every((s) => Math.hypot(s.x - cx, s.y - cy) > s.w / 2 + 30);
      if (far) return { x: cx, y: cy };
    }
    return { x: 60, y: 700 };
  });
  const s0 = (await state(page)).scale;
  await doubleTapAt(page, touch, safe.x, safe.y);
  await page.waitForTimeout(1000);
  const s1 = (await state(page)).scale;
  check(`${label}：双击缩放`, s0 !== s1, `scale ${s0} → ${s1}`);

  /* 长按猪头 → 摸头反应（点坐标要落在猪头热区里，能验证坐标换算没错位） */
  const head = await centerOf(page, '.hotspot[data-id="HS-01"]');
  if (head) {
    await longPressAt(page, touch, head.x, head.y, 420);
    await page.waitForTimeout(200);
    check(`${label}：长按猪头有摸头反应`, (await state(page)).patting === true);
  } else {
    check(`${label}：找到猪头热区`, false, 'HS-01 不在画面里');
  }

  /* 从热区上拖过：不应该被带去菜品页（拖拽后的 click 要吞掉） */
  const dragStart = await visibleOf(page, '.hotspot', 10);
  if (dragStart) {
    await dragAt(page, touch, dragStart.x, dragStart.y, -160, 12);
    await page.waitForTimeout(700);
    check(`${label}：从热区上拖过不误触`, (await state(page)).route === 'pages/map/index');
  } else {
    check(`${label}：找到可拖过的热区`, false);
  }

  /* 点热区 → 菜品页 → 拖动切下一道菜 */
  const spot = await visibleOf(page, '.hotspot', 10);
  if (spot) {
    await tapAt(page, touch, spot.x, spot.y);
    await page.waitForTimeout(1200);
    const dish = await state(page);
    check(`${label}：点热区进菜品页`, /packageDish\/pages\//.test(dish.route || ''), dish.route);
    await dragAt(page, touch, 120, 420, 200, 12);
    await page.waitForTimeout(900);
    const next = await state(page);
    check(`${label}：菜品页拖动切下一道`, next.route !== dish.route, `${dish.route} → ${next.route}`);
    await shot(page, `31-${label}-菜品页`);
    /* 回地图 */
    await page.evaluate(() => { const el = document.querySelector('.back-btn'); if (el) el.click(); });
    await page.waitForTimeout(900);
    check(`${label}：返回地图`, (await state(page)).route === 'pages/map/index');
  } else {
    check(`${label}：找到可点击的热区`, false);
  }

  await context.close();
}

/* ------------------------------ 回归：完整链路 + 分享卡 + 持久化 ------------------------------ */

async function regressionPass(browser) {
  const context = await browser.newContext({ viewport: { width: 900, height: 900 } });   /* 全程用鼠标 */
  const page = await context.newPage();
  watch(page, '回归');
  await page.goto(INDEX);
  await page.waitForTimeout(700);
  await shot(page, '40-入口');
  check('回归：入口页渲染', (await state(page)).route === 'pages/entry/index');

  await tapAt(page, false, 187, 500);
  await page.waitForTimeout(1300);
  check('回归：音频被解锁', await page.evaluate(() => !!window.__npAudioCtx && window.__npAudioCtx.state === 'running'));
  await shot(page, '41-封面合起');

  await dragAt(page, false, 120, 430, 380, 18);
  await page.waitForTimeout(2600);
  await shot(page, '42-地图摊开');

  /* 看整只猪 → 点一个小秘密 */
  await page.evaluate(() => { const el = document.querySelector('.view-toggle'); if (el) el.click(); });
  await page.waitForTimeout(1100);
  const secret = await visibleOf(page, '.map__secret', 8);
  if (secret) {
    await tapAt(page, false, secret.x, secret.y);
    await page.waitForTimeout(700);
    const pills = await page.evaluate(() => Array.from(document.querySelectorAll('.map__progress text')).map((x) => x.textContent));
    check('回归：小秘密计数', pills.some((t) => /小秘密\s*[1-9]/.test(t)), pills.join(' | '));
    await shot(page, '43-找到小秘密');
  }
  await page.evaluate(() => { const el = document.querySelector('.view-toggle'); if (el) el.click(); });
  await page.waitForTimeout(800);

  /* 点热区 → 菜品页 → 来历页 → 回地图 */
  const spot = await visibleOf(page, '.hotspot', 10);
  if (spot) {
    await tapAt(page, false, spot.x, spot.y);
    await page.waitForTimeout(1200);
    await shot(page, '44-菜品页');
    await page.evaluate(() => { const el = document.querySelector('.dish-page__origin'); if (el) el.click(); });
    await page.waitForTimeout(900);
    check('回归：来历页', (await state(page)).route === 'pages/origin/index');
    await shot(page, '45-来历页');
    await page.evaluate(() => { const el = document.querySelector('.origin__back'); if (el) el.click(); });
    await page.waitForTimeout(800);
    await page.evaluate(() => { const el = document.querySelector('.back-btn'); if (el) el.click(); });
    await page.waitForTimeout(900);
    check('回归：回到地图', (await state(page)).route === 'pages/map/index', `pages=${(await state(page)).pages}`);
  }

  /* 我的年猪宴 → 分享卡 → 下载 */
  await page.evaluate(() => window.wx.navigateTo({ url: '/pages/banquet/index' }));
  await page.waitForTimeout(1500);
  await shot(page, '46-我的年猪宴');
  const card = await page.evaluate(() => {
    const c = document.querySelector('canvas#card');
    if (!c) return { ok: false, why: '没有 canvas' };
    try { return { ok: true, w: c.width, h: c.height, len: c.toDataURL('image/png').length }; } catch (e) { return { ok: false, why: e.message }; }
  });
  check('回归：分享卡能导出', card.ok, card.ok ? `${card.w}×${card.h}` : card.why);
  if (card.ok) {
    const buf = Buffer.from((await page.evaluate(() => document.querySelector('canvas#card').toDataURL('image/png'))).split(',')[1], 'base64');
    fs.writeFileSync(path.join(SHOT_DIR, '47-分享卡.png'), buf);
  }
  const dl = page.waitForEvent('download', { timeout: 6000 }).catch(() => null);
  await page.evaluate(() => { const el = document.querySelector('.banquet__btn'); if (el) el.click(); });
  const download = await dl;
  check('回归：保存分享卡触发下载', !!download, download ? download.suggestedFilename() : '没有下载');

  /* 刷新后进度留存 */
  await page.reload();
  await page.waitForTimeout(900);
  await tapAt(page, false, 187, 500);
  await page.waitForTimeout(1500);
  const pills = await page.evaluate(() => Array.from(document.querySelectorAll('.map__progress text')).map((x) => x.textContent));
  check('回归：刷新后进度还在', pills.some((t) => /已上桌\s*[1-9]/.test(t)), pills.join(' | '));
  await shot(page, '48-刷新后');

  await context.close();
}

/* ------------------------------ 跑 ------------------------------ */

const browser = await chromium.launch({ executablePath: CHROME });
console.log('\n目标：' + (REMOTE_URL ? INDEX : 'file:// ' + INDEX.replace(/^file:\/\//, '')));
console.log('\n【鼠标】');
await inputPass(browser, false);
console.log('\n【触摸】');
await inputPass(browser, true);
console.log('\n【回归】');
await regressionPass(browser);
await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log('\n结果：' + (checks.length - failed.length) + ' / ' + checks.length + ' 通过');
console.log('截图目录：' + SHOT_DIR);
if (problems.length) {
  console.log('\n控制台问题（' + problems.length + '）：');
  [...new Set(problems)].slice(0, 30).forEach((p) => console.log('  ' + p));
}
if (failed.length) {
  console.log('\n未通过：');
  failed.forEach((f) => console.log('  ✗ ' + f.name + (f.detail ? '   ' + f.detail : '')));
}
if (failed.length || problems.length) process.exitCode = 1;
