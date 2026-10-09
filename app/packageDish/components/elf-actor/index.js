const audio = require('../../../utils/audio.js');
const track = require('../../../utils/track.js');

Component({
  properties: {
    /* 小精灵身体（静态姿势，含表情与服装） */
    body: { type: String, value: '' },
    /* 动作手臂层（与身体同画布，肩点一致） */
    arm: { type: String, value: '' },
    /* 点击后播放的环境音效（无语音） */
    sound: { type: String, value: '' },
    /* 单次动作时长 */
    duration: { type: Number, value: 1800 },
    /* 定位样式（由 dish-stage 传入） */
    posStyle: { type: String, value: '' },
    /* 镜像：小精灵站在菜品右侧时使用 */
    flip: { type: Boolean, value: false },
    /* 用于埋点 */
    dishId: { type: String, value: '' }
  },

  data: {
    acting: false,
    actionClass: '',
    actionStyle: '',
    /* 第几次点击：1 夹菜 / 2 吹热气 / 3 满足转圈，循环 */
    stage: 0,
    /* 点满三次后，待机里会多一个小动作 */
    trained: false,
    star: false
  },

  lifetimes: {
    detached() {
      clearTimeout(this.timer);
      clearTimeout(this.starTimer);
    }
  },

  methods: {
    onTap() {
      if (this.data.acting) return;

      const duration = this.data.duration || 1800;
      const stage = (this.data.stage % 3) + 1;
      const trained = this.data.trained || stage === 3;

      this.setData({
        acting: true,
        stage: stage,
        trained: trained,
        actionClass: 'is-act' + stage,
        actionStyle: 'animation-duration:' + duration + 'ms'
      });

      /* 第一次是菜品专属拟音，后两次是通用的吹气 / 欢呼，都带家族动机 */
      if (stage === 1) {
        if (this.data.sound) audio.play(this.data.sound);
      } else if (stage === 2) {
        audio.play('elf_blow');
      } else {
        audio.play(this.data.sound);
        setTimeout(() => audio.play('elf_cheer'), 420);
        this.dropStar(duration);
      }

      this.taps = (this.taps || 0) + 1;
      track.log('elf_tap', { dish: this.data.dishId, count: this.taps, stage: stage });

      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.setData({ acting: false, actionClass: '' });
      }, duration);
    },

    /* 第三次点击结尾掉一颗小星星 */
    dropStar(duration) {
      clearTimeout(this.starTimer);
      this.starTimer = setTimeout(() => {
        this.setData({ star: true });
        this.starTimer = setTimeout(() => this.setData({ star: false }), 1200);
      }, Math.max(400, duration - 620));
    }
  }
});
