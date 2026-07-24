from __future__ import annotations

import asyncio
from dataclasses import replace

from fastapi.testclient import TestClient

from gateway.config import GatewaySettings
from gateway.main import app, runtime
from gateway.runtime import RuntimeManager, parse_ssh_command
from gateway.schemas import RuntimeSnapshot


client = TestClient(app)


def test_gateway_health_and_unconfigured_status():
    health = client.get("/healthz")
    assert health.status_code == 200
    assert health.json()["service"] == "muse-local-gateway"

    status = client.get("/v1/status")
    assert status.status_code == 200
    assert status.json()["runtime"]["mode"] == "unconfigured"


def test_parse_autodl_style_ssh_command():
    host, port, username, identity = parse_ssh_command(
        "ssh -p 47740 root@region.example.com"
    )
    assert host == "region.example.com"
    assert port == 47740
    assert username == "root"
    assert identity is None


def test_directory_listing_and_model_validation(tmp_path):
    model_dir = tmp_path / "animagine"
    model_dir.mkdir()
    (model_dir / "model_index.json").write_text("{}", encoding="utf-8")
    checkpoint = tmp_path / "character.safetensors"
    checkpoint.write_bytes(b"test")
    (tmp_path / "ignore.txt").write_text("ignore", encoding="utf-8")

    settings = replace(
        GatewaySettings.from_env(),
        backend_dir=tmp_path,
        worker_log=tmp_path / "worker.log",
    )
    manager = RuntimeManager(settings)
    listing = manager.list_directory(str(tmp_path))

    assert [entry.name for entry in listing.entries] == [
        "animagine",
        "character.safetensors",
    ]
    assert manager.validate_model_path(str(model_dir)) == model_dir
    assert manager.validate_model_path(str(checkpoint)) == checkpoint


def test_configure_route_uses_discriminated_runtime(monkeypatch):
    async def fake_configure(_):
        return RuntimeSnapshot(
            mode="local",
            state="starting",
            label="test-model",
            detail="loading",
        )

    monkeypatch.setattr(runtime, "configure", fake_configure)
    response = client.post(
        "/v1/runtime/configure",
        json={
            "mode": "local",
            "model_path": "/models/test",
            "torch_dtype": "float16",
            "low_vram": False,
        },
    )

    assert response.status_code == 200
    assert response.json()["mode"] == "local"
    assert response.json()["state"] == "starting"


def test_cloud_password_is_required():
    response = client.post(
        "/v1/runtime/configure",
        json={
            "mode": "cloud",
            "ssh_command": "ssh root@gpu.example.com",
            "ssh_password": "",
        },
    )
    assert response.status_code == 422


class FakeSSHResult:
    def __init__(
        self,
        exit_status: int,
        *,
        stdout: str = "",
        stderr: str = "",
    ):
        self.exit_status = exit_status
        self.stdout = stdout
        self.stderr = stderr


class FakeSSHConnection:
    def __init__(self, results):
        self.results = iter(results)
        self.commands = []

    async def run(self, command, *, check):
        self.commands.append((command, check))
        return next(self.results)


def test_cloud_connection_starts_remote_worker_when_health_check_fails():
    settings = replace(
        GatewaySettings.from_env(),
        remote_start_command="start-muse-worker",
        remote_start_timeout_seconds=1,
    )
    manager = RuntimeManager(settings)
    connection = FakeSSHConnection(
        [
            FakeSSHResult(7),
            FakeSSHResult(0, stdout="started"),
            FakeSSHResult(0),
        ]
    )
    manager._ssh_connection = connection

    asyncio.run(manager._ensure_remote_worker())

    assert [command for command, _ in connection.commands] == [
        "curl -fsS --max-time 5 http://127.0.0.1:6006/healthz >/dev/null",
        "start-muse-worker",
        "curl -fsS --max-time 5 http://127.0.0.1:6006/healthz >/dev/null",
    ]


def test_cloud_connection_keeps_running_remote_worker():
    manager = RuntimeManager(GatewaySettings.from_env())
    connection = FakeSSHConnection([FakeSSHResult(0)])
    manager._ssh_connection = connection

    asyncio.run(manager._ensure_remote_worker())

    assert len(connection.commands) == 1
