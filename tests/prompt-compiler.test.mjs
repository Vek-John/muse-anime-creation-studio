import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = join(testDirectory, "..", "app");

async function loadPromptModules() {
  const outputDirectory = mkdtempSync(join(tmpdir(), "muse-prompt-test-"));
  const files = ["prompt-tags.ts", "studio-config.ts", "prompt-compiler.ts"];

  for (const filename of files) {
    const source = readFileSync(join(appDirectory, filename), "utf8");
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
    writeFileSync(
      join(outputDirectory, filename.replace(/\.ts$/, ".mjs")),
      output,
    );
  }

  const cacheKey = `?test=${process.pid}-${Date.now()}`;
  const [compiler, config] = await Promise.all([
    import(
      `${pathToFileURL(join(outputDirectory, "prompt-compiler.mjs")).href}${cacheKey}`
    ),
    import(
      `${pathToFileURL(join(outputDirectory, "studio-config.mjs")).href}${cacheKey}`
    ),
  ]);
  rmSync(outputDirectory, { recursive: true, force: true });
  return { compiler, config };
}

const { compiler, config } = await loadPromptModules();

test("prompt order is deterministic and protects framing before accessories", () => {
  const selectionsA = {
    accessory: "书包",
    pose: "全身像",
    baseStyle: "日系萌系",
  };
  const selectionsB = {
    baseStyle: "日系萌系",
    pose: "全身像",
    accessory: "书包",
  };

  const first = compiler.compilePrompt({
    selections: selectionsA,
    description: "gentle smile",
    qualityGuard: "五官正常",
  });
  const second = compiler.compilePrompt({
    selections: selectionsB,
    description: "gentle smile",
    qualityGuard: "五官正常",
  });

  assert.equal(first.prompt, second.prompt);
  assert.ok(first.prompt.indexOf("full body") < first.prompt.indexOf("school bag"));
  assert.ok(
    first.prompt.endsWith("masterpiece, high score, great score, absurdres"),
  );
  assert.equal(
    first.segments.find((segment) => segment.id === "selection:pose").protected,
    true,
  );
});

test("scene and action conflicts resolve to the newest choice", () => {
  const scene = compiler.resolveSelectionChange(
    { campusScene: "樱花树下" },
    "animeScene",
    "星空下",
  );
  assert.equal(scene.selections.campusScene, undefined);
  assert.equal(scene.selections.animeScene, "星空下");

  const background = compiler.resolveSelectionChange(
    { campusScene: "樱花树下", animeScene: "星空下" },
    "background",
    "纯白背景",
  );
  assert.equal(background.selections.campusScene, undefined);
  assert.equal(background.selections.animeScene, undefined);

  const action = compiler.resolveSelectionChange(
    { interaction: "挥手" },
    "atmosphereAction",
    "打篮球",
  );
  assert.equal(action.selections.interaction, undefined);
  assert.equal(action.selections.atmosphereAction, "打篮球");
});

test("structured subject overrides conflicting free-text subject", () => {
  const result = compiler.compilePrompt({
    selections: { specialSetting: "情侣头像（双人互动）" },
    description: "1girl, solo, gentle smile",
  });

  assert.match(result.prompt, /^1boy, 1girl,/);
  assert.doesNotMatch(result.prompt, /\bsolo\b/);
  assert.ok(result.warnings.length > 0);
});

test("solid backgrounds add matching negative constraints", () => {
  const result = compiler.compilePrompt({
    selections: { background: "纯白背景" },
    description: "1girl",
  });
  assert.deepEqual(result.negativeAdditions, [
    "scenery",
    "detailed background",
    "colored background",
    "gradient background",
    "cast shadow",
    "silhouette",
  ]);
});

test("high-risk composition tags add inference-side exclusion constraints", () => {
  const fullBody = compiler.compilePrompt({
    selections: { pose: "全身像" },
    description: "",
  });
  assert.match(
    fullBody.prompt,
    /full body, wide shot, head-to-toe, feet visible/,
  );
  assert.deepEqual(fullBody.negativeAdditions, [
    "close-up",
    "out of frame",
  ]);

  const circularCrop = compiler.compilePrompt({
    selections: { format: "圆形裁剪兼容" },
    description: "",
  });
  assert.match(circularCrop.prompt, /full body, wide shot/);
  assert.deepEqual(circularCrop.negativeAdditions, [
    "close-up",
    "out of frame",
  ]);
});

test("circular crop and incompatible framing resolve by latest choice", () => {
  const circularWins = compiler.resolveSelectionChange(
    { pose: "半身像" },
    "format",
    "圆形裁剪兼容",
  );
  assert.equal(circularWins.selections.pose, undefined);
  assert.equal(circularWins.selections.format, "圆形裁剪兼容");
  assert.match(circularWins.notices.join(" "), /圆形裁剪/);

  const poseWins = compiler.resolveSelectionChange(
    { format: "圆形裁剪兼容" },
    "pose",
    "全身像",
  );
  assert.equal(poseWins.selections.format, undefined);
  assert.equal(poseWins.selections.pose, "全身像");

  const directCompile = compiler.compilePrompt({
    selections: {
      pose: "半身像",
      format: "圆形裁剪兼容",
    },
    description: "",
  });
  assert.doesNotMatch(directCompile.prompt, /upper body/);
  assert.match(directCompile.prompt, /full body, wide shot/);
  assert.ok(directCompile.warnings.length > 0);
});

test("technical settings are not a parallel tag group and IP options remain", () => {
  assert.equal(
    config.PARAMETER_GROUPS.some((group) => group.id === "technical"),
    false,
  );
  const animeReference = config.PARAMETER_GROUPS.flatMap(
    (group) => group.fields,
  ).find((field) => field.id === "animeReference");
  assert.deepEqual(animeReference.options, [
    "原神风",
    "火影忍者画风",
    "鬼灭之刃质感",
    "海贼王手绘风",
    "罗小黑战记治愈风",
  ]);
  assert.deepEqual(config.QUALITY_GUARD_OPTIONS, [
    "五官正常",
    "无穿模",
    "发丝不模糊",
    "比例协调",
  ]);
  const usage = config.PARAMETER_GROUPS.flatMap((group) => group.fields).find(
    (field) => field.id === "usage",
  );
  assert.ok(usage.options.includes("社团海报构图"));
  assert.ok(!usage.options.some((option) => option.includes("可商用")));
});
