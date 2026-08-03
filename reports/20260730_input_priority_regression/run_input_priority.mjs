import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const REPORT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(REPORT_DIR, "..", "..", "app");
const GATEWAY_URL =
  process.env.MUSE_GATEWAY_URL ?? "http://127.0.0.1:8000";
const PHASE = process.env.PRIORITY_PHASE ?? "quick";
const DRY_RUN = process.env.PRIORITY_DRY_RUN === "true";
const SEEDS_PER_CASE = Number.parseInt(
  process.env.PRIORITY_SEEDS_PER_CASE ?? "3",
  10,
);
const BASE_SEED = Number.parseInt(
  process.env.PRIORITY_BASE_SEED ?? "96000",
  10,
);
const SUBJECT_VALIDATION =
  process.env.PRIORITY_SUBJECT_VALIDATION ?? "strict";
const MAX_SUBJECT_ATTEMPTS = 4;
const CASE_FILTER = new Set(
  (process.env.PRIORITY_CASES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const SETTINGS =
  PHASE.startsWith("release")
    ? {
        width: 1024,
        height: 1024,
        steps: 28,
        guidance_scale: 5,
        sampler: "euler_a",
        clip_skip: 2,
      }
    : {
        width: 512,
        height: 512,
        steps: 12,
        guidance_scale: 5,
        sampler: "euler_a",
        clip_skip: 2,
      };

const DEFAULT_LIKE_SELECTIONS = {
  baseStyle: "日系萌系",
  texture: "4K 高清",
  hairstyle: "短发狼尾",
  personality: "元气少女",
  pose: "半身像",
  campusScene: "樱花树下",
  emotion: "温柔治愈",
  format: "小红书头像",
};

const CASES = [
  {
    id: "default_human_guard",
    label: "空白输入仅保留默认人形限制",
    selections: {},
    description: "",
    expected: ["可辨认的人类主体", "头部完整", "不限定性别"],
  },
  {
    id: "no_humans_landscape",
    label: "明确无人场景移除人物限制",
    selections: {},
    description: "no humans, empty street, rainy night",
    expected: ["无人街道", "雨夜", "不出现人物"],
  },
  {
    id: "mecha_focus",
    label: "机甲画风移除人物限制",
    selections: { baseStyle: "机甲硬核" },
    description: "",
    expected: ["机甲主体", "机械装甲", "不强制人物"],
  },
  {
    id: "explicit_human_mecha",
    label: "明确男性覆盖机甲的非人默认",
    selections: { baseStyle: "机甲硬核" },
    description: "1boy, mecha pilot, standing",
    expected: ["单人男性", "机甲驾驶员", "站立", "人物完整"],
  },
  {
    id: "generic_multiple_people",
    label: "明确多人移除单人限制",
    selections: {},
    description: "multiple people, school festival, group photo",
    expected: ["多个人物", "校园祭", "群像", "不强制单人"],
  },
  {
    id: "explicit_faceless",
    label: "明确无脸移除面部完整性限制",
    selections: {},
    description: "1boy, faceless, black coat",
    expected: ["男性", "无脸", "黑色外套", "不强制面部校验"],
  },
  {
    id: "male_old_uniform",
    label: "1man 老年男性校服全身",
    selections: DEFAULT_LIKE_SELECTIONS,
    description: "1man, old, school uniform, top to toe",
    expected: [
      "单人男性",
      "成年人或老年男性特征",
      "校服",
      "从头到脚完整",
    ],
  },
  {
    id: "male_crossdress_sailor",
    label: "男性女装水手服全身",
    selections: DEFAULT_LIKE_SELECTIONS,
    description:
      "1man, old, crossdressing, sailor uniform, top to toe",
    expected: [
      "单人男性身体与面部",
      "老年或成年男性特征",
      "女式水手服或裙装",
      "从头到脚完整",
    ],
  },
  {
    id: "male_chinese_override",
    label: "中文输入覆盖女性默认项",
    selections: DEFAULT_LIKE_SELECTIONS,
    description: "水手服校草男生，从头到脚，站立，直视镜头",
    expected: ["单人男性", "水手风校服", "站立全身", "看向镜头"],
  },
  {
    id: "female_overrides_male",
    label: "女性输入覆盖男性下拉项",
    selections: {
      baseStyle: "日系萌系",
      campusIdentity: "校草风男生",
      outfit: "校园西装",
      pose: "半身像",
    },
    description:
      "1woman, adult female, long hair, full body, standing",
    expected: ["单人女性", "成年女性", "长发", "站立全身"],
  },
  {
    id: "multi_slot_override",
    label: "输入覆盖服装构图动作场景画风",
    selections: {
      baseStyle: "厚涂写实",
      campusIdentity: "JK 制服女生",
      outfit: "校园西装",
      pose: "半身像",
      interaction: "递情书",
      campusScene: "教室窗边",
      format: "小红书头像",
    },
    description:
      "1boy, sailor uniform, full body, waving, white background, watercolor style",
    expected: [
      "单人男性",
      "水手风男校服",
      "挥手全身",
      "白色背景",
      "水彩风格",
    ],
  },
  {
    id: "yellow_hair_heavy_rain",
    label: "黄发日式服装暴雨人物",
    selections: DEFAULT_LIKE_SELECTIONS,
    description:
      "1boy, yellow hair, japanese clothes, under the heavy rain",
    expected: [
      "单人男性人类",
      "黄色头发",
      "日式服装",
      "暴雨场景",
    ],
  },
  {
    id: "yellow_hair_heavy_rain_chinese",
    label: "中文黄发日式服装暴雨人物",
    selections: DEFAULT_LIKE_SELECTIONS,
    description: "1boy，黄发，日式服装，暴雨中",
    expected: [
      "单人男性人类",
      "黄色头发",
      "日式服装",
      "暴雨场景",
    ],
  },
  {
    id: "yellow_hair_thunderstorm_aliases",
    label: "英文近义标签黄发雷暴人物",
    selections: DEFAULT_LIKE_SELECTIONS,
    description:
      "1boy, golden-haired, japanese attire, thunderstorm",
    expected: [
      "单人男性人类",
      "黄色头发",
      "日式服装",
      "雷暴或暴雨场景",
    ],
  },
];

async function loadPromptModules() {
  const outputDirectory = await mkdtemp(
    path.join(tmpdir(), "muse-input-priority-"),
  );
  const files = ["prompt-tags.ts", "studio-config.ts", "prompt-compiler.ts"];

  try {
    for (const filename of files) {
      const source = await readFile(path.join(APP_DIR, filename), "utf8");
      const output = ts
        .transpileModule(source, {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
          fileName: filename,
        })
        .outputText.replaceAll('"./prompt-tags"', '"./prompt-tags.mjs"')
        .replaceAll('"./studio-config"', '"./studio-config.mjs"');
      await writeFile(
        path.join(outputDirectory, filename.replace(/\.ts$/, ".mjs")),
        output,
      );
    }

    const cacheKey = `?run=${process.pid}-${Date.now()}`;
    return await Promise.all([
      import(
        `${pathToFileURL(path.join(outputDirectory, "prompt-compiler.mjs")).href}${cacheKey}`
      ),
      import(
        `${pathToFileURL(path.join(outputDirectory, "prompt-tags.mjs")).href}${cacheKey}`
      ),
    ]);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

async function requestJson(pathname, payload) {
  const response = await fetch(`${GATEWAY_URL}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${pathname} failed (${response.status}): ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function main() {
  const selectedCases = CASES.filter(
    (item) => CASE_FILTER.size === 0 || CASE_FILTER.has(item.id),
  );
  if (!selectedCases.length) {
    throw new Error("PRIORITY_CASES did not match any configured case.");
  }

  const statusResponse = await fetch(`${GATEWAY_URL}/v1/status`);
  const status = await statusResponse.json();
  if (!statusResponse.ok || status.status !== "ready") {
    throw new Error(`GPU runtime is not ready: ${JSON.stringify(status)}`);
  }

  const [compiler, promptTags] = await loadPromptModules();
  const outputDirectory = path.join(REPORT_DIR, "outputs", PHASE);
  const resultPath = path.join(REPORT_DIR, `${PHASE}-results.json`);
  await mkdir(outputDirectory, { recursive: true });

  const results = {
    generatedAt: new Date().toISOString(),
    phase: PHASE,
    model: status.model,
    settings: {
      ...SETTINGS,
      seeds_per_case: SEEDS_PER_CASE,
    },
    summary: {
      total: DRY_RUN ? 0 : selectedCases.length * SEEDS_PER_CASE,
      generated: 0,
      generation_errors: 0,
    },
    cases: [],
  };

  for (let caseIndex = 0; caseIndex < selectedCases.length; caseIndex += 1) {
    const item = selectedCases[caseIndex];
    const compiled = compiler.compilePrompt({
      selections: item.selections,
      description: item.description,
      qualityGuard: "五官正常",
    });
    const negativePrompt = compiler.mergeNegativePrompt(
      promptTags.DEFAULT_NEGATIVE_PROMPT,
      compiled.negativeAdditions,
      compiled.negativeRemovals,
    );
    const commonPayload = {
      prompt: compiled.prompt,
      prompt_segments: compiled.segments,
      negative_prompt: negativePrompt,
      expected_subject: compiled.expectedSubject ?? undefined,
    };
    const inspection = await requestJson(
      "/v1/prompt/inspect",
      commonPayload,
    );
    const caseResult = {
      ...item,
      compiler: {
        ...compiled,
        negative_prompt: negativePrompt,
      },
      inspection,
      generations: [],
      review: {
        status: "pending",
        pass_count: null,
        notes: "",
      },
    };
    results.cases.push(caseResult);
    await writeFile(resultPath, `${JSON.stringify(results, null, 2)}\n`);

    if (DRY_RUN) {
      console.log(
        `[inspect] ${item.id} subject=${compiled.subjectKind} tokens=${Math.max(
          inspection.diagnostics.token_usage.tokenizer_1,
          inspection.diagnostics.token_usage.tokenizer_2,
        )}`,
      );
      continue;
    }

    for (let seedIndex = 0; seedIndex < SEEDS_PER_CASE; seedIndex += 1) {
      const requestedSeed =
        BASE_SEED +
        caseIndex * 1000 +
        seedIndex * MAX_SUBJECT_ATTEMPTS;
      try {
        const body = await requestJson("/v1/generate", {
          ...commonPayload,
          ...SETTINGS,
          subject_validation: compiled.expectedSubject
            ? SUBJECT_VALIDATION
            : "off",
          max_subject_attempts: MAX_SUBJECT_ATTEMPTS,
          seed: requestedSeed,
          background_mode: compiled.backgroundMode,
        });
        const fileName = `${String(caseIndex + 1).padStart(2, "0")}_${item.id}_request-${requestedSeed}_output-${body.seed}.png`;
        await writeFile(
          path.join(outputDirectory, fileName),
          Buffer.from(body.image_base64, "base64"),
        );
        caseResult.generations.push({
          requested_seed: requestedSeed,
          seed: body.seed,
          output: `outputs/${PHASE}/${fileName}`,
          duration_ms: body.duration_ms,
          prompt_used: body.prompt_used,
          prompt_diagnostics: body.prompt_diagnostics,
          subject_validation: body.subject_validation,
          review: { status: "pending", notes: "" },
        });
        results.summary.generated += 1;
        console.log(
          `[${results.summary.generated}/${results.summary.total}] ${item.id} seed=${body.seed} ${body.duration_ms}ms`,
        );
      } catch (error) {
        results.summary.generation_errors += 1;
        caseResult.generations.push({
          requested_seed: requestedSeed,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        results.generatedAt = new Date().toISOString();
        await writeFile(resultPath, `${JSON.stringify(results, null, 2)}\n`);
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
