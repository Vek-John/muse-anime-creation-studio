export type ParameterField = {
  id: string;
  label: string;
  placeholder?: string;
  options: string[];
};

export type ParameterGroup = {
  id: string;
  index: string;
  title: string;
  description: string;
  fields: ParameterField[];
};

export const STYLE_ADAPTER_IDS = [
  "demonslayer",
  "naruto",
  "genshin",
  "onepiece",
  "luoxiaohei",
] as const;

export type StyleAdapterId = (typeof STYLE_ADAPTER_IDS)[number];

export type StyleAdapterConfig = {
  id: StyleAdapterId;
  selections: readonly string[];
  label: string;
  trigger: string;
  promptAdditions: readonly string[];
  defaultScale: number;
  minScale: number;
  maxScale: number;
  recommended: string;
  negativeAdditions: readonly string[];
  compatibilityNote?: string;
};

export const STYLE_ADAPTER_REGISTRY = {
  demonslayer: {
    id: "demonslayer",
    selections: [
      "鬼灭之刃画风",
      // Compatibility with selections saved before the label was clarified.
      "鬼灭之刃质感",
    ],
    label: "鬼灭之刃画风 LoRA",
    trigger: "demonslayer style",
    promptAdditions: ["original character"],
    defaultScale: 0.65,
    minScale: 0.3,
    maxScale: 1,
    recommended: "Euler Ancestral · 30 步 · CFG 6",
    negativeAdditions: [
      "official character",
      "character cosplay",
    ],
  },
  naruto: {
    id: "naruto",
    selections: ["火影忍者画风"],
    label: "火影忍者画风 LoRA",
    trigger: "in naruto-style",
    promptAdditions: [
      "original character",
      "ninja anime aesthetic",
      "cel shading",
    ],
    defaultScale: 0.65,
    minScale: 0.3,
    maxScale: 1,
    recommended: "Euler Ancestral · 28 步 · CFG 5",
    negativeAdditions: [
      "official character",
      "character cosplay",
      "franchise logo",
    ],
  },
  genshin: {
    id: "genshin",
    selections: ["原神风"],
    label: "原神人物风格 LoRA",
    trigger: "genshin-style character",
    promptAdditions: [
      "original character",
      "fantasy game illustration",
      "ornate anime costume",
    ],
    defaultScale: 0.6,
    minScale: 0.3,
    maxScale: 1,
    recommended: "Euler Ancestral · 28 步 · CFG 5",
    negativeAdditions: [
      "official character",
      "character cosplay",
      "game logo",
    ],
    compatibilityNote: "触发词根据发布者训练 caption 推断，需以实图回归为准。",
  },
  onepiece: {
    id: "onepiece",
    selections: ["海贼王手绘风"],
    label: "海贼王画风 LoRA（实验）",
    trigger: "one_piece_style",
    promptAdditions: [
      "original character",
      "adventure manga aesthetic",
      "expressive linework",
    ],
    defaultScale: 0.6,
    minScale: 0.3,
    maxScale: 1,
    recommended: "Euler Ancestral · 28 步 · CFG 5",
    negativeAdditions: [
      "official character",
      "character cosplay",
      "franchise logo",
    ],
    compatibilityNote: "跨 Illustrious → Animagine XL 适配，当前为实验模式。",
  },
  luoxiaohei: {
    id: "luoxiaohei",
    selections: ["罗小黑战记治愈风"],
    label: "罗小黑风格 LoRA",
    trigger: "muse_lxh_style",
    promptAdditions: [],
    defaultScale: 0.6,
    minScale: 0.3,
    maxScale: 1,
    recommended: "Euler Ancestral · 28 步 · CFG 5",
    negativeAdditions: [],
  },
} satisfies Record<StyleAdapterId, StyleAdapterConfig>;

const STYLE_ADAPTERS_BY_SELECTION = Object.fromEntries(
  Object.values(STYLE_ADAPTER_REGISTRY).flatMap((adapter) =>
    adapter.selections.map((selection) => [selection, adapter]),
  ),
) as Record<string, StyleAdapterConfig>;

export function styleAdapterForSelection(
  selection: string | undefined,
): StyleAdapterConfig | null {
  return selection ? STYLE_ADAPTERS_BY_SELECTION[selection] ?? null : null;
}

export const PARAMETER_GROUPS: ParameterGroup[] = [
  {
    id: "style",
    index: "01",
    title: "风格定位类",
    description: "确定画面的整体视觉语言",
    fields: [
      {
        id: "baseStyle",
        label: "基础画风",
        options: [
          "日系萌系",
          "古风仙侠",
          "赛博科幻",
          "机甲硬核",
          "水墨淡彩",
          "校园清新",
          "热血战斗",
          "清冷治愈",
          "厚涂写实",
          "线稿简约",
        ],
      },
      {
        id: "animeReference",
        label: "动漫 IP 衍生",
        options: [
          "原神风",
          "火影忍者画风",
          "鬼灭之刃画风",
          "海贼王手绘风",
          "罗小黑战记治愈风",
        ],
      },
      {
        id: "texture",
        label: "细节质感",
        options: [
          "4K 高清",
          "发丝清晰",
          "阴影柔和",
          "锐化聚焦",
          "低饱和",
          "马卡龙色调",
          "霓虹光效",
        ],
      },
    ],
  },
  {
    id: "character",
    index: "02",
    title: "核心形象类",
    description: "塑造角色外貌与人物设定",
    fields: [
      {
        id: "hairstyle",
        label: "发型（外貌特征）",
        options: [
          "双马尾",
          "高马尾",
          "短发狼尾",
          "长卷发",
          "呆毛",
          "粉毛",
          "蓝毛",
          "银发（异色发）",
          "渐变发色",
        ],
      },
      {
        id: "facialFeatures",
        label: "五官（外貌特征）",
        options: [
          "大眼睛",
          "异瞳",
          "浅杏眼",
          "微笑唇",
          "脸红娇羞",
          "清冷眼眸",
          "元气挑眉",
        ],
      },
      {
        id: "faceDetails",
        label: "面部细节",
        options: [
          "雀斑",
          "泪痣",
          "猫耳",
          "狐耳（兽耳）",
          "恶魔角",
          "口罩遮脸",
          "圆框眼镜",
          "方框眼镜",
        ],
      },
      {
        id: "campusIdentity",
        label: "校园身份（人设）",
        options: [
          "JK 制服女生",
          "校草风男生",
          "社团达人（动漫社）",
          "社团达人（汉服社）",
          "学霸",
          "篮球运动系",
          "足球运动系",
        ],
      },
      {
        id: "personality",
        label: "二次元人设",
        options: [
          "傲娇",
          "天然呆",
          "病娇",
          "中二",
          "温柔学长",
          "元气少女",
          "清冷御姐",
          "腹黑少年",
        ],
      },
      {
        id: "specialSetting",
        label: "特殊设定",
        options: [
          "情侣头像（双人互动）",
          "闺蜜头像（同款不同色）",
          "兄弟羁绊风",
        ],
      },
    ],
  },
  {
    id: "wardrobe",
    index: "03",
    title: "穿搭与配饰类",
    description: "组合服装风格与角色配件",
    fields: [
      {
        id: "outfit",
        label: "服装风格",
        options: [
          "JK 制服",
          "水手服",
          "汉服",
          "Lolita",
          "校园西装",
          "运动校服",
          "工装",
          "魔法学院服",
          "机甲战衣",
        ],
      },
      {
        id: "accessory",
        label: "配饰细节",
        options: [
          "猫耳发带",
          "星星发卡",
          "耳机",
          "项链",
          "书包",
          "棒球帽",
          "佩剑",
          "魔法杖",
          "围巾手套",
        ],
      },
    ],
  },
  {
    id: "pose",
    index: "04",
    title: "动作与姿态类",
    description: "控制构图视角和人物动作",
    fields: [
      {
        id: "pose",
        label: "基础姿态",
        options: [
          "正面视角",
          "侧脸",
          "半身像",
          "全身像",
          "坐姿",
          "站姿",
          "低头浅笑",
          "抬头望天",
        ],
      },
      {
        id: "interaction",
        label: "互动动作",
        options: [
          "比耶",
          "托腮",
          "挥手",
          "递情书",
          "背靠背（情侣）",
          "并肩走",
          "摸头杀",
          "对视微笑",
        ],
      },
      {
        id: "atmosphereAction",
        label: "氛围动作",
        options: [
          "吹樱花",
          "戴耳机听歌",
          "翻漫画书",
          "打篮球",
          "魔法施法",
          "战斗姿势",
        ],
      },
    ],
  },
  {
    id: "scene",
    index: "05",
    title: "场景与背景类",
    description: "搭建角色所处的空间环境",
    fields: [
      {
        id: "campusScene",
        label: "校园场景",
        options: [
          "樱花树下",
          "教室窗边",
          "操场跑道",
          "图书馆",
          "放学小路",
          "天台",
        ],
      },
      {
        id: "animeScene",
        label: "二次元场景",
        options: [
          "星空下",
          "海边落日",
          "雨夜公交站",
          "异世界森林",
          "赛博朋克街道",
          "古风庭院",
        ],
      },
      {
        id: "background",
        label: "背景简化",
        options: [
          "纯白背景",
          "粉色背景",
          "蓝色背景",
          "渐变背景",
          "模糊光斑",
          "留白设计",
        ],
      },
    ],
  },
  {
    id: "mood",
    index: "06",
    title: "氛围与情绪类",
    description: "定义画面的情感和气质",
    fields: [
      {
        id: "emotion",
        label: "情绪表达",
        options: [
          "元气满满",
          "温柔治愈",
          "清冷疏离",
          "傲娇炸毛",
          "害羞脸红",
          "热血激昂",
          "厌世感",
        ],
      },
      {
        id: "tone",
        label: "氛围基调",
        options: [
          "甜妹感",
          "盐系",
          "氛围感",
          "高级小众",
          "甜而不腻",
          "酷飒拽",
        ],
      },
    ],
  },
  {
    id: "social",
    index: "07",
    title: "社交适配类",
    description: "匹配头像、海报和发布平台",
    fields: [
      {
        id: "format",
        label: "尺寸适配",
        options: [
          "微信头像",
          "QQ 头像",
          "小红书头像",
          "微博头像",
          "正方形裁剪兼容",
          "圆形裁剪兼容",
        ],
      },
      {
        id: "usage",
        label: "特殊需求",
        options: [
          "无水印",
          "高清无噪点",
          "不撞款",
          "小众设计",
          "社团海报构图",
        ],
      },
    ],
  },
];

// Compatibility exports used by reports and tests. Visible controls start
// empty; the compiler adds only its small, disposable human-integrity baseline.
export const DEFAULT_QUALITY_GUARDS = [] as const;

export const DEFAULT_SELECTIONS: Record<string, string> = {};
