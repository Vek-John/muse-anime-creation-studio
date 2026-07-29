import {
  QUALITY_SUFFIX,
  RATING_TAG,
  toModelPrompt,
} from "./prompt-tags";
import { PARAMETER_GROUPS } from "./studio-config";

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
  subject: string;
};

type FieldRule = {
  slot: PromptSlot;
  priority: 0 | 1 | 2 | 3;
  protected?: boolean;
};

type SubjectKind =
  | "female"
  | "male"
  | "female_pair"
  | "male_pair"
  | "mixed";

type SubjectCandidate = {
  kind: SubjectKind;
  fieldId: string;
  value: string;
  rank: number;
};

const SLOT_ORDER: Record<PromptSlot, number> = {
  subject: 0,
  identity: 1,
  custom: 2,
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
  "2girls",
  "2boys",
  "solo",
  "male focus",
  "female focus",
  "1boy and 1girl",
  "1girl and 1boy",
  "couple",
]);

const RESERVED_TAGS = new Set([
  RATING_TAG,
  ...splitTags(QUALITY_SUFFIX),
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
]);

const ACTION_PATTERN =
  /\b(looking|sitting|standing|walking|waving|holding|giving|reading|playing|dribbling|casting|blowing|pose|smile|back-to-back)\b/i;

function splitTags(value: string): string[] {
  return value
    .split(/[,，\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function subjectText(kind: SubjectKind): string {
  if (kind === "male") return "1boy, solo, male focus";
  if (kind === "female_pair") return "2girls";
  if (kind === "male_pair") return "2boys, male focus";
  if (kind === "mixed") return "1boy, 1girl";
  return "1girl, solo";
}

function descriptionSubject(tags: string[]): SubjectKind | null {
  const normalizedTags = new Set(tags.map(normalized));
  if (
    normalizedTags.has("1boy and 1girl") ||
    normalizedTags.has("1girl and 1boy") ||
    (normalizedTags.has("1boy") && normalizedTags.has("1girl"))
  ) {
    return "mixed";
  }
  if (normalizedTags.has("2girls")) return "female_pair";
  if (normalizedTags.has("2boys")) return "male_pair";
  if (normalizedTags.has("1boy")) return "male";
  if (normalizedTags.has("1girl")) return "female";
  return null;
}

function subjectsConflict(canonical: SubjectKind, selected: SubjectKind): boolean {
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
  if (FRAMING_TAGS.has(key)) {
    return { slot: "framing", priority: 0, protected: true };
  }
  if (ACTION_PATTERN.test(tag)) {
    return { slot: "action", priority: 1, protected: false };
  }
  return { slot: "custom", priority: 2, protected: false };
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
): string {
  const seen = new Set<string>();
  return [...splitTags(base), ...additions.flatMap(splitTags)]
    .filter((tag) => {
      const key = normalized(tag);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(", ");
}

export function compilePrompt({
  selections,
  description,
  qualityGuard,
}: {
  selections: Record<string, string>;
  description: string;
  qualityGuard?: string;
}): PromptCompileResult {
  const warnings: string[] = [];
  const customTags = splitTags(description);
  const customSubject = descriptionSubject(customTags);
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

  const canonical = candidates[0]?.kind ?? customSubject ?? "female";
  if (candidates[0] && customSubject && candidates[0].kind !== customSubject) {
    warnings.push(
      `人物数量/性别以“${candidates[0].value}”为准，已忽略自定义描述中的冲突主体标签。`,
    );
  }

  const rawSegments: Array<PromptSegment & { order: number }> = [
    {
      id: "subject",
      label: "主体",
      text: subjectText(canonical),
      slot: "subject",
      priority: 0,
      protected: true,
      order: -100,
    },
  ];

  let order = 0;
  for (const [fieldId, value] of orderedSelectionEntries(selections)) {
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
      selectedSubject &&
      candidates[0]?.fieldId !== fieldId &&
      subjectsConflict(canonical, selectedSubject)
    ) {
      warnings.push(
        `“${value}”与当前主体冲突，未写入本次模型提示词。`,
      );
      continue;
    }

    const rule = FIELD_RULES[fieldId] ?? {
      slot: "custom" as const,
      priority: 3 as const,
    };
    const text = splitTags(toModelPrompt(value))
      .filter((tag) => !SUBJECT_TAGS.has(normalized(tag)))
      .join(", ");
    if (!text) continue;
    rawSegments.push({
      id: `selection:${fieldId}`,
      label: `${FIELD_LABELS[fieldId] ?? fieldId} · ${value}`,
      text,
      slot: rule.slot,
      priority: rule.priority,
      protected: Boolean(rule.protected),
      order: order++,
    });
  }

  customTags.forEach((tag, index) => {
    const key = normalized(tag);
    if (SUBJECT_TAGS.has(key) || RESERVED_TAGS.has(key)) return;
    rawSegments.push({
      id: `custom:${index}`,
      label: `自定义 · ${tag}`,
      text: tag,
      ...classifyCustomTag(tag),
      order: order++,
    });
  });

  rawSegments.push({
    id: "rating",
    label: "内容分级",
    text: RATING_TAG,
    slot: "rating",
    priority: 0,
    protected: true,
    order: order++,
  });

  if (qualityGuard) {
    rawSegments.push({
      id: "quality-guard",
      label: `质量约束 · ${qualityGuard}`,
      text: toModelPrompt(qualityGuard),
      slot: "quality",
      priority: 1,
      protected: false,
      order: order++,
    });
  }

  rawSegments.push({
    id: "quality-suffix",
    label: "模型质量尾缀",
    text: QUALITY_SUFFIX,
    slot: "suffix",
    priority: 0,
    protected: true,
    order: Number.MAX_SAFE_INTEGER,
  });

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
  if (SOLID_BACKGROUNDS.has(selections.background)) {
    negativeAdditions.push(
      "scenery",
      "detailed background",
    );
  }
  if (selections.background === "纯白背景") {
    negativeAdditions.push(
      "colored background",
      "gradient background",
      "cast shadow",
      "silhouette",
    );
  }
  if (
    selections.pose === "全身像" &&
    selections.format !== "圆形裁剪兼容"
  ) {
    negativeAdditions.push("close-up", "out of frame");
  }
  if (selections.format === "圆形裁剪兼容") {
    negativeAdditions.push("close-up", "out of frame");
  }
  if (canonical === "male" && selections.campusIdentity === "校草风男生") {
    negativeAdditions.push(
      "1girl",
      "female",
      "woman",
      "breasts",
      "skirt",
    );
  }

  return {
    prompt: segments.map((segment) => segment.text).join(", "),
    segments,
    warnings,
    negativeAdditions,
    subject: subjectText(canonical),
  };
}
