from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path


def _as_list(value: str | None, default: str) -> list[str]:
    raw = value if value is not None else default
    return [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class GatewaySettings:
    cors_origins: list[str]
    backend_dir: Path
    worker_python: str
    worker_log: Path
    worker_start_timeout_seconds: float
    remote_env_file: str
    remote_port: int

    @classmethod
    def from_env(cls) -> "GatewaySettings":
        backend_dir = Path(__file__).resolve().parents[1]
        default_log = Path.home() / ".cache" / "muse" / "local-worker.log"
        return cls(
            cors_origins=_as_list(
                os.getenv("GATEWAY_CORS_ORIGINS"),
                "http://localhost:3000,http://127.0.0.1:3000",
            ),
            backend_dir=backend_dir,
            worker_python=os.getenv("GATEWAY_WORKER_PYTHON", sys.executable),
            worker_log=Path(
                os.getenv("GATEWAY_WORKER_LOG", str(default_log))
            ).expanduser(),
            worker_start_timeout_seconds=float(
                os.getenv("GATEWAY_WORKER_START_TIMEOUT", "30")
            ),
            remote_env_file=os.getenv(
                "GATEWAY_REMOTE_ENV_FILE",
                "/root/muse-diffusion/.env",
            ),
            remote_port=int(os.getenv("GATEWAY_REMOTE_PORT", "6006")),
        )
