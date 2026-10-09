/**
 * 年猪宴 · 小程序运行时（H5）
 *
 * 让微信小程序的 WXML / WXSS / JS 直接跑在浏览器里，只做四件事：
 *   1. 模块系统：require() 按小程序规则解析（相对当前文件、/ 开头为工程根）
 *   2. WXML 编译：标签 + wx:if / wx:for / wx:key / {{}} / 绑定事件
 *   3. WXSS 换算：Nrpx → (N/2)px（375 宽基准），内联 style 里的 rpx 同样换算
 *   4. wx 接口适配：路由、存储、音频、选择器、canvas 导出、保存图片
 *
 * 工程源码一个字节都不用改：本文件是唯一的"新逻辑"。
 * 依赖 window.NP_DEFS（由 _build/build.mjs 生成的 app/bundle.js 提供）。
 */
(function () {
  'use strict';

  const DEFS = window.NP_DEFS || { modules: {}, wxml: {}, wxss: {}, json: {}, dataURI: {}, manifest: {} };
  const APP_ROOT = (window.NP_APP_ROOT || 'app/').replace(/\/+$/, '') + '/';
  const BASE_W = 375;                       /* rpx 的基准宽度 */
  const BASE_H = 812;                       /* 设计稿高度 */
  const STORAGE_PREFIX = 'np_h5_';

  /* ============================ 1. 小工具 ============================ */

  function norm(p) {
    const out = [];
    String(p).split('/').forEach((seg) => {
      if (!seg || seg === '.') return;
      if (seg === '..') out.pop();
      else out.push(seg);
    });
    return out.join('/');
  }
  const dirOf = (p) => {
    const i = p.lastIndexOf('/');
    return i < 0 ? '' : p.slice(0, i);
  };
  function resolvePath(fromDir, request) {
    return request.charAt(0) === '/' ? norm(request) : norm(fromDir + '/' + request);
  }
  /* WXSS / 内联样式里的 rpx 换算：只认 CSS 值上下文，避开 base64 里偶然出现的 "rpx" */
  function fixRpx(css) {
    return String(css).replace(/(^|[:\s,(])(-?\d*\.?\d+)rpx\b/g, (m, pre, num) => pre + (parseFloat(num) / 2) + 'px');
  }
  /* 资源路径：/ 开头 = 工程根；否则相对当前文件；命中内联表就用 data URI（canvas 导出要用） */
  function assetURL(raw, fromDir) {
    if (raw == null || raw === '') return raw;
    const s = String(raw);
    if (/^(data:|https?:|blob:)/.test(s)) return s;
    const key = s.charAt(0) === '/' ? norm(s) : norm((fromDir || '') + '/' + s);
    return DEFS.dataURI[key] || APP_ROOT + key;
  }

  /* ============================ 2. 模块系统 ============================ */

  const moduleCache = Object.create(null);

  function requirePath(path) {
    const p = norm(path).replace(/\.js$/, '');
    if (p in moduleCache) return moduleCache[p].exports;
    const factory = DEFS.modules[p];
    if (!factory) throw new Error('[np] 找不到模块 ' + p);
    const module = { exports: {} };
    moduleCache[p] = module;
    factory(module, module.exports, makeRequire(dirOf(p)));
    return module.exports;
  }
  function makeRequire(fromDir) {
    return function (request) { return requirePath(resolvePath(fromDir, request)); };
  }

  /* ============================ 3. 样式注入 ============================ */

  const styleCache = Object.create(null);
  function injectWXSS(name) {
    if (styleCache[name]) return;
    styleCache[name] = true;
    const src = DEFS.wxss[name];
    if (!src) return;
    const tag = document.createElement('style');
    tag.setAttribute('data-np-style', name);
    tag.textContent = fixRpx(src);
    document.head.appendChild(tag);
  }

  /* ============================ 4. WXML 编译 ============================ */

  const exprCache = new Map();
  function evalExpr(expr, scope) {
    let fn = exprCache.get(expr);
    if (!fn) {
      try {
        /* 非严格模式下 with 才可用；作用域链让 {{item.x}} 与 {{x}} 同时成立 */
        fn = new Function('$s', 'with($s){ return (' + expr + '); }');
      } catch (e) {
        fn = function () { return ''; };
      }
      exprCache.set(expr, fn);
    }
    try { return fn(scope); } catch (e) { return ''; }
  }

  /* 把属性值拆成字符串片段与表达式片段 */
  function parseParts(raw) {
    const parts = [];
    const re = /\{\{([\s\S]+?)\}\}/g;
    let last = 0;
    let m;
    while ((m = re.exec(raw))) {
      if (m.index > last) parts.push({ str: raw.slice(last, m.index) });
      parts.push({ expr: m[1] });
      last = m.index + m[0].length;
    }
    if (last < raw.length) parts.push({ str: raw.slice(last) });
    return parts;
  }
  function isSingleExpr(raw) {
    const m = /^\s*\{\{([\s\S]+)\}\}\s*$/.exec(raw);
    return m ? m[1] : null;
  }
  function evalParts(parts, scope) {
    if (parts.length === 1) {
      if (parts[0].str !== undefined) return parts[0].str;
      return evalExpr(parts[0].expr, scope);
    }
    return parts.map((p) => (p.str !== undefined ? p.str : String(evalExpr(p.expr, scope)))).join('');
  }

  const EVENT_MAP = {
    tap: 'click',
    longtap: 'contextmenu',
    longpress: 'pointerdown',
    touchstart: 'touchstart',
    touchmove: 'touchmove',
    touchend: 'touchend',
    touchcancel: 'touchcancel'
  };

  /* --------------------------- 指针 → 触摸桥接 ---------------------------
     小程序页面只绑 bindtouchstart / bindtouchmove / bindtouchend，
     桌面浏览器不会因为鼠标产生触摸事件，所以要在这里把鼠标（以及手写笔、
     真触摸）统一成小程序形状的 touch 事件。
     坐标一律换算到"设备逻辑坐标"（375×812 那套），因为页面内部用的是
     (x - this.x) / this.scale 这种本地坐标，桌面窗口居中带来的偏移会让
     摸头判定、双击缩放锚点整体偏掉。 */

  const activePointers = new Map();   /* pointerId -> { id, x, y, moved, captured } */
  let pointerMovedPx = 0;             /* 本次手势的最大位移（逻辑像素） */
  let swallowNextClick = false;       /* 拖拽之后吞掉浏览器的尾随 click */
  let swallowTimer = 0;

  function deviceRect() {
    const d = document.getElementById('np-device');
    return d ? d.getBoundingClientRect() : { left: 0, top: 0 };
  }
  function toLogical(clientX, clientY) {
    const r = deviceRect();
    const s = deviceScale || 1;
    const x = (clientX - r.left) / s;
    const y = (clientY - r.top) / s;
    return { x, y };
  }
  function touchPoint(rec) {
    return {
      identifier: rec.id,
      clientX: rec.x,
      clientY: rec.y,
      pageX: rec.x,
      pageY: rec.y,
      force: rec.force || 1
    };
  }
  function makeGestureEvent(type, changed, currentEl, nativeEvent) {
    const target = {
      id: currentEl.id || '',
      dataset: currentEl.__npDataset || {},
      offsetLeft: currentEl.offsetLeft,
      offsetTop: currentEl.offsetTop
    };
    const touches = [];
    activePointers.forEach((rec) => touches.push(touchPoint(rec)));
    return {
      type,
      timeStamp: Date.now(),
      detail: {},
      target,
      currentTarget: target,
      touches,
      changedTouches: changed ? [touchPoint(changed)] : [],
      preventDefault() { if (nativeEvent.cancelable) nativeEvent.preventDefault(); },
      stopPropagation() { nativeEvent.stopPropagation(); }
    };
  }
  function fireTouch(inst, name, evt) {
    const handler = inst && inst[name];
    if (typeof handler === 'function') handler.call(inst, evt);
  }
  /* 事件挂在谁身上就交给谁处理：元素上没有就从祖先里找最近的实例 */
  function instanceOfNode(node, fallback) {
    let cur = node;
    while (cur) {
      if (cur.__np) return cur.__np;
      cur = cur.parentNode;
    }
    return fallback;
  }
  const TOUCH_TYPES = { touchstart: 1, touchmove: 1, touchend: 1, touchcancel: 1 };

  /**
   * 一个元素只挂一套指针监听（specs = { touchstart, touchmove, touchend, touchcancel }），
   * 每个事件只在页面绑了对应 handler 时才派发；同时始终维护活动指针表，
   * 因为"拖拽后吞掉 click"和坐标换算都依赖它。
   */
  function bindGesture(el, specs, ctx) {
    const instanceOf = (node) => instanceOfNode(node, ctx && ctx.instance);
    const fire = (type, rec, nativeEvent) => {
      const spec = specs[type];
      if (!spec) return;
      fireTouch(instanceOf(el), spec.handler, makeGestureEvent(type, rec, el, nativeEvent));
    };

    /* 老浏览器没有 PointerEvent：退回原生触摸事件（此时坐标已经是页面本地坐标） */
    if (!window.PointerEvent) {
      Object.keys(specs).forEach((domType) => {
        const spec = specs[domType];
        el.addEventListener(domType, (nativeEvent) => {
          if (spec.stop) nativeEvent.stopPropagation();
          if (spec.stop && domType === 'touchmove' && nativeEvent.cancelable) nativeEvent.preventDefault();
          fireTouch(instanceOf(el), spec.handler, makeEvent(nativeEvent, el));
        }, { passive: !(domType === 'touchmove' || domType === 'touchstart') });
      });
      return;
    }

    el.addEventListener('pointerdown', (nativeEvent) => {
      if (nativeEvent.pointerType === 'mouse' && nativeEvent.button !== 0) return;
      const p = toLogical(nativeEvent.clientX, nativeEvent.clientY);
      const rec = {
        id: nativeEvent.pointerId,
        x: p.x,
        y: p.y,
        startX: p.x,
        startY: p.y,
        moved: 0,
        captured: false
      };
      activePointers.set(nativeEvent.pointerId, rec);
      pointerMovedPx = 0;
      swallowNextClick = false;
      if (specs.touchstart && specs.touchstart.stop) nativeEvent.stopPropagation();
      fire('touchstart', rec, nativeEvent);
    }, { passive: false });

    el.addEventListener('pointermove', (nativeEvent) => {
      const rec = activePointers.get(nativeEvent.pointerId);
      if (!rec) return;
      /* 浏览器会把一帧内的多个位置合并成一个事件。合成触摸时要逐个还原，
         否则一次拖动只会拿到一两个点，页面上的拖动会"跳"。 */
      let samples = null;
      if (typeof nativeEvent.getCoalescedEvents === 'function') {
        try { samples = nativeEvent.getCoalescedEvents(); } catch (e) { samples = null; }
      }
      if (!samples || !samples.length) samples = [nativeEvent];

      for (let i = 0; i < samples.length; i += 1) {
        const src = samples[i];
        const p = toLogical(src.clientX, src.clientY);
        rec.x = p.x;
        rec.y = p.y;
        rec.moved = Math.max(rec.moved, Math.hypot(p.x - rec.startX, p.y - rec.startY));
        pointerMovedPx = Math.max(pointerMovedPx, rec.moved);
        /* 真的拖起来了才捕获指针：这样拖出元素仍收得到 move，
           而纯点击不捕获，浏览器才会把 click 派发到原元素上（热区靠它） */
        if (!rec.captured && rec.moved > 4) {
          try { el.setPointerCapture(nativeEvent.pointerId); rec.captured = true; } catch (e) {}
        }
        if (specs.touchmove && specs.touchmove.stop && nativeEvent.cancelable) nativeEvent.preventDefault();
        fire('touchmove', rec, nativeEvent);
      }
    }, { passive: false });

    const finish = (type) => (nativeEvent) => {
      const rec = activePointers.get(nativeEvent.pointerId);
      if (!rec) return;
      const p = toLogical(nativeEvent.clientX, nativeEvent.clientY);
      rec.x = p.x;
      rec.y = p.y;
      rec.moved = Math.max(rec.moved, Math.hypot(p.x - rec.startX, p.y - rec.startY));
      pointerMovedPx = Math.max(pointerMovedPx, rec.moved);
      activePointers.delete(nativeEvent.pointerId);
      if (rec.captured) {
        try { el.releasePointerCapture(nativeEvent.pointerId); } catch (e) {}
      }
      if (rec.moved > 10) swallowNextClick = true;
      /* 一次拖拽最多吃掉紧随其后的那一下 click；浏览器有时不发这一下，
         所以超时就自动失效，免得把后面的正常点击一起吃掉 */
      if (swallowNextClick) {
        clearTimeout(swallowTimer);
        swallowTimer = setTimeout(() => { swallowNextClick = false; }, 350);
      }
      fire(type, rec, nativeEvent);
    };
    el.addEventListener('pointerup', finish('touchend'));
    el.addEventListener('pointercancel', finish('touchcancel'));
  }

  function attrOf(el, name) {
    const a = el.attributes.getNamedItem(name);
    return a ? a.value : undefined;
  }

  function compileWXML(src, ownerDir, ctx) {
    const doc = new DOMParser().parseFromString('<np-root>' + src + '</np-root>', 'text/html');
    const root = doc.body.querySelector('np-root') || doc.body;
    return compileChildren(root, ownerDir, ctx);
  }

  function compileChildren(parent, ownerDir, ctx) {
    const out = [];
    Array.prototype.forEach.call(parent.childNodes, (child) => {
      if (child.nodeType === 3) {
        if (!child.nodeValue.trim()) return;
        out.push({ kind: 'text', parts: parseParts(child.nodeValue) });
      } else if (child.nodeType === 1) {
        const node = compileElement(child, ownerDir, ctx);
        if (node) out.push(node);
      }
    });
    return out;
  }

  function compileElement(el, ownerDir, ctx) {
    const tag = el.tagName.toLowerCase();
    const forRaw = attrOf(el, 'wx:for');
    const ifRaw = attrOf(el, 'wx:if');

    let node = compilePlain(el, tag, ownerDir, ctx);

    if (ifRaw !== undefined) {
      node = { kind: 'if', expr: isSingleExpr(ifRaw) || ifRaw, branch: node };
    }
    if (forRaw !== undefined) {
      node = {
        kind: 'for',
        listExpr: isSingleExpr(forRaw) || forRaw,
        itemName: attrOf(el, 'wx:for-item') || 'item',
        indexName: attrOf(el, 'wx:for-index') || 'index',
        keyName: attrOf(el, 'wx:key'),
        template: node
      };
    }
    return node;
  }

  function compilePlain(el, tag, ownerDir, ctx) {
    const componentPath = ctx && ctx.usingComponents ? ctx.usingComponents[tag] : null;
    if (componentPath) {
      const props = [];
      Array.prototype.forEach.call(el.attributes, (a) => {
        if (a.name.indexOf('wx:') === 0 || a.name === 'class' || a.name === 'style' || a.name === 'id') return;
        props.push({ domName: a.name, name: camel(a.name), parts: parseParts(a.value) });
      });
      return { kind: 'el', tag, isComponent: true, componentPath, propBindings: props, children: [] };
    }

    const isImage = tag === 'img' || tag === 'image';
    const bindings = [];
    const dataset = [];
    const events = [];
    Array.prototype.forEach.call(el.attributes, (a) => {
      const name = a.name;
      if (name.indexOf('wx:') === 0) return;
      if (name === 'mode' && isImage) { bindings.push({ name: '__mode', parts: parseParts(a.value) }); return; }
      const ev = /^(bind|catch):?([a-zA-Z]+)$/.exec(name);
      if (ev) {
        const handler = a.value.trim();
        if (!handler) return;
        events.push({ dom: EVENT_MAP[ev[2]] || ev[2], handler, stop: ev[1] === 'catch' });
        return;
      }
      if (name.indexOf('data-') === 0) {
        dataset.push({ key: camel(name.slice(5)), parts: parseParts(a.value) });
        /* 同时也当成真实属性写进 DOM：小程序里 data-* 本来就在节点上，
           这样调试和 querySelector('[data-id=...]') 都能用 */
        bindings.push({ name, parts: parseParts(a.value) });
        return;
      }
      if (name === 'id') { bindings.push({ name: 'id', parts: parseParts(a.value) }); return; }
      bindings.push({ name, parts: parseParts(a.value) });
    });

    return {
      kind: 'el',
      tag,
      isImage,
      bindings,
      dataset,
      events,
      children: compileChildren(el, ownerDir, ctx)
    };
  }

  function camel(s) {
    return String(s).replace(/-([a-z0-9])/g, (m, c) => c.toUpperCase());
  }

  const MODE_FIT = {
    scaleToFill: 'fill',
    aspectFit: 'contain',
    aspectFill: 'cover',
    widthFix: 'contain',
    top: 'contain',
    bottom: 'contain',
    left: 'contain',
    right: 'contain',
    center: 'contain'
  };

  /* ============================ 5. 渲染实例 ============================ */

  /* 生成一个 node 的 DOM，并返回 refresh(scope) 用来在 setData 后定点更新 */
  function instantiate(node, scope, ctx) {
    if (node.kind === 'text') {
      const dom = document.createTextNode('');
      const refresh = (s) => {
        const v = evalParts(node.parts, s);
        const text = v == null ? '' : String(v);
        if (dom.nodeValue !== text) dom.nodeValue = text;
      };
      refresh(scope);
      return { el: dom, refresh };
    }

    if (node.kind === 'if') {
      const anchor = document.createComment('np-if');
      let inner = null;
      const refresh = (s) => {
        const show = !!evalExpr(node.expr, s);
        if (show) {
          if (!inner) inner = instantiate(node.branch, s, ctx);
          const parent = anchor.parentNode;
          /* 首次渲染时锚点还没进 DOM，所以按"有没有插进当前父级"判断，而不是"有没有创建过" */
          if (parent && inner.el.parentNode !== parent) parent.insertBefore(inner.el, anchor);
          inner.refresh(s);
        } else if (inner) {
          if (inner.el.parentNode) inner.el.parentNode.removeChild(inner.el);
          inner = null;
        }
      };
      refresh(scope);
      return { el: anchor, refresh };
    }

    if (node.kind === 'for') {
      const anchor = document.createComment('np-for');
      let entries = [];
      const refresh = (s) => {
        const list = evalExpr(node.listExpr, s);
        const arr = Array.isArray(list) ? list : [];
        const used = new Array(entries.length).fill(false);
        const next = [];
        arr.forEach((item, index) => {
          const itemScope = Object.create(s);
          itemScope[node.itemName] = item;
          itemScope[node.indexName] = index;
          let key;
          if (node.keyName === 'index') key = 'i' + index;
          else if (node.keyName === '*this') key = 'v' + item;
          else if (node.keyName) key = 'k' + (item ? item[node.keyName] : index);
          else key = 'i' + index;

          let entry = null;
          for (let i = 0; i < entries.length; i += 1) {
            if (!used[i] && entries[i].key === key) { used[i] = true; entry = entries[i]; break; }
          }
          if (entry) {
            entry.node.refresh(itemScope);
          } else {
            const created = instantiate(node.template, itemScope, ctx);
            if (anchor.parentNode) anchor.parentNode.insertBefore(created.el, anchor);
            entry = { key, node: created };
          }
          next.push(entry);
          entry.__scope = itemScope;
        });
        for (let i = 0; i < entries.length; i += 1) {
          if (!used[i] && entries[i].node.el.parentNode) {
            entries[i].node.el.parentNode.removeChild(entries[i].node.el);
          }
        }
        /* 顺序可能变了：从后往前对齐，只有真的错位才移动节点。
           （早先写成"每个节点都和锚点比"，结果每次刷新都把节点重新插入一遍，
             浏览器会因此判定元素被搬走，点击事件就再也不派发了 —— 地图点不动就是这个原因。） */
        if (anchor.parentNode) {
          let ref = anchor;
          for (let i = next.length - 1; i >= 0; i -= 1) {
            const node = next[i].node.el;
            if (node.nextSibling !== ref) anchor.parentNode.insertBefore(node, ref);
            ref = node;
          }
        }
        entries = next;
      };
      refresh(scope);
      return { el: anchor, refresh };
    }

    /* 组件：宿主元素 + 内部实例 */
    if (node.isComponent) {
      const comp = createComponent(node, scope, ctx);
      return { el: comp.host, refresh: comp.refresh, __inst: comp.inst };
    }

    const el = document.createElement(node.isImage ? 'img' : node.tag);
    if (node.isImage) el.className = 'np-image';

    const binds = node.bindings.map((b) => ({ name: b.name, parts: b.parts, last: undefined }));
    const applyAttrs = (s) => {
      for (let i = 0; i < binds.length; i += 1) {
        const b = binds[i];
        let v = evalParts(b.parts, s);
        if (b.name === 'src' && node.isImage) v = assetURL(v, el.__npDir || (ctx && ctx.dir));
        if (b.name === 'style') v = fixStyle(v);
        if (b.last === v) continue;
        b.last = v;
        if (b.name === '__mode') {
          el.style.objectFit = MODE_FIT[v] || 'fill';
          continue;
        }
        if (v === undefined || v === null || v === false) el.removeAttribute(b.name);
        else if (v === true) el.setAttribute(b.name, '');
        else el.setAttribute(b.name, String(v));
      }
      if (node.dataset.length) {
        const ds = {};
        for (let i = 0; i < node.dataset.length; i += 1) {
          ds[node.dataset[i].key] = evalParts(node.dataset[i].parts, s);
        }
        el.__npDataset = ds;
      }
    };
    applyAttrs(scope);

    /* 触摸类事件统一走指针桥接：同一元素上的多个触摸绑定合成一套监听 */
    const touchSpecs = {};
    let hasTouch = false;
    for (let i = 0; i < node.events.length; i += 1) {
      const spec = node.events[i];
      if (TOUCH_TYPES[spec.dom]) {
        touchSpecs[spec.dom] = spec;
        hasTouch = true;
      }
    }
    if (hasTouch) bindGesture(el, touchSpecs, ctx);

    for (let i = 0; i < node.events.length; i += 1) {
      const spec = node.events[i];
      if (TOUCH_TYPES[spec.dom]) continue;
      const domType = spec.dom;
      el.addEventListener(domType, (nativeEvent) => {
        const instance = instanceOfNode(el, ctx && ctx.instance);
        if (spec.stop) nativeEvent.stopPropagation();
        const handler = instance && instance[spec.handler];
        if (typeof handler !== 'function') return;
        handler.call(instance, makeEvent(nativeEvent, el));
      }, { passive: true });
    }

    const kids = node.children.map((child) => instantiate(child, scope, ctx));
    kids.forEach((k) => el.appendChild(k.el));
    /* wx:if / wx:for 的锚点在 instantiate 阶段还没进 DOM，挂上父级后再刷一次，
       它们才能把内部内容插进来（小猪、折面内容就是这么漏掉的） */
    kids.forEach((k) => k.refresh(scope));

    const refresh = (s) => {
      applyAttrs(s);
      for (let i = 0; i < kids.length; i += 1) kids[i].refresh(s);
    };
    return { el, refresh };
  }

  function fixStyle(v) {
    if (v == null) return '';
    if (typeof v === 'object') {
      return Object.keys(v).map((k) => k + ':' + v[k]).join(';');
    }
    return fixRpx(v);
  }

  function makeEvent(nativeEvent, currentEl) {
    const touch = (t) => ({
      identifier: t.identifier,
      clientX: t.clientX,
      clientY: t.clientY,
      pageX: t.pageX,
      pageY: t.pageY,
      force: t.force || 1
    });
    const target = {
      id: currentEl.id || '',
      dataset: currentEl.__npDataset || {},
      offsetLeft: currentEl.offsetLeft,
      offsetTop: currentEl.offsetTop
    };
    return {
      type: nativeEvent.type,
      timeStamp: nativeEvent.timeStamp,
      detail: nativeEvent.detail || {},
      target,
      currentTarget: target,
      touches: nativeEvent.touches ? Array.prototype.map.call(nativeEvent.touches, touch) : [],
      changedTouches: nativeEvent.changedTouches ? Array.prototype.map.call(nativeEvent.changedTouches, touch) : [touch(nativeEvent.changedTouches ? nativeEvent.changedTouches[0] : nativeEvent)],
      preventDefault() { if (nativeEvent.cancelable) nativeEvent.preventDefault(); },
      stopPropagation() { nativeEvent.stopPropagation(); }
    };
  }

  /* ---------- 实例（页面 / 组件共用） ---------- */

  function copyData(src) {
    try { return JSON.parse(JSON.stringify(src || {})); } catch (e) { return Object.assign({}, src || {}); }
  }

  function applyPatch(data, patch) {
    Object.keys(patch || {}).forEach((key) => {
      if (/[.[]/.test(key)) setByPath(data, key, patch[key]);
      else data[key] = patch[key];
    });
  }
  function setByPath(data, path, value) {
    const segs = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let cur = data;
    for (let i = 0; i < segs.length - 1; i += 1) {
      const k = segs[i];
      if (cur[k] == null) cur[k] = /^\d+$/.test(segs[i + 1]) ? [] : {};
      cur = cur[k];
    }
    cur[segs[segs.length - 1]] = value;
  }

  function coerce(value, type) {
    if (value === undefined) return undefined;
    if (type === Number) return Number(value);
    if (type === Boolean) return value === 'false' ? false : !!value;
    if (type === String) return value == null ? '' : String(value);
    if (type === Object) {
      if (typeof value === 'string') { try { return JSON.parse(value); } catch (e) { return {}; } }
      return value;
    }
    if (type === Array) return Array.isArray(value) ? value : [];
    return value;
  }

  function makeInstance(config, initial, dir, wxmlSrc, json, kind) {
    const inst = {
      __kind: kind,
      __config: config,
      __dir: dir,
      __json: json || {},
      __nodes: [],
      __components: [],
      data: copyData(initial)
    };

    /* 页面：顶层方法直接挂实例；组件：只有 methods 里的才是方法 */
    if (kind === 'component') {
      const methods = config.methods || {};
      Object.keys(methods).forEach((k) => { if (typeof methods[k] === 'function') inst[k] = methods[k]; });
    } else {
      Object.keys(config).forEach((k) => {
        if (k === 'data' || k === 'properties') return;
        if (typeof config[k] === 'function') inst[k] = config[k];
      });
    }

    inst.setData = function (patch, cb) {
      applyPatch(this.data, patch || {});
      this.__refresh();
      if (typeof cb === 'function') cb();
    };
    inst.__refresh = function () {
      for (let i = 0; i < this.__nodes.length; i += 1) this.__nodes[i].refresh(this.data);
    };

    const usingComponents = {};
    const uc = (json && json.usingComponents) || {};
    Object.keys(uc).forEach((tag) => { usingComponents[tag] = resolvePath(dir, uc[tag]); });

    const ctx = { dir, instance: inst, usingComponents, page: null };
    const tree = compileWXML(wxmlSrc, dir, { usingComponents });
    inst.__tree = tree;
    inst.__ctx = ctx;
    return inst;
  }

  function mountInstance(inst, container) {
    inst.__nodes = inst.__tree.map((node) => instantiate(node, inst.data, inst.__ctx));
    inst.__nodes.forEach((n) => container.appendChild(n.el));
    inst.__nodes.forEach((n) => n.refresh(inst.data));
    inst.__el = container;
  }

  /* ---------- 组件 ---------- */

  const componentCache = Object.create(null);
  function loadComponent(path) {
    if (componentCache[path]) return componentCache[path];
    requirePath(path + '.js');
    const def = pendingComponent;
    pendingComponent = null;
    if (!def) throw new Error('[np] 组件没有调用 Component(): ' + path);
    const wxml = DEFS.wxml[path] || '';
    const json = DEFS.json[path] || {};
    const built = { config: def, dir: dirOf(path), wxml, json, path };
    componentCache[path] = built;
    return built;
  }

  function createComponent(node, scope, ctx) {
    const built = loadComponent(node.componentPath);
    const propDefs = built.config.properties || {};
    /* 先铺属性默认值，再用传入值覆盖，组件不传的属性才有默认 */
    const props = {};
    Object.keys(propDefs).forEach((name) => {
      props[name] = copyData(propDefs[name].value);
    });
    node.propBindings.forEach((p) => {
      const raw = evalParts(p.parts, scope);
      const pd = propDefs[p.name];
      const value = coerce(raw, pd && pd.type);
      props[p.name] = value === undefined ? (pd ? copyData(pd.value) : raw) : value;
    });

    const inst = makeInstance(built.config, Object.assign({}, built.config.data || {}, props), built.dir, built.wxml, built.json, 'component');
    inst.__propBindings = node.propBindings;
    inst.__propDefs = propDefs;

    const host = document.createElement(node.tag);
    host.setAttribute('data-np-component', node.tag);
    mountInstance(inst, host);
    inst.__host = host;
    host.__np = inst;

    /* 组件挂到页面上时，要跟着页面显示/隐藏跑 pageLifetimes */
    const owner = ctx && (ctx.page || ctx.instance);
    if (owner && owner.__components) owner.__components.push(inst);
    if (owner && owner.__visible === false) callPageLifetime(inst, 'hide');

    if (built.config.lifetimes && built.config.lifetimes.attached) {
      built.config.lifetimes.attached.call(inst);
    }

    const refresh = (s) => {
      /* 父级重渲染时同步属性（本工程属性都是静态的，这层是保险） */
      inst.__propBindings.forEach((p) => {
        const raw = evalParts(p.parts, s);
        const pd = propDefs[p.name];
        const value = coerce(raw, pd && pd.type);
        if (value !== undefined && inst.data[p.name] !== value) {
          inst.data[p.name] = value;
          inst.__refresh();
        }
      });
    };
    return { host, inst, refresh };
  }

  function callPageLifetime(inst, name) {
    const pl = inst && inst.__config && inst.__config.pageLifetimes;
    if (pl && typeof pl[name] === 'function') pl[name].call(inst);
  }

  function destroyInstance(inst) {
    const cfg = inst.__config;
    if (cfg && cfg.lifetimes && cfg.lifetimes.detached) cfg.lifetimes.detached.call(inst);
    (inst.__components || []).forEach((c) => destroyInstance(c));
  }

  /* ============================ 6. 路由 ============================ */

  const stack = [];
  let screenEl = null;
  let routeLock = false;

  function parseUrl(url) {
    const [path, qs] = String(url).split('?');
    const query = {};
    (qs || '').split('&').forEach((pair) => {
      if (!pair) return;
      const [k, v] = pair.split('=');
      query[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    return { route: norm(path), query };
  }

  const pageDefCache = Object.create(null);

  function createPage(route, query) {
    const json = DEFS.json[route] || DEFS.json[route + '/index'] || {};
    /* 页面模块只会执行一次，之后从缓存里取配置（否则二次进入时 Page() 不会再被调用） */
    let def = pageDefCache[route];
    if (!def) {
      pendingPage = null;
      requirePath(route + '.js');
      def = pendingPage;
      pendingPage = null;
      if (!def) throw new Error('[np] 页面没有调用 Page(): ' + route);
      pageDefCache[route] = def;
    }
    const wxml = DEFS.wxml[route] || '';

    const inst = makeInstance(def, def.data, dirOf(route), wxml, json, 'page');
    inst.__config = def;
    inst.__route = route;
    inst.__query = query || {};
    inst.__components = inst.__components || [];

    const el = document.createElement('page');
    el.className = 'np-page';
    el.setAttribute('data-np-route', route);
    mountInstance(inst, el);
    inst.__el = el;
    el.__np = inst;   /* 方便在控制台里查页面数据 */
    attachDesktopEnhancements(inst);

    /* 组件在挂载时创建，这里统一收集（mountInstance 期间已 push 到 inst.__components） */
    if (typeof def.onLoad === 'function') def.onLoad.call(inst, inst.__query);
    /* onReady = 首次渲染完成；地图页的入场动画就挂在这里 */
    if (typeof def.onReady === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(() => def.onReady.call(inst)));
    }
    return inst;
  }

  function callShow(inst) {
    inst.__visible = true;
    if (inst.__config && typeof inst.__config.onShow === 'function') inst.__config.onShow.call(inst);
    (inst.__components || []).forEach((c) => callPageLifetime(c, 'show'));
  }
  function callHide(inst) {
    inst.__visible = false;
    if (inst.__config && typeof inst.__config.onHide === 'function') inst.__config.onHide.call(inst);
    (inst.__components || []).forEach((c) => callPageLifetime(c, 'hide'));
  }
  function callUnload(inst) {
    if (inst.__config && typeof inst.__config.onUnload === 'function') inst.__config.onUnload.call(inst);
    destroyInstance(inst);
  }

  /* ============================ 6.5 H5 增强（桌面专属，工程里没有） ============================ */

  /**
   * 地图滚轮缩放。
   * 小程序里用双指捏合缩放，桌面没有对应手势，所以把滚轮接到页面已有的相机通道上：
   * 算法与 index.js 的捏合分支完全一致（next = clamp(scale*factor)、k = next/scale、
   * x = anchor - (anchor - x) * k），只是锚点换成光标位置。
   * 合着的书不缩放（和页面里 "合着的书不缩放" 的约定一致）。
   */
  function attachDesktopEnhancements(inst) {
    if (!inst || inst.__route !== 'pages/map/index') return;
    const viewport = inst.__el && inst.__el.querySelector('.map__viewport');
    if (!viewport) return;

    viewport.addEventListener('wheel', (e) => {
      if (!inst.data.isOpen) return;          /* 合着的书不缩放 */
      e.preventDefault();
      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 16;      /* 行 */
      else if (e.deltaMode === 2) delta *= 100;/* 页 */
      const anchor = toLogical(e.clientX, e.clientY);
      const factor = Math.pow(1.0015, -delta); /* 上滚放大、下滚缩小 */
      let next = inst.scale * factor;
      if (next < inst.minScale) next = inst.minScale;
      if (next > inst.maxScale) next = inst.maxScale;
      if (next === inst.scale) return;
      const k = next / inst.scale;
      inst.x = anchor.x - (anchor.x - inst.x) * k;
      inst.y = anchor.y - (anchor.y - inst.y) * k;
      inst.scale = next;
      inst.clamp();
      inst.apply();
      if (typeof inst.syncFullFlag === 'function') inst.syncFullFlag();
    }, { passive: false });
  }

  function slideIn(el) {
    el.style.transition = 'transform 280ms cubic-bezier(0.22, 0.61, 0.36, 1)';
    el.style.transform = 'translateX(100%)';
    requestAnimationFrame(() => { el.style.transform = 'translateX(0)'; });
    setTimeout(() => { el.style.transition = ''; }, 320);
  }
  function slideOut(el, done) {
    el.style.transition = 'transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1)';
    el.style.transform = 'translateX(100%)';
    setTimeout(() => { el.style.transition = ''; done(); }, 280);
  }

  function openPage(url, mode) {
    const { route, query } = parseUrl(url);
    const top = stack[stack.length - 1];
    let inst;
    try {
      inst = createPage(route, query);
    } catch (e) {
      console.error('[np] 打开页面失败 ' + route, e);
      return false;
    }

    if (mode === 'redirect' && top) {
      stack.pop();
      callUnload(top);
      if (top.__el.parentNode) top.__el.parentNode.removeChild(top.__el);
      screenEl.appendChild(inst.__el);
      stack.push(inst);
      callShow(inst);
      return true;
    }
    if (mode === 'relaunch') {
      stack.slice().forEach((p) => {
        callUnload(p);
        if (p.__el.parentNode) p.__el.parentNode.removeChild(p.__el);
      });
      stack.length = 0;
      screenEl.appendChild(inst.__el);
      stack.push(inst);
      callShow(inst);
      return true;
    }

    if (stack.length >= 10) return false;
    screenEl.appendChild(inst.__el);
    stack.push(inst);
    slideIn(inst.__el);
    if (top) callHide(top);
    callShow(inst);
    return true;
  }

  /* ============================ 7. wx 接口适配 ============================ */

  const nowInfo = { windowWidth: BASE_W, windowHeight: BASE_H, pixelRatio: window.devicePixelRatio || 2 };

  function ensureCanvasHelpers(canvas, baseDir) {
    if (!canvas.createImage) {
      canvas.createImage = function () {
        const img = new Image();
        /* 小程序里 canvas.createImage() 拿到的图也走工程路径规则：
           / 开头 = 工程根；命中内联表就用 data URI（否则 file:// 下 canvas 会被判跨域） */
        let realSrc = '';
        Object.defineProperty(img, 'src', {
          configurable: true,
          get() { return realSrc; },
          set(v) {
            realSrc = v;
            img.setAttribute('src', assetURL(v, baseDir));
          }
        });
        return img;
      };
    }
    return canvas;
  }

  const wx = {
    /* --- 路由 --- */
    navigateTo(o) {
      const ok = openPage(o.url, 'push');
      if (ok) { if (o.success) o.success({}); } else if (o.fail) o.fail({ errMsg: 'navigateTo:fail' });
    },
    redirectTo(o) {
      const ok = openPage(o.url, 'redirect');
      if (ok) { if (o.success) o.success({}); } else if (o.fail) o.fail({ errMsg: 'redirectTo:fail' });
    },
    reLaunch(o) {
      const ok = openPage(o.url, 'relaunch');
      if (ok) { if (o.success) o.success({}); } else if (o.fail) o.fail({ errMsg: 'reLaunch:fail' });
    },
    navigateBack(o) {
      const opts = o || {};
      if (stack.length <= 1) {
        if (opts.fail) opts.fail({ errMsg: 'navigateBack:fail' });
        return;
      }
      const top = stack.pop();
      const back = stack[stack.length - 1];
      slideOut(top.__el, () => {
        callUnload(top);
        if (top.__el.parentNode) top.__el.parentNode.removeChild(top.__el);
        callShow(back);
        if (opts.success) opts.success({});
      });
    },

    /* --- 存储 --- */
    setStorageSync(key, value) {
      try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); } catch (e) {}
    },
    getStorageSync(key) {
      try {
        const raw = localStorage.getItem(STORAGE_PREFIX + key);
        return raw == null ? '' : JSON.parse(raw);
      } catch (e) { return ''; }
    },
    removeStorageSync(key) {
      try { localStorage.removeItem(STORAGE_PREFIX + key); } catch (e) {}
    },

    /* --- 设备信息 --- */
    getWindowInfo() {
      return {
        windowWidth: nowInfo.windowWidth,
        windowHeight: nowInfo.windowHeight,
        screenWidth: nowInfo.windowWidth,
        screenHeight: nowInfo.windowHeight,
        pixelRatio: nowInfo.pixelRatio,
        statusBarHeight: 20,
        safeArea: { top: 20, bottom: nowInfo.windowHeight, left: 0, right: nowInfo.windowWidth, width: nowInfo.windowWidth, height: nowInfo.windowHeight - 20 }
      };
    },
    getSystemInfoSync() {
      return Object.assign(wx.getWindowInfo(), {
        platform: 'devtools',
        system: 'H5',
        brand: 'np',
        model: 'H5 预览',
        language: 'zh_CN',
        version: '1.0.0',
        SDKVersion: '3.0.0',
        fontSizeSetting: 16,
        benchmarkLevel: 50
      });
    },
    getDeviceInfo() {
      return { platform: 'devtools', system: 'H5', brand: 'np', model: 'H5 预览', benchmarkLevel: 50 };
    },

    /* --- 音频：小程序的 WebAudio 与浏览器同源，直接给原生 AudioContext --- */
    createWebAudioContext() {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = Ctx ? new Ctx() : null;
      window.__npAudioCtx = ctx;   /* 方便在控制台/测试里看音频状态 */
      return ctx;
    },
    createInnerAudioContext() {
      const audio = new Audio();
      return {
        set src(v) { audio.src = v; },
        get src() { return audio.src; },
        play() { audio.play().catch(() => {}); },
        pause() { audio.pause(); },
        stop() { audio.pause(); audio.currentTime = 0; },
        seek() {},
        destroy() {},
        onPlay() {}, onError() {}, onEnded() {}, onStop() {}
      };
    },

    /* --- 节点查询 / canvas --- */
    createSelectorQuery() {
      const q = { inst: null, sel: null, fields: null, cb: null };
      const api = {
        in(inst) { q.inst = inst; return api; },
        select(sel) { q.sel = sel; return api; },
        selectAll(sel) { q.sel = sel; q.all = true; return api; },
        fields(opts) { q.fields = opts; return api; },
        boundingClientRect(cb) { q.cb = cb; return api; },
        exec(cb) {
          const root = (q.inst && q.inst.__el) || document;
          const el = root.querySelector(q.sel);
          const out = [];
          if (el) {
            const rect = el.getBoundingClientRect();
            const scale = deviceScale || 1;
            const item = {
              id: el.id || '',
              dataset: el.__npDataset || {},
              left: rect.left / scale,
              top: rect.top / scale,
              right: rect.right / scale,
              bottom: rect.bottom / scale,
              width: rect.width / scale,
              height: rect.height / scale
            };
            if (q.fields && q.fields.node) {
              item.node = el.tagName === 'CANVAS' ? ensureCanvasHelpers(el, q.inst && q.inst.__dir) : el;
            }
            out.push(item);
          } else out.push(null);
          if (typeof cb === 'function') cb(out);
          else if (q.cb) q.cb(out[0] || null);
          return api;
        }
      };
      return api;
    },
    canvasToTempFilePath(o) {
      try {
        const data = o.canvas.toDataURL('image/png');
        if (o.success) o.success({ tempFilePath: data });
      } catch (e) {
        if (o.fail) o.fail({ errMsg: 'canvasToTempFilePath:fail ' + e.message });
      }
    },
    saveImageToPhotosAlbum(o) {
      try {
        const a = document.createElement('a');
        a.href = o.filePath;
        a.download = '年猪宴-分享卡.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        if (o.success) o.success({});
      } catch (e) {
        if (o.fail) o.fail({ errMsg: 'saveImageToPhotosAlbum:fail' });
      }
    },

    /* --- 其余：H5 里没有对应动作，给空实现保证调用链不断 --- */
    setNavigationBarTitle(o) { if (o && o.title) document.title = o.title; },
    openSetting(o) { if (o && o.fail) o.fail({ errMsg: 'openSetting:fail' }); },
    reportEvent() {},
    nextTick(fn) { Promise.resolve().then(fn); },
    showToast(o) { console.log('[np][toast]', o && o.title); }
  };

  /* ============================ 8. 设备外壳 ============================ */

  let deviceScale = 1;
  function layoutDevice() {
    const device = document.getElementById('np-device');
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const compact = vw <= 520;
    let scale;
    let logicalH;
    if (compact) {
      scale = vw / BASE_W;
      logicalH = Math.round(vh / scale);
      document.body.classList.remove('np-desktop');
    } else {
      scale = Math.min(1, (vh - 72) / BASE_H);
      logicalH = BASE_H;
      document.body.classList.add('np-desktop');
    }
    deviceScale = scale;
    nowInfo.windowWidth = BASE_W;
    nowInfo.windowHeight = Math.max(560, logicalH);
    device.style.width = BASE_W + 'px';
    device.style.height = nowInfo.windowHeight + 'px';
    device.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
  }

  /* ============================ 9. 启动 ============================ */

  let pendingPage = null;
  let pendingComponent = null;
  let appInstance = null;

  function boot() {
    window.wx = wx;
    window.getApp = function () { return appInstance; };
    window.Page = function (config) { pendingPage = config; };
    window.Component = function (config) { pendingComponent = config; };
    window.App = function (config) {
      appInstance = config;
      appInstance.setData = function (patch) { Object.assign(this.globalData, patch); };
      if (typeof config.onLaunch === 'function') config.onLaunch.call(config);
    };

    screenEl = document.getElementById('np-screen');
    /* 保险丝：设备内一律不触发浏览器手势（下拉刷新 / 手势返回 / 双指缩放）。
       页面自己的 touch 逻辑读的是坐标，不依赖默认行为，所以拦掉没有副作用。 */
    screenEl.addEventListener('touchmove', (e) => {
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    /* 拖拽之后的 click 不算 tap：否则从热区上拖过会顺手把用户带进菜品页 */
    screenEl.addEventListener('click', (e) => {
      if (!swallowNextClick) return;
      swallowNextClick = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);
    /* 浏览器默认的图片拖拽 / 文字选择会打断手势，直接禁掉 */
    screenEl.addEventListener('dragstart', (e) => e.preventDefault());
    layoutDevice();
    window.addEventListener('resize', layoutDevice);

    /* 全局样式先注入，页面/组件样式再按需注入 */
    injectWXSS('app');
    Object.keys(DEFS.wxss).forEach((name) => { if (name !== 'app') injectWXSS(name); });

    try {
      requirePath('app.js');
    } catch (e) {
      console.error('[np] app.js 启动失败', e);
    }

    const entry = (DEFS.manifest && DEFS.manifest.entry) || 'pages/entry/index';
    openPage('/' + entry, 'relaunch');

    const boot = document.getElementById('np-boot');
    if (boot) boot.classList.add('is-done');
  }

  window.addEventListener('error', (e) => {
    const boot = document.getElementById('np-boot');
    if (boot && !boot.classList.contains('is-done')) {
      boot.innerHTML = '<div class="np-err">运行时出错：' + (e.message || e.error) + '</div>';
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
