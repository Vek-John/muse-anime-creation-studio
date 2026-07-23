from __future__ import annotations

import asyncio
import os
import secrets
import shlex
import socket
from pathlib import Path
from typing import Any

import asyncssh
import httpx

from .config import GatewaySettings
from .schemas import (
    CloudRuntimeConfig,
    DirectoryEntry,
    DirectoryListing,
    LocalRuntimeConfig,
    RuntimeConfig,
    RuntimeSnapshot,
)

MODEL_FILE_SUFFIXES = {".safetensors", ".ckpt"}


def parse_ssh_command(command: str) -> tuple[str, int, str, str | None]:
    """Parse a small, non-shell SSH command subset used by the demo UI."""
    tokens = shlex.split(command)
    if tokens and tokens[0] == "ssh":
        tokens = tokens[1:]

    port = 22
    identity_file: str | None = None
    target: str | None = None
    index = 0

    while index < len(tokens):
        token = tokens[index]
        if token in {"-p", "-i"}:
            if index + 1 >= len(tokens):
                raise ValueError(f"{token} requires a value")
            value = tokens[index + 1]
            if token == "-p":
                port = int(value)
            else:
                identity_file = value
            index += 2
            continue
        if token.startswith("-"):
            raise ValueError(f"Unsupported SSH option: {token}")
        if target is not None:
            raise ValueError("Only one SSH target is supported.")
        target = token
        index += 1

    if not target or "@" not in target:
        raise ValueError("Use an SSH target such as root@gpu.example.com.")

    username, host = target.rsplit("@", 1)
    if not username or not host:
        raise ValueError("SSH username and host are required.")
    if not 1 <= port <= 65535:
        raise ValueError("SSH port is invalid.")
    return host, port, username, identity_file


def _reserve_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class RuntimeManager:
    def __init__(self, settings: GatewaySettings) -> None:
        self.settings = settings
        self._lock = asyncio.Lock()
        self._mode = "unconfigured"
        self._state = "idle"
        self._label = "尚未选择运行方式"
        self._detail = ""
        self._base_url: str | None = None
        self._worker_api_key = ""
        self._local_process: asyncio.subprocess.Process | None = None
        self._local_log_handle: Any = None
        self._ssh_connection: asyncssh.SSHClientConnection | None = None
        self._ssh_listener: asyncssh.SSHListener | None = None

    def snapshot(self) -> RuntimeSnapshot:
        return RuntimeSnapshot(
            mode=self._mode,
            state=self._state,
            label=self._label,
            detail=self._detail,
        )

    def list_directory(self, requested_path: str | None) -> DirectoryListing:
        candidate = Path(requested_path or str(Path.home())).expanduser()
        try:
            current = candidate.resolve(strict=True)
        except OSError as exc:
            raise RuntimeError(f"目录不存在或无法访问：{candidate}") from exc

        if not current.is_dir():
            raise RuntimeError("请选择一个目录。")

        entries: list[DirectoryEntry] = []
        try:
            children = sorted(
                current.iterdir(),
                key=lambda item: (not item.is_dir(), item.name.lower()),
            )
        except OSError as exc:
            raise RuntimeError(f"无法读取目录：{current}") from exc

        for item in children:
            try:
                if item.is_dir():
                    kind = "directory"
                elif item.is_file() and item.suffix.lower() in MODEL_FILE_SUFFIXES:
                    kind = "model_file"
                else:
                    continue
            except OSError:
                continue
            entries.append(
                DirectoryEntry(name=item.name, path=str(item), kind=kind)
            )

        parent = None if current.parent == current else str(current.parent)
        return DirectoryListing(
            current=str(current),
            parent=parent,
            entries=entries,
        )

    def validate_model_path(self, raw_path: str) -> Path:
        try:
            path = Path(raw_path).expanduser().resolve(strict=True)
        except OSError as exc:
            raise RuntimeError(f"模型路径不存在：{raw_path}") from exc
        if path.is_file() and path.suffix.lower() in MODEL_FILE_SUFFIXES:
            return path
        if path.is_dir() and (path / "model_index.json").is_file():
            return path
        raise RuntimeError(
            "模型路径需要是 Diffusers 目录（包含 model_index.json），"
            "或 .safetensors/.ckpt 文件。"
        )

    async def configure(self, config: RuntimeConfig) -> RuntimeSnapshot:
        async with self._lock:
            await self._stop_unlocked()
            self._state = "starting"
            self._detail = ""
            try:
                if isinstance(config, LocalRuntimeConfig):
                    await self._configure_local(config)
                else:
                    await self._configure_cloud(config)
            except Exception as exc:
                await self._stop_unlocked(reset_state=False)
                self._state = "error"
                self._detail = str(exc)
                if isinstance(exc, RuntimeError):
                    raise
                raise RuntimeError(str(exc)) from exc
            return self.snapshot()

    async def _configure_local(self, config: LocalRuntimeConfig) -> None:
        model_path = self.validate_model_path(config.model_path)
        port = _reserve_port()
        worker_api_key = secrets.token_hex(32)
        self.settings.worker_log.parent.mkdir(parents=True, exist_ok=True)
        self._local_log_handle = self.settings.worker_log.open("ab", buffering=0)

        env = os.environ.copy()
        env.update(
            {
                "API_KEY": worker_api_key,
                "ALLOW_INSECURE_NO_AUTH": "false",
                "CORS_ORIGINS": "http://127.0.0.1",
                "MODEL_ID": str(model_path),
                "PRELOAD_MODEL": "true",
                "LOW_VRAM": str(config.low_vram).lower(),
                "TORCH_DTYPE": config.torch_dtype,
            }
        )
        self._local_process = await asyncio.create_subprocess_exec(
            self.settings.worker_python,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--workers",
            "1",
            cwd=self.settings.backend_dir,
            env=env,
            stdout=self._local_log_handle,
            stderr=self._local_log_handle,
        )

        self._mode = "local"
        self._label = model_path.name
        self._base_url = f"http://127.0.0.1:{port}"
        self._worker_api_key = worker_api_key
        await self._wait_for_worker_health()

    async def _configure_cloud(self, config: CloudRuntimeConfig) -> None:
        host, port, username, command_identity = parse_ssh_command(
            config.ssh_command
        )
        connect_args: dict[str, Any] = {
            "host": host,
            "port": port,
            "username": username,
        }
        if config.auth_method == "password":
            connect_args["password"] = config.ssh_password
            connect_args["client_keys"] = []
            connect_args["preferred_auth"] = [
                "password",
                "keyboard-interactive",
            ]
        else:
            key_path = (
                config.ssh_private_key_path or command_identity or ""
            ).strip()
            connect_args["client_keys"] = [str(Path(key_path).expanduser())]
            if config.ssh_private_key_passphrase:
                connect_args["passphrase"] = config.ssh_private_key_passphrase

        self._ssh_connection = await asyncssh.connect(**connect_args)
        self._ssh_listener = await self._ssh_connection.forward_local_port(
            "127.0.0.1",
            0,
            "127.0.0.1",
            config.remote_port,
        )
        local_port = self._ssh_listener.get_port()
        self._mode = "cloud"
        self._label = f"{username}@{host}"
        self._base_url = f"http://127.0.0.1:{local_port}"
        self._worker_api_key = config.remote_api_key

        response = await self._request("GET", "/v1/status", timeout=30)
        if response.status_code >= 400:
            raise RuntimeError(
                f"远端模型服务返回 {response.status_code}，请检查 API 密钥和端口。"
            )
        body = response.json()
        self._state = "ready" if body.get("model_loaded") else "starting"
        self._detail = f"{body.get('model', '远端模型')} · {body.get('device', 'GPU')}"

    async def _wait_for_worker_health(self) -> None:
        assert self._base_url is not None
        deadline = asyncio.get_running_loop().time() + (
            self.settings.worker_start_timeout_seconds
        )
        async with httpx.AsyncClient(trust_env=False) as client:
            while asyncio.get_running_loop().time() < deadline:
                if self._local_process and self._local_process.returncode is not None:
                    raise RuntimeError(
                        f"本地模型进程启动失败，请查看日志：{self.settings.worker_log}"
                    )
                try:
                    response = await client.get(
                        f"{self._base_url}/healthz",
                        timeout=2,
                    )
                    if response.status_code == 200:
                        body = response.json()
                        self._state = (
                            "ready" if body.get("model_loaded") else "starting"
                        )
                        self._detail = (
                            f"{body.get('model', self._label)} · "
                            f"{body.get('device', 'CUDA')}"
                        )
                        return
                except httpx.HTTPError:
                    pass
                await asyncio.sleep(0.4)
        raise RuntimeError(
            f"本地模型服务启动超时，请查看日志：{self.settings.worker_log}"
        )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        timeout: float = 600,
    ) -> httpx.Response:
        if not self._base_url:
            raise RuntimeError("请先选择本地模型或连接云端服务器。")
        headers = {"Authorization": f"Bearer {self._worker_api_key}"}
        try:
            async with httpx.AsyncClient(trust_env=False) as client:
                return await client.request(
                    method,
                    f"{self._base_url}{path}",
                    headers=headers,
                    json=json,
                    timeout=timeout,
                )
        except httpx.HTTPError as exc:
            raise RuntimeError("无法连接当前模型服务。") from exc

    async def status(self) -> dict[str, Any]:
        if not self._base_url:
            return {
                "status": "starting",
                "model": "未配置运行环境",
                "model_loaded": False,
                "device": "未连接",
                "queue_busy": False,
                "runtime": self.snapshot().model_dump(),
            }

        response = await self._request("GET", "/v1/status", timeout=30)
        if response.status_code >= 400:
            raise RuntimeError(f"模型服务返回 {response.status_code}。")
        body = response.json()
        self._state = "ready" if body.get("model_loaded") else "starting"
        self._detail = f"{body.get('model', self._label)} · {body.get('device', 'GPU')}"
        body["runtime"] = self.snapshot().model_dump()
        return body

    async def generate(self, payload: dict[str, Any]) -> httpx.Response:
        return await self._request(
            "POST",
            "/v1/generate",
            json=payload,
            timeout=600,
        )

    async def stop(self) -> None:
        async with self._lock:
            await self._stop_unlocked()

    async def _stop_unlocked(self, *, reset_state: bool = True) -> None:
        if self._ssh_listener is not None:
            self._ssh_listener.close()
            await self._ssh_listener.wait_closed()
            self._ssh_listener = None
        if self._ssh_connection is not None:
            self._ssh_connection.close()
            await self._ssh_connection.wait_closed()
            self._ssh_connection = None
        if self._local_process is not None:
            if self._local_process.returncode is None:
                self._local_process.terminate()
                try:
                    await asyncio.wait_for(self._local_process.wait(), timeout=8)
                except TimeoutError:
                    self._local_process.kill()
                    await self._local_process.wait()
            self._local_process = None
        if self._local_log_handle is not None:
            self._local_log_handle.close()
            self._local_log_handle = None

        self._base_url = None
        self._worker_api_key = ""
        if reset_state:
            self._mode = "unconfigured"
            self._state = "idle"
            self._label = "尚未选择运行方式"
            self._detail = ""
