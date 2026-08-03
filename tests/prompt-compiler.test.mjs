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
  assert.ok(first.prompt.endsWith("masterpiece"));
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

test("input subject overrides conflicting structured subject", () => {
  const result = compiler.compilePrompt({
    selections: { specialSetting: "情侣头像（双人互动）" },
    description: "1girl, solo, gentle smile",
  });

  assert.match(result.prompt, /^1girl, solo,/);
  assert.doesNotMatch(result.prompt, /\b1boy\b/);
  assert.equal(result.subjectKind, "female");
  assert.ok(result.warnings.length > 0);
});

test("solid backgrounds add matching negative constraints", () => {
  const result = compiler.compilePrompt({
    selections: { background: "纯白背景" },
    description: "1girl",
  });
  for (const tag of [
    "scenery",
    "colored background",
  ]) {
    assert.ok(result.negativeAdditions.includes(tag));
  }
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
  assert.ok(fullBody.negativeAdditions.includes("close-up"));
  assert.ok(fullBody.negativeAdditions.includes("out of frame"));

  const circularCrop = compiler.compilePrompt({
    selections: { format: "圆形裁剪兼容" },
    description: "",
  });
  assert.match(circularCrop.prompt, /full body, wide shot/);
  assert.ok(circularCrop.negativeAdditions.includes("close-up"));
  assert.ok(circularCrop.negativeAdditions.includes("out of frame"));
});

test("1man is normalized to the model 1boy contract and overrides female defaults", () => {
  const result = compiler.compilePrompt({
    selections: config.DEFAULT_SELECTIONS,
    description: "1man, old, school uniform, top to toe",
    qualityGuard: "五官正常",
  });

  assert.equal(result.subjectKind, "male");
  assert.match(result.prompt, /^1boy, solo, male focus,/);
  assert.doesNotMatch(result.prompt, /adult male/);
  assert.match(
    result.prompt,
    /old man, wrinkles, grey hair, facial hair, beard/,
  );
  assert.match(result.prompt, /male school uniform, trousers/);
  assert.match(result.prompt, /full body, wide shot, head-to-toe, feet visible/);
  assert.doesNotMatch(result.prompt, /\b1girl\b/);
  assert.doesNotMatch(result.prompt, /energetic girl/);
  assert.doesNotMatch(result.prompt, /upper body/);
  assert.doesNotMatch(result.prompt, /social media avatar/);
  for (const tag of ["1girl", "breasts"]) {
    assert.ok(result.negativeAdditions.includes(tag));
  }
  assert.ok(
    result.segments
      .filter((segment) => segment.id.startsWith("custom:"))
      .every((segment) => segment.protected && segment.priority === 0),
  );
});

test("the last explicit input subject wins when the input contains stale defaults", () => {
  const result = compiler.compilePrompt({
    selections: config.DEFAULT_SELECTIONS,
    description:
      "1girl, solo, gentle smile, 1man, adult male, masculine face",
  });

  assert.equal(result.subjectKind, "male");
  assert.match(result.prompt, /^1boy, solo, male focus,/);
  assert.doesNotMatch(result.prompt, /\b1girl\b/);
  assert.match(result.warnings.join(" "), /最后出现/);
});

test("female input overrides male selections and receives inverse exclusions", () => {
  const result = compiler.compilePrompt({
    selections: {
      campusIdentity: "校草风男生",
      personality: "温柔学长",
    },
    description: "1woman, adult female, long hair",
  });

  assert.equal(result.subjectKind, "female");
  assert.match(result.prompt, /^1girl, solo,/);
  assert.doesNotMatch(result.prompt, /handsome male student|gentle senior boy/);
  for (const tag of ["1boy", "male focus", "beard"]) {
    assert.ok(result.negativeAdditions.includes(tag));
  }
});

test("male crossdressing preserves feminine clothing but excludes female anatomy", () => {
  const result = compiler.compilePrompt({
    selections: { personality: "元气少女", outfit: "校园西装" },
    description:
      "1man, old, crossdressing, sailor uniform, top to toe",
  });

  assert.equal(result.subjectKind, "male");
  assert.match(result.prompt, /crossdressing/);
  assert.match(result.prompt, /masculine male/);
  assert.match(result.prompt, /sailor uniform/);
  assert.match(result.prompt, /pleated skirt/);
  assert.doesNotMatch(result.prompt, /school blazer|energetic girl/);
  assert.ok(result.negativeAdditions.includes("breasts"));
  assert.ok(!result.negativeAdditions.includes("skirt"));
  assert.ok(!result.negativeAdditions.includes("dress"));
});

test("input framing action scene style and outfit override conflicting selections", () => {
  const result = compiler.compilePrompt({
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
  });

  assert.equal(result.subjectKind, "male");
  assert.match(result.prompt, /^1boy, solo, male focus,/);
  assert.match(result.prompt, /male sailor-style school uniform/);
  assert.match(result.prompt, /full body/);
  assert.match(result.prompt, /waving, raised hand, open hand/);
  assert.match(result.prompt, /white background/);
  assert.ok(
    result.prompt.includes("watercolor \\(medium\\), traditional media"),
  );
  assert.doesNotMatch(
    result.prompt,
    /japanese school uniform|school blazer|upper body|visible envelope|classroom window|social media avatar|semi-realistic/,
  );
  assert.equal(result.backgroundMode, "white");
  assert.ok(result.warnings.filter((warning) => /输入框优先/.test(warning)).length >= 5);
});

test("Chinese male intent is recognized inside an unstructured phrase", () => {
  const result = compiler.compilePrompt({
    selections: { personality: "元气少女" },
    description: "水手服校草男生，从头到脚，站立",
  });

  assert.equal(result.subjectKind, "male");
  assert.match(result.prompt, /^1boy, solo, male focus,/);
  assert.match(result.prompt, /male sailor-style school uniform/);
  assert.match(result.prompt, /head-to-toe/);
  assert.doesNotMatch(result.prompt, /energetic girl/);
});

test("tag aliases and weather override prevent faceless rain-scene failures", () => {
  const result = compiler.compilePrompt({
    selections: config.DEFAULT_SELECTIONS,
    description:
      "1boy, yellow hair, japanese clothes, under the heavy rain",
    qualityGuard: "五官正常",
  });

  assert.equal(result.subjectKind, "male");
  assert.match(result.prompt, /^1boy, solo, male focus,/);
  assert.match(result.prompt, /blonde hair/);
  assert.match(result.prompt, /japanese clothes/);
  assert.match(result.prompt, /rain, wet, wet clothes, cloudy sky, outdoors/);
  assert.doesNotMatch(result.prompt, /yellow hair|under the heavy rain/);
  assert.doesNotMatch(
    result.prompt,
    /under cherry blossom tree|falling petals|gentle, soothing/,
  );
  for (const field of [
    "hairstyle",
    "outfit",
    "campusScene",
    "animeScene",
    "background",
    "emotion",
    "tone",
  ]) {
    assert.ok(result.inputOverrideFields.includes(field));
  }
  for (const tag of [
    "no humans",
    "head out of frame",
    "faceless",
    "headless",
  ]) {
    assert.ok(result.negativeAdditions.includes(tag));
  }
});

test("Chinese and alternate rain aliases compile without stray untranslated tags", () => {
  const cases = [
    "1boy，黄发，日式服装，暴雨中",
    "1boy, golden-haired, japanese attire, thunderstorm",
  ];

  for (const description of cases) {
    const result = compiler.compilePrompt({
      selections: config.DEFAULT_SELECTIONS,
      description,
      qualityGuard: "五官正常",
    });

    assert.equal(result.subjectKind, "male");
    assert.match(result.prompt, /^1boy, solo, male focus,/);
    assert.match(result.prompt, /blonde hair/);
    assert.match(result.prompt, /japanese clothes/);
    assert.match(
      result.prompt,
      /rain, wet, wet clothes, cloudy sky, outdoors/,
    );
    assert.doesNotMatch(
      result.prompt,
      /黄发|金发|日式服装|日式衣装|暴雨|大雨|暴风雨|thunderstorm|golden-haired|japanese attire|(?:^|, )中(?:,|$)/,
    );
    assert.doesNotMatch(
      result.prompt,
      /under cherry blossom tree|falling petals|gentle, soothing/,
    );
  }
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
    "鬼灭之刃画风",
    "海贼王手绘风",
    "罗小黑战记治愈风",
  ]);
  assert.deepEqual(config.DEFAULT_QUALITY_GUARDS, []);
  const usage = config.PARAMETER_GROUPS.flatMap((group) => group.fields).find(
    (field) => field.id === "usage",
  );
  assert.ok(usage.options.includes("社团海报构图"));
  assert.ok(!usage.options.some((option) => option.includes("可商用")));
});

test("blank canvas keeps only compact disposable human guards", () => {
  const blank = compiler.compilePrompt({
    selections: {},
    description: "",
  });

  assert.equal(blank.prompt, "solo, safe, masterpiece");
  assert.deepEqual(
    blank.segments.map((segment) => segment.id),
    ["default-human", "rating", "quality-suffix"],
  );
  assert.ok(
    blank.segments.every(
      (segment) => segment.priority === 3 && !segment.protected,
    ),
  );
  assert.equal(blank.subject, "solo");
  assert.equal(blank.subjectKind, "human");
  assert.equal(blank.expectedSubject, "human");
  assert.deepEqual(blank.negativeAdditions, [
    "no humans",
    "head out of frame",
    "faceless",
    "headless",
  ]);
  assert.deepEqual(blank.negativeRemovals, []);
});

test("explicit no-human intent removes every default human constraint", () => {
  const result = compiler.compilePrompt({
    selections: {},
    description: "no humans, empty street, rainy night",
  });

  assert.doesNotMatch(result.prompt, /\bsolo\b/);
  assert.match(result.prompt, /no humans/);
  assert.equal(result.subjectKind, null);
  assert.equal(result.expectedSubject, null);
  assert.deepEqual(result.negativeAdditions, []);
  assert.match(result.warnings.join(" "), /停用默认人物完整性限制/);
});

test("hard no-human input overrides stale human selections and tags", () => {
  const result = compiler.compilePrompt({
    selections: {
      campusIdentity: "校草风男生",
      hairstyle: "高马尾",
      outfit: "校园西装",
      baseStyle: "日系萌系",
    },
    description: "1boy, no humans, empty street",
  });

  assert.equal(result.subjectKind, null);
  assert.equal(result.expectedSubject, null);
  assert.doesNotMatch(
    result.prompt,
    /1boy|solo|male focus|male student|ponytail|school blazer/,
  );
  assert.match(result.prompt, /no humans/);
  assert.match(result.prompt, /empty street/);
  assert.match(result.prompt, /anime style/);
  assert.match(result.warnings.join(" "), /非人主体要求优先/);
});

test("non-human model focus disables the generic person default", () => {
  const result = compiler.compilePrompt({
    selections: { baseStyle: "机甲硬核" },
    description: "",
  });

  assert.match(result.prompt, /\bmecha\b/);
  assert.doesNotMatch(result.prompt, /\bsolo\b/);
  assert.equal(result.subjectKind, null);
  assert.equal(result.expectedSubject, null);
  assert.deepEqual(result.negativeAdditions, []);
});

test("wearable mecha and appearance selections retain a human subject", () => {
  const outfit = compiler.compilePrompt({
    selections: { outfit: "机甲战衣" },
    description: "",
  });
  assert.match(outfit.prompt, /^solo/);
  assert.match(outfit.prompt, /mecha bodysuit/);
  assert.equal(outfit.expectedSubject, "human");

  const styledCharacter = compiler.compilePrompt({
    selections: {
      baseStyle: "机甲硬核",
      hairstyle: "短发狼尾",
    },
    description: "",
  });
  assert.match(styledCharacter.prompt, /^solo/);
  assert.equal(styledCharacter.expectedSubject, "human");
});

test("an explicit human subject wins over a non-human style signal", () => {
  const result = compiler.compilePrompt({
    selections: {},
    description: "1boy, mecha armor",
  });

  assert.match(result.prompt, /^1boy, solo, male focus/);
  assert.equal(result.subjectKind, "male");
  assert.equal(result.expectedSubject, "male");
  for (const tag of [
    "no humans",
    "head out of frame",
    "faceless",
    "headless",
  ]) {
    assert.ok(result.negativeAdditions.includes(tag));
  }
});

test("explicit integrity exceptions remove conflicting guards", () => {
  const faceless = compiler.compilePrompt({
    selections: {
      facialFeatures: "大眼睛",
      faceDetails: "雀斑",
    },
    description: "1boy, faceless, school uniform, black coat",
  });

  assert.equal(faceless.subjectKind, "male");
  assert.equal(faceless.expectedSubject, null);
  assert.match(faceless.prompt, /\bfaceless\b/);
  assert.doesNotMatch(faceless.prompt, /masculine face|large eyes|freckles/);
  assert.ok(!faceless.negativeAdditions.includes("faceless"));
  assert.ok(faceless.negativeAdditions.includes("headless"));
  assert.ok(faceless.inputOverrideFields.includes("facialFeatures"));
  assert.ok(faceless.inputOverrideFields.includes("faceDetails"));
  assert.match(faceless.warnings.join(" "), /停用本次人物完整性校验/);

  const cropped = compiler.compilePrompt({
    selections: { hairstyle: "高马尾" },
    description: "1girl, head out of frame",
  });
  const negative = compiler.mergeNegativePrompt(
    "lowres, cropped, blurry",
    cropped.negativeAdditions,
    cropped.negativeRemovals,
  );
  assert.ok(cropped.negativeRemovals.includes("cropped"));
  assert.doesNotMatch(cropped.prompt, /high ponytail/);
  assert.ok(cropped.inputOverrideFields.includes("hairstyle"));
  assert.doesNotMatch(negative, /\bcropped\b/);
  assert.doesNotMatch(negative, /head out of frame/);
});

test("generic multi-person intent drops solo but keeps human validation", () => {
  const result = compiler.compilePrompt({
    selections: {},
    description: "multiple people, school festival",
  });

  assert.doesNotMatch(result.prompt, /\bsolo\b/);
  assert.match(result.prompt, /multiple people/);
  assert.equal(result.subjectKind, "human");
  assert.equal(result.expectedSubject, "human");
  assert.ok(result.negativeAdditions.includes("no humans"));
});

test("automatic hints stay compact and are always disposable", () => {
  const result = compiler.compilePrompt({
    selections: {
      baseStyle: "日系萌系",
      outfit: "水手服",
    },
    description: "1boy, blonde hair",
  });
  const automatic = result.segments.filter((segment) =>
    ["rating", "quality-suffix"].includes(segment.id),
  );

  assert.deepEqual(
    automatic.map((segment) => segment.text),
    ["safe", "masterpiece"],
  );
  assert.ok(
    automatic.every(
      (segment) => segment.priority === 3 && !segment.protected,
    ),
  );
  assert.doesNotMatch(
    result.prompt,
    /symmetrical face|correct facial features|coherent clothing|no clipping|detailed hair|sharp hair strands|correct proportions|high score|great score|absurdres/,
  );
});

test("Demon Slayer selection compiles a protected LoRA trigger", () => {
  const result = compiler.compilePrompt({
    selections: { animeReference: "鬼灭之刃画风" },
    description: "1boy, solo, original character",
  });
  const segment = result.segments.find(
    (item) => item.id === "selection:animeReference",
  );
  const adapter = config.styleAdapterForSelection("鬼灭之刃画风");

  assert.equal(segment.text, "demonslayer style");
  assert.match(result.prompt, /original character/);
  assert.equal(segment.priority, 0);
  assert.equal(segment.protected, true);
  assert.equal(adapter.id, "demonslayer");
  assert.equal(adapter.defaultScale, 0.65);
  assert.ok(adapter.negativeAdditions.includes("official character"));
});

test("explicit input style disables the selected IP adapter route", () => {
  const result = compiler.compilePrompt({
    selections: { animeReference: "鬼灭之刃画风" },
    description: "1girl, watercolor style",
  });

  assert.ok(result.inputOverrideFields.includes("animeReference"));
  assert.doesNotMatch(result.prompt, /demonslayer style/);
});
