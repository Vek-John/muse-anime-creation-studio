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
const PHASE = process.env.REGRESSION_PHASE ?? "baseline";
const DRY_RUN = process.env.REGRESSION_DRY_RUN === "true";
const SEEDS_PER_CASE = Number.parseInt(
  process.env.REGRESSION_SEEDS_PER_CASE ?? "3",
  10,
);
const CASE_FILTER = new Set(
  (process.env.REGRESSION_CASES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const SETTINGS = {
  width: 1024,
  height: 1024,
  steps: 28,
  guidance_scale: 5,
  sampler: "euler_a",
  clip_skip: 2,
};

const CASES = [
  {
    id: "school_idol_boy",
    label: "校草风男生",
    selections: {
      baseStyle: "日系萌系",
      campusIdentity: "校草风男生",
      outfit: "校园西装",
      pose: "半身像",
      campusScene: "教室窗边",
    },
    description: "looking at viewer",
    expected: ["恰好一名男性角色", "校园男生形象", "半身构图"],
  },
  {
    id: "white_background",
    label: "纯白背景",
    selections: {
      baseStyle: "日系萌系",
      campusIdentity: "JK 制服女生",
      pose: "全身像",
      background: "纯白背景",
    },
    description: "standing",
    expected: ["恰好一名角色", "从头到脚可见", "无场景的纯白背景"],
  },
  {
    id: "mixed_couple",
    label: "情侣双人",
    selections: {
      baseStyle: "日系萌系",
      specialSetting: "情侣头像（双人互动）",
      pose: "全身像",
      background: "纯白背景",
    },
    description: "standing side by side, looking at viewer",
    expected: ["恰好一名男生和一名女生", "两人同时完整可见", "并肩互动"],
  },
  {
    id: "two_girls",
    label: "闺蜜双人",
    selections: {
      baseStyle: "日系萌系",
      specialSetting: "闺蜜头像（同款不同色）",
      pose: "全身像",
      background: "粉色背景",
    },
    description: "looking at viewer",
    expected: ["恰好两名女生", "两人同时完整可见", "同款不同色服装"],
  },
  {
    id: "full_body",
    label: "全身像",
    selections: {
      baseStyle: "日系萌系",
      campusIdentity: "JK 制服女生",
      pose: "全身像",
      background: "蓝色背景",
    },
    description: "standing, looking at viewer",
    expected: ["单人", "从头到脚可见", "四肢未被裁切"],
  },
  {
    id: "love_letter",
    label: "递情书",
    selections: {
      baseStyle: "日系萌系",
      campusIdentity: "JK 制服女生",
      pose: "全身像",
      interaction: "递情书",
      background: "纯白背景",
    },
    description: "shy smile",
    expected: ["人物完整", "信封清晰可见", "朝观看者递出信封"],
  },
  {
    id: "basketball",
    label: "打篮球",
    selections: {
      baseStyle: "日系萌系",
      campusIdentity: "篮球运动系",
      outfit: "运动校服",
      pose: "全身像",
      atmosphereAction: "打篮球",
      campusScene: "操场跑道",
    },
    description: "looking ahead",
    expected: ["人物完整", "篮球清晰可见", "明确的运球或打篮球动作"],
  },
  {
    id: "circular_crop",
    label: "圆形裁剪兼容",
    selections: {
      baseStyle: "日系萌系",
      campusIdentity: "JK 制服女生",
      pose: "半身像",
      background: "纯白背景",
      format: "圆形裁剪兼容",
    },
    description: "looking at viewer",
    expected: ["正面居中", "头肩完整", "四周有圆形裁剪安全边距"],
  },
];

async function loadPromptModules() {
  const outputDirectory = await mkdtemp(
    path.join(tmpdir(), "muse-semantic-regression-"),
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
    const [compiler, promptTags] = await Promise.all([
      import(
        `${pathToFileURL(path.join(outputDirectory, "prompt-compiler.mjs")).href}${cacheKey}`
      ),
      import(
        `${pathToFileURL(path.join(outputDirectory, "prompt-tags.mjs")).href}${cacheKey}`
      ),
    ]);
    return { compiler, promptTags };
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
  if (!Number.isInteger(SEEDS_PER_CASE) || SEEDS_PER_CASE < 1) {
    throw new Error("REGRESSION_SEEDS_PER_CASE must be a positive integer");
  }

  const selectedCases = CASES.filter(
    (item) => CASE_FILTER.size === 0 || CASE_FILTER.has(item.id),
  );
  if (selectedCases.length === 0) {
    throw new Error("REGRESSION_CASES did not match any configured case");
  }

  const statusResponse = await fetch(`${GATEWAY_URL}/v1/status`);
  if (!statusResponse.ok) {
    throw new Error(`Gateway status failed: ${statusResponse.status}`);
  }
  const status = await statusResponse.json();
  if (status.status !== "ready" || !status.model_loaded) {
    throw new Error(`Cloud model is not ready: ${JSON.stringify(status)}`);
  }

  const { compiler, promptTags } = await loadPromptModules();
  const outputDirectory = path.join(REPORT_DIR, "outputs", PHASE);
  const resultPath = path.join(REPORT_DIR, `${PHASE}-results.json`);
  await mkdir(outputDirectory, { recursive: true });

  const results = {
    generatedAt: null,
    phase: PHASE,
    gateway: GATEWAY_URL,
    model: status.model,
    purpose:
      "Three-seed semantic adherence regression using the application's current prompt compiler and the model card's recommended inference settings.",
    settings: {
      ...SETTINGS,
      base_negative_prompt: promptTags.DEFAULT_NEGATIVE_PROMPT,
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
    const originalCaseIndex = CASES.findIndex(
      (candidate) => candidate.id === item.id,
    );
    const compiled = compiler.compilePrompt({
      selections: item.selections,
      description: item.description,
      qualityGuard: "五官正常",
    });
    const effectiveNegativePrompt = compiler.mergeNegativePrompt(
      promptTags.DEFAULT_NEGATIVE_PROMPT,
      compiled.negativeAdditions,
    );
    const inspection = await requestJson("/v1/prompt/inspect", {
      prompt: compiled.prompt,
      prompt_segments: compiled.segments,
      negative_prompt: effectiveNegativePrompt,
      expected_subject: compiled.subjectKind,
    });
    const caseResult = {
      ...item,
      compiler: {
        prompt: compiled.prompt,
        prompt_segments: compiled.segments,
        warnings: compiled.warnings,
        negative_additions: compiled.negativeAdditions,
        negative_prompt: effectiveNegativePrompt,
      },
      inspection,
      generations: [],
      review: {
        status: "pending",
        pass_count: null,
        observed: [],
        notes: "",
      },
    };
    results.cases.push(caseResult);
    results.generatedAt = new Date().toISOString();
    await writeFile(resultPath, `${JSON.stringify(results, null, 2)}\n`);
    if (DRY_RUN) {
      console.log(`[inspect] ${item.id}`);
      continue;
    }

    for (let seedIndex = 0; seedIndex < SEEDS_PER_CASE; seedIndex += 1) {
      const ordinal = originalCaseIndex * SEEDS_PER_CASE + seedIndex;
      const seed = 94000 + ordinal;
      const startedAt = Date.now();
      const body = await requestJson("/v1/generate", {
        prompt: compiled.prompt,
        prompt_segments: compiled.segments,
        negative_prompt: effectiveNegativePrompt,
        ...SETTINGS,
        background_mode: compiled.backgroundMode,
        expected_subject: compiled.subjectKind,
        subject_validation: "strict",
        max_subject_attempts: 4,
        seed,
      });
      const fileName = `${String(caseIndex + 1).padStart(2, "0")}_${item.id}_seed-${body.seed}.png`;
      await writeFile(
        path.join(outputDirectory, fileName),
        Buffer.from(body.image_base64, "base64"),
      );
      caseResult.generations.push({
        seed: body.seed,
        output: `outputs/${PHASE}/${fileName}`,
        request_id: body.request_id,
        duration_ms: body.duration_ms,
        wall_duration_ms: Date.now() - startedAt,
        prompt_used: body.prompt_used,
        prompt_diagnostics: body.prompt_diagnostics,
        background_mode: body.background_mode,
        review: { status: "pending", observed: [], notes: "" },
      });
      results.summary.generated += 1;
      results.generatedAt = new Date().toISOString();
      await writeFile(resultPath, `${JSON.stringify(results, null, 2)}\n`);
      console.log(
        `[${results.summary.generated}/${results.summary.total}] ${item.id} seed=${body.seed} ${body.duration_ms}ms`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
