#!/usr/bin/env python3
"""Exercise the two historical male-subject regressions through the real API."""

from __future__ import annotations

import argparse
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from verify_style_switch import (
    ADAPTERS,
    DEFAULT_API_URL,
    DEFAULT_ENV_FILE,
    VerificationError,
    atomic_write_json,
    contains_prompt_tag,
    decode_png,
    normalize_api_url,
    post_json,
    read_api_key,
    response_without_image,
    sha256_bytes,
)


DEFAULT_OUTPUT_ROOT = Path("/root/autodl-tmp/muse-subject-regression")
NEGATIVE_PROMPT = (
    "lowres, worst quality, bad quality, bad anatomy, bad hands, text, watermark, "
    "1girl, 2girls, breasts, cleavage"
)


@dataclass(frozen=True)
class RegressionCase:
    name: str
    prompt: str
    seed: int


def build_cases() -> list[RegressionCase]:
    old_uniform = (
        "1boy, solo, male focus, old man, wrinkles, grey hair, facial hair, beard, "
        "male school uniform, trousers, full body, wide shot, head-to-toe, feet visible"
    )
    yellow_rain = (
        "1boy, solo, male focus, blonde hair, japanese clothes, rain, wet, "
        "wet clothes, cloudy sky, outdoors"
    )
    return [
        RegressionCase("old_uniform_seed_a", old_uniform, 20_260_803),
        RegressionCase("old_uniform_seed_b", old_uniform, 3_776_952_234),
        RegressionCase("yellow_rain_seed_a", yellow_rain, 20_260_803),
        RegressionCase("yellow_rain_seed_b", yellow_rain, 3_776_952_234),
    ]


def accepted_seed_is_in_retry_window(base_seed: int, accepted_seed: int) -> bool:
    """Return whether the accepted seed is one of four deterministic attempts.

    >>> accepted_seed_is_in_retry_window(10, 13)
    True
    >>> accepted_seed_is_in_retry_window(10, 14)
    False
    """

    return accepted_seed in {(base_seed + offset) % (2**32) for offset in range(4)}


def request_payload(
    case: RegressionCase,
    adapter_name: str,
) -> dict[str, Any]:
    negative_prompt = NEGATIVE_PROMPT
    if case.name.startswith("old_uniform_"):
        negative_prompt += (
            ", close-up, out of frame, character sheet, reference sheet, "
            "multiple views, inset, split screen, collage"
        )
    return {
        "prompt": case.prompt,
        "negative_prompt": negative_prompt,
        "width": 1024,
        "height": 1024,
        "steps": 28,
        "guidance_scale": 5,
        "seed": case.seed,
        "sampler": "euler_a",
        "clip_skip": 2,
        "expected_subject": "male",
        "subject_validation": "strict",
        "max_subject_attempts": 4,
        "style_adapter": adapter_name,
        "style_adapter_scale": None,
    }


def validate_response(
    case: RegressionCase,
    response: dict[str, Any],
    adapter_name: str,
) -> None:
    expected_scale, expected_trigger = ADAPTERS[adapter_name]
    accepted_seed = response.get("seed")
    if not isinstance(accepted_seed, int) or not accepted_seed_is_in_retry_window(
        case.seed, accepted_seed
    ):
        raise VerificationError(
            f"{case.name}: accepted seed {accepted_seed!r} is outside the retry window."
        )
    if response.get("style_adapter") != adapter_name:
        raise VerificationError(
            f"{case.name}: {adapter_name} adapter was not active."
        )
    if response.get("style_adapter_scale") != expected_scale:
        raise VerificationError(
            f"{case.name}: server default scale was not {expected_scale}."
        )
    prompt_used = response.get("prompt_used")
    if not isinstance(prompt_used, str) or not contains_prompt_tag(
        prompt_used,
        expected_trigger,
    ):
        raise VerificationError(
            f"{case.name}: prompt_used is missing {expected_trigger}."
        )
    report = response.get("subject_validation")
    if not isinstance(report, dict) or report.get("status") != "passed":
        raise VerificationError(f"{case.name}: strict male validation did not pass.")
    if report.get("expected_subject") != "male":
        raise VerificationError(f"{case.name}: expected_subject drifted from male.")
    attempts = report.get("attempts")
    if (
        not isinstance(attempts, list)
        or not attempts
        or not isinstance(attempts[-1], dict)
        or not attempts[-1].get("passed")
    ):
        raise VerificationError(f"{case.name}: final validation attempt is not a pass.")


def prepare_output_dir(argument: Path | None) -> Path:
    if argument is None:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        output_dir = DEFAULT_OUTPUT_ROOT / timestamp
    else:
        output_dir = argument.expanduser()
    if output_dir.exists() and any(output_dir.iterdir()):
        raise VerificationError(f"Output directory is not empty: {output_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def run(args: argparse.Namespace) -> Path:
    api_url = normalize_api_url(args.api_url)
    api_key = read_api_key(args.api_key, args.env_file.expanduser())
    output_dir = prepare_output_dir(args.output_dir)
    results: list[dict[str, Any]] = []

    expected_scale, expected_trigger = ADAPTERS[args.adapter]
    for index, case in enumerate(build_cases(), start=1):
        started = time.perf_counter()
        _, response = post_json(
            f"{api_url}/v1/generate",
            request_payload(case, args.adapter),
            api_key,
            args.timeout,
        )
        validate_response(case, response, args.adapter)
        image = decode_png(response)
        image_name = f"{index:02d}_{case.name}.png"
        metadata_name = f"{index:02d}_{case.name}.json"
        image_sha256 = sha256_bytes(image)
        (output_dir / image_name).write_bytes(image)
        metadata = response_without_image(
            response,
            image_file=image_name,
            image_sha256=image_sha256,
        )
        atomic_write_json(output_dir / metadata_name, metadata)
        item = {
            "case": case.name,
            "base_seed": case.seed,
            "accepted_seed": response["seed"],
            "attempt_count": len(response["subject_validation"]["attempts"]),
            "elapsed_ms": round((time.perf_counter() - started) * 1000),
            "image_file": image_name,
            "metadata_file": metadata_name,
            "image_sha256": image_sha256,
        }
        results.append(item)
        print(
            f"PASS {case.name}: accepted_seed={item['accepted_seed']} "
            f"attempts={item['attempt_count']} sha256={image_sha256}"
        )

    summary = {
        "status": "passed",
        "api_url": api_url,
        "adapter": args.adapter,
        "trigger": expected_trigger,
        "resolved_scale": expected_scale,
        "expected_subject": "male",
        "case_count": len(results),
        "cases": results,
    }
    atomic_write_json(output_dir / "verification_summary.json", summary)
    print(f"Artifacts: {output_dir}")
    return output_dir


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--api-key")
    parser.add_argument(
        "--adapter",
        choices=tuple(ADAPTERS),
        default="luoxiaohei",
        help="Style adapter to exercise (default: luoxiaohei).",
    )
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--timeout", type=float, default=180)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        run(args)
    except VerificationError as exc:
        print(f"FAIL: {exc}", file=__import__("sys").stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
