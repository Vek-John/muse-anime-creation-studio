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
        )

    def validate(self) -> None:
        if not self.api_key and not self.allow_insecure_no_auth:
            raise RuntimeError(
                "API_KEY is required. Set ALLOW_INSECURE_NO_AUTH=true only "
                "for an isolated development environment."
            )
        if self.torch_dtype not in {"float16", "bfloat16"}:
            raise RuntimeError("TORCH_DTYPE must be float16 or bfloat16.")
