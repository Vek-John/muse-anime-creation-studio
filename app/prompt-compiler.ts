import {
  QUALITY_SUFFIX,
  RATING_TAG,
  toModelPrompt,
} from "./prompt-tags";
import {
  PARAMETER_GROUPS,
  styleAdapterForSelection,
} from "./studio-config";

export type PromptSlot =
  | "subject"
  | "identity"
  | "custom"
  | "rating"
  | "framing"
  | "action"
  | "appearance"
  | "outfit"
  | "scene"
  | "mood"
  | "style"
  | "quality"
  | "suffix";

export type PromptSegment = {
  id: string;
  label: string;
  text: string;
  slot: PromptSlot;
  priority: 0 | 1 | 2 | 3;
  protected: boolean;
};

export type PromptCompileResult = {
  prompt: string;
  segments: PromptSegment[];
  warnings: string[];
  negativeAdditions: string[];
  negativeRemovals: string[];
  subject: string;
  subjectKind: SubjectKind | null;
  expectedSubject: SubjectKind | null;
  backgroundMode: "none" | "white";
  inputOverrideFields: string[];
};

type FieldRule = {
  slot: PromptSlot;
  priority: 0 | 1 | 2 | 3;
  protected?: boolean;
};

export type SubjectKind =
  | "human"
  | "female"
  | "male"
  | "female_pair"
  | "male_pair"
  | "mixed";

type SubjectSignal = {
  kind: SubjectKind;
  label: string;
  start: number;
  end: number;
  adult: boolean;
  elderly: boolean;
  specificity: number;
};

type CustomIntent = {
  subject: SubjectSignal | null;
  conflictingSubjects: SubjectSignal[];
  tags: string[];
  overrideFields: Set<string>;
  crossdressing: boolean;
  fullBody: boolean;
  whiteBackground: boolean;
};

type SubjectCandidate = {
  kind: SubjectKind;
  fieldId: string;
  value: string;
  rank: number;
};

type GuardIntent = {
  nonHuman: boolean;
  multipleSubjects: boolean;
  integrityOverrides: Set<string>;
};

const SLOT_ORDER: Record<PromptSlot, number> = {
  subject: 0,
  custom: 1,
  identity: 2,
  rating: 3,
  framing: 4,
  action: 5,
  appearance: 6,
  outfit: 7,
  scene: 8,
  mood: 9,
  style: 10,
  quality: 11,
  suffix: 12,
};

export const FIELD_RULES: Record<string, FieldRule> = {
  baseStyle: { slot: "style", priority: 1 },
  animeReference: { slot: "style", priority: 2 },
  texture: { slot: "quality", priority: 2 },
  hairstyle: { slot: "appearance", priority: 2 },
  facialFeatures: { slot: "appearance", priority: 1 },
  faceDetails: { slot: "appearance", priority: 2 },
  campusIdentity: { slot: "identity", priority: 1 },
  personality: { slot: "identity", priority: 2 },
  specialSetting: { slot: "identity", priority: 0 },
  outfit: { slot: "outfit", priority: 1 },
  accessory: { slot: "outfit", priority: 3 },
  pose: { slot: "framing", priority: 0, protected: true },
  interaction: { slot: "action", priority: 0, protected: true },
  atmosphereAction: { slot: "action", priority: 0, protected: true },
  campusScene: { slot: "scene", priority: 1 },
  animeScene: { slot: "scene", priority: 1 },
  background: { slot: "scene", priority: 1 },
  emotion: { slot: "mood", priority: 2 },
  tone: { slot: "mood", priority: 3 },
  format: { slot: "framing", priority: 1 },
  usage: { slot: "quality", priority: 3 },
};

const FIELD_LABELS = Object.fromEntries(
  PARAMETER_GROUPS.flatMap((group) =>
    group.fields.map((field) => [field.id, field.label]),
  ),
);

const FIELD_ORDER = new Map(
  PARAMETER_GROUPS.flatMap((group) => group.fields).map((field, index) => [
    field.id,
    index,
  ]),
);

const SUBJECT_TAGS = new Set([
  "1girl",
  "1boy",
  "1woman",
  "1man",
  "1female",
  "1male",
  "2girls",
  "2boys",
  "2women",
  "2men",
  "2females",
  "2males",
  "solo",
  "male focus",
  "female focus",
  "1boy and 1girl",
  "1girl and 1boy",
]);

const SOLID_BACKGROUNDS = new Set([
  "纯白背景",
  "粉色背景",
  "蓝色背景",
  "渐变背景",
]);

const CIRCULAR_CROP_CONFLICTING_POSES = new Set([
  "侧脸",
  "半身像",
  "全身像",
]);

const STRUCTURED_SUBJECTS: Record<string, SubjectKind> = {
  "情侣头像（双人互动）": "mixed",
  "闺蜜头像（同款不同色）": "female_pair",
  兄弟羁绊风: "male_pair",
  "JK 制服女生": "female",
  校草风男生: "male",
  温柔学长: "male",
  腹黑少年: "male",
  元气少女: "female",
  清冷御姐: "female",
};

const SUBJECT_RANK: Record<string, number> = {
  specialSetting: 0,
  campusIdentity: 1,
  personality: 2,
};

const FRAMING_TAGS = new Set([
  "portrait",
  "headshot",
  "close-up",
  "upper body",
  "full body",
  "cowboy shot",
  "front view",
  "profile",
  "centered composition",
  "centered subject",
  "head-to-toe",
  "feet visible",
  "wide shot",
]);

const ACTION_PATTERN =
  /\b(looking|walking|waving|holding|giving|offering|reading|playing|dribbling|casting|blowing|fighting|running|jumping|dancing|pose|smile|back-to-back)\b/i;
const ACTION_TAGS = new Set(["raised hand", "open hand"]);

const STANCE_PATTERN =
  /\b(sitting|standing|kneeling|lying|crouching)\b/i;

const OUTFIT_PATTERN =
  /\b(uniform|outfit|clothes|clothing|dress|skirt|pants|trousers|shirt|blazer|jacket|coat|sweater|hoodie|kimono|hanfu|lolita|armor|workwear|crossdressing)\b/i;

const SCENE_PATTERN =
  /\b(background|indoors|outdoors|classroom|school rooftop|library|forest|street|beach|seaside|courtyard|bus stop|running track)\b/i;

const WEATHER_PATTERN =
  /\b(rain|rainy|raining|heavy rain|rainstorm|thunderstorm|storm|snow|snowy|blizzard|fog|foggy|thunder|lightning)\b|雨|暴雨|大雨|暴风雨|雨天|下雨|雪|暴雪|雾|雷电/i;

const STYLE_PATTERN =
  /\b(anime style|art style|visual style|aesthetic|painting|painterly|lineart|realistic|watercolor|ink wash|cel shading|illustration)\b/i;

const HAIR_PATTERN = /\b(hair|hairstyle|twintails|ponytail|ahoge)\b/i;
const FACE_PATTERN = /\b(eyes?|face|gaze|eyebrow|smile|blush)\b/i;
const FACE_DETAIL_PATTERN =
  /\b(freckles|mole|cat ears|fox ears|horns|mask|glasses)\b/i;
const MOOD_PATTERN =
  /\b(cheerful|energetic|gentle|soothing|cool|distant|shy|passionate|intense|world-weary|sweet|confident|edgy|sad|angry|happy)\b/i;

const HARD_NON_HUMAN_PATTERN =
  /\b(?:no humans?|without (?:a |any )?(?:person|people|human|character)s?)\b|(?:无人|无人物|不要人物|没有人物|不出现人物)/i;

const NON_HUMAN_PATTERN =
  /\b(?:landscape|scenery|still life|object(?: focus| only)?|animal(?: focus| only)?|robot(?: focus| only)?|mecha(?: focus| only)?|vehicle(?: focus| only)?|architecture|background only|empty (?:room|street|scene))\b|(?:纯风景|风景画|静物|物品主体|动物主体|机器人主体|纯机甲|车辆主体|建筑主体|空房间|空街道|空场景)/i;

const MULTIPLE_SUBJECT_PATTERN =
  /\b(?:multiple (?:people|boys|girls|characters)|group|crowd|duo|trio|team|couple)\b|(?:多人|群像|一群人|双人|三人|情侣)/i;

const HUMAN_IMPLYING_SELECTION_FIELDS = new Set([
  "hairstyle",
  "facialFeatures",
  "faceDetails",
  "campusIdentity",
  "personality",
  "specialSetting",
  "outfit",
  "accessory",
]);

const NON_HUMAN_CONFLICTING_SELECTION_FIELDS = new Set([
  ...HUMAN_IMPLYING_SELECTION_FIELDS,
  "pose",
  "interaction",
  "atmosphereAction",
]);

const MALE_KINDS = new Set<SubjectKind>(["male", "male_pair"]);
const FEMALE_KINDS = new Set<SubjectKind>(["female", "female_pair"]);

function splitTags(value: string): string[] {
  return value
    .split(/[,，\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function subjectText(
  kind: SubjectKind,
  integrityOverrides: Set<string> = new Set(),
): string {
  if (kind === "human") return "solo";
  if (kind === "male") {
    const tags = [
      "1boy",
      "solo",
      "male focus",
      "masculine face",
      "broad shoulders",
      "flat chest",
    ];
    if (integrityOverrides.size > 0) {
      return tags.filter((tag) => tag !== "masculine face").join(", ");
    }
    return tags.join(", ");
  }
  if (kind === "female_pair") return "2girls";
  if (kind === "male_pair") return "2boys, male focus";
  if (kind === "mixed") return "1boy, 1girl";
  return "1girl, solo";
}

function analyzeGuardIntent(
  description: string,
  selections: Record<string, string>,
  hasExplicitSubject: boolean,
): GuardIntent {
  const selectionEntries = orderedSelectionEntries(selections);
  const selectedText = selectionEntries
    .flatMap(([, value]) => [value, toModelPrompt(value)])
    .join(", ");
  const descriptionText = normalized(description);
  const normalizedSelectedText = normalized(selectedText);
  const text = normalized(`${descriptionText}, ${normalizedSelectedText}`);
  const hardNonHuman = HARD_NON_HUMAN_PATTERN.test(text);
  const selectionsImplyHuman = selectionEntries.some(([fieldId]) =>
    HUMAN_IMPLYING_SELECTION_FIELDS.has(fieldId),
  );
  const nonHuman =
    hardNonHuman ||
    (!hasExplicitSubject && NON_HUMAN_PATTERN.test(descriptionText)) ||
    (!hasExplicitSubject &&
      !selectionsImplyHuman &&
      NON_HUMAN_PATTERN.test(normalizedSelectedText));
  const integrityOverrides = new Set<string>();

  if (/\bfaceless(?: male| female)?\b|无脸/i.test(text)) {
    integrityOverrides.add("faceless");
  }
  if (/\bheadless\b|无头/i.test(text)) {
    integrityOverrides.add("headless");
  }
  if (
    /\b(?:head out of frame|cropped head)\b|头部出框|头部不入镜/i.test(
      text,
    )
  ) {
    integrityOverrides.add("head out of frame");
  }

  return {
    nonHuman,
    multipleSubjects: MULTIPLE_SUBJECT_PATTERN.test(text),
    integrityOverrides,
  };
}

function collectSubjectSignals(
  description: string,
  pattern: RegExp,
  kind: SubjectKind,
  {
    adult = false,
    elderly = false,
    specificity = 1,
  }: {
    adult?: boolean;
    elderly?: boolean;
    specificity?: number;
  } = {},
): SubjectSignal[] {
  const expression = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  return [...description.matchAll(expression)].map((match) => ({
    kind,
    label: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    adult,
    elderly,
    specificity,
  }));
}

function exactSubjectSignal(
  tag: string,
  start: number,
): SubjectSignal | null {
  const key = normalized(tag);
  const create = (
    kind: SubjectKind,
    adult = false,
    elderly = false,
  ): SubjectSignal => ({
    kind,
    label: tag,
    start,
    end: start + tag.length,
    adult,
    elderly,
    specificity: 2,
  });

  if (
    /^(?:1boy and 1girl|1girl and 1boy|1man and 1woman|1woman and 1man|one man and one woman|one woman and one man|一男一女)$/.test(
      key,
    )
  ) {
    return create("mixed", true);
  }
  if (/^(?:2boys|2men|2males|two boys|two men|两个男生|两个男人|双男)$/.test(key)) {
    return create("male_pair", /\b(?:men|males)\b/.test(key));
  }
  if (
    /^(?:2girls|2women|2females|two girls|two women|两个女生|两个女人|双女)$/.test(
      key,
    )
  ) {
    return create("female_pair", /\b(?:women|females)\b/.test(key));
  }
  if (
    /^(?:1boy|one boy|single boy|boy|male focus|男生|男孩|少年|校草)$/.test(
      key,
    )
  ) {
    return create("male");
  }
  if (
    /^(?:1man|1male|one man|single man|man|male|adult male|mature male|old man|elderly male|男人|男性|成年男性|老男人|老年男性)$/.test(
      key,
    )
  ) {
    return create(
      "male",
      true,
      /^(?:old man|elderly male|老男人|老年男性)$/.test(key),
    );
  }
  if (
    /^(?:1girl|one girl|single girl|girl|female focus|女生|女孩|少女)$/.test(
      key,
    )
  ) {
    return create("female");
  }
  if (
    /^(?:1woman|1female|one woman|single woman|woman|female|adult female|mature woman|old woman|elderly female|女人|女性|成年女性|老年女性)$/.test(
      key,
    )
  ) {
    return create(
      "female",
      true,
      /^(?:old woman|elderly female|老年女性)$/.test(key),
    );
  }
  return null;
}

function descriptionSubject(description: string): {
  subject: SubjectSignal | null;
  conflictingSubjects: SubjectSignal[];
} {
  const pairSignals = [
    ...collectSubjectSignals(
      description,
      /\b(?:1boy|1man|1male|one boy|one man)\s*(?:and|&|\+)\s*(?:1girl|1woman|1female|one girl|one woman)\b/gi,
      "mixed",
      { adult: true, specificity: 4 },
    ),
    ...collectSubjectSignals(
      description,
      /\b(?:1girl|1woman|1female|one girl|one woman)\s*(?:and|&|\+)\s*(?:1boy|1man|1male|one boy|one man)\b/gi,
      "mixed",
      { adult: true, specificity: 4 },
    ),
    ...collectSubjectSignals(description, /一男一女/g, "mixed", {
      adult: true,
      specificity: 4,
    }),
  ];

  const signals: SubjectSignal[] = [
    ...pairSignals,
    ...collectSubjectSignals(
      description,
      /\b(?:2boys|two boys)\b/gi,
      "male_pair",
      { specificity: 3 },
    ),
    ...collectSubjectSignals(
      description,
      /\b(?:2men|2males|two men)\b/gi,
      "male_pair",
      { adult: true, specificity: 3 },
    ),
    ...collectSubjectSignals(
      description,
      /\b(?:2girls|two girls)\b/gi,
      "female_pair",
      { specificity: 3 },
    ),
    ...collectSubjectSignals(
      description,
      /\b(?:2women|2females|two women)\b/gi,
      "female_pair",
      { adult: true, specificity: 3 },
    ),
    ...collectSubjectSignals(description, /\b1boy\b/gi, "male", {
      specificity: 3,
    }),
    ...collectSubjectSignals(
      description,
      /\b(?:1man|1male)\b/gi,
      "male",
      { adult: true, specificity: 3 },
    ),
    ...collectSubjectSignals(description, /\b1girl\b/gi, "female", {
      specificity: 3,
    }),
    ...collectSubjectSignals(
      description,
      /\b(?:1woman|1female)\b/gi,
      "female",
      { adult: true, specificity: 3 },
    ),
    ...collectSubjectSignals(
      description,
      /\b(?:adult male|mature male|old man|elderly male)\b/gi,
      "male",
      { adult: true, specificity: 2 },
    ),
    ...collectSubjectSignals(
      description,
      /\b(?:adult female|mature woman|old woman|elderly female)\b/gi,
      "female",
      { adult: true, specificity: 2 },
    ),
    ...collectSubjectSignals(
      description,
      /(?:两个男生|两个男人|双男)/g,
      "male_pair",
      { adult: true, specificity: 3 },
    ),
    ...collectSubjectSignals(
      description,
      /(?:两个女生|两个女人|双女)/g,
      "female_pair",
      { adult: true, specificity: 3 },
    ),
    ...collectSubjectSignals(
      description,
      /(?:老年男性|老男人)/g,
      "male",
      { adult: true, elderly: true, specificity: 3 },
    ),
    ...collectSubjectSignals(
      description,
      /(?:成年男性|男人|男性)/g,
      "male",
      { adult: true, specificity: 2 },
    ),
    ...collectSubjectSignals(
      description,
      /(?:男生|男孩|少年|校草|男扮女装)/g,
      "male",
      { specificity: 2 },
    ),
    ...collectSubjectSignals(
      description,
      /(?:老年女性)/g,
      "female",
      { adult: true, elderly: true, specificity: 3 },
    ),
    ...collectSubjectSignals(
      description,
      /(?:成年女性|女人|女性)/g,
      "female",
      { adult: true, specificity: 2 },
    ),
    ...collectSubjectSignals(
      description,
      /(?:女生|女孩|少女)/g,
      "female",
      { specificity: 2 },
    ),
  ];

  let cursor = 0;
  for (const tag of splitTags(description)) {
    const start = description.toLowerCase().indexOf(tag.toLowerCase(), cursor);
    const resolvedStart = start >= 0 ? start : cursor;
    const exact = exactSubjectSignal(tag, resolvedStart);
    if (exact) signals.push(exact);
    cursor = resolvedStart + tag.length;
  }

  const filtered = signals.filter(
    (signal) =>
      signal.kind === "mixed" ||
      !pairSignals.some(
        (pair) => signal.start >= pair.start && signal.end <= pair.end,
      ),
  );
  filtered.sort(
    (a, b) =>
      a.start - b.start ||
      a.end - b.end ||
      a.specificity - b.specificity,
  );
  const subject = filtered.at(-1) ?? null;
  if (!subject) return { subject: null, conflictingSubjects: [] };

  const conflictingSubjects = filtered.filter(
    (signal) => signal.kind !== subject.kind,
  );
  return { subject, conflictingSubjects };
}

function isSubjectOnlyTag(tag: string): boolean {
  return exactSubjectSignal(tag, 0) !== null || normalized(tag) === "solo";
}

function cleanupRemainder(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[\s:;，,、+\-]+|[\s:;，,、+\-]+$/g, "")
    .trim();
}

function normalizeCustomTags(
  description: string,
  canonical: SubjectKind | null,
  subject: SubjectSignal | null,
  crossdressing: boolean,
): string[] {
  const tags: string[] = [];
  const add = (...values: string[]) => tags.push(...values.filter(Boolean));
  const isMale = canonical ? MALE_KINDS.has(canonical) : false;
  const isFemale = canonical ? FEMALE_KINDS.has(canonical) : false;
  const hasElderlyIntent =
    /\b(?:old|elderly|old man|old woman)\b|老年|年老|老男人|老年男性|老年女性/i.test(
      description,
    );

  if (subject?.adult && !hasElderlyIntent) {
    if (isMale) add("adult male");
    if (isFemale) add("adult female");
  }
  if (subject?.elderly) {
    if (isMale) add("old man", "wrinkles");
    if (isFemale) add("old woman", "wrinkles");
  }

  for (const rawTag of splitTags(description)) {
    if (isSubjectOnlyTag(rawTag)) {
      continue;
    }

    let remainder = rawTag;
    remainder = remainder
      .replace(
        /\b(?:1boy|1man|1male|1girl|1woman|1female|2boys|2men|2males|2girls|2women|2females)\b/gi,
        " ",
      )
      .replace(
        /(?:老年男性|老男人|成年男性|男人|男性|男生|男孩|少年|校草|老年女性|成年女性|女人|女性|女生|女孩|少女)/g,
        " ",
      );

    if (
      /\b(?:cross[- ]?dress(?:ing|ed)?|crossdresser|femboy|otoko no ko)\b|男扮女装|女装/i.test(
        remainder,
      )
    ) {
      add("crossdressing", "masculine male", "flat chest");
      remainder = remainder.replace(
        /\b(?:cross[- ]?dress(?:ing|ed)?|crossdresser|femboy|otoko no ko)\b|男扮女装|女装/gi,
        " ",
      );
    }

    if (/\b(?:sailor uniform|serafuku)\b|水手服/i.test(remainder)) {
      if (isMale && crossdressing) {
        add(
          "crossdressing",
          "masculine male",
          "flat chest",
          "sailor uniform",
          "sailor collar",
          "pleated skirt",
        );
      } else if (isMale) {
        add(
          "male sailor-style school uniform",
          "sailor collar",
          "long sleeves",
          "trousers",
          ...(hasElderlyIntent
            ? []
            : ["male student", "short hair", "masculine face"]),
        );
      } else {
        add("sailor uniform");
      }
      remainder = remainder.replace(
        /\b(?:sailor uniform|serafuku)\b|水手服/gi,
        " ",
      );
    }

    if (/\b(?:female\s+)?school uniform\b|校服|学校制服/i.test(remainder)) {
      if (isMale && crossdressing) {
        add(
          "crossdressing",
          "masculine male",
          "flat chest",
          "school uniform",
          "pleated skirt",
        );
      } else if (isMale) {
        add(
          "male school uniform",
          "trousers",
          ...(hasElderlyIntent
            ? []
            : ["male student", "short hair", "masculine face"]),
        );
      } else {
        add("school uniform");
      }
      remainder = remainder.replace(
        /\b(?:female\s+)?school uniform\b|校服|学校制服/gi,
        " ",
      );
    }

    if (
      /\b(?:top[\s-]*to[\s-]*toe|head[\s-]*to[\s-]*toe|from head to toe)\b|从头到脚|全身像?/i.test(
        remainder,
      )
    ) {
      add("full body", "wide shot", "head-to-toe", "feet visible");
      remainder = remainder.replace(
        /\b(?:top[\s-]*to[\s-]*toe|head[\s-]*to[\s-]*toe|from head to toe)\b|从头到脚|全身像?/gi,
        " ",
      );
    }

    if (/\b(?:yellow|golden)[- ]hair(?:ed)?\b|黄发|金发/i.test(remainder)) {
      add("blonde hair");
      remainder = remainder.replace(
        /\b(?:yellow|golden)[- ]hair(?:ed)?\b|黄发|金发/gi,
        " ",
      );
    }

    if (
      /\b(?:japanese clothes|japanese clothing|japanese attire)\b|日式服装|日式衣装/i.test(
        remainder,
      )
    ) {
      add("japanese clothes");
      remainder = remainder.replace(
        /\b(?:japanese clothes|japanese clothing|japanese attire)\b|日式服装|日式衣装/gi,
        " ",
      );
    }

    if (
      /\b(?:under (?:the )?)?(?:heavy rain|rainstorm|thunderstorm)\b|(?:暴雨|大雨|暴风雨)中?/i.test(remainder)
    ) {
      add("rain", "wet", "wet clothes", "cloudy sky", "outdoors");
      remainder = remainder.replace(
        /\b(?:under (?:the )?)?(?:heavy rain|rainstorm|thunderstorm)\b|(?:暴雨|大雨|暴风雨)中?/gi,
        " ",
      );
    } else if (
      /\b(?:under (?:the )?)?(?:rain|rainy|raining)\b|雨中|雨天|下雨/i.test(
        remainder,
      )
    ) {
      add("rain", "wet clothes", "cloudy sky", "outdoors");
      remainder = remainder.replace(
        /\b(?:under (?:the )?)?(?:rain|rainy|raining)\b|雨中|雨天|下雨/gi,
        " ",
      );
    }

    if (/^(?:old|elderly|年老|老年)$/i.test(cleanupRemainder(remainder))) {
      if (isMale) {
        add("old man", "wrinkles", "grey hair", "facial hair", "beard");
      } else if (isFemale) {
        add("old woman", "elderly", "wrinkles", "grey hair");
      } else {
        add("elderly", "wrinkles");
      }
      remainder = " ";
    }

    if (/^(?:adult|mature|成年)$/i.test(cleanupRemainder(remainder))) {
      if (isMale) add("adult male");
      else if (isFemale) add("adult female");
      else add("adult");
      remainder = " ";
    }

    const chineseAliases: Array<[RegExp, string[]]> = [
      [/(?:站立|站着)/g, ["standing"]],
      [/(?:坐着|坐姿)/g, ["sitting"]],
      [/(?:挥手)/g, ["waving", "raised hand", "open hand"]],
      [/(?:看向镜头|看着观众|直视镜头)/g, ["looking at viewer"]],
      [/(?:打篮球)/g, ["dribbling a basketball", "visible basketball"]],
      [
        /(?:纯白背景|白色背景)/g,
        ["white background", "simple background", "pure white background"],
      ],
      [
        /(?:水彩风格|水彩画风)/g,
        ["watercolor \\(medium\\)", "traditional media"],
      ],
      [/(?:日系动漫|动漫风格)/g, ["anime style"]],
    ];
    for (const [pattern, replacements] of chineseAliases) {
      if (pattern.test(remainder)) {
        add(...replacements);
        pattern.lastIndex = 0;
        remainder = remainder.replace(pattern, " ");
      }
      pattern.lastIndex = 0;
    }

    if (/^waving$/i.test(cleanupRemainder(remainder))) {
      add("waving", "raised hand", "open hand");
      remainder = " ";
    }

    if (/\bwatercolou?r(?: style| painting)?\b/i.test(remainder)) {
      add("watercolor \\(medium\\)", "traditional media");
      remainder = remainder.replace(
        /\bwatercolou?r(?: style| painting)?\b/gi,
        " ",
      );
    }

    if (/校草/.test(rawTag)) {
      add("handsome male student", "masculine face");
    }

    const cleaned = cleanupRemainder(remainder);
    if (cleaned && !isSubjectOnlyTag(cleaned)) add(cleaned);
  }
  return tags;
}

function detectOverrideFields(
  description: string,
  tags: string[],
): Set<string> {
  const text = normalized(`${description}, ${tags.join(", ")}`);
  const fields = new Set<string>();

  if (
    /\b(full body|head-to-toe|feet visible|wide shot|upper body|close-up|headshot|portrait|cowboy shot|front view|profile)\b|全身|半身|特写|侧脸|正面视角/i.test(
      text,
    )
  ) {
    fields.add("pose");
    fields.add("format");
  }
  if (STANCE_PATTERN.test(text)) fields.add("pose");
  if (ACTION_PATTERN.test(text)) {
    fields.add("interaction");
    fields.add("atmosphereAction");
  }
  if (OUTFIT_PATTERN.test(text) || /制服|校服|水手服|裙|裤|西装|穿着|服装/.test(text)) {
    fields.add("outfit");
  }
  if (
    SCENE_PATTERN.test(text) ||
    WEATHER_PATTERN.test(text) ||
    /背景|教室|天台|图书馆|森林|街道|海边|庭院|公交站/.test(text)
  ) {
    fields.add("campusScene");
    fields.add("animeScene");
    fields.add("background");
  }
  if (
    /\b(heavy rain|rainstorm|thunderstorm|storm|blizzard|thunder|lightning)\b|暴雨|大雨|暴风雨|暴雪|雷电/i.test(
      text,
    )
  ) {
    fields.add("emotion");
    fields.add("tone");
  }
  if (STYLE_PATTERN.test(text) || /画风|风格|写实|水墨|线稿/.test(text)) {
    fields.add("baseStyle");
    fields.add("animeReference");
  }
  if (HAIR_PATTERN.test(text) || /发型|头发|发色/.test(text)) {
    fields.add("hairstyle");
  }
  if (FACE_PATTERN.test(text) || /眼睛|眼眸|眉|微笑|脸红/.test(text)) {
    fields.add("facialFeatures");
  }
  if (FACE_DETAIL_PATTERN.test(text) || /雀斑|泪痣|兽耳|恶魔角|口罩|眼镜/.test(text)) {
    fields.add("faceDetails");
  }
  if (MOOD_PATTERN.test(text) || /开心|悲伤|愤怒|害羞|温柔|清冷|热血|厌世/.test(text)) {
    fields.add("emotion");
    fields.add("tone");
  }
  return fields;
}

function buildCustomIntent(
  description: string,
  canonical: SubjectKind | null,
  subjectResult: ReturnType<typeof descriptionSubject>,
): CustomIntent {
  const crossdressing =
    /\b(?:cross[- ]?dress(?:ing|ed)?|crossdresser|femboy|otoko no ko)\b|男扮女装|女装/i.test(
      description,
    );
  const tags = normalizeCustomTags(
    description,
    canonical,
    subjectResult.subject,
    crossdressing,
  );
  const joined = normalized(`${description}, ${tags.join(", ")}`);
  return {
    subject: subjectResult.subject,
    conflictingSubjects: subjectResult.conflictingSubjects,
    tags,
    overrideFields: detectOverrideFields(description, tags),
    crossdressing,
    fullBody:
      /\b(full body|head-to-toe|feet visible|wide shot|top[\s-]*to[\s-]*toe|from head to toe)\b|从头到脚|全身像?/i.test(
        joined,
      ),
    whiteBackground:
      /\b(?:white|pure white|plain white) background\b|纯白背景/i.test(
        joined,
      ),
  };
}

function applyIntegrityOverrides(
  customIntent: CustomIntent,
  guardIntent: GuardIntent,
): void {
  if (guardIntent.integrityOverrides.size === 0) return;

  customIntent.overrideFields.add("facialFeatures");
  customIntent.overrideFields.add("faceDetails");

  const headIsHidden =
    guardIntent.integrityOverrides.has("headless") ||
    guardIntent.integrityOverrides.has("head out of frame");
  if (headIsHidden) {
    customIntent.overrideFields.add("hairstyle");
  }

  const conflictingAutomaticTraits = new Set([
    "masculine face",
    "facial hair",
    "beard",
    ...(headIsHidden ? ["short hair", "grey hair"] : []),
  ]);
  customIntent.tags = customIntent.tags.filter(
    (tag) => !conflictingAutomaticTraits.has(normalized(tag)),
  );
}

function subjectsConflict(canonical: SubjectKind, selected: SubjectKind): boolean {
  if (canonical === "human") return false;
  if (canonical === "mixed") return false;
  if (canonical === "female_pair") {
    return selected === "male" || selected === "male_pair" || selected === "mixed";
  }
  if (canonical === "male_pair") {
    return selected === "female" || selected === "female_pair" || selected === "mixed";
  }
  if (canonical === "female") {
    return selected === "male" || selected === "male_pair" || selected === "mixed";
  }
  return selected === "female" || selected === "female_pair" || selected === "mixed";
}

function classifyCustomTag(tag: string): Pick<
  PromptSegment,
  "slot" | "priority" | "protected"
> {
  const key = normalized(tag);
  if (
    FRAMING_TAGS.has(key) ||
    /\b(full body|head-to-toe|feet visible|wide shot|upper body|close-up|headshot|cowboy shot|front view|profile)\b/i.test(
      key,
    ) ||
    STANCE_PATTERN.test(key)
  ) {
    return { slot: "framing", priority: 0, protected: true };
  }
  if (ACTION_PATTERN.test(tag) || ACTION_TAGS.has(key)) {
    return { slot: "action", priority: 0, protected: true };
  }
  return { slot: "custom", priority: 0, protected: true };
}

function dedupeSegments(segments: PromptSegment[]): PromptSegment[] {
  const seen = new Set<string>();
  const result: PromptSegment[] = [];

  for (const segment of segments) {
    const tags = splitTags(segment.text).filter((tag) => {
      const key = normalized(tag);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (tags.length) {
      result.push({ ...segment, text: tags.join(", ") });
    }
  }
  return result;
}

export function orderedSelectionEntries(
  selections: Record<string, string>,
): [string, string][] {
  return Object.entries(selections)
    .filter(([, value]) => Boolean(value))
    .sort(([fieldA], [fieldB]) => {
      const indexA = FIELD_ORDER.get(fieldA) ?? Number.MAX_SAFE_INTEGER;
      const indexB = FIELD_ORDER.get(fieldB) ?? Number.MAX_SAFE_INTEGER;
      return indexA - indexB || fieldA.localeCompare(fieldB);
    });
}

export function resolveSelectionChange(
  current: Record<string, string>,
  fieldId: string,
  value: string,
): { selections: Record<string, string>; notices: string[] } {
  const selections = { ...current };
  const notices: string[] = [];

  if (!value) {
    delete selections[fieldId];
    return { selections, notices };
  }

  selections[fieldId] = value;

  if (fieldId === "campusScene") {
    if (selections.animeScene) {
      delete selections.animeScene;
      notices.push("已移除二次元场景：同一画面只保留一个主场景。");
    }
    if (SOLID_BACKGROUNDS.has(selections.background)) {
      delete selections.background;
      notices.push("已移除纯色背景：场景与纯色背景不能同时作为主背景。");
    }
  }

  if (fieldId === "animeScene") {
    if (selections.campusScene) {
      delete selections.campusScene;
      notices.push("已移除校园场景：同一画面只保留一个主场景。");
    }
    if (SOLID_BACKGROUNDS.has(selections.background)) {
      delete selections.background;
      notices.push("已移除纯色背景：场景与纯色背景不能同时作为主背景。");
    }
  }

  if (fieldId === "background" && SOLID_BACKGROUNDS.has(value)) {
    if (selections.campusScene || selections.animeScene) {
      delete selections.campusScene;
      delete selections.animeScene;
      notices.push("已移除场景：纯色背景会单独控制画面背景。");
    }
  }

  if (
    fieldId === "format" &&
    value === "圆形裁剪兼容" &&
    CIRCULAR_CROP_CONFLICTING_POSES.has(selections.pose)
  ) {
    delete selections.pose;
    notices.push("已移除冲突姿态：圆形裁剪将自动使用居中安全构图。");
  }

  if (
    fieldId === "pose" &&
    CIRCULAR_CROP_CONFLICTING_POSES.has(value) &&
    selections.format === "圆形裁剪兼容"
  ) {
    delete selections.format;
    notices.push("已移除圆形裁剪：当前姿态将作为最新的构图要求。");
  }

  if (fieldId === "interaction" && selections.atmosphereAction) {
    delete selections.atmosphereAction;
    notices.push("已移除氛围动作：每次只保留一个核心动作。");
  }

  if (fieldId === "atmosphereAction" && selections.interaction) {
    delete selections.interaction;
    notices.push("已移除互动动作：每次只保留一个核心动作。");
  }

  return { selections, notices };
}

export function mergeNegativePrompt(
  base: string,
  additions: string[],
  removals: string[] = [],
): string {
  const removed = new Set(removals.map(normalized));
  const seen = new Set<string>();
  return [...splitTags(base), ...additions.flatMap(splitTags)]
    .filter((tag) => {
      const key = normalized(tag);
      if (!key || removed.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(", ");
}

function selectionPrompt(
  fieldId: string,
  value: string,
  canonical: SubjectKind | null,
  crossdressing: boolean,
): string {
  const isMale = canonical ? MALE_KINDS.has(canonical) : false;
  if (fieldId !== "outfit" || !isMale) return toModelPrompt(value);

  if (value === "水手服") {
    return crossdressing
      ? "crossdressing, masculine male, flat chest, sailor uniform, sailor collar, pleated skirt"
      : "male sailor-style school uniform, sailor collar, long sleeves, trousers, male student, short hair, masculine face";
  }
  if (value === "JK 制服") {
    return crossdressing
      ? "crossdressing, masculine male, flat chest, japanese school uniform, pleated skirt"
      : "male japanese school uniform, trousers, male student, short hair, masculine face";
  }
  if (value === "Lolita") {
    return "crossdressing, male focus, lolita fashion, frilled dress";
  }
  return toModelPrompt(value);
}

export function compilePrompt({
  selections,
  description,
}: {
  selections: Record<string, string>;
  description: string;
}): PromptCompileResult {
  const warnings: string[] = [];
  const subjectResult = descriptionSubject(description);
  const candidates = orderedSelectionEntries(selections)
    .filter(([, value]) => Boolean(STRUCTURED_SUBJECTS[value]))
    .map(
      ([fieldId, value]): SubjectCandidate => ({
        kind: STRUCTURED_SUBJECTS[value],
        fieldId,
        value,
        rank: SUBJECT_RANK[fieldId] ?? 99,
      }),
    )
    .sort((a, b) => a.rank - b.rank);

  const inferredSubject =
    subjectResult.subject?.kind ?? candidates[0]?.kind ?? null;
  const guardIntent = analyzeGuardIntent(
    description,
    selections,
    Boolean(inferredSubject),
  );
  const canonical = guardIntent.nonHuman
    ? null
    : inferredSubject ?? "human";
  const expectedSubject =
    guardIntent.nonHuman || guardIntent.integrityOverrides.size > 0
      ? null
      : canonical;
  const customIntent = buildCustomIntent(
    description,
    canonical,
    subjectResult,
  );
  applyIntegrityOverrides(customIntent, guardIntent);

  if (customIntent.conflictingSubjects.length > 0 && customIntent.subject) {
    warnings.push(
      `输入框包含互斥的人物数量/性别，按最后出现的“${customIntent.subject.label}”执行。`,
    );
  }
  if (guardIntent.nonHuman) {
    warnings.push(
      "检测到无人或非人主体要求，已停用默认人物完整性限制和人物校验。",
    );
  } else if (guardIntent.integrityOverrides.size > 0) {
    warnings.push(
      `输入明确要求“${[...guardIntent.integrityOverrides].join(
        "、",
      )}”，已移除对应冲突限制并停用本次人物完整性校验。`,
    );
  }
  const rawSegments: Array<PromptSegment & { order: number }> = [];
  const compiledSubject =
    canonical === "human" && guardIntent.multipleSubjects
      ? ""
      : canonical
        ? subjectText(canonical, guardIntent.integrityOverrides)
        : "";
  if (compiledSubject) {
    rawSegments.push({
      id: canonical === "human" ? "default-human" : "subject",
      label:
        canonical === "human" ? "默认人物限制 · 单人" : "主体",
      text: compiledSubject,
      slot: "subject",
      priority: canonical === "human" ? 3 : 0,
      protected: canonical !== "human",
      order: -100,
    });
  }

  let order = 0;
  customIntent.tags.forEach((tag, index) => {
    const key = normalized(tag);
    if (SUBJECT_TAGS.has(key)) return;
    rawSegments.push({
      id: `custom:${index}`,
      label: `输入框 · ${tag}`,
      text: tag,
      ...classifyCustomTag(tag),
      order: -1000 + index,
    });
  });

  for (const [fieldId, value] of orderedSelectionEntries(selections)) {
    if (
      guardIntent.nonHuman &&
      NON_HUMAN_CONFLICTING_SELECTION_FIELDS.has(fieldId)
    ) {
      warnings.push(
        `非人主体要求优先：已忽略“${FIELD_LABELS[fieldId] ?? fieldId} · ${value}”。`,
      );
      continue;
    }
    if (customIntent.overrideFields.has(fieldId)) {
      warnings.push(
        `输入框优先：已忽略“${FIELD_LABELS[fieldId] ?? fieldId} · ${value}”。`,
      );
      continue;
    }

    if (
      fieldId === "pose" &&
      selections.format === "圆形裁剪兼容" &&
      CIRCULAR_CROP_CONFLICTING_POSES.has(value)
    ) {
      warnings.push(
        `“${value}”与圆形裁剪安全构图冲突，未写入本次模型提示词。`,
      );
      continue;
    }

    const selectedSubject = STRUCTURED_SUBJECTS[value];
    if (
      canonical &&
      selectedSubject &&
      subjectsConflict(canonical, selectedSubject) &&
      (Boolean(customIntent.subject) || candidates[0]?.fieldId !== fieldId)
    ) {
      warnings.push(
        customIntent.subject
          ? `输入框优先：“${value}”与输入主体冲突，未写入本次模型提示词。`
          : `“${value}”与当前主体冲突，未写入本次模型提示词。`,
      );
      continue;
    }

    const rule = FIELD_RULES[fieldId] ?? {
      slot: "custom" as const,
      priority: 3 as const,
    };
    const text = splitTags(
      selectionPrompt(
        fieldId,
        value,
        canonical,
        customIntent.crossdressing,
      ),
    )
      .filter((tag) => !SUBJECT_TAGS.has(normalized(tag)))
      .join(", ");
    if (!text) continue;
    const styleAdapter =
      fieldId === "animeReference"
        ? styleAdapterForSelection(value)
        : null;
    rawSegments.push({
      id: `selection:${fieldId}`,
      label: `${FIELD_LABELS[fieldId] ?? fieldId} · ${value}`,
      text,
      slot: rule.slot,
      priority: styleAdapter ? 0 : rule.priority,
      protected: Boolean(styleAdapter || rule.protected),
      order: order++,
    });
  }

  if (rawSegments.length > 0) {
    rawSegments.push({
      id: "rating",
      label: "可省略内容分级",
      text: RATING_TAG,
      slot: "rating",
      priority: 3,
      protected: false,
      order: order++,
    });

    rawSegments.push({
      id: "quality-suffix",
      label: "可省略质量尾缀",
      text: QUALITY_SUFFIX,
      slot: "suffix",
      priority: 3,
      protected: false,
      order: Number.MAX_SAFE_INTEGER,
    });
  }

  const segments = dedupeSegments(
    rawSegments
      .sort(
        (a, b) =>
          SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot] ||
          a.priority - b.priority ||
          a.order - b.order,
      )
      .map(
        ({
          id,
          label,
          text,
          slot,
          priority,
          protected: isProtected,
        }) => ({
        id,
        label,
        text,
        slot,
        priority,
        protected: isProtected,
      }),
      ),
  );

  const negativeAdditions: string[] = [];
  const negativeRemovals: string[] = [];
  const selectedBackgroundIsActive =
    !customIntent.overrideFields.has("background");
  const hasSolidBackground =
    customIntent.whiteBackground ||
    (selectedBackgroundIsActive &&
      SOLID_BACKGROUNDS.has(selections.background));
  if (hasSolidBackground) {
    negativeAdditions.push("scenery");
  }
  if (
    customIntent.whiteBackground ||
    (selectedBackgroundIsActive && selections.background === "纯白背景")
  ) {
    negativeAdditions.push(
      "colored background",
    );
  }
  if (
    customIntent.fullBody ||
    (selections.pose === "全身像" &&
      !customIntent.overrideFields.has("pose") &&
      selections.format !== "圆形裁剪兼容")
  ) {
    negativeAdditions.push("close-up", "out of frame");
  }
  if (
    selections.format === "圆形裁剪兼容" &&
    !customIntent.overrideFields.has("format")
  ) {
    negativeAdditions.push("close-up", "out of frame");
  }
  if (canonical === "male") {
    negativeAdditions.push(
      "1girl",
      "2girls",
      "breasts",
      "cleavage",
    );
  } else if (canonical === "male_pair") {
    negativeAdditions.push(
      "1girl",
      "2girls",
      "breasts",
      "cleavage",
    );
  }
  if (canonical === "female") {
    negativeAdditions.push(
      "1boy",
      "2boys",
      "male focus",
      "beard",
    );
  } else if (canonical === "female_pair") {
    negativeAdditions.push(
      "1boy",
      "2boys",
      "male focus",
      "beard",
    );
  }
  if (!guardIntent.nonHuman) {
    for (const guard of [
      "no humans",
      "head out of frame",
      "faceless",
      "headless",
    ]) {
      if (!guardIntent.integrityOverrides.has(guard)) {
        negativeAdditions.push(guard);
      }
    }
  }
  if (guardIntent.integrityOverrides.has("head out of frame")) {
    negativeRemovals.push("cropped");
  }
  if (
    customIntent.tags.some((tag) =>
      /^(?:old man|old woman|elderly)$/i.test(tag),
    )
  ) {
    negativeAdditions.push("young", "child");
  }

  const backgroundMode =
    customIntent.whiteBackground ||
    (selectedBackgroundIsActive && selections.background === "纯白背景")
      ? "white"
      : "none";

  return {
    prompt: segments.map((segment) => segment.text).join(", "),
    segments,
    warnings,
    negativeAdditions,
    negativeRemovals,
    subject: compiledSubject,
    subjectKind: canonical,
    expectedSubject,
    backgroundMode,
    inputOverrideFields: [...customIntent.overrideFields],
  };
}
