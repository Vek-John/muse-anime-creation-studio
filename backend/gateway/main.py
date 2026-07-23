from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from .config import GatewaySettings
from .runtime import RuntimeManager
from .schemas import DirectoryListing, RuntimeConfig, RuntimeSnapshot

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("muse.gateway")

settings = GatewaySettings.from_env()
runtime = RuntimeManager(settings)


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await runtime.stop()


app = FastAPI(
    title="MUSE Local Runtime Gateway",
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
    allow_headers=["Content-Type"],
)


@app.exception_handler(RuntimeError)
async def runtime_error_handler(_: Request, exc: RuntimeError):
    logger.warning("Runtime gateway error: %s", exc)
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.get("/healthz")
async def healthz() -> dict:
    return {
        "status": "ready",
        "service": "muse-local-gateway",
        "runtime": runtime.snapshot().model_dump(),
    }


@app.get("/v1/runtime", response_model=RuntimeSnapshot)
async def runtime_status() -> RuntimeSnapshot:
    return runtime.snapshot()


@app.get("/v1/runtime/directories", response_model=DirectoryListing)
async def list_directories(
    path: str | None = Query(default=None, max_length=4096),
) -> DirectoryListing:
    return runtime.list_directory(path)


@app.post("/v1/runtime/configure", response_model=RuntimeSnapshot)
async def configure_runtime(payload: RuntimeConfig) -> RuntimeSnapshot:
    return await runtime.configure(payload)


@app.post("/v1/runtime/disconnect", response_model=RuntimeSnapshot)
async def disconnect_runtime() -> RuntimeSnapshot:
    await runtime.stop()
    return runtime.snapshot()


@app.get("/v1/status")
async def status() -> dict:
    return await runtime.status()


@app.post("/v1/generate")
async def generate(request: Request) -> Response:
    try:
        payload = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON body.") from exc

    response = await runtime.generate(payload)
    headers = {}
    if request_id := response.headers.get("X-Request-ID"):
        headers["X-Request-ID"] = request_id
    return Response(
        content=response.content,
        status_code=response.status_code,
        media_type=response.headers.get("content-type", "application/json"),
        headers=headers,
    )
