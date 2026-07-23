import os

os.environ["API_KEY"] = "test-secret"
os.environ["PRELOAD_MODEL"] = "false"
os.environ["CORS_ORIGINS"] = "http://localhost:3000"

from fastapi.testclient import TestClient

from app.main import app, engine
from app.schemas import GenerationResponse


client = TestClient(app)


def test_health_is_public_and_does_not_load_the_model():
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["model_loaded"] is False


def test_status_requires_api_key():
    response = client.get("/v1/status")
    assert response.status_code == 401

    response = client.get(
        "/v1/status",
        headers={"Authorization": "Bearer test-secret"},
    )
    assert response.status_code == 200


def test_generate_contract(monkeypatch):
    async def fake_generate(payload, request_id):
        return GenerationResponse(
            request_id=request_id,
            image_base64="aW1hZ2U=",
            seed=123,
            model="test/model",
            width=payload.width,
            height=payload.height,
            steps=payload.steps,
            guidance_scale=payload.guidance_scale,
            sampler=payload.sampler,
            duration_ms=50,
        )

    monkeypatch.setattr(engine, "generate", fake_generate)
    response = client.post(
        "/v1/generate",
        headers={"Authorization": "Bearer test-secret"},
        json={
            "prompt": "masterpiece, 1girl",
            "negative_prompt": "lowres",
            "width": 1024,
            "height": 1024,
            "steps": 28,
            "guidance_scale": 5,
            "seed": -1,
            "sampler": "dpmpp_2m_karras",
            "clip_skip": 2,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["seed"] == 123
    assert body["image_base64"] == "aW1hZ2U="
    assert response.headers["X-Request-ID"] == body["request_id"]


def test_dimensions_must_be_multiples_of_64():
    response = client.post(
        "/v1/generate",
        headers={"Authorization": "Bearer test-secret"},
        json={
            "prompt": "masterpiece, 1girl",
            "width": 1000,
            "height": 1024,
        },
    )
    assert response.status_code == 422
