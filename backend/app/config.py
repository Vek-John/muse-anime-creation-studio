from __future__ import annotations

import os
from dataclasses import dataclass


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _as_list(value: str | None, default: str) -> list[str]:
    raw = value if value is not None else default
    return [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    api_key: str
    allow_insecure_no_auth: bool
    cors_origins: list[str]
    model_id: str
    hf_token: str | None
    torch_dtype: str
    low_vram: bool
    preload_model: bool
    output_dir: str
    max_prompt_chars: int
    subject_verifier_model: str
    subject_validation_threshold: float
    subject_validation_margin: float
    subject_validation_count_threshold: float
    human_integrity_threshold: float
    demonslayer_lora_path: str

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            api_key=os.getenv("API_KEY", "").strip(),
            allow_insecure_no_auth=_as_bool(
                os.getenv("ALLOW_INSECURE_NO_AUTH"), default=False
            ),
            cors_origins=_as_list(
                os.getenv("CORS_ORIGINS"),
                "http://localhost:3000,http://127.0.0.1:3000",
            ),
            model_id=os.getenv(
                "MODEL_ID", "cagliostrolab/animagine-xl-4.0"
            ).strip(),
            hf_token=os.getenv("HF_TOKEN") or None,
            torch_dtype=os.getenv("TORCH_DTYPE", "float16").strip(),
            low_vram=_as_bool(os.getenv("LOW_VRAM"), default=False),
            preload_model=_as_bool(os.getenv("PRELOAD_MODEL"), default=True),
            output_dir=os.getenv("OUTPUT_DIR", "/app/outputs").strip(),
            max_prompt_chars=int(os.getenv("MAX_PROMPT_CHARS", "4000")),
            subject_verifier_model=os.getenv(
                "SUBJECT_VERIFIER_MODEL",
                "SmilingWolf/wd-swinv2-tagger-v3",
            ).strip(),
            subject_validation_threshold=float(
                os.getenv("SUBJECT_VALIDATION_THRESHOLD", "0.28")
            ),
            subject_validation_margin=float(
                os.getenv("SUBJECT_VALIDATION_MARGIN", "0.08")
            ),
            subject_validation_count_threshold=float(
                os.getenv("SUBJECT_VALIDATION_COUNT_THRESHOLD", "0.28")
            ),
            human_integrity_threshold=float(
                os.getenv("HUMAN_INTEGRITY_THRESHOLD", "0.28")
            ),
            demonslayer_lora_path=os.getenv(
                "DEMONSLAYER_LORA_PATH",
                (
                    "/root/autodl-tmp/muse-models/loras/demonslayer/"
                    "Demonslayer_style_lora-.safetensors"
                ),
            ).strip(),
        )

    def validate(self) -> None:
        if not self.api_key and not self.allow_insecure_no_auth:
            raise RuntimeError(
                "API_KEY is required. Set ALLOW_INSECURE_NO_AUTH=true only "
                "for an isolated development environment."
            )
        if self.torch_dtype not in {"float16", "bfloat16"}:
            raise RuntimeError("TORCH_DTYPE must be float16 or bfloat16.")
        for name, value in (
            ("SUBJECT_VALIDATION_THRESHOLD", self.subject_validation_threshold),
            ("SUBJECT_VALIDATION_MARGIN", self.subject_validation_margin),
            (
                "SUBJECT_VALIDATION_COUNT_THRESHOLD",
                self.subject_validation_count_threshold,
            ),
            ("HUMAN_INTEGRITY_THRESHOLD", self.human_integrity_threshold),
        ):
            if not 0 <= value <= 1:
                raise RuntimeError(f"{name} must be between 0 and 1.")
