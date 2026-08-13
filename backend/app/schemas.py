from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


SamplerName = Literal[
    "dpmpp_2m_karras",
    "dpmpp_sde_karras",
    "euler_a",
    "euler",
]
BackgroundMode = Literal["none", "white"]
StyleAdapterName = Literal[
    "demonslayer",
    "naruto",
    "genshin",
    "onepiece",
    "luoxiaohei",
]
ExpectedSubject = Literal[
    "human",
    "female",
    "male",
    "female_pair",
    "male_pair",
    "mixed",
]
SubjectValidationMode = Literal["off", "strict"]


class PromptSegment(BaseModel):
    id: str = Field(min_length=1, max_length=160)
    label: str = Field(min_length=1, max_length=240)
    text: str = Field(min_length=1, max_length=2000)
    slot: str = Field(default="", max_length=40)
    priority: int = Field(default=2, ge=0, le=3)
    protected: bool = False


class PromptTokenUsage(BaseModel):
    tokenizer_1: int = Field(ge=0)
    tokenizer_2: int = Field(ge=0)
    limit: int = Field(ge=1)


class PromptDiagnostics(BaseModel):
    token_usage: PromptTokenUsage
    negative_token_usage: PromptTokenUsage
    omitted_segments: list[PromptSegment] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class PromptInspectionRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    negative_prompt: str = Field(default="", max_length=4000)
    expected_subject: ExpectedSubject | None = None
    prompt_segments: list[PromptSegment] = Field(
        default_factory=list,
        max_length=256,
    )


class PromptInspectionResponse(BaseModel):
    prompt: str
    negative_prompt: str
    diagnostics: PromptDiagnostics


class GenerationRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    negative_prompt: str = Field(default="", max_length=4000)
    expected_subject: ExpectedSubject | None = None
    subject_validation: SubjectValidationMode = "off"
    max_subject_attempts: int = Field(default=4, ge=1, le=8)
    prompt_segments: list[PromptSegment] = Field(
        default_factory=list,
        max_length=256,
    )
    width: int = Field(default=1024, ge=640, le=1536)
    height: int = Field(default=1024, ge=640, le=1536)
    steps: int = Field(default=28, ge=25, le=60)
    guidance_scale: float = Field(default=5.0, ge=1.0, le=15.0)
    seed: int = Field(default=-1, ge=-1, le=4_294_967_295)
    sampler: SamplerName = "euler_a"
    clip_skip: int = Field(default=2, ge=1, le=4)
    background_mode: BackgroundMode = "none"
    style_adapter: StyleAdapterName | None = None
    style_adapter_scale: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
    )

    @field_validator("width", "height")
    @classmethod
    def must_be_multiple_of_64(cls, value: int) -> int:
        if value % 64 != 0:
            raise ValueError("width and height must be multiples of 64")
        return value

    @model_validator(mode="after")
    def must_use_model_safe_pixel_budget(self):
        if self.width * self.height < 900_000:
            raise ValueError(
                "Animagine requests need at least 900000 pixels; "
                "use a recommended SDXL resolution such as 1024x1024."
            )
        return self


class SubjectValidationAttempt(BaseModel):
    seed: int
    passed: bool
    target_score: float = Field(ge=0, le=1)
    conflicting_score: float = Field(ge=0, le=1)
    count_score: float = Field(ge=0, le=1)
    integrity_conflict_score: float = Field(ge=0, le=1)
    integrity_conflicts: list[str] = Field(default_factory=list)
    scores: dict[str, float]
    reason: str


class SubjectValidationReport(BaseModel):
    status: Literal["passed", "skipped"]
    expected_subject: ExpectedSubject | None = None
    attempts: list[SubjectValidationAttempt] = Field(default_factory=list)


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
    prompt_used: str = ""
    prompt_diagnostics: PromptDiagnostics | None = None
    background_mode: BackgroundMode = "none"
    style_adapter: StyleAdapterName | None = None
    style_adapter_scale: float | None = None
    subject_validation: SubjectValidationReport | None = None


class HealthResponse(BaseModel):
    status: Literal["starting", "ready"]
    model: str
    model_loaded: bool
    device: str
    queue_busy: bool
