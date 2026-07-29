import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPORT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(REPORT_DIR, "outputs", "retests");
const RESULT_PATH = path.join(REPORT_DIR, "targeted-retest-results.json");
const GATEWAY_URL = process.env.MUSE_GATEWAY_URL ?? "http://127.0.0.1:8000";

const QUALITY_SUFFIX =
  "safe, masterpiece, high score, great score, absurdres";
const NEGATIVE_PROMPT =
  "lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry";

const cases = [
  {
    id: "retest_heterochromia",
    sourceField: "facialFeatures",
    label: "异瞳（补强构图）",
    expected: ["完整脸部", "双眼可见", "左右眼颜色不同"],
    prompt: `1girl, solo, portrait, head and shoulders, centered face, both eyes visible, heterochromia, looking at viewer, ${QUALITY_SUFFIX}`,
  },
  {
    id: "retest_school_idol_boy",
    sourceField: "campusIdentity",
    label: "校草风男生（补强性别）",
    expected: ["单个男生", "校园制服"],
    prompt: `1boy, solo, male focus, handsome school idol, japanese school uniform, upper body, classroom, ${QUALITY_SUFFIX}`,
  },
  {
    id: "retest_two_girls",
    sourceField: "specialSetting",
    label: "闺蜜头像（补强人数与构图）",
    expected: ["恰好两名女生", "同款不同色服装"],
    prompt: `2girls, best friends, matching outfits, different colors, full body, standing side by side, plain background, ${QUALITY_SUFFIX}`,
  },
  {
    id: "retest_love_letter",
    sourceField: "interaction",
    label: "递情书（补强物体与手势）",
    expected: ["人物递出信封", "情书清晰可见"],
    prompt: `1girl, solo, full body, outstretched hand, holding a visible envelope, giving a love letter toward viewer, shy smile, ${QUALITY_SUFFIX}`,
  },
  {
    id: "retest_basketball",
    sourceField: "atmosphereAction",
    label: "打篮球（补强主语、动作与物体）",
    expected: ["人物完整", "运球动作", "篮球可见"],
    prompt: `1girl, solo, full body, dribbling a basketball, playing basketball, visible basketball, school gym, dynamic pose, ${QUALITY_SUFFIX}`,
  },
  {
    id: "retest_white_background",
    sourceField: "background",
    label: "纯白背景（补强排他背景）",
    expected: ["无场景", "纯白背景"],
    prompt: `1girl, solo, full body, isolated on pure white background, studio background, no scenery, ${QUALITY_SUFFIX}`,
  },
  {
    id: "retest_circular_crop",
    sourceField: "format",
    label: "圆形裁剪兼容（补强安全区）",
    expected: ["正面居中", "头肩周围留有安全边距"],
    prompt: `1girl, solo, bust portrait, front view, centered face, centered subject, ample margin around head and shoulders, circular crop safe, plain background, ${QUALITY_SUFFIX}`,
  },
  {
    id: "retest_school_bag",
    sourceField: "accessory",
    label: "书包（补强单主体）",
    expected: ["单个人物", "一个清晰书包"],
    prompt: `1girl, solo, full body, japanese school uniform, carrying one school bag, standing, plain background, ${QUALITY_SUFFIX}`,
  },
];

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const statusResponse = await fetch(`${GATEWAY_URL}/v1/status`);
  if (!statusResponse.ok) {
    throw new Error(`Gateway status failed: ${statusResponse.status}`);
  }
  const status = await statusResponse.json();
  if (status.status !== "ready" || !status.model_loaded) {
    throw new Error(`Cloud model is not ready: ${JSON.stringify(status)}`);
  }

  const results = {
    generatedAt: null,
    gateway: GATEWAY_URL,
    model: status.model,
    purpose:
      "Re-test first-pass failures at the model card's recommended square resolution and inference settings, with semantically reinforced prompts.",
    settings: {
      width: 1024,
      height: 1024,
      steps: 28,
      guidance_scale: 5,
      sampler: "euler_a",
      clip_skip: 2,
      negative_prompt: NEGATIVE_PROMPT,
    },
    cases: [],
  };

  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index];
    const seed = 93000 + index;
    const startedAt = Date.now();
    const response = await fetch(`${GATEWAY_URL}/v1/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: item.prompt,
        negative_prompt: NEGATIVE_PROMPT,
        width: 1024,
        height: 1024,
        steps: 28,
        guidance_scale: 5,
        seed,
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
    const fileName = `${String(index + 1).padStart(2, "0")}_${item.id}.png`;
    await writeFile(
      path.join(OUTPUT_DIR, fileName),
      Buffer.from(body.image_base64, "base64"),
    );
    results.cases.push({
      ...item,
      seed: body.seed,
      output: `outputs/retests/${fileName}`,
      request_id: body.request_id,
      duration_ms: body.duration_ms,
      wall_duration_ms: Date.now() - startedAt,
      review: { status: "pending", observed: [], notes: "" },
    });
    results.generatedAt = new Date().toISOString();
    await writeFile(RESULT_PATH, `${JSON.stringify(results, null, 2)}\n`);
    console.log(
      `[${index + 1}/${cases.length}] generated ${item.id} in ${body.duration_ms}ms`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
