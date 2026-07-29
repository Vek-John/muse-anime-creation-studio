import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const REPORT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PHASE = process.env.REGRESSION_PHASE ?? "baseline";
const THUMB_SIZE = 320;
const LABEL_HEIGHT = 54;
const GAP = 12;
const ROWS_PER_SHEET = 4;

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function drawSheet(cases, outputPath) {
  const columns = Math.max(
    ...cases.map((item) => item.generations.length),
  );
  const cellHeight = THUMB_SIZE + LABEL_HEIGHT;
  const width = columns * THUMB_SIZE + (columns + 1) * GAP;
  const height = cases.length * cellHeight + (cases.length + 1) * GAP;
  const composites = [];
  const labels = [];

  for (let row = 0; row < cases.length; row += 1) {
    const item = cases[row];
    for (
      let column = 0;
      column < item.generations.length;
      column += 1
    ) {
      const generation = item.generations[column];
      const left = GAP + column * (THUMB_SIZE + GAP);
      const top = GAP + row * (cellHeight + GAP);
      const imageBuffer = await sharp(
        path.join(REPORT_DIR, generation.output),
      )
        .resize(THUMB_SIZE, THUMB_SIZE, {
          fit: "contain",
          background: "#08080a",
        })
        .png()
        .toBuffer();
      composites.push({ input: imageBuffer, left, top });
      labels.push(`
        <rect x="${left}" y="${top + THUMB_SIZE}" width="${THUMB_SIZE}" height="${LABEL_HEIGHT}" fill="#1f2027"/>
        <text x="${left + 8}" y="${top + THUMB_SIZE + 21}" fill="#eff0f4" font-size="16" font-family="PingFang SC, Helvetica, sans-serif">${escapeXml(item.label)} · seed ${generation.seed}</text>
        <text x="${left + 8}" y="${top + THUMB_SIZE + 43}" fill="#b8bac3" font-size="13" font-family="Helvetica, sans-serif">${escapeXml(item.id)}</text>
      `);
    }
  }

  const labelLayer = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${labels.join("\n")}
    </svg>
  `);

  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#121216",
    },
  })
    .composite([...composites, { input: labelLayer, left: 0, top: 0 }])
    .png()
    .toFile(outputPath);
}

async function main() {
  const payload = JSON.parse(
    await readFile(path.join(REPORT_DIR, `${PHASE}-results.json`), "utf8"),
  );
  const outputDirectory = path.join(REPORT_DIR, "contact-sheets");
  await mkdir(outputDirectory, { recursive: true });

  for (let start = 0; start < payload.cases.length; start += ROWS_PER_SHEET) {
    const page = Math.floor(start / ROWS_PER_SHEET) + 1;
    await drawSheet(
      payload.cases.slice(start, start + ROWS_PER_SHEET),
      path.join(
        outputDirectory,
        `${PHASE}-${String(page).padStart(2, "0")}.png`,
      ),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
