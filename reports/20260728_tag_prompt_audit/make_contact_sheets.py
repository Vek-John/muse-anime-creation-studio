from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


REPORT_DIR = Path(__file__).resolve().parent
RESULTS_PATH = REPORT_DIR / "generation-results.json"
RETEST_RESULTS_PATH = REPORT_DIR / "targeted-retest-results.json"
SHEET_DIR = REPORT_DIR / "contact-sheets"
THUMB_SIZE = 256
LABEL_HEIGHT = 52
CELL_GAP = 12
BG = (18, 18, 22)
LABEL_BG = (31, 32, 39)
TEXT = (239, 240, 244)


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            pass
    return ImageFont.load_default()


FONT = load_font(16)
SMALL_FONT = load_font(13)


def draw_sheet(items: list[dict], columns: int, output_name: str) -> None:
    rows = (len(items) + columns - 1) // columns
    width = columns * THUMB_SIZE + (columns + 1) * CELL_GAP
    cell_height = THUMB_SIZE + LABEL_HEIGHT
    height = rows * cell_height + (rows + 1) * CELL_GAP
    sheet = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(sheet)

    for index, item in enumerate(items):
        row, column = divmod(index, columns)
        x = CELL_GAP + column * (THUMB_SIZE + CELL_GAP)
        y = CELL_GAP + row * (cell_height + CELL_GAP)
        image_path = REPORT_DIR / item["output"]
        with Image.open(image_path) as source:
            image = source.convert("RGB")
            image.thumbnail((THUMB_SIZE, THUMB_SIZE), Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", (THUMB_SIZE, THUMB_SIZE), (8, 8, 10))
            offset = (
                (THUMB_SIZE - image.width) // 2,
                (THUMB_SIZE - image.height) // 2,
            )
            canvas.paste(image, offset)
            sheet.paste(canvas, (x, y))

        draw.rectangle(
            (x, y + THUMB_SIZE, x + THUMB_SIZE, y + cell_height),
            fill=LABEL_BG,
        )
        draw.text(
            (x + 8, y + THUMB_SIZE + 6),
            item["id"],
            font=SMALL_FONT,
            fill=TEXT,
        )
        draw.text(
            (x + 8, y + THUMB_SIZE + 27),
            item["label"][:23],
            font=FONT,
            fill=TEXT,
        )

    SHEET_DIR.mkdir(parents=True, exist_ok=True)
    sheet.save(SHEET_DIR / output_name, optimize=True)


def main() -> None:
    payload = json.loads(RESULTS_PATH.read_text(encoding="utf-8"))
    semantic = [item for item in payload["cases"] if item["field"] != "comparison"]
    comparisons = [item for item in payload["cases"] if item["field"] == "comparison"]
    retests = json.loads(RETEST_RESULTS_PATH.read_text(encoding="utf-8"))["cases"]

    draw_sheet(semantic[:12], 4, "semantic-fields-01.png")
    draw_sheet(semantic[12:], 4, "semantic-fields-02.png")
    draw_sheet(comparisons, 4, "comparisons.png")
    draw_sheet(retests, 4, "targeted-retests.png")


if __name__ == "__main__":
    main()
