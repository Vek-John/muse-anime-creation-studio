import os

os.environ["API_KEY"] = "test-secret"
os.environ["PRELOAD_MODEL"] = "false"
os.environ["CORS_ORIGINS"] = "http://localhost:3000"

from fastapi.testclient import TestClient

from app.engine import PromptBudgetError
from app.main import app, engine
from app.schemas import (
    GenerationResponse,
    PromptDiagnostics,
    PromptInspectionResponse,
    PromptTokenUsage,
)


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


def test_strict_subject_validation_request_contract(monkeypatch):
    captured = {}

    async def fake_generate(payload, request_id):
        captured["payload"] = payload
        return GenerationResponse(
            request_id=request_id,
            image_base64="aW1hZ2U=",
            seed=124,
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
            "prompt": "1boy, solo, male focus",
            "expected_subject": "male",
            "subject_validation": "strict",
            "max_subject_attempts": 5,
        },
    )

    assert response.status_code == 200
    assert captured["payload"].expected_subject == "male"
    assert captured["payload"].subject_validation == "strict"
    assert captured["payload"].max_subject_attempts == 5


def test_generic_human_validation_request_contract(monkeypatch):
    captured = {}

    async def fake_generate(payload, request_id):
        captured["payload"] = payload
        return GenerationResponse(
            request_id=request_id,
            image_base64="aW1hZ2U=",
            seed=125,
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
            "prompt": "solo, safe, masterpiece",
            "expected_subject": "human",
            "subject_validation": "strict",
        },
    )

    assert response.status_code == 200
    assert captured["payload"].expected_subject == "human"
    assert captured["payload"].subject_validation == "strict"


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


def test_low_pixel_budget_and_low_step_requests_are_rejected():
    low_pixels = client.post(
        "/v1/generate",
        headers={"Authorization": "Bearer test-secret"},
        json={
            "prompt": "1boy, solo",
            "width": 640,
            "height": 640,
            "steps": 28,
        },
    )
    assert low_pixels.status_code == 422

    low_steps = client.post(
        "/v1/generate",
        headers={"Authorization": "Bearer test-secret"},
        json={
            "prompt": "1boy, solo",
            "width": 1024,
            "height": 1024,
            "steps": 24,
        },
    )
    assert low_steps.status_code == 422


def test_prompt_inspection_contract(monkeypatch):
    async def fake_inspect(payload):
        return PromptInspectionResponse(
            prompt=payload.prompt,
            negative_prompt=payload.negative_prompt,
            diagnostics=PromptDiagnostics(
                token_usage=PromptTokenUsage(
                    tokenizer_1=12,
                    tokenizer_2=13,
                    limit=75,
                ),
                negative_token_usage=PromptTokenUsage(
                    tokenizer_1=2,
                    tokenizer_2=2,
                    limit=75,
                ),
            ),
        )

    monkeypatch.setattr(engine, "inspect_prompt", fake_inspect)
    response = client.post(
        "/v1/prompt/inspect",
        headers={"Authorization": "Bearer test-secret"},
        json={
            "prompt": "1girl, full body",
            "negative_prompt": "lowres",
            "prompt_segments": [
                {
                    "id": "subject",
                    "label": "主体",
                    "text": "1girl",
                    "slot": "subject",
                    "priority": 0,
                    "protected": True,
                }
            ],
        },
    )

    assert response.status_code == 200
    assert response.json()["diagnostics"]["token_usage"] == {
        "tokenizer_1": 12,
        "tokenizer_2": 13,
        "limit": 75,
    }
    assert response.json()["diagnostics"]["negative_token_usage"] == {
        "tokenizer_1": 2,
        "tokenizer_2": 2,
        "limit": 75,
    }


def test_prompt_budget_errors_are_returned_as_422(monkeypatch):
    async def reject_prompt(_):
        raise PromptBudgetError("protected prompt is too long")

    monkeypatch.setattr(engine, "inspect_prompt", reject_prompt)
    response = client.post(
        "/v1/prompt/inspect",
        headers={"Authorization": "Bearer test-secret"},
        json={"prompt": "too long"},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "protected prompt is too long"
