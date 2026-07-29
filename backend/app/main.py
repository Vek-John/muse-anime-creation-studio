from __future__ import annotations

import asyncio
import logging
import secrets
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import Settings
from .engine import DiffusionEngine, PromptBudgetError
from .schemas import (
    GenerationRequest,
    GenerationResponse,
    HealthResponse,
    PromptInspectionRequest,
    PromptInspectionResponse,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("muse.diffusion")

settings = Settings.from_env()
settings.validate()
engine = DiffusionEngine(settings)


async def preload_model() -> None:
    try:
        await engine.load()
    except Exception:
        logger.exception("Model preload failed; the API remains available for retry.")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.preload_model:
        asyncio.create_task(preload_model())
    yield


app = FastAPI(
    title="MUSE Diffusion API",
    version="1.0.0",
    docs_url="/docs",
    redoc_url=None,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
)


def require_api_key(authorization: str | None = Header(default=None)) -> None:
    if settings.allow_insecure_no_auth and not settings.api_key:
        return

    expected = f"Bearer {settings.api_key}"
    if not authorization or not secrets.compare_digest(authorization, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key.",
        )


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or secrets.token_hex(12)
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.exception_handler(RuntimeError)
async def runtime_error_handler(request: Request, exc: RuntimeError):
    logger.exception("Generation runtime error", extra={"request_id": request.state.request_id})
    return JSONResponse(
        status_code=503,
        content={
            "detail": str(exc),
            "request_id": request.state.request_id,
        },
    )


@app.exception_handler(PromptBudgetError)
async def prompt_budget_error_handler(request: Request, exc: PromptBudgetError):
    return JSONResponse(
        status_code=422,
        content={
            "detail": str(exc),
            "request_id": request.state.request_id,
        },
    )


@app.get("/healthz", response_model=HealthResponse)
async def healthz() -> HealthResponse:
    return HealthResponse(
        status="ready" if engine.state.model_loaded else "starting",
        model=settings.model_id,
        model_loaded=engine.state.model_loaded,
        device=engine.state.device,
        queue_busy=engine.state.queue_busy,
    )


@app.get("/v1/status", response_model=HealthResponse)
async def authenticated_status(
    _: None = Depends(require_api_key),
) -> HealthResponse:
    return await healthz()


@app.post("/v1/generate", response_model=GenerationResponse)
async def generate(
    request: Request,
    payload: GenerationRequest,
    _: None = Depends(require_api_key),
) -> GenerationResponse:
    if len(payload.prompt) > settings.max_prompt_chars:
        raise HTTPException(status_code=422, detail="Prompt is too long.")

    logger.info(
        "Generation requested request_id=%s size=%sx%s steps=%s sampler=%s",
        request.state.request_id,
        payload.width,
        payload.height,
        payload.steps,
        payload.sampler,
    )
    return await engine.generate(payload, request.state.request_id)


@app.post("/v1/prompt/inspect", response_model=PromptInspectionResponse)
async def inspect_prompt(
    payload: PromptInspectionRequest,
    _: None = Depends(require_api_key),
) -> PromptInspectionResponse:
    if len(payload.prompt) > settings.max_prompt_chars:
        raise HTTPException(status_code=422, detail="Prompt is too long.")
    return await engine.inspect_prompt(payload)
