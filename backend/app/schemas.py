from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


SamplerName = Literal[
    "dpmpp_2m_karras",
    "dpmpp_sde_karras",
    "euler_a",
    "euler",
]


class GenerationRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    negative_prompt: str = Field(default="", max_length=4000)
    width: int = Field(default=1024, ge=512, le=1536)
    height: int = Field(default=1024, ge=512, le=1536)
    steps: int = Field(default=28, ge=10, le=60)
    guidance_scale: float = Field(default=5.0, ge=1.0, le=15.0)
    seed: int = Field(default=-1, ge=-1, le=4_294_967_295)
    sampler: SamplerName = "dpmpp_2m_karras"
    clip_skip: int = Field(default=2, ge=1, le=4)

    @field_validator("width", "height")
    @classmethod
    def must_be_multiple_of_64(cls, value: int) -> int:
        if value % 64 != 0:
            raise ValueError("width and height must be multiples of 64")
        return value


class GenerationResponse(BaseModel):
    request_id: str
    image_base64: str
    mime_type: str = "image/png"
    seed: int
    model: str
    width: int
    height: int
    steps: int
    guidance_scale: float
    sampler: SamplerName
    duration_ms: int


class HealthResponse(BaseModel):
    status: Literal["starting", "ready"]
    model: str
    model_loaded: bool
    device: str
    queue_busy: bool
