/**
 * 音效系统
 *
 * 默认使用 WebAudio 实时合成，工程零音频文件即可发声，导入开发者工具就能听到。
 * 正式音效（S-01 ~ S-11）到位后：
 *   1. 把 mp3 放到 assets/audio/ 目录（或用 CDN）
 *   2. 把 FILE_MODE 改为 true
 *   3. 按 FILE_MAP 补齐文件名
 *
 * 硬性约束：全部为环境拟音，没有任何人物语音。
 */
const FILE_MODE = false;
const FILE_BASE = '/assets/audio/'; // 例：'https://cdn.xxx.com/nianzhuyan/audio/'

const FILE_MAP = {
  enter_bell: 'snd_enter_bell.mp3',
  hotspot_ding: 'snd_hotspot_ding.mp3',
  transition: 'snd_transition_whoosh.mp3',
  back_bell: 'snd_back_bell.mp3',
  steam: 'snd_steam_loop.mp3',
  firecracker: 'snd_firecracker.mp3',
  plate_drop: 'snd_plate_drop.mp3',
  pig_pat: 'snd_pig_pat.mp3',
  pig_yawn: 'snd_pig_yawn.mp3',
    pig_lick: 'snd_pig_lick.mp3',
    feast: 'snd_feast.mp3',
    secret_cat: 'snd_secret_cat.mp3',
  secret_sparrow: 'snd_secret_sparrow.mp3',
  secret_swallow: 'snd_secret_swallow.mp3',
  secret_mouse: 'snd_secret_mouse.mp3',
  secret_dog: 'snd_secret_dog.mp3',
  elf_blow: 'snd_elf_blow.mp3',
  elf_cheer: 'snd_elf_cheer.mp3',
  goblin_hongyun: 'snd_goblin_hongyun.mp3',
  goblin_youcai: 'snd_goblin_youcai.mp3',
  goblin_mifu: 'snd_goblin_mifu.mp3',
  goblin_shazhucai: 'snd_goblin_shazhucai.mp3',
  goblin_feichang: 'snd_goblin_feichang.mp3',
  goblin_nuomi: 'snd_goblin_nuomi.mp3',
  goblin_chouguiyu: 'snd_goblin_chouguiyu.mp3'
};

/* 各音效相对音量，遵循「全程轻柔」原则 */
const VOLUME = {
  enter_bell: 0.5,
  hotspot_ding: 0.55,
  transition: 0.4,
  back_bell: 0.5,
  steam: 0.08,
  firecracker: 0.5,
  plate_drop: 0.55,
  pig_pat: 0.4,
  pig_yawn: 0.35,
    pig_lick: 0.4,
    feast: 0.6,
    secret_cat: 0.45,
  secret_sparrow: 0.4,
  secret_swallow: 0.4,
  secret_mouse: 0.35,
  secret_dog: 0.4,
  elf_blow: 0.45,
  elf_cheer: 0.5,
  goblin_mifu: 0.5,
  goblin_shazhucai: 0.5,
  goblin_hongyun: 0.5,
  goblin_youcai: 0.5,
  goblin_feichang: 0.5,
  goblin_nuomi: 0.5,
  goblin_chouguiyu: 0.45
};

let ctx = null;
let muted = false;
let steamNode = null;
let steamStopTimer = null;
let unlocked = false;
let timer = null;
let filePool = {};

/* ------------------------------- 基础能力 ------------------------------- */

function getCtx() {
  if (ctx) return ctx;
  if (FILE_MODE) return null;
  try {
    if (typeof wx.createWebAudioContext === 'function') {
      ctx = wx.createWebAudioContext();
    }
  } catch (e) {
    ctx = null;
  }
  return ctx;
}

function ready() {
  return !muted && !FILE_MODE && !!getCtx();
}

function tone(freq, dur, opt) {
  if (!ready()) return;
  const o = opt || {};
  try {
    const c = getCtx();
    const t = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) {
      osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    }
    const peak = o.vol == null ? 0.2 : o.vol;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + (o.attack || 0.014));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.06);
  } catch (e) {
    /* ignore */
  }
}

function noise(dur, opt) {
  if (!ready()) return;
  const o = opt || {};
  try {
    const c = getCtx();
    const sr = c.sampleRate || 44100;
    const len = Math.max(1, Math.floor(sr * dur));
    const buf = c.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const gain = c.createGain();
    const t = c.currentTime;
    const peak = o.vol == null ? 0.06 : o.vol;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + (o.attack || 0.02));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    let node = src;
    if (o.filter && typeof c.createBiquadFilter === 'function') {
      const f = c.createBiquadFilter();
      f.type = o.filter;
      f.frequency.setValueAtTime(o.freq || 1000, t);
      if (o.toFreq) {
        f.frequency.exponentialRampToValueAtTime(o.toFreq, t + dur);
      }
      f.Q.value = o.q == null ? 1 : o.q;
      src.connect(f);
      node = f;
    }
    node.connect(gain);
    gain.connect(c.destination);
    src.start(t);
    src.stop(t + dur + 0.02);
  } catch (e) {
    /* ignore */
  }
}

function later(fn, ms) {
  setTimeout(fn, ms);
}

/* ---------------------------------------------------------------------------
 * 家族动机：六道菜共用同一组三个音，只换调性与音色，听起来才像一家人。
 * ------------------------------------------------------------------------- */
const MOTIVE = [784, 1046.5, 1318.5]; /* G5 - C6 - E6 */

/* 单颗鞭炮：一记脆响 + 一点低频闷响 */
function crack(vol, freq) {
  noise(0.1, {
    vol: vol,
    filter: 'bandpass',
    freq: freq,
    toFreq: freq * 0.45,
    q: 0.9,
    attack: 0.002
  });
  tone(freq * 0.2, 0.13, { vol: vol * 0.35, type: 'triangle', to: freq * 0.1 });
}

function motive(semitone, type, vol, gap) {
  const k = Math.pow(2, semitone / 12);
  const step = gap || 132;
  for (let i = 0; i < MOTIVE.length; i += 1) {
    (function (i) {
      later(function () {
        tone(MOTIVE[i] * k, 0.44, {
          vol: vol * (1 - i * 0.13),
          type: type,
          to: MOTIVE[i] * k * 1.015
        });
      }, i * step);
    })(i);
  }
}

/* ------------------------------- 音效定义 ------------------------------- */

const SYNTH = {
  /* S-01 扫码进入：轻柔新年铃铛 */
  enter_bell: function () {
    tone(880, 1.2, { vol: 0.15 });
    later(function () { tone(1320, 0.9, { vol: 0.1 }); }, 110);
    later(function () { tone(1760, 0.7, { vol: 0.06 }); }, 220);
  },

  /* S-02 点击热区：叮咚轻响 */
  hotspot_ding: function () {
    tone(1180, 0.4, { vol: 0.16, to: 1500, type: 'triangle' });
    later(function () { tone(1580, 0.28, { vol: 0.08 }); }, 60);
  },

  /* S-03 页面转场：柔和滑动 */
  transition: function () {
    noise(0.45, { vol: 0.05, filter: 'bandpass', freq: 520, toFreq: 2000, q: 0.8 });
  },

  /* S-10 返回首页：短促铃铛 */
  back_bell: function () {
    tone(1320, 0.42, { vol: 0.14 });
    later(function () { tone(1980, 0.3, { vol: 0.06 }); }, 70);
  },

  /* 菜落桌：瓷碗碰上木桌的「叮」 */
  plate_drop: function () {
    tone(1560, 0.5, { vol: 0.14, to: 1180, type: 'triangle' });
    later(function () {
      noise(0.06, { vol: 0.07, filter: 'lowpass', freq: 700, attack: 0.004 });
    }, 30);
    later(function () { tone(2340, 0.3, { vol: 0.06 }); }, 60);
  },

  /* 摸头：小猪满足的呼噜（低频颤音，不是人声） */
  pig_pat: function () {
    tone(196, 0.7, { vol: 0.1, type: 'triangle', to: 232 });
    later(function () { tone(148, 0.8, { vol: 0.08, type: 'sine', to: 176 }); }, 120);
    later(function () {
      noise(0.5, { vol: 0.03, filter: 'lowpass', freq: 420, attack: 0.12 });
    }, 180);
  },

  /* 打哈欠：一声长长的呼气 */
  pig_yawn: function () {
    noise(0.9, { vol: 0.05, filter: 'lowpass', freq: 900, toFreq: 380, attack: 0.35 });
    later(function () { tone(240, 0.9, { vol: 0.05, type: 'sine', to: 180 }); }, 140);
  },

  /* 开席：锣鼓 + 鞭炮 */
  feast: function () {
    tone(320, 0.9, { vol: 0.16, type: 'triangle', to: 150 });
    later(function () { tone(480, 0.7, { vol: 0.12, type: 'triangle', to: 220 }); }, 40);
    for (let i = 0; i < 7; i += 1) {
      (function (k) {
        later(function () {
          noise(0.05, { vol: 0.07 - k * 0.005, filter: 'highpass', freq: 1800, attack: 0.003 });
        }, 260 + k * 110);
      })(i);
    }
    later(function () { tone(880, 0.8, { vol: 0.1 }); }, 320);
    later(function () { tone(1320, 0.9, { vol: 0.09 }); }, 430);
  },

  /* S-05 鸿运当头：筷子轻碰 + 细碎咀嚼 */
  goblin_hongyun: function () {
    motive(4, 'triangle', 0.1);
    noise(0.05, { vol: 0.1, filter: 'highpass', freq: 2200, attack: 0.004 });
    later(function () {
      noise(0.05, { vol: 0.08, filter: 'highpass', freq: 2600, attack: 0.004 });
    }, 130);
    later(function () { tone(660, 0.16, { vol: 0.05, type: 'triangle' }); }, 250);
    later(function () {
      noise(0.04, { vol: 0.05, filter: 'bandpass', freq: 900, attack: 0.003 });
    }, 420);
    later(function () {
      noise(0.04, { vol: 0.045, filter: 'bandpass', freq: 760, attack: 0.003 });
    }, 560);
  },

  /* S-06 油菜苔烧龙骨：筷子碰碗碟的清脆小音 */
  goblin_youcai: function () {
    motive(0, 'sine', 0.09);
    tone(1980, 0.34, { vol: 0.12, to: 2400 });
    later(function () {
      noise(0.05, { vol: 0.07, filter: 'highpass', freq: 2400, attack: 0.003 });
    }, 90);
    later(function () { tone(2640, 0.24, { vol: 0.06 }); }, 300);
  },

  /* 霉豆腐（小食）：小瓷碟轻轻放下的清脆声 */
  goblin_mifu: function () {
    motive(0, 'sine', 0.1);
    tone(2240, 0.3, { vol: 0.09, to: 1700 });
    later(function () {
      noise(0.04, { vol: 0.045, filter: 'highpass', freq: 3000, attack: 0.003 });
    }, 70);
    later(function () { tone(1480, 0.4, { vol: 0.06 }); }, 240);
  },

  /* 杀猪菜（热锅）：轻微咕嘟声 + 锅边轻碰 */
  goblin_shazhucai: function () {
    motive(-3, 'triangle', 0.1);
    noise(0.5, { vol: 0.045, filter: 'lowpass', freq: 700, toFreq: 420, attack: 0.1 });
    later(function () {
      noise(0.16, { vol: 0.035, filter: 'bandpass', freq: 520, q: 1.4 });
    }, 300);
    later(function () {
      noise(0.04, { vol: 0.06, filter: 'highpass', freq: 2200, attack: 0.003 });
    }, 560);
  },

  /* S-07 干锅肥肠：轻柔吸鼻子 + 筷子搅动 */
  goblin_feichang: function () {
    motive(-5, 'triangle', 0.1, 108);
    noise(0.22, { vol: 0.045, filter: 'lowpass', freq: 900, toFreq: 380, attack: 0.06 });
    later(function () {
      noise(0.4, { vol: 0.05, filter: 'bandpass', freq: 1500, toFreq: 900, q: 0.6 });
    }, 320);
    later(function () {
      noise(0.06, { vol: 0.06, filter: 'highpass', freq: 2000, attack: 0.004 });
    }, 700);
  },

  /* S-08 糯米圆子：小勺碰瓷碗的叮咚 */
  goblin_nuomi: function () {
    motive(5, 'sine', 0.11, 150);
    tone(1580, 0.6, { vol: 0.13, to: 1200, type: 'sine' });
    later(function () { tone(2360, 0.4, { vol: 0.07 }); }, 40);
    later(function () { tone(1180, 0.5, { vol: 0.06 }); }, 220);
  },

  /* S-09 臭鳜鱼：轻轻嗅闻的气息 */
  goblin_chouguiyu: function () {
    motive(2, 'sine', 0.09, 140);
    noise(0.3, { vol: 0.04, filter: 'lowpass', freq: 1100, toFreq: 500, attack: 0.08 });
    later(function () {
      noise(0.26, { vol: 0.032, filter: 'lowpass', freq: 900, toFreq: 420, attack: 0.07 });
    }, 420);
  },

  /* ------------------- 彩蛋：藏在画面里的五个小家伙 ------------------- */

  /* 小猫：软软的一声喵（动物声，不是人声） */
  secret_cat: function () {
    tone(620, 0.34, { vol: 0.1, type: 'triangle', to: 900 });
    later(function () { tone(880, 0.4, { vol: 0.08, type: 'triangle', to: 700 }); }, 200);
  },

  /* 麻雀：两声短促的啾啾 */
  secret_sparrow: function () {
    tone(2280, 0.12, { vol: 0.09, type: 'sine', to: 2600 });
    later(function () { tone(2500, 0.12, { vol: 0.08, type: 'sine', to: 2200 }); }, 130);
  },

  /* 燕子：三声轻快的叽喳 */
  secret_swallow: function () {
    tone(2600, 0.1, { vol: 0.08, type: 'sine' });
    later(function () { tone(2200, 0.1, { vol: 0.08, type: 'sine' }); }, 110);
    later(function () { tone(2800, 0.14, { vol: 0.07, type: 'sine', to: 2400 }); }, 220);
  },

  /* 小老鼠：细细的吱吱 */
  secret_mouse: function () {
    tone(3200, 0.1, { vol: 0.06, type: 'sine', to: 3600 });
    later(function () { tone(3400, 0.1, { vol: 0.055, type: 'sine', to: 3000 }); }, 120);
  },

  /* 小狗：轻轻呜一声 */
  secret_dog: function () {
    tone(340, 0.36, { vol: 0.09, type: 'triangle', to: 250 });
    later(function () { tone(300, 0.3, { vol: 0.07, type: 'triangle', to: 220 }); }, 240);
  },

  /* 小猪被馋到：吧唧一下嘴 */
  pig_lick: function () {
    noise(0.07, { vol: 0.06, filter: 'bandpass', freq: 1400, q: 1.2, attack: 0.005 });
    later(function () {
      noise(0.06, { vol: 0.05, filter: 'bandpass', freq: 1100, q: 1.4, attack: 0.005 });
    }, 150);
    later(function () { tone(520, 0.2, { vol: 0.05, type: 'triangle', to: 640 }); }, 90);
  },

  /* 小精灵吹热气 */
  elf_blow: function () {
    noise(0.42, { vol: 0.05, filter: 'lowpass', freq: 1200, toFreq: 520, attack: 0.1 });
  },

  /* 小精灵吃开心了：三音动机上行 + 一点闪亮 */
  elf_cheer: function () {
    motive(7, 'sine', 0.1, 96);
    later(function () { tone(2093, 0.5, { vol: 0.06, to: 2400 }); }, 300);
  }
};

/* ------------------------------- 文件模式 ------------------------------- */

function fileSrc(name) {
  return FILE_BASE + (FILE_MAP[name] || name + '.mp3');
}

function playFile(name, loop) {
  try {
    const key = name + (loop ? '_loop' : '');
    let item = filePool[key];
    if (!item) {
      const ctxs = [];
      const size = loop ? 1 : 3;
      for (let i = 0; i < size; i += 1) {
        const c = wx.createInnerAudioContext();
        c.src = fileSrc(name);
        c.loop = !!loop;
        c.volume = VOLUME[name] == null ? 0.5 : VOLUME[name];
        ctxs.push(c);
      }
      item = { ctxs: ctxs, index: 0 };
      filePool[key] = item;
    }
    const target = item.ctxs[item.index % item.ctxs.length];
    item.index += 1;
    target.seek(0);
    target.play();
    return item;
  } catch (e) {
    return null;
  }
}

/* ------------------------------- 对外接口 ------------------------------- */

function isMuted() {
  if (typeof muted === 'boolean' && muted) return true;
  try {
    return !!wx.getStorageSync('np_muted');
  } catch (e) {
    return false;
  }
}

function setMuted(value) {
  muted = !!value;
  try {
    wx.setStorageSync('np_muted', muted);
  } catch (e) {
    /* ignore */
  }
  if (muted) {
    stopSteam();
  }
}

function toggle() {
  setMuted(!isMuted());
  return isMuted();
}

function play(name) {
  if (isMuted()) return;
  if (FILE_MODE) {
    playFile(name, false);
    return;
  }
  const fn = SYNTH[name];
  if (fn) fn();
}

/* S-04 菜品热气：极轻的循环呼呼声 */
function startSteam() {
  clearTimeout(steamStopTimer);
  steamStopTimer = null;
  if (isMuted()) return;
  if (FILE_MODE) {
    playFile('steam', true);
    return;
  }
    if (steamNode || !ready()) return;
    try {
      const c = getCtx();
      const sr = c.sampleRate || 44100;
      const len = Math.floor(sr * 2.5);
      const buf = c.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i += 1) {
        data[i] = Math.random() * 2 - 1;
      }
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;

      /* 只留中间一段频带：听起来是「呵气」，而不是宽频的「沙沙」 */
      let node = src;
      if (typeof c.createBiquadFilter === 'function') {
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(620, c.currentTime);
        bp.Q.value = 0.65;
        src.connect(bp);
        node = bp;
      }

      const gain = c.createGain();
      gain.gain.value = VOLUME.steam;
      node.connect(gain);
      gain.connect(c.destination);
      src.start(c.currentTime);

      /* 让热气一阵一阵地起伏，而不是一直平推着响 */
      let lfo = null;
      try {
        lfo = c.createOscillator();
        const lfoGain = c.createGain();
        lfo.frequency.value = 0.28;
        lfoGain.gain.value = VOLUME.steam * 0.5;
        lfo.connect(lfoGain);
        lfoGain.connect(gain.gain);
        lfo.start(c.currentTime);
      } catch (e) {
        lfo = null;
      }

      steamNode = { src: src, gain: gain, lfo: lfo };
    } catch (e) {
      steamNode = null;
    }
  }

function doStopSteam() {
  try {
    if (steamNode) {
      steamNode.src.stop();
      if (steamNode.lfo) {
        try {
          steamNode.lfo.stop();
        } catch (e) {
          /* ignore */
        }
      }
      steamNode = null;
    }
    const item = filePool.steam_loop;
    if (item) {
      item.ctxs.forEach(function (c) { c.stop(); });
      delete filePool.steam_loop;
    }
  } catch (e) {
    steamNode = null;
  }
}

/* 延后 240ms 真正停止：避免页面切换时“上一页 onHide”把新页面刚启动的热气关掉 */
function stopSteam() {
  clearTimeout(steamStopTimer);
  steamStopTimer = setTimeout(doStopSteam, 240);
}

/* 首次用户交互时调用，解锁移动端音频 */
function unlock() {
  unlocked = true;
  if (FILE_MODE) return;
  getCtx();
}

/* ---------------------------------------------------------------------------
 * 远处的一挂鞭炮：进菜品页时放一轮就好，不做常驻底噪。
 * ------------------------------------------------------------------------- */

const POP_VOL = 0.07;
let lastFireAt = 0;

function distantPop(vol) {
  const freq = 620 + Math.random() * 700;
  noise(0.17, {
    vol: vol,
    filter: 'lowpass',
    freq: freq,
    toFreq: freq * 0.35,
    attack: 0.004
  });
  tone(freq * 0.32, 0.2, { vol: vol * 0.45, type: 'triangle', to: freq * 0.18 });
}

  /**
   * 放一轮鞭炮：前段一小串密集脆响，尾段零星几声，合计约 2 秒。
   * 只响一轮就结束，不做循环。
   * @param {number} delayMs 延迟多久开始，用来错开页面转场音
   */
  function playFirecracker(delayMs) {
    if (isMuted()) return;

    /* 连续切菜时不要叠加成一团（一轮两秒，所以间隔要比它长） */
    const now = Date.now();
    if (now - lastFireAt < 2600) return;
    lastFireAt = now;

  const start = Math.max(0, delayMs || 0);

  if (FILE_MODE) {
    setTimeout(function () {
      if (!isMuted()) playFile('firecracker', false);
    }, start);
    return;
  }

  if (!unlocked || !ready()) return;
  const c = getCtx();
  if (typeof c.resume === 'function' && c.state && c.state !== 'running') {
    try {
      c.resume();
    } catch (e) {
      /* ignore */
    }
  }

    /* 前段：一小串密集脆响，约 1.1 秒 */
    const head = 10 + Math.floor(Math.random() * 5);
    for (let i = 0; i < head; i += 1) {
      (function (i) {
        setTimeout(function () {
          if (isMuted()) return;
          crack(0.09 + Math.random() * 0.05, 1400 + Math.random() * 900);
        }, start + i * (55 + Math.random() * 55));
      })(i);
    }

    /* 尾段：零星几声慢慢过去，凑够两秒 */
    const tail = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < tail; i += 1) {
      (function (i) {
        setTimeout(function () {
          if (isMuted()) return;
          distantPop(POP_VOL * (0.6 + Math.random() * 0.5));
        }, start + 1150 + i * (150 + Math.random() * 90));
      })(i);
    }
  }

function setTimer(fn, ms) {
  clearTimeout(timer);
  timer = setTimeout(fn, ms);
}

module.exports = {
  isMuted: isMuted,
  setMuted: setMuted,
  toggle: toggle,
  play: play,
  startSteam: startSteam,
  stopSteam: stopSteam,
  playFirecracker: playFirecracker,
  unlock: unlock,
  setTimer: setTimer
};
