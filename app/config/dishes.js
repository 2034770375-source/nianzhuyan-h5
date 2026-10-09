/**
 * 六道菜的元数据（文案 / 素材 / 小精灵 / 音效 / 动画参数）
 * 详情页共用同一套版式骨架，差异全部由这里驱动。
 *
 * 顺序即详情页左右滑动的顺序：
 *   霉豆腐 → 杀猪菜 → 臭鳜鱼 → 鸿运当头 → 糯米圆子 → 干锅肥肠 → 循环
 */
const ASSET = '/packageDish/assets/';

/* 环绕配菜的四个固定装饰位（相对菜品容器） */
const DECO_SLOTS = [
  { left: '-9%', top: '44%', size: 178, delay: 0.0, rotate: -6, z: 7 },
  { left: '8%', top: '-2%', size: 129, delay: 0.7, rotate: 8, z: 3 },
  { right: '-9%', top: '32%', size: 156, delay: 1.4, rotate: 5, z: 3 },
  { right: '6%', bottom: '4%', size: 157, delay: 2.1, rotate: -8, z: 7 }
];

const DISHES = {
  mifu: {
    id: 'mifu',
    part: '小猪身前的小食碟',
    title: '霉豆腐',
    subtitle: '小食开胃！',
    tagline: '小小一块，鲜上半天',
    story: '头一碟，先开开胃',
    fact: '豆腐放它自己长出一层白毛，鲜味是等出来的',
    origin: '徽州人做豆腐有一手。豆腐点好不马上吃，放在竹筛上让它自己发酵，表面慢慢长出一层白绒毛，鲜味就是这么等出来的。徽州街头最有名的是「毛豆腐」——小贩挑着担子，用炭火一烤，刷上辣椒酱，外焦里嫩。一碟霉豆腐上桌，是整桌年猪宴的开胃信号。',
    accent: '#cf7a30',
    dishImg: ASSET + 'dish_mifu.png',
    imageScale: 0.9,
    decos: ['jar', 'chili', 'ginger', 'garlic'],
    steam: [
      { left: '38%', size: 50, delay: 0.2, duration: 4.6 },
      { left: '52%', size: 58, delay: 1.5, duration: 5.0 }
    ],
    elf: {
      label: '端小碟的小女孩',
      body: ASSET + 'elf_mifu_body.png',
      arm: ASSET + 'elf_mifu_arm.png',
      sound: 'goblin_mifu',
      left: '2%',
      bottom: '8%',
      flip: false,
      action: 1800
    }
  },
  shazhucai: {
    id: 'shazhucai',
    part: '猪背脊龙骨部位',
    title: '杀猪菜',
    subtitle: '热乎一锅！',
    tagline: '一锅杀猪菜，满屋都是年味',
    story: '第一锅，先请邻居',
    fact: '杀年猪当天，第一锅先请来帮忙的邻居吃',
    origin: '杀年猪那天的头一顿叫「杀猪饭」。天不亮就烧水，邻居都来搭手；猪杀好，先切一块最新鲜的肉下锅，配上血肠、酸菜、粉条，炖一大锅。第一碗不给自家人，先端给来帮忙的邻居。所以这道菜的味道，一半是肉香，一半是人情。',
    accent: '#c2673a',
    dishImg: ASSET + 'dish_shazhucai.png',
    decos: ['pot', 'flame', 'scallion', 'garlic'],
    steam: [
      { left: '34%', size: 58, delay: 0.0, duration: 3.8 },
      { left: '45%', size: 70, delay: 0.9, duration: 4.2 },
      { left: '57%', size: 62, delay: 1.8, duration: 4.0 },
      { left: '66%', size: 50, delay: 2.6, duration: 4.4 }
    ],
    elf: {
      label: '握筷子的小男孩',
      body: ASSET + 'elf_shazhucai_body.png',
      arm: ASSET + 'elf_shazhucai_arm.png',
      sound: 'goblin_shazhucai',
      right: '0%',
      bottom: '2%',
      flip: true,
      action: 2000
    }
  },
  chouguiyu: {
    id: 'chouguiyu',
    part: '身旁独立宴席配菜区',
    title: '臭鳜鱼',
    subtitle: '闻着特别，吃着真香！',
    tagline: '徽州一绝，越闻越想吃',
    story: '头牌上桌，越闻越想吃',
    fact: '木桶里压上石头腌七天，鱼肉才成蒜瓣状',
    origin: '这是徽州最有名、也最有争议的一道菜。新鲜鳜鱼用淡盐水腌上，一层鱼一层盐码进木桶，上面压一块青石，腌六七天。鱼肉在这段时间里悄悄发酵，鲜味反而更浓，肉变成一瓣一瓣的「蒜瓣肉」。闻着有点冲，吃起来是别处没有的鲜。',
    accent: '#efb84a',
    dishImg: ASSET + 'dish_chouguiyu.png',
    decos: ['scallion', 'ginger', 'chili', 'pot'],
    steam: [
      { left: '34%', size: 52, delay: 0.2, duration: 4.6 },
      { left: '49%', size: 62, delay: 1.4, duration: 5.0 },
      { left: '63%', size: 52, delay: 2.6, duration: 4.2 }
    ],
    elf: {
      label: '捂鼻子的小女孩',
      body: ASSET + 'elf_chouguiyu_body.png',
      arm: ASSET + 'elf_chouguiyu_arm.png',
      sound: 'goblin_chouguiyu',
      left: '0%',
      bottom: '6%',
      flip: false,
      action: 2400
    }
  },
  hongyun: {
    id: 'hongyun',
    part: '猪头部位',
    title: '鸿运当头',
    subtitle: '新年开吃！',
    tagline: '猪头一上桌，鸿运跟着来',
    story: '猪头端上，鸿运当头',
    fact: '旧时猪头要先祭祖，祭完一家人才动筷',
    origin: '猪头是整头猪里最「正式」的部位。旧时年节祭祖，供桌上摆的就是它；祭完了，一家人才动筷分食。「有头有尾」是过日子的讲究，也是这道菜名字的来处——日子要有头有尾，运气要从头开始。',
    accent: '#d8342a',
    dishImg: ASSET + 'dish_hongyun.png',
    decos: ['greens', 'pepper', 'anise', 'ingot'],
    steam: [
      { left: '36%', size: 54, delay: 0.0, duration: 4.2 },
      { left: '47%', size: 66, delay: 1.1, duration: 4.8 },
      { left: '58%', size: 50, delay: 2.2, duration: 4.0 }
    ],
    elf: {
      label: '红衣小男孩',
      body: ASSET + 'elf_hongyun_body.png',
      arm: ASSET + 'elf_hongyun_arm.png',
      sound: 'goblin_hongyun',
      left: '0%',
      bottom: '6%',
      flip: false,
      action: 1800
    }
  },
  nuomi: {
    id: 'nuomi',
    part: '猪四肢部位',
    title: '糯米圆子',
    subtitle: '团团圆圆！',
    tagline: '一勺甜糯，一年圆满',
    story: '甜口收尾，团团圆圆',
    fact: '糯米先泡一整夜再磨粉，圆子才够糯',
    origin: '糯米要先泡一整夜，再磨成细粉，揉成团、搓成圆。圆子讲究「匀」——大小一样，才叫圆满。徽州人家的年夜饭上，甜口的圆子通常放在后半程，一勺下去，这一年就算过圆了。',
    accent: '#d99a2b',
    dishImg: ASSET + 'dish_nuomi.png',
    decos: ['jar', 'rice', 'sugar', 'petals'],
    steam: [
      { left: '40%', size: 50, delay: 0.6, duration: 5.2 },
      { left: '54%', size: 56, delay: 2.0, duration: 4.6 }
    ],
    elf: {
      label: '软萌小女孩',
      body: ASSET + 'elf_nuomi_body.png',
      arm: ASSET + 'elf_nuomi_arm.png',
      sound: 'goblin_nuomi',
      right: '1%',
      bottom: '8%',
      flip: true,
      action: 2000
    }
  },
  feichang: {
    id: 'feichang',
    part: '猪腹部肠道部位',
    title: '干锅肥肠',
    subtitle: '香到跺脚！',
    tagline: '一锅烟火气，最是家常味',
    story: '热炒跟上，越吃越热',
    fact: '大肠要用盐和面粉反复搓洗七八遍',
    origin: '年猪身上，大肠是最费工夫的部位——先用盐和面粉反复搓洗，再焯、再卤，前后小半天。炒的时候配辣椒、蒜瓣、葱段大火爆香，盛进小铁锅，底下点一炉小火，边吃边加热。锅一直是热的，话也就一直聊得下去。',
    accent: '#f2814b',
    dishImg: ASSET + 'dish_feichang.png',
    decos: ['chili', 'scallion', 'garlic', 'flame'],
    steam: [
      { left: '33%', size: 60, delay: 0.0, duration: 3.6 },
      { left: '43%', size: 72, delay: 0.8, duration: 4.0 },
      { left: '55%', size: 64, delay: 1.6, duration: 3.8 },
      { left: '65%', size: 52, delay: 2.4, duration: 4.2 }
    ],
    elf: {
      label: '调皮小男孩',
      body: ASSET + 'elf_feichang_body.png',
      arm: ASSET + 'elf_feichang_arm.png',
      sound: 'goblin_feichang',
      left: '1%',
      bottom: '0%',
      flip: false,
      action: 2000
    }
  }
};

/* 详情页左右滑动的循环顺序 */
/* 上菜顺序（中式宴席通用次序：开胃小食 → 头锅热菜 → 热炒 → 大菜 → 头牌 → 甜口收尾） */
const ORDER = ['mifu', 'shazhucai', 'feichang', 'hongyun', 'chouguiyu', 'nuomi'];

function buildDecoStyle(slot, mirrored) {
  const left = mirrored ? slot.right : slot.left;
  const right = mirrored ? slot.left : slot.right;
  const parts = [
    'width:' + slot.size + 'rpx',
    'height:' + slot.size + 'rpx',
    'z-index:' + (slot.z || 7),
    'animation-delay:' + slot.delay + 's',
    '--np-deco-rotate:' + slot.rotate + 'deg'
  ];
  if (left) parts.push('left:' + left);
  if (right) parts.push('right:' + right);
  if (slot.top) parts.push('top:' + slot.top);
  if (slot.bottom) parts.push('bottom:' + slot.bottom);
  return parts.join(';');
}

/* 组装出页面可直接渲染的完整视图数据 */
function getDishView(dishId) {
  const dish = DISHES[dishId] || DISHES.hongyun;
  /* 小精灵站在右侧时，配菜布局整体镜像，避免挡住小精灵 */
  const mirrored = !!dish.elf.flip;
  const decos = dish.decos.map(function (name, i) {
    return {
      src: ASSET + 'deco_' + name + '.png',
      style: buildDecoStyle(DECO_SLOTS[i % DECO_SLOTS.length], mirrored)
    };
  });

  const elfStyle = ['width:220rpx', 'height:275rpx'];
  if (dish.elf.left) elfStyle.push('left:' + dish.elf.left);
  if (dish.elf.right) elfStyle.push('right:' + dish.elf.right);
  if (dish.elf.bottom) elfStyle.push('bottom:' + dish.elf.bottom);

  const steam = dish.steam.map(function (s) {
    return {
      style: ['left:' + s.left, 'width:' + s.size + 'rpx',
              'height:' + (s.size * 2.6) + 'rpx',
              'animation-delay:' + s.delay + 's',
              'animation-duration:' + s.duration + 's'].join(';')
    };
  });

  const imgStyle = dish.imageScale
    ? '--np-dish-scale:' + dish.imageScale
    : '';

  return {
    id: dish.id,
    title: dish.title,
    subtitle: dish.subtitle,
    tagline: dish.tagline,
    story: dish.story,
    fact: dish.fact,
    origin: dish.origin,
    index: ORDER.indexOf(dish.id) + 1,
    total: ORDER.length,
    part: dish.part,
    accent: dish.accent,
    dishImg: dish.dishImg,
    imgStyle: imgStyle,
    decos: decos,
    steam: steam,
    elf: dish.elf,
    elfStyle: elfStyle.join(';'),
    next: ORDER[(ORDER.indexOf(dish.id) + 1) % ORDER.length]
  };
}

function nextDish(dishId) {
  const i = ORDER.indexOf(dishId);
  return ORDER[(i + 1) % ORDER.length];
}

function pagePath(dishId) {
  return '/packageDish/pages/' + dishId + '/index';
}

module.exports = {
  DISHES: DISHES,
  ORDER: ORDER,
  getDishView: getDishView,
  nextDish: nextDish,
  pagePath: pagePath
};
