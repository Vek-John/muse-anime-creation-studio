#!/usr/bin/env python3
"""End-to-end regression for single-process style adapter switching.

The tool intentionally uses only the Python standard library so it can run in
the inference virtual environment without installing test dependencies.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import math
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


DEFAULT_API_URL = "http://127.0.0.1:6006"
DEFAULT_ENV_FILE = Path("/root/muse-diffusion/.env")
DEFAULT_OUTPUT_ROOT = Path(
    "/root/autodl-tmp/muse-style-switch-regression"
)
FIXED_SEED = 20_260_803
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
ADAPTERS = {
    "luoxiaohei": (0.60, "muse_lxh_style"),
    "demonslayer": (0.65, "demonslayer style"),
    "naruto": (0.65, "in naruto-style"),
    "genshin": (0.60, "genshin-style character"),
    "onepiece": (0.60, "one_piece_style"),
}
KNOWN_TRIGGERS = tuple(values[1] for values in ADAPTERS.values())


class VerificationError(RuntimeError):
    """Raised when the API or adapter lifecycle violates the contract."""


@dataclass(frozen=True)
class VerificationCase:
    name: str
    adapter: str | None
    expected_scale: float | None
    expected_trigger: str | None


def build_cases(skip_adapters: Iterable[str]) -> list[VerificationCase]:
    """Return the required single-process request sequence.

    >>> [case.name for case in build_cases([])]
    ['base_before', 'luoxiaohei', 'demonslayer', 'naruto', 'genshin', 'onepiece', 'base_after']
    >>> [case.name for case in build_cases(['luoxiaohei', 'onepiece'])]
    ['base_before', 'demonslayer', 'naruto', 'genshin', 'base_after']
    """

    skipped = set(skip_adapters)
    cases = [VerificationCase("base_before", None, None, None)]
    for adapter_name, (scale, trigger) in ADAPTERS.items():
        if adapter_name in skipped:
            continue
        cases.append(
            VerificationCase(
                adapter_name,
                adapter_name,
                scale,
                trigger,
            )
        )
    cases.append(VerificationCase("base_after", None, None, None))
    return cases


def parse_dotenv_lines(lines: Iterable[str]) -> dict[str, str]:
    """Parse the small KEY=VALUE subset used by the deployment `.env`.

    The file is parsed as data rather than sourced as shell code.

    >>> parse_dotenv_lines(["API_KEY=abc123\\n", "export MODE='cloud'\\n"])
    {'API_KEY': 'abc123', 'MODE': 'cloud'}
    >>> parse_dotenv_lines(["# comment\\n", "BROKEN\\n", 'X="a b"\\n'])
    {'X': 'a b'}
    """

    values: dict[str, str] = {}
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].lstrip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()
        values[key] = value
    return values


def contains_prompt_tag(prompt: str, expected: str) -> bool:
    """Check an exact comma-delimited model tag, ignoring case and spacing.

    >>> contains_prompt_tag("1girl,  muse_lxh_style, safe", "muse_lxh_style")
    True
    >>> contains_prompt_tag("1girl, not_muse_lxh_style", "muse_lxh_style")
    False
    """

    expected_tag = " ".join(expected.lower().split())
    return any(
        " ".join(tag.lower().split()) == expected_tag
        for tag in prompt.replace("，", ",").split(",")
    )


def response_without_image(
    response: dict[str, Any],
    *,
    image_file: str | None = None,
    image_sha256: str | None = None,
) -> dict[str, Any]:
    """Return JSON-safe response metadata without the base64 payload.

    >>> response_without_image(
    ...     {"seed": 1, "image_base64": "secret"},
    ...     image_file="case.png",
    ...     image_sha256="abc",
    ... )
    {'seed': 1, 'image_file': 'case.png', 'image_sha256': 'abc'}
    """

    sanitized = {
        key: value
        for key, value in response.items()
        if key != "image_base64"
    }
    if image_file is not None:
        sanitized["image_file"] = image_file
    if image_sha256 is not None:
        sanitized["image_sha256"] = image_sha256
    return sanitized


def sha256_bytes(content: bytes) -> str:
    """Return a lowercase SHA-256 digest.

    >>> sha256_bytes(b"muse")
    '4016c3db3bc3c731a4148022f43ebd6d4422b77976763135b9d9afcb9b71b2c1'
    """

    return hashlib.sha256(content).hexdigest()


def normalize_api_url(value: str) -> str:
    normalized = value.strip().rstrip("/")
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise VerificationError(
            "--api-url must be an absolute http:// or https:// URL."
        )
    return normalized


def read_api_key(cli_value: str | None, env_file: Path) -> str:
    if cli_value is not None:
        api_key = cli_value.strip()
    else:
        try:
            values = parse_dotenv_lines(
                env_file.read_text(encoding="utf-8").splitlines()
            )
        except OSError as exc:
            raise VerificationError(
                f"Cannot read API key env file: {env_file}"
            ) from exc
        api_key = values.get("API_KEY", "").strip()

    if not api_key or api_key == "replace-with-a-long-random-secret":
        raise VerificationError(
            "API_KEY is missing; provide --api-key or a private --env-file."
        )
    return api_key


def request_payload(case: VerificationCase) -> dict[str, Any]:
    return {
        "prompt": (
            "1girl, solo, full body, standing, simple white background, "
            "safe, masterpiece"
        ),
        "negative_prompt": (
            "lowres, bad anatomy, bad hands, text, watermark"
        ),
        "width": 1024,
        "height": 1024,
        "steps": 25,
        "guidance_scale": 5,
        "seed": FIXED_SEED,
        "sampler": "euler_a",
        "clip_skip": 2,
        "subject_validation": "off",
        "style_adapter": case.adapter,
        # Null deliberately exercises the server-side adapter default.
        "style_adapter_scale": None,
    }


def post_json(
    url: str,
    payload: dict[str, Any],
    api_key: str,
    timeout: float,
) -> tuple[int, dict[str, Any]]:
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            status = int(response.status)
            body = response.read()
    except HTTPError as exc:
        body = exc.read(16_384).decode("utf-8", errors="replace")
        raise VerificationError(
            f"API returned HTTP {exc.code}: {body}"
        ) from exc
    except URLError as exc:
        raise VerificationError(
            f"Cannot reach inference API: {exc.reason}"
        ) from exc

    if status != 200:
        raise VerificationError(f"API returned unexpected HTTP {status}.")
    try:
        decoded = json.loads(body)
    except json.JSONDecodeError as exc:
        raise VerificationError("API response is not valid JSON.") from exc
    if not isinstance(decoded, dict):
        raise VerificationError("API response must be a JSON object.")
    return status, decoded


def decode_png(response: dict[str, Any]) -> bytes:
    encoded = response.get("image_base64")
    if not isinstance(encoded, str) or not encoded:
        raise VerificationError("API response has no image_base64 payload.")
    try:
        image = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise VerificationError("image_base64 is invalid.") from exc
    if not image.startswith(PNG_SIGNATURE):
        raise VerificationError("Decoded image is not a PNG file.")
    return image


def validate_case_response(
    case: VerificationCase,
    response: dict[str, Any],
) -> None:
    if response.get("seed") != FIXED_SEED:
        raise VerificationError(
            f"{case.name}: expected seed {FIXED_SEED}, "
            f"received {response.get('seed')!r}."
        )

    actual_adapter = response.get("style_adapter")
    if actual_adapter != case.adapter:
        raise VerificationError(
            f"{case.name}: expected adapter {case.adapter!r}, "
            f"received {actual_adapter!r}."
        )

    actual_scale = response.get("style_adapter_scale")
    if case.expected_scale is None:
        if actual_scale is not None:
            raise VerificationError(
                f"{case.name}: base request returned LoRA scale {actual_scale!r}."
            )
    elif (
        isinstance(actual_scale, bool)
        or not isinstance(actual_scale, (int, float))
        or not math.isclose(
            float(actual_scale),
            case.expected_scale,
            rel_tol=0,
            abs_tol=1e-9,
        )
    ):
        raise VerificationError(
            f"{case.name}: expected resolved scale {case.expected_scale}, "
            f"received {actual_scale!r}."
        )

    prompt_used = response.get("prompt_used")
    if not isinstance(prompt_used, str) or not prompt_used.strip():
        raise VerificationError(f"{case.name}: response has no prompt_used.")
    if case.expected_trigger:
        if not contains_prompt_tag(prompt_used, case.expected_trigger):
            raise VerificationError(
                f"{case.name}: prompt_used is missing trigger "
                f"{case.expected_trigger!r}."
            )
        leaked = [
            trigger
            for trigger in KNOWN_TRIGGERS
            if trigger != case.expected_trigger
            and contains_prompt_tag(prompt_used, trigger)
        ]
        if leaked:
            raise VerificationError(
                f"{case.name}: prompt contains another adapter trigger: "
                f"{', '.join(leaked)}."
            )
    else:
        leaked = [
            trigger
            for trigger in KNOWN_TRIGGERS
            if contains_prompt_tag(prompt_used, trigger)
        ]
        if leaked:
            raise VerificationError(
                f"{case.name}: base prompt contains LoRA trigger(s): "
                f"{', '.join(leaked)}."
            )


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def prepare_output_dir(argument: Path | None) -> Path:
    if argument is None:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        output_dir = DEFAULT_OUTPUT_ROOT / timestamp
    else:
        output_dir = argument.expanduser()

    if output_dir.exists() and any(output_dir.iterdir()):
        raise VerificationError(
            f"Output directory is not empty: {output_dir}"
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def run_verification(args: argparse.Namespace) -> Path:
    api_url = normalize_api_url(args.api_url)
    if args.timeout <= 0:
        raise VerificationError("--timeout must be greater than zero.")
    env_file = args.env_file.expanduser()
    api_key = read_api_key(args.api_key, env_file)
    output_dir = prepare_output_dir(args.output_dir)
    args.resolved_output_dir = output_dir
    cases = build_cases(args.skip_adapter)
    case_results: list[dict[str, Any]] = []

    for index, case in enumerate(cases, start=1):
        payload = request_payload(case)
        started = time.perf_counter()
        status, response = post_json(
            f"{api_url}/v1/generate",
            payload,
            api_key,
            args.timeout,
        )
        elapsed_ms = round((time.perf_counter() - started) * 1000)

        stem = f"{index:02d}_{case.name}"
        metadata_path = output_dir / f"{stem}.json"
        try:
            image = decode_png(response)
        except VerificationError:
            atomic_write_json(
                metadata_path,
                response_without_image(response),
            )
            raise

        image_path = output_dir / f"{stem}.png"
        image_path.write_bytes(image)
        image_sha256 = sha256_bytes(image)
        sanitized = response_without_image(
            response,
            image_file=image_path.name,
            image_sha256=image_sha256,
        )
        sanitized["verification"] = {
            "case": case.name,
            "http_status": status,
            "elapsed_ms": elapsed_ms,
            "requested_adapter": case.adapter,
            "requested_scale": None,
            "expected_resolved_scale": case.expected_scale,
            "expected_trigger": case.expected_trigger,
        }
        atomic_write_json(metadata_path, sanitized)

        validate_case_response(case, response)
        case_results.append(
            {
                "case": case.name,
                "adapter": response.get("style_adapter"),
                "resolved_scale": response.get("style_adapter_scale"),
                "seed": response.get("seed"),
                "prompt_used": response.get("prompt_used"),
                "request_id": response.get("request_id"),
                "elapsed_ms": elapsed_ms,
                "image_file": image_path.name,
                "metadata_file": metadata_path.name,
                "image_sha256": image_sha256,
            }
        )
        print(
            f"PASS {case.name}: adapter={case.adapter or 'base'} "
            f"sha256={image_sha256}"
        )

    result_by_name = {item["case"]: item for item in case_results}
    before_hash = result_by_name["base_before"]["image_sha256"]
    after_hash = result_by_name["base_after"]["image_sha256"]
    base_images_identical = before_hash == after_hash
    unchanged_adapter_cases = [
        item["case"]
        for item in case_results
        if item["adapter"] is not None
        and item["image_sha256"] == before_hash
    ]
    manifest = {
        "status": (
            "passed"
            if base_images_identical and not unchanged_adapter_cases
            else "failed"
        ),
        "api_url": api_url,
        "fixed_seed": FIXED_SEED,
        "skipped_adapters": sorted(args.skip_adapter),
        "base_images_identical": base_images_identical,
        "unchanged_adapter_cases": unchanged_adapter_cases,
        "base_before_sha256": before_hash,
        "base_after_sha256": after_hash,
        "cases": case_results,
    }
    atomic_write_json(output_dir / "verification_summary.json", manifest)

    if not base_images_identical:
        raise VerificationError(
            "base_before and base_after PNG SHA-256 differ; "
            "the adapter may still be active."
        )
    if unchanged_adapter_cases:
        raise VerificationError(
            "LoRA output is byte-identical to the base image for: "
            f"{', '.join(unchanged_adapter_cases)}. The adapter may be "
            "ineffective or not actually enabled."
        )
    print(f"PASS base lifecycle: identical SHA-256 {before_hash}")
    return output_dir


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Generate a fixed-seed base/LoRA/base sequence against one "
            "MUSE inference API and reject adapter leakage."
        )
    )
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    parser.add_argument(
        "--env-file",
        type=Path,
        default=DEFAULT_ENV_FILE,
        help="Private dotenv file containing API_KEY.",
    )
    parser.add_argument(
        "--api-key",
        help=(
            "API key override. Prefer --env-file because command-line values "
            "may be visible to other local processes."
        ),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        help=(
            "Empty output directory. Defaults to a UTC timestamp below "
            f"{DEFAULT_OUTPUT_ROOT}."
        ),
    )
    parser.add_argument(
        "--skip-adapter",
        action="append",
        choices=tuple(ADAPTERS),
        default=[],
        help="Skip one unavailable adapter. Repeat to skip more than one.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=900,
        help="Per-generation HTTP timeout in seconds (default: 900).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    output_dir: Path | None = None
    try:
        output_dir = run_verification(args)
    except (OSError, VerificationError) as exc:
        if output_dir is None:
            candidate = getattr(args, "resolved_output_dir", None)
        else:
            candidate = output_dir
        if candidate is None and args.output_dir is not None:
            candidate = args.output_dir.expanduser()
        if candidate is not None:
            if candidate.is_dir():
                output_dir = candidate
        if output_dir is not None and output_dir.is_dir():
            try:
                atomic_write_json(
                    output_dir / "verification_failure.json",
                    {
                        "status": "failed",
                        "error": str(exc),
                        "fixed_seed": FIXED_SEED,
                    },
                )
            except OSError:
                pass
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1

    print(f"Artifacts: {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
