const cfg = require('../../config/hotspots.js');
const fold = require('../../config/map.js');
const dishes = require('../../config/dishes.js');
const pigLayers = require('../../config/pigLayers.js');
const audio = require('../../utils/audio.js');
const track = require('../../utils/track.js');

const ART_W = cfg.ART_W;
const ART_H = cfg.ART_H;
const FOLD = fold.FOLD;

Page({
  data: {
    canvasStyle: '',
    /* 六折风琴本：每一折自己的内容（静态，只在访问状态变化时重建） */
    panels: [],
    coverStyle: '',
    paperStyle: '',
    headStyle: '',
    isOpen: false,
    glowId: '',
    tag: { show: false, name: '', part: '', style: '' },
    guideShow: false,
    muted: false,
    entered: false,
    imgFailed: false,
    fullView: false,
    layerStyle: {},
    progressText: '已上桌 0 / 6',
    secretsText: '小秘密 0 / 5',
    secretFoundCount: 0,
    secretToast: '',
    popKey: '',
    blink: false,
    patting: false,
    yawning: false,
    tongue: false,
    feast: false,
    feastBursts: [],
    showFeastBtn: false
  },

  onLoad() {
    this.navigating = false;
    this.moved = false;
    this.mode = null;
    this.lastTap = 0;
    this.vel = { x: 0, y: 0 };
    this.shownPlates = {};
    this.plateMap = {};
    this.feastPlayed = false;
    this.cameFromDish = false;
    this.pokeTimer = null;
    this.foldAnim = null;
    this.guideSeen = false;

    /* 小猪可动图层的定位与旋转轴心 */
    const layerStyle = {};
    pigLayers.layers.forEach(function (L) {
      layerStyle[L.name] = 'left:' + L.left + 'px;top:' + L.top + 'px;width:' + L.width +
        'px;height:' + L.height + 'px;transform-origin:' + L.originX + '% ' + L.originY + '%';
    });
    pigLayers.plates.forEach((function (P) {
      this.plateMap[P.id] = P;
    }).bind(this));
    this.setData({ layerStyle: layerStyle });

    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    let vw = (info && info.windowWidth) || 0;
    let vh = (info && info.windowHeight) || 0;
    if (!vw || vw < 100) vw = 375;
    if (!vh || vh < 100) vh = 667;
    this.vw = vw;
    this.vh = vh;
    this.fitHeightScale = vh / ART_H;
    /* 允许一直缩到能看见整只猪 */
    this.containScale = Math.min(vw / ART_W, vh / ART_H);
    this.minScale = this.containScale;
    this.maxScale = this.fitHeightScale * 3;
    /* 完全摊开后的机位：和小猪头部对齐（与旧版默认视野一致） */
    this.openCam = fold.openView(this.foldCtx());
    this.scale = this.openCam.scale;
    this.x = this.openCam.x;
    this.y = this.openCam.y;
    this.clamp();

    /* 冷启动是一本合起风琴本：先摆到封面那一折 */
    this.unfold = 0;
    const v0 = fold.viewAt(0, this.foldCtx());
    this.scale = v0.scale;
    this.x = v0.x;
    this.y = v0.y;
    this.stripW = v0.strip;
    this.foldDirty = true;

    this.setData({ muted: audio.isMuted() });
    this.renderPanels();
    this.apply();

    let seen = false;
    try {
      seen = !!wx.getStorageSync('np_guide');
    } catch (e) {
      seen = false;
    }
    /* 引导等书拉开之后再出现，不然和封面的「向右拉开」打架 */
    this.guideSeen = !!seen;

    track.log('map_show', {});
  },

  onReady() {
    setTimeout(() => this.setData({ entered: true }), 40);
  },

  onShow() {
    this.navigating = false;
    this.setData({
      tag: { show: false, name: '', part: '', style: '' },
      glowId: ''
    });
    const count = this.refreshPlates(true);
    this.checkFeast(count);
    this.buildSecrets();
    this.scheduleBlink();
    this.resetIdle();
    if (this.cameFromDish) {
      this.cameFromDish = false;
      setTimeout(() => this.playLick(), 520);
    }
  },

  onHide() {
    audio.stopSteam();
    if (this.raf) clearTimeout(this.raf);
    if (this.foldAnim) clearTimeout(this.foldAnim);
    clearTimeout(this.blinkTimer);
    clearTimeout(this.idleTimer);
    clearTimeout(this.lickTimer);
    clearTimeout(this.pokeTimer);
    this.cancelPat();
    this.setData({ patting: false, yawning: false, blink: false, tongue: false });
  },

  onUnload() {
    audio.stopSteam();
    clearTimeout(this.guideTimer);
    if (this.raf) clearTimeout(this.raf);
    if (this.foldAnim) clearTimeout(this.foldAnim);
    clearTimeout(this.blinkTimer);
    clearTimeout(this.idleTimer);
    clearTimeout(this.patOffTimer);
    clearTimeout(this.dropTimer);
    this.cancelPat();
  },

  getVisited() {
    try {
      const app = getApp();
      return (app && app.globalData && app.globalData.visited) || {};
    } catch (e) {
      return {};
    }
  },

  /* ----------------------------- 视图变换 ----------------------------- */

  apply() {
    const d = {
      canvasStyle:
        'width:' + ART_W + 'px;height:' + ART_H + 'px;' +
        'transform:translate3d(' + this.x.toFixed(2) + 'px,' + this.y.toFixed(2) + 'px,0) ' +
        'scale(' + this.scale.toFixed(4) + ');'
    };
    /* 折面样式只在开合变化时重算：单纯平移 / 缩放时不用重复下发 */
    if (this.foldDirty) {
      const list = this.foldStyles();
      for (let i = 0; i < list.length; i += 1) {
        /* 用路径式 setData 只改这一折的位置，不重发整棵节点数据 */
        d['panels[' + i + '].style'] = list[i];
      }
      d.coverStyle = this.coverStyleStr();
      d.paperStyle = 'width:' + fold.stripWidth(fold.growths(this.unfold)).toFixed(2) + 'px;';
      d.headStyle = this.headStyleStr();
      this.foldDirty = false;
    }
    this.setData(d);
  },

  /* --------------------------- 风琴本：开合 --------------------------- */

  foldCtx() {
    return {
      vw: this.vw,
      vh: this.vh,
      artW: ART_W,
      artH: ART_H,
      fitScale: this.fitHeightScale
    };
  },

  /* 每折的位置 / 宽度 / 折痕强度，都是几条短样式，跟着 unfold 每帧刷新 */
  foldStyles() {
    const list = fold.layout(this.unfold);
    const out = [];
    for (let i = 0; i < list.length; i += 1) {
      const p = list[i];
      out.push('left:' + p.left.toFixed(2) + 'px;width:' + p.width.toFixed(2) +
        'px;--lip:' + p.lip.toFixed(3) + ';');
    }
    return out;
  },

  coverStyleStr() {
    const u = fold.clamp01(this.unfold);
    const p = fold.clamp01(u / FOLD.coverFade);
    /* 用幂曲线让封面一拉就走，不留在画面上「糊」着 */
    return 'opacity:' + Math.pow(1 - p, 1.8).toFixed(3) + ';' +
      'transform:translate3d(' + (-u * 62).toFixed(1) + 'px,0,0);';
  },

  /* 顶上那条状态签：合着的时候让位给封面，摊开的过程中浮出来 */
  headStyleStr() {
    const u = fold.clamp01(this.unfold);
    return 'opacity:' + fold.clamp01((u - 0.42) / 0.36).toFixed(3) + ';';
  },

  /* 直接落到某个开合进度（拖动时跟手调用） */
  setFold(u) {
    this.unfold = u;
    const v = fold.viewAt(u, this.foldCtx());
    this.scale = v.scale;
    this.x = v.x;
    this.y = v.y;
    this.stripW = v.strip;
    this.foldDirty = true;
    const open = u >= 1;
    if (open !== this.data.isOpen) this.setData({ isOpen: open });
    this.apply();
  },

  /* 松手后的补间：不存在半开状态，要么摊开要么合回 */
  snapFold(target) {
    if (this.foldAnim) {
      clearTimeout(this.foldAnim);
      this.foldAnim = null;
    }
    const from = this.unfold;
    const dist = Math.abs(target - from);
    if (dist < 0.004) {
      this.setFold(target);
      this.afterFold(target);
      if (target >= 1) this.settleOpen();
      return;
    }
    const dur = FOLD.snapMs * (0.45 + 0.55 * dist);
    const start = Date.now();
    const step = () => {
      const p = Math.min(1, (Date.now() - start) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      this.setFold(from + (target - from) * e);
      if (p < 1) {
        this.foldAnim = setTimeout(step, 16);
      } else {
        this.foldAnim = null;
        this.setFold(target);
        this.afterFold(target);
        /* 书摊开了，最后把镜头推近到小猪脸上 */
        if (target >= 1) this.settleOpen();
      }
    };
    step();
  },

  /* 摊开之后的收尾镜头：整本书 → 小猪的脸 */
  settleOpen() {
    const v = this.openCam || fold.openView(this.foldCtx());
    if (Math.abs(this.scale - v.scale) < 0.004 && Math.abs(this.x - v.x) < 4) {
      this.x = v.x;
      this.y = v.y;
      this.scale = v.scale;
      this.clamp();
      this.apply();
      return;
    }
    this.tweenTo(v.x, v.y, v.scale, FOLD.settleMs);
  },

  /* 合上：先把镜头拉回「整本书摊在眼前」，再一折一折收起来 */
  closeBook() {
    if (this.navigating) return;
    if (this.foldAnim) {
      clearTimeout(this.foldAnim);
      this.foldAnim = null;
    }
    if (this.unfold < 1) {
      this.snapFold(0);
      return;
    }
    const v = fold.viewAt(1, this.foldCtx());
    if (Math.abs(this.scale - v.scale) < 0.004 && Math.abs(this.x - v.x) < 4) {
      this.snapFold(0);
      return;
    }
    this.tweenTo(v.x, v.y, v.scale, FOLD.pullBackMs, () => this.snapFold(0));
  },

  afterFold(target) {
    if (target < 1) return;
    this.scheduleBlink();
    this.resetIdle();
    if (!this.guideSeen) {
      this.guideSeen = true;
      this.setData({ guideShow: true });
      clearTimeout(this.guideTimer);
      this.guideTimer = setTimeout(() => this.hideGuide(), 3600);
    }
  },

  onFoldClose() {
    if (this.navigating || this.unfold <= 0) return;
    audio.play('transition');
    this.setData({
      tag: { show: false, name: '', part: '', style: '' },
      glowId: '',
      guideShow: false,
      fullView: false
    });
    track.log('fold_close', {});
    this.closeBook();
  },

  bounds(axis) {
    const size = axis === 'x' ? (this.stripW || ART_W) * this.scale : ART_H * this.scale;
    const limit = axis === 'x' ? this.vw : this.vh;
    if (size <= limit) {
      const c = (limit - size) / 2;
      return { min: c, max: c };
    }
    return { min: limit - size, max: 0 };
  },

  clamp() {
    const bx = this.bounds('x');
    const by = this.bounds('y');
    this.x = Math.min(bx.max, Math.max(bx.min, this.x));
    this.y = Math.min(by.max, Math.max(by.min, this.y));
  },

  rubber(value, axis) {
    const b = this.bounds(axis);
    if (value > b.max) return b.max + (value - b.max) * 0.28;
    if (value < b.min) return b.min + (value - b.min) * 0.28;
    return value;
  },

  dist(a, b) {
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  },

  /* ------------------------------- 手势 ------------------------------- */

  onTouchStart(e) {
    const ts = e.touches;
    audio.unlock();
    this.hideGuide();
    if (this.raf) {
      clearTimeout(this.raf);
      this.raf = null;
    }
    if (this.foldAnim) {
      clearTimeout(this.foldAnim);
      this.foldAnim = null;
    }
    this.vel = { x: 0, y: 0 };

    if (ts.length === 1) {
      /* 书还没摊开时，横向拖动就是「拉开」；摊开后同一个手势恢复为平移 */
      this.mode = this.unfold >= 1 ? 'pan' : 'fold';
      this.startX = ts[0].clientX;
      this.startY = ts[0].clientY;
      this.startOffset = { x: this.x, y: this.y };
      this.startU = this.unfold;
      this.prev = { x: ts[0].clientX, y: ts[0].clientY, t: Date.now() };
      this.moved = false;
      /* 长按猪头 340ms → 摸头反应 */
      this.cancelPat();
      if (this.mode === 'pan' && this.hitHead(ts[0].clientX, ts[0].clientY)) {
        this.patTimer = setTimeout(() => this.startPat(), 340);
      }
    } else if (ts.length > 1) {
      /* 合着的书不缩放 */
      if (this.unfold < 1) {
        this.mode = null;
        return;
      }
      this.mode = 'pinch';
      this.moved = true;
      this.cancelPat();
      this.startDist = this.dist(ts[0], ts[1]);
      this.startScale = this.scale;
      this.startOffset = { x: this.x, y: this.y };
      this.center = {
        x: (ts[0].clientX + ts[1].clientX) / 2,
        y: (ts[0].clientY + ts[1].clientY) / 2
      };
    }
  },

  onTouchMove(e) {
    const ts = e.touches;

    /* 拉开 / 合回：横向拖动直接驱动 unfold */
    if (this.mode === 'fold' && ts.length === 1) {
      const dx = ts[0].clientX - this.startX;
      if (Math.abs(dx) > 6) this.moved = true;

      const now = Date.now();
      const dt = Math.max(1, now - this.prev.t);
      this.vel = {
        x: (ts[0].clientX - this.prev.x) / dt,
        y: 0
      };
      this.prev = { x: ts[0].clientX, y: ts[0].clientY, t: now };

      let next = this.startU + dx / FOLD.dragFull;
      /* 拉到底 / 推到底再用力：给一点橡皮筋，松手会吸回去 */
      if (next > 1) next = 1 + (next - 1) * 0.24;
      if (next < 0) next = next * 0.24;
      this.setFold(next);
      return;
    }

    if (this.mode === 'pan' && ts.length === 1) {
      const dx = ts[0].clientX - this.startX;
      const dy = ts[0].clientY - this.startY;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        this.moved = true;
        this.cancelPat();
      }

      const now = Date.now();
      const dt = Math.max(1, now - this.prev.t);
      this.vel = {
        x: (ts[0].clientX - this.prev.x) / dt,
        y: (ts[0].clientY - this.prev.y) / dt
      };
      this.prev = { x: ts[0].clientX, y: ts[0].clientY, t: now };

      this.x = this.rubber(this.startOffset.x + dx, 'x');
      this.y = this.rubber(this.startOffset.y + dy, 'y');
      this.apply();
      return;
    }

    if (this.mode === 'pinch' && ts.length > 1) {
      const ratio = this.dist(ts[0], ts[1]) / (this.startDist || 1);
      let next = Math.min(this.maxScale, this.startScale * ratio);
      /* 缩到最小之后继续内收：橡皮筋式再压一点，松手超过阈值就自动合起 */
      if (next < this.minScale) {
        const floor = this.minScale * (1 - FOLD.foldOvershoot);
        next = this.minScale + (next - this.minScale) * 0.7;
        if (next < floor) next = floor;
      }
      const k = next / this.startScale;
      this.x = this.center.x - (this.center.x - this.startOffset.x) * k;
      this.y = this.center.y - (this.center.y - this.startOffset.y) * k;
      this.scale = next;
      this.clamp();
      this.apply();
    }
  },

  onTouchEnd(e) {
    const ended = (e && e.changedTouches && e.changedTouches[0]) || null;
    const left = e && e.touches ? e.touches.length : 0;

    this.cancelPat();

    if (left > 0) return;

    const wasPinch = this.mode === 'pinch';
    const wasFold = this.mode === 'fold';
    this.mode = null;

    /* 拉开 / 合回：松手判定，只有摊开与合起两种归宿 */
    if (wasFold) {
      let target = this.unfold > FOLD.snapOpen ? 1 : 0;
      if (this.vel.x > FOLD.snapVelocity) target = 1;
      else if (this.vel.x < -FOLD.snapVelocity) target = 0;
      /* 只点了一下没拖：当成「拉开」，不用非得拖够距离 */
      if (!this.moved) {
        audio.play('transition');
        track.log('fold_tap_open', { from: Number(this.unfold.toFixed(2)) });
        this.snapFold(1);
        return;
      }
      if (Math.abs(this.unfold - target) > 0.02) {
        audio.play(target >= 1 ? 'transition' : 'back_bell');
      }
      track.log('fold_snap', { open: target === 1, from: Number(this.unfold.toFixed(2)) });
      this.snapFold(target);
      return;
    }

    this.clamp();
    this.apply();

    if (wasPinch) {
      this.vel = { x: 0, y: 0 };
      /* 缩到最小还继续内收 → 自动合起；否则弹回最小比例 */
      if (this.scale < this.minScale * (1 - FOLD.foldOvershoot * 0.8)) {
        audio.play('back_bell');
        track.log('fold_auto_close', {});
        this.setData({ fullView: false });
        this.closeBook();
        return;
      }
      if (this.scale < this.minScale) {
        this.tweenTo(this.boundsAt('x', this.minScale).min,
          this.boundsAt('y', this.minScale).min, this.minScale, 320);
      }
      this.syncFullFlag();
      return;
    }

    this.inertia();

    if (this.moved || !ended) return;

    const now = Date.now();
    if (now - this.lastTap < 300) {
      this.doubleTap(ended.clientX, ended.clientY);
      this.lastTap = 0;
    } else {
      this.lastTap = now;
      this.tapX = ended.clientX;
      this.tapY = ended.clientY;
    }
  },

  /* 手动缩放后同步「整只猪」按钮状态 */
  syncFullFlag() {
    const isFull = this.scale <= this.containScale * 1.03;
    if (isFull !== this.data.fullView) {
      this.setData({ fullView: isFull });
    }
  },

  inertia() {
    let vx = this.vel.x * 16;
    let vy = this.vel.y * 16;
    if (Math.abs(vx) < 0.35 && Math.abs(vy) < 0.35) return;

    const step = () => {
      vx *= 0.94;
      vy *= 0.94;
      const bx = this.bounds('x');
      const by = this.bounds('y');
      let nx = this.x + vx;
      let ny = this.y + vy;
      if (nx > bx.max) {
        nx = bx.max;
        vx = 0;
      } else if (nx < bx.min) {
        nx = bx.min;
        vx = 0;
      }
      if (ny > by.max) {
        ny = by.max;
        vy = 0;
      } else if (ny < by.min) {
        ny = by.min;
        vy = 0;
      }
      this.x = nx;
      this.y = ny;
      this.apply();
      if (Math.abs(vx) > 0.3 || Math.abs(vy) > 0.3) {
        this.raf = setTimeout(step, 16);
      } else {
        this.raf = null;
      }
    };
    step();
  },

  doubleTap(px, py) {
    if (this.unfold < 1) return;
    const zoomed = this.scale > this.minScale * 1.5;
    const target = zoomed
      ? this.minScale
      : Math.min(this.maxScale, this.minScale * 2);
    const k = target / this.scale;
    this.x = px - (px - this.x) * k;
    this.y = py - (py - this.y) * k;
    this.scale = target;
    this.clamp();
    this.apply();
    audio.play('hotspot_ding');
    track.log('map_double_tap', { zoom: target === this.minScale ? 1 : 2 });
  },

  /* ------------------------------- 热区 ------------------------------- */

  onHotspotTap(e) {
    if (this.moved || this.navigating) return;
    /* 书还没完全摊开：折在里面的热区点不到 */
    if (this.unfold < 1) return;
    const panelIdx = Number(e.currentTarget.dataset.panel || 0);
    if (fold.growth(this.unfold, panelIdx) < 1) return;
    /* 刚摸过猪头：这次抬手不算点击，避免摸完就跳走 */
    if (this.patAt && Date.now() - this.patAt < 900) return;
    const id = e.currentTarget.dataset.id;
    let target = null;
    for (let i = 0; i < cfg.HOTSPOTS.length; i += 1) {
      if (cfg.HOTSPOTS[i].id === id) target = cfg.HOTSPOTS[i];
    }
    if (!target) return;

    this.navigating = true;
    audio.play('hotspot_ding');
    /* 不再震动：type:'light' 在部分安卓机上会被忽略、退化成强震动 */

    const sx = this.x + target.cx * ART_W * this.scale;
    const sy = this.y + target.cy * ART_H * this.scale;

    this.setData({
      glowId: id,
      tag: {
        show: true,
        name: target.name,
        part: target.part,
        style: 'left:' + sx.toFixed(1) + 'px;top:' + sy.toFixed(1) + 'px;'
      }
    });

    track.log('hotspot_click', { hotspot: id, dish: target.dishId, part: target.part });

    setTimeout(() => {
      audio.play('transition');
      this.cameFromDish = true;
      wx.navigateTo({
        url: dishes.pagePath(target.dishId),
        fail: () => {
          this.navigating = false;
          this.setData({ tag: { show: false, name: '', part: '', style: '' }, glowId: '' });
        }
      });
    }, 380);
  },

  onToggleMute() {
    const muted = audio.toggle();
    this.setData({ muted: muted });
    if (!muted) {
      audio.play('hotspot_ding');
    }
    track.log('mute_toggle', { muted: muted });
  },

  /* --------------------- 图片加载状态（便于定位问题） --------------------- */

  onImgLoad(e) {
    const d = e && e.detail ? e.detail : {};
    console.log('[map] 年猪长地图加载成功 ' + d.width + 'x' + d.height);
    if (this.data.imgFailed) this.setData({ imgFailed: false });
  },

  onImgError(e) {
    console.error('[map] 年猪长地图加载失败', e && e.detail);
    this.setData({ imgFailed: true });
    track.log('map_img_error', {});
  },

  onRetryImg() {
    this.setData({ imgFailed: false });
  },

  /* --------------------------- 整只猪 / 看细节 --------------------------- */

  onToggleFullView() {
    if (this.data.fullView) {
      this.goDetailView();
    } else {
      this.goFullView();
    }
  },

  goFullView() {
    this.savedView = { x: this.x, y: this.y, scale: this.scale };
    const bx = this.boundsAt('x', this.containScale);
    const by = this.boundsAt('y', this.containScale);
    this.tweenTo(bx.min, by.min, this.containScale, 520);
    this.setData({ fullView: true });
    audio.play('hotspot_ding');
    track.log('map_full_view', {});
  },

  goDetailView() {
    const v = this.savedView;
    this.setData({ fullView: false });
    audio.play('hotspot_ding');
    if (v) {
      this.tweenTo(v.x, v.y, v.scale, 520);
    } else {
      const bx = this.boundsAt('x', this.fitHeightScale);
      const by = this.boundsAt('y', this.fitHeightScale);
      this.tweenTo(bx.min, by.min, this.fitHeightScale, 520);
    }
  },

  /* 以目标缩放推算画布边界（scale 可指定） */
  boundsAt(axis, scale) {
    const size = axis === 'x' ? ART_W * scale : ART_H * scale;
    const limit = axis === 'x' ? this.vw : this.vh;
    if (size <= limit) {
      const c = (limit - size) / 2;
      return { min: c, max: c };
    }
    return { min: limit - size, max: 0 };
  },

  tweenTo(tx, ty, tscale, duration, done) {
    if (this.raf) {
      clearTimeout(this.raf);
      this.raf = null;
    }
    const sx = this.x;
    const sy = this.y;
    const ss = this.scale;
    const start = Date.now();
    const step = () => {
      const p = Math.min(1, (Date.now() - start) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      this.scale = ss + (tscale - ss) * e;
      this.x = sx + (tx - sx) * e;
      this.y = sy + (ty - sy) * e;
      this.apply();
      if (p < 1) {
        this.raf = setTimeout(step, 16);
      } else {
        this.raf = null;
        this.clamp();
        this.apply();
        if (done) done();
      }
    };
    step();
  },

  hideGuide() {
    if (!this.data.guideShow) return;
    clearTimeout(this.guideTimer);
    this.setData({ guideShow: false });
    try {
      wx.setStorageSync('np_guide', 1);
    } catch (e) {
      /* ignore */
    }
    track.log('guide_dismiss', {});
  },

  /* ------------------------- 宴席进度：菜落桌 ------------------------- */

  /* 六折里的内容归位（分折逻辑在 config/map.js，和预览脚本共用一份） */
  renderPanels() {
    const panels = fold.buildPanels({
      visited: this.getVisited(),
      plates: this.plateIds || [],
      fresh: this.freshPlates || {},
      secrets: this.getSecrets()
    });
    /* 重建内容时把当前的折面样式补回去，免得折面跳回原位 */
    const styles = this.foldStyles();
    for (let i = 0; i < panels.length && i < styles.length; i += 1) {
      panels[i].style = styles[i];
    }
    this.setData({ panels: panels });
  },

  refreshPlates(animate) {
    const visited = this.getVisited();
    const ids = dishes.ORDER.filter(function (id) {
      return !!visited[id];
    });
    let freshId = '';

    for (let i = 0; i < ids.length; i += 1) {
      if (animate && !this.shownPlates[ids[i]]) freshId = ids[i];
      this.shownPlates[ids[i]] = true;
    }

    this.plateIds = ids;
    this.freshPlates = {};
    if (freshId) this.freshPlates[freshId] = true;

    this.setData({ progressText: '已上桌 ' + ids.length + ' / 6' });
    this.renderPanels();

    if (freshId) {
      audio.play('plate_drop');
      clearTimeout(this.dropTimer);
      this.dropTimer = setTimeout(() => {
        this.freshPlates = {};
        this.renderPanels();
      }, 720);
    }
    return ids.length;
  },

  /* ---------------------------- 小猪活着 ---------------------------- */

  scheduleBlink() {
    clearTimeout(this.blinkTimer);
    this.blinkTimer = setTimeout(() => {
      if (!this.data.patting && !this.data.yawning && !this.data.feast) {
        this.setData({ blink: true });
        setTimeout(() => this.setData({ blink: false }), 130);
      }
      this.scheduleBlink();
    }, 3200 + Math.random() * 5200);
  },

  resetIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.playYawn(), 22000);
  },

  playYawn() {
    if (this.data.patting || this.data.feast || this.data.yawning) {
      this.resetIdle();
      return;
    }
    this.setData({ yawning: true, blink: true });
    audio.play('pig_yawn');
    track.log('pig_yawn', {});
    setTimeout(() => {
      this.setData({ yawning: false, blink: false });
    }, 2000);
    this.resetIdle();
  },

  hitHead(x, y) {
    const hs = cfg.HOTSPOTS[0];
    const artX = (x - this.x) / this.scale;
    const artY = (y - this.y) / this.scale;
    const dx = artX - hs.cx * ART_W;
    const dy = artY - hs.cy * ART_H;
    return Math.sqrt(dx * dx + dy * dy) <= hs.r * ART_W;
  },

  cancelPat() {
    if (this.patTimer) {
      clearTimeout(this.patTimer);
      this.patTimer = null;
    }
  },

  startPat() {
    this.patTimer = null;
    if (this.data.patting || this.data.feast) return;
    this.patAt = Date.now();
    this.setData({ patting: true, yawning: false, blink: false });
    audio.play('pig_pat');
    this.resetIdle();
    track.log('pig_pat', {});
    clearTimeout(this.patOffTimer);
    this.patOffTimer = setTimeout(() => {
      this.setData({ patting: false });
    }, 1700);
  },

  /* ---------------------------- 开席高潮 ---------------------------- */

  checkFeast(count) {
    if (count < 6) return;
    if (!this.data.showFeastBtn) this.setData({ showFeastBtn: true });
    let seen = false;
    try {
      seen = !!wx.getStorageSync('np_feast');
    } catch (e) {
      seen = false;
    }
    if (!seen && !this.feastPlayed) this.playFeast();
  },

  playFeast() {
    this.feastPlayed = true;
    const bursts = [];
    for (let i = 0; i < 5; i += 1) {
      const size = 260 + Math.random() * 220;
      bursts.push('left:' + (6 + Math.random() * 74).toFixed(1) + '%;top:' +
        (8 + Math.random() * 46).toFixed(1) + '%;width:' + size.toFixed(0) +
        'px;height:' + size.toFixed(0) + 'px;animation-delay:' + (i * 0.22).toFixed(2) + 's');
    }
    this.setData({
      feast: true,
      feastBursts: bursts,
      patting: false,
      yawning: false,
      blink: false,
      showFeastBtn: true
    });
    audio.play('feast');
    track.log('feast_play', {});
    try {
      wx.setStorageSync('np_feast', 1);
    } catch (e) {
      /* ignore */
    }
    setTimeout(() => this.setData({ feast: false }), 3000);
  },

  goBanquet() {
    audio.play('transition');
    wx.navigateTo({ url: '/pages/banquet/index' });
  },

  /* --------------------------- 藏在画面里的秘密 --------------------------- */

  getSecrets() {
    try {
      return wx.getStorageSync('np_secrets') || {};
    } catch (e) {
      return {};
    }
  },

  saveSecrets(found) {
    try {
      wx.setStorageSync('np_secrets', found);
    } catch (e) {
      /* ignore */
    }
  },

  buildSecrets() {
    const found = this.getSecrets();
    const count = Object.keys(found).length;
    this.setData({
      secretFoundCount: count,
      secretsText: '小秘密 ' + count + ' / ' + pigLayers.secrets.length
    });
    this.renderPanels();
  },

  onSecretTap(e) {
    if (this.unfold < 1) return;
    const key = e.currentTarget.dataset.key;
    let name = '';
    for (let i = 0; i < pigLayers.secrets.length; i += 1) {
      if (pigLayers.secrets[i].key === key) name = pigLayers.secrets[i].name;
    }

    const found = this.getSecrets();
    const isNew = !found[key];
    if (isNew) {
      found[key] = 1;
      this.saveSecrets(found);
    }

    audio.play('secret_' + key);

    /* 被戳到的小家伙蹦一下 */
    clearTimeout(this.pokeTimer);
    this.setData({ popKey: key });
    this.pokeTimer = setTimeout(() => this.setData({ popKey: '' }), 900);

    if (isNew) {
      const count = Object.keys(found).length;
      const total = pigLayers.secrets.length;
      this.showSecretToast('发现 ' + count + ' / ' + total + ' · ' + name);
      track.log('secret_found', { key: key, count: count });
      if (count >= total) {
        setTimeout(() => this.showSecretToast('五个小秘密都找到了！'), 2600);
      }
      this.buildSecrets();
    }
  },

  showSecretToast(text) {
    this.setData({ secretToast: text });
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.setData({ secretToast: '' }), 2200);
  },

  /* 点「小秘密」签子：给一条文字线索，按顺序提示还没找到的 */
  onSecretPillTap() {
    const found = this.getSecrets();
    const total = pigLayers.secrets.length;
    const left = pigLayers.secrets.filter(function (s) {
      return !found[s.key];
    });
    if (!left.length) {
      this.showSecretToast('五个小家伙都找到了！');
      return;
    }
    let pick = left[0];
    if (left.length > 1) {
      pick = left[Math.floor(Math.random() * left.length)];
    }
    this.showSecretToast(pick.hint);
    track.log('secret_hint', { key: pick.key, left: left.length, total: total });
  },

  /* ------------------------- 小猪被馋到：舔一下嘴 ------------------------- */

  playLick() {
    if (this.data.patting || this.data.yawning || this.data.feast) return;
    this.setData({ tongue: true, blink: false });
    audio.play('pig_lick');
    clearTimeout(this.lickTimer);
    this.lickTimer = setTimeout(() => this.setData({ tongue: false }), 900);
    track.log('pig_lick', {});
  }
});
