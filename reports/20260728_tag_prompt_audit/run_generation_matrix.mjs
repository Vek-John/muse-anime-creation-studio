import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPORT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(REPORT_DIR, "outputs");
const RESULT_PATH = path.join(REPORT_DIR, "generation-results.json");
const GATEWAY_URL = process.env.MUSE_GATEWAY_URL ?? "http://127.0.0.1:8000";

const QUALITY_SUFFIX =
  "safe, masterpiece, high score, great score, absurdres";
const NEGATIVE_PROMPT =
  "lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry";

const semanticCases = [
  {
    id: "field_baseStyle",
    field: "baseStyle",
    label: "古风仙侠",
    expected: ["古风幻想", "汉服/东方服饰", "优雅画风"],
    prompt: `1girl, solo, hanfu, ancient chinese fantasy, xianxia, elegant, misty mountain courtyard, ${QUALITY_SUFFIX}`,
  },
  {
    id: "field_animeReference",
    field: "animeReference",
    label: "原神风（仅测试通用映射，不含作品或角色名）",
    expected: ["幻想游戏插画", "华丽动漫服装"],
    prompt: `1girl, solo, fantasy game illustration, ornate anime costume, standing, simple background, ${QUALITY_SUFFIX}`,
  },
  {
    id: "field_texture",
    field: "texture",
    label: "霓虹光效",
    expected: ["霓虹照明", "发光效果"],
    prompt: `1girl, solo, upper body, neon lighting, glow, dark city background, ${QUALITY_SUFFIX}`,
  },
  {
    id: "field_hairstyle",
    field: "hairstyle",
    label: "渐变发色",
    expected: ["明显渐变发色"],
    prompt: `1girl, solo, gradient hair, waist-length hair, upper body, plain background, ${QUALITY_SUFFIX}`,
  },
  {
    id: "field_facialFeatures",
    field: "facialFeatures",
    label: "异瞳",
    expected: ["左右眼颜色不同"],
    prompt: `1girl, solo, heterochromia, face close-up, looking at viewer, ${QUALITY_SUFFIX}`,
  },
  {
    id: "field_faceDetails",
    field: "faceDetails",
    label: "圆框眼镜",
    expected: ["圆框眼镜"],
    prompt: `1girl, solo, round glasses, face close-up, looking at viewer, plain background, ${QUALITY_SUFFIX}`,
  },
  {
    id: "field_campusIdentity",
    field: "campusIdentity",
    label: "校草风男生",
    expected: ["单个男生", "校园制服/校草气质"],
    prompt: `1boy, solo, handsome school idol, japanese school uniform, classroom, ${QUALITY_SUFFIX}`,
  },
  {
    id: "field_personality",
    field: "personality",
    label: "清冷御姐",
    expected: ["成熟女性", "冷静疏离气质"],
    prompt: `1woman, solo, cool mature woman, detached gaze, upper body, simple background, ${QUALITY_SUFFIX}`,
  },
  {
    id: "field_specialSetting",
    field: "specialSetting",
    label: "闺蜜头像（同款不同色）",
    expected: ["两名女生", "好友互动", "同款不同色服装"],
    prompt: `2girls, best friends, matching outfits, different colors, standing side by side, ${QUALITY_SUFFIX}`,
  },
  {
    id: "field_outfit",
    field: "outfit",
    label: "机甲战衣",
    expected: ["机械装甲", "机甲紧身战衣"],
    prompt: `1girl, solo, full body, mecha bodysuit, mechanical armor, standing, ${QUALITY_SUFFIX}`,
  },
  {
    id: "field_accessory",
    field: "accessory",
    label: "书包",
    expected: ["清晰可见的书包"],
    prompt: `1girl, solo, full body, japanese school uniform, school bag, standing, plain background, ${QUALITY_SUFFIX}`,
  },
  {
    id: "field_pose",
    field: "pose",
    label: "全身像",
    expected: ["人物从头到脚完整入镜"],
    prompt: `1girl, solo, full body, standing, plain background, ${QUALITY_SUFFIX}`,
  },
  {
    id: "field_interaction",
    field: "interaction",
    label: "递情书",
    expected: ["递出情书的动作", "情书可见"],
    prompt: `1girl, solo, giving a love letter toward viewer, upper body, shy smile, ${QUALITY_SUFFIX}`,
  },
  {
    id: "field_atmosphereAction",
    field: "atmosphereAction",
    label: "打篮球",
    expected: ["打篮球动作", "篮球可见"],
    prompt: `1girl, solo, playing basketball, full body, school gym, dynamic pose, ${QUALITY_SUFFIX}`,
  },
  {
    id: "field_campusScene",
    field: "campusScene",
    label: "教室窗边",
    expected: ["教室", "窗边位置"],
    prompt: `1girl, solo, upper body, beside classroom window, daylight, ${QUALITY_SUFFIX}`,
  },
  {
    id: "field_animeScene",
    field: "animeScene",
    label: "赛博朋克街道",
    expected: ["赛博朋克街道", "霓虹招牌"],
    prompt: `1girl, solo, full body, cyberpunk street, neon signs, night, ${QUALITY_SUFFIX}`,
  },
  {
    id: "field_background",
    field: "background",
    label: "纯白背景",
    expected: ["纯白或接近纯白背景"],
    prompt: `1girl, solo, upper body, plain white background, ${QUALITY_SUFFIX}`,
  },
  {
    id: "field_emotion",
    field: "emotion",
    label: "害羞脸红",
    expected: ["害羞表情", "明显脸红"],
    prompt: `1girl, solo, shy, blush, upper body, looking away, simple background, ${QUALITY_SUFFIX}`,
  },
  {
    id: "field_tone",
    field: "tone",
    label: "酷飒拽",
    expected: ["冷酷自信", "强势时尚气质"],
    prompt: `1girl, solo, cool, confident, edgy, street fashion, upper body, ${QUALITY_SUFFIX}`,
  },
  {
    id: "field_format",
    field: "format",
    label: "圆形裁剪兼容",
    expected: ["主体居中", "头肩不贴边，适合圆形裁剪"],
    prompt: `1girl, solo, upper body, circular crop safe, centered subject, simple background, ${QUALITY_SUFFIX}`,
  },
  {
    id: "field_usage",
    field: "usage",
    label: "不撞款",
    expected: ["非现成角色、具有独特设计细节"],
    prompt: `1girl, solo, original character design, asymmetrical outfit, distinctive accessories, full body, ${QUALITY_SUFFIX}`,
  },
  {
    id: "field_negativeConstraint",
    field: "negativeConstraint",
    label: "发丝不模糊",
    expected: ["清晰头发", "发丝细节"],
    prompt: `1girl, solo, long hair, detailed hair, sharp hair strands, upper body, ${QUALITY_SUFFIX}`,
  },
];

const longPromptTags = [
  "1girl",
  "solo",
  "long silver hair",
  "gradient blue hair tips",
  "detailed hair strands",
  "heterochromia",
  "round glasses",
  "japanese school uniform",
  "school bag",
  "necklace",
  "scarf",
  "gloves",
  "standing",
  "front view",
  "looking at viewer",
  "gentle smile",
  "waving",
  "under cherry blossom tree",
  "falling petals",
  "school rooftop",
  "sunset",
  "soft clouds",
  "soft backlight",
  "cinematic atmosphere",
  "pastel color palette",
  "original character design",
  "centered composition",
  "symmetrical face",
  "correct facial features",
  "correct proportions",
  "coherent clothing",
  "clean image",
  "low noise",
  "safe",
  "masterpiece",
  "high score",
  "great score",
  "absurdres",
];

const comparisonCases = [
  {
    id: "compare_scene_clean",
    field: "comparison",
    label: "单一校园场景",
    expected: ["教室窗边"],
    seed: 91001,
    prompt: `1girl, solo, upper body, beside classroom window, daylight, ${QUALITY_SUFFIX}`,
  },
  {
    id: "compare_scene_conflict",
    field: "comparison",
    label: "校园 + 异世界 + 纯白背景冲突",
    expected: ["观察模型选择、混合或忽略了哪个场景"],
    seed: 91001,
    prompt: `1girl, solo, upper body, beside classroom window, fantasy forest, plain white background, daylight, ${QUALITY_SUFFIX}`,
  },
  {
    id: "compare_count_clean",
    field: "comparison",
    label: "干净双人提示词",
    expected: ["一男一女双人互动"],
    seed: 91002,
    prompt: `1boy, 1girl, couple interaction, matching profile picture, standing side by side, ${QUALITY_SUFFIX}`,
  },
  {
    id: "compare_count_conflict",
    field: "comparison",
    label: "solo + 情侣人数冲突",
    expected: ["观察人物数量是否稳定"],
    seed: 91002,
    prompt: `1girl, solo, 1boy and 1girl, couple interaction, matching profile picture, standing side by side, ${QUALITY_SUFFIX}`,
  },
  {
    id: "compare_fullbody_early",
    field: "comparison",
    label: "全身像在长提示词前部",
    expected: ["全身构图应被保留"],
    seed: 91003,
    prompt: [
      longPromptTags[0],
      longPromptTags[1],
      "full body",
      ...longPromptTags.slice(2),
    ].join(", "),
  },
  {
    id: "compare_fullbody_late",
    field: "comparison",
    label: "全身像在长提示词末部",
    expected: ["若被 77-token 截断，构图可能退化"],
    seed: 91003,
    prompt: [...longPromptTags, "full body"].join(", "),
  },
  {
    id: "compare_action_clean",
    field: "comparison",
    label: "单一动作",
    expected: ["递出情书"],
    seed: 91004,
    prompt: `1girl, solo, giving a love letter toward viewer, upper body, ${QUALITY_SUFFIX}`,
  },
  {
    id: "compare_action_conflict",
    field: "comparison",
    label: "递情书 + 打篮球 + 看漫画冲突",
    expected: ["观察动作混杂或被忽略"],
    seed: 91004,
    prompt: `1girl, solo, giving a love letter, playing basketball, reading manga, full body, ${QUALITY_SUFFIX}`,
  },
];

const cases = [...semanticCases, ...comparisonCases].map((item, index) => ({
  ...item,
  seed: item.seed ?? 70000 + index,
}));

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readPreviousResults() {
  try {
    return JSON.parse(await readFile(RESULT_PATH, "utf8"));
  } catch {
    return {
      generatedAt: null,
      gateway: GATEWAY_URL,
      settings: {},
      cases: [],
    };
  }
}

async function writeProgress(results) {
  await writeFile(
    RESULT_PATH,
    `${JSON.stringify(
      {
        ...results,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const statusResponse = await fetch(`${GATEWAY_URL}/v1/status`);
  if (!statusResponse.ok) {
    throw new Error(
      `Gateway status failed: ${statusResponse.status} ${await statusResponse.text()}`,
    );
  }
  const status = await statusResponse.json();
  if (status.status !== "ready" || !status.model_loaded) {
    throw new Error(`Cloud model is not ready: ${JSON.stringify(status)}`);
  }

  const previous = await readPreviousResults();
  const previousById = new Map(previous.cases.map((item) => [item.id, item]));
  const results = {
    generatedAt: previous.generatedAt,
    gateway: GATEWAY_URL,
    runtime: status.runtime,
    model: status.model,
    settings: {
      width: 640,
      height: 640,
      steps: 16,
      guidance_scale: 5,
      sampler: "euler_a",
      clip_skip: 2,
      negative_prompt: NEGATIVE_PROMPT,
    },
    coverage: {
      totalFields: 23,
      semanticImageFields: 22,
      uiOnlyFields: ["sampling"],
      comparisonCases: comparisonCases.length,
    },
    cases: [],
  };

  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index];
    const fileName = `${String(index + 1).padStart(2, "0")}_${item.id}.png`;
    const outputPath = path.join(OUTPUT_DIR, fileName);
    const previousItem = previousById.get(item.id);

    if (previousItem && (await fileExists(outputPath))) {
      results.cases.push({ ...previousItem, output: `outputs/${fileName}` });
      console.log(`[${index + 1}/${cases.length}] reuse ${item.id}`);
      continue;
    }

    const startedAt = Date.now();
    const response = await fetch(`${GATEWAY_URL}/v1/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: item.prompt,
        negative_prompt: NEGATIVE_PROMPT,
        width: 640,
        height: 640,
        steps: 16,
        guidance_scale: 5,
        seed: item.seed,
        sampler: "euler_a",
        clip_skip: 2,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `${item.id} failed: ${response.status} ${await response.text()}`,
      );
    }

    const body = await response.json();
    await writeFile(outputPath, Buffer.from(body.image_base64, "base64"));
    const result = {
      id: item.id,
      field: item.field,
      label: item.label,
      expected: item.expected,
      prompt: item.prompt,
      seed: body.seed,
      output: `outputs/${fileName}`,
      request_id: body.request_id,
      duration_ms: body.duration_ms,
      wall_duration_ms: Date.now() - startedAt,
      model: body.model,
      review: {
        status: "pending",
        observed: [],
        notes: "",
      },
    };
    results.cases.push(result);
    await writeProgress(results);
    console.log(
      `[${index + 1}/${cases.length}] generated ${item.id} in ${body.duration_ms}ms`,
    );
  }

  await writeProgress(results);
  console.log(`Done: ${results.cases.length} images -> ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
