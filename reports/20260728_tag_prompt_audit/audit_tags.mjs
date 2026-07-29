import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const reportDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(
  reportDirectory,
  "../..",
);

async function importTypeScript(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  const source = await fs.readFile(absolutePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: absolutePath,
  }).outputText;
  const encoded = Buffer.from(output).toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

const config = await importTypeScript("app/studio-config.ts");
const prompts = await importTypeScript("app/prompt-tags.ts");

const fields = config.PARAMETER_GROUPS.flatMap((group, groupIndex) =>
  group.fields.map((field, fieldIndex) => ({
    groupId: group.id,
    groupIndex,
    fieldIndex,
    fieldId: field.id,
    label: field.label,
    options: field.options,
  })),
);
const options = fields.flatMap((field) =>
  field.options.map((value) => ({
    ...field,
    value,
    modelTag: prompts.toModelPrompt(value),
  })),
);

const unmapped = options.filter(
  ({ value, modelTag }) => value === modelTag,
);
const emptyMappings = options.filter(({ modelTag }) => !modelTag);
const mappedGroups = Object.entries(
  options.reduce((accumulator, option) => {
    const key = option.modelTag;
    accumulator[key] ??= [];
    accumulator[key].push(option.value);
    return accumulator;
  }, {}),
).filter(([key, values]) => key && values.length > 1);

const defaultEntries = Object.entries(config.DEFAULT_SELECTIONS);
const defaultParameterPrompt = defaultEntries
  .map(([, value]) => prompts.toModelPrompt(value))
  .filter(Boolean)
  .join(", ");
const defaultDescription =
  "1girl, solo, looking back at viewer, gentle smile, soft backlight, clean composition";
const defaultPrompt = [
  prompts.QUALITY_PREFIX,
  defaultDescription,
  defaultParameterPrompt,
].join(", ");

const allFieldsPrompt = [
  prompts.QUALITY_PREFIX,
  "1girl, solo",
  ...fields.map((field) =>
    prompts.toModelPrompt(
      field.options.reduce((longest, value) =>
        prompts.toModelPrompt(value).length >
        prompts.toModelPrompt(longest).length
          ? value
          : longest,
      ),
    ),
  ),
]
  .filter(Boolean)
  .join(", ");

const report = {
  groupCount: config.PARAMETER_GROUPS.length,
  fieldCount: fields.length,
  optionCount: options.length,
  mappedCount: options.length - unmapped.length,
  unmapped,
  emptyMappings,
  duplicateMappings: mappedGroups.map(([modelTag, values]) => ({
    modelTag,
    values,
  })),
  defaultSelectionOrder: defaultEntries.map(([fieldId, value]) => ({
    fieldId,
    value,
  })),
  defaultPrompt,
  defaultPromptCharacters: defaultPrompt.length,
  allFieldsPrompt,
  allFieldsPromptCharacters: allFieldsPrompt.length,
  optionMappings: options.map(
    ({ groupId, fieldId, label, value, modelTag }) => ({
      groupId,
      fieldId,
      label,
      value,
      modelTag,
    }),
  ),
  fieldInventory: fields.map((field) => ({
    groupId: field.groupId,
    fieldId: field.fieldId,
    label: field.label,
    optionCount: field.options.length,
  })),
};

const outputPath = path.join(
  reportDirectory,
  "static-audit.json",
);
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
