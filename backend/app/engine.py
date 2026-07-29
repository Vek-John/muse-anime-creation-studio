from __future__ import annotations

import asyncio
import base64
import io
import secrets
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

from .config import Settings
from .schemas import (
    GenerationRequest,
    GenerationResponse,
    PromptDiagnostics,
    PromptInspectionRequest,
    PromptInspectionResponse,
    PromptSegment,
    PromptTokenUsage,
)


@dataclass
class EngineState:
    model_loaded: bool = False
    loading: bool = False
    queue_busy: bool = False
    device: str = "cuda"


class PromptBudgetError(Exception):
    """Raised when protected prompt content cannot fit the model context."""


class DiffusionEngine:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.state = EngineState()
        self._pipe = None
        self._load_lock = Lock()
        self._generation_lock = asyncio.Lock()

    def _load_sync(self) -> None:
        if self._pipe is not None:
            return

        with self._load_lock:
            if self._pipe is not None:
                return

            self.state.loading = True
            try:
                import torch
                from diffusers import StableDiffusionXLPipeline

                if not torch.cuda.is_available():
                    raise RuntimeError(
                        "CUDA GPU is unavailable. Install the NVIDIA driver and "
                        "Container Toolkit, then start the container with GPU access."
                    )

                dtype = (
                    torch.bfloat16
                    if self.settings.torch_dtype == "bfloat16"
                    else torch.float16
                )
                model_path = Path(self.settings.model_id).expanduser()
                if model_path.is_file():
                    pipe = StableDiffusionXLPipeline.from_single_file(
                        str(model_path),
                        torch_dtype=dtype,
                        use_safetensors=model_path.suffix.lower()
                        == ".safetensors",
                    )
                else:
                    pipe = StableDiffusionXLPipeline.from_pretrained(
                        self.settings.model_id,
                        torch_dtype=dtype,
                        use_safetensors=True,
                        token=self.settings.hf_token,
                    )

                pipe.enable_vae_slicing()
                pipe.vae.enable_tiling()

                if self.settings.low_vram:
                    pipe.enable_model_cpu_offload()
                    self.state.device = "cuda+cpu-offload"
                else:
                    pipe.to("cuda")
                    self.state.device = "cuda"

                self._pipe = pipe
                self.state.model_loaded = True
            finally:
                self.state.loading = False

    async def load(self) -> None:
        await asyncio.to_thread(self._load_sync)

    def _configure_scheduler(self, sampler: str) -> None:
        from diffusers import (
            DPMSolverMultistepScheduler,
            EulerAncestralDiscreteScheduler,
            EulerDiscreteScheduler,
        )

        config = self._pipe.scheduler.config
        if sampler == "euler_a":
            self._pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(config)
        elif sampler == "euler":
            self._pipe.scheduler = EulerDiscreteScheduler.from_config(config)
        elif sampler == "dpmpp_sde_karras":
            self._pipe.scheduler = DPMSolverMultistepScheduler.from_config(
                config,
                algorithm_type="sde-dpmsolver++",
                use_karras_sigmas=True,
            )
        else:
            self._pipe.scheduler = DPMSolverMultistepScheduler.from_config(
                config,
                algorithm_type="dpmsolver++",
                use_karras_sigmas=True,
            )

    @staticmethod
    def _special_token_count(tokenizer) -> int:
        counter = getattr(tokenizer, "num_special_tokens_to_add", None)
        if callable(counter):
            try:
                return int(counter(pair=False))
            except (TypeError, ValueError):
                pass
        return 2

    @classmethod
    def _token_count(cls, tokenizer, text: str) -> int:
        encoded = tokenizer(
            text,
            add_special_tokens=True,
            truncation=False,
        )
        input_ids = encoded["input_ids"]
        if input_ids and isinstance(input_ids[0], list):
            input_ids = input_ids[0]
        return max(0, len(input_ids) - cls._special_token_count(tokenizer))

    @classmethod
    def _token_limit(cls, tokenizer) -> int:
        model_max_length = getattr(tokenizer, "model_max_length", 77)
        try:
            total_limit = int(model_max_length)
        except (TypeError, ValueError, OverflowError):
            total_limit = 77
        if total_limit <= 0 or total_limit > 77:
            total_limit = 77
        return max(1, total_limit - cls._special_token_count(tokenizer))

    @staticmethod
    def _join_segments(segments: list[PromptSegment]) -> str:
        return ", ".join(
            segment.text.strip()
            for segment in segments
            if segment.text.strip()
        )

    @staticmethod
    def _whiten_edge_background(image):
        """Turn a mostly uniform edge-connected background white.

        Pure-white prompt tags often produce a pale tinted backdrop. This
        lightweight pass only flood-fills dominant colors sampled from the
        image border, so a centered character remains untouched.
        """
        from PIL import ImageDraw

        source = image.convert("RGB")
        result = source.copy()
        width, height = source.size
        step = max(8, min(width, height) // 32)
        inner_x = min(width - 1, max(0, width // 8))
        border_points = {
            *((x, 0) for x in range(0, width, step)),
            *((x, height - 1) for x in range(0, width, step)),
            *((0, y) for y in range(0, height, step)),
            *((width - 1, y) for y in range(0, height, step)),
            *((inner_x, y) for y in range(0, height, step)),
            *((width - 1 - inner_x, y) for y in range(0, height, step)),
            (width - 1, height - 1),
        }

        def bucket(pixel: tuple[int, int, int]) -> tuple[int, int, int]:
            return tuple(channel // 32 for channel in pixel)

        counts = Counter(bucket(source.getpixel(point)) for point in border_points)
        top_three_coverage = sum(
            count for _, count in counts.most_common(3)
        ) / len(border_points)
        if len(counts) > 10 or top_three_coverage < 0.8:
            return source

        dominant_buckets: set[tuple[int, int, int]] = set()
        covered = 0
        target = max(1, round(len(border_points) * 0.8))
        for color_bucket, count in counts.most_common(6):
            dominant_buckets.add(color_bucket)
            covered += count
            if covered >= target:
                break
        dominant_buckets.update(
            color_bucket
            for color_bucket in counts
            if min(color_bucket) >= 2
            and max(color_bucket) - min(color_bucket) <= 3
        )

        for point in border_points:
            if bucket(source.getpixel(point)) not in dominant_buckets:
                continue
            ImageDraw.floodfill(
                result,
                point,
                (255, 255, 255),
                thresh=48,
            )
        return result

    def _inspect_sync(
        self,
        request: PromptInspectionRequest,
    ) -> PromptInspectionResponse:
        self._load_sync()
        tokenizer_1 = self._pipe.tokenizer
        tokenizer_2 = getattr(self._pipe, "tokenizer_2", None) or tokenizer_1
        limit = min(
            self._token_limit(tokenizer_1),
            self._token_limit(tokenizer_2),
        )

        active_segments = list(request.prompt_segments)
        prompt = (
            self._join_segments(active_segments)
            if active_segments
            else request.prompt.strip()
        )
        omitted: list[PromptSegment] = []

        def usage(value: str) -> tuple[int, int]:
            return (
                self._token_count(tokenizer_1, value),
                self._token_count(tokenizer_2, value),
            )

        tokenizer_1_count, tokenizer_2_count = usage(prompt)
        while max(tokenizer_1_count, tokenizer_2_count) > limit:
            candidates = [
                (index, segment)
                for index, segment in enumerate(active_segments)
                if not segment.protected
            ]
            if not candidates:
                raise PromptBudgetError(
                    "核心主体、构图与动作超过模型的 "
                    f"{limit} token 上限，请精简自定义描述或减少核心标签。"
                )

            drop_index, dropped = max(
                candidates,
                key=lambda item: (item[1].priority, item[0]),
            )
            omitted.append(dropped)
            del active_segments[drop_index]
            prompt = self._join_segments(active_segments)
            tokenizer_1_count, tokenizer_2_count = usage(prompt)

        negative_1, negative_2 = usage(request.negative_prompt)
        if max(negative_1, negative_2) > limit:
            raise PromptBudgetError(
                "负面提示词超过模型的 "
                f"{limit} token 上限（当前 {max(negative_1, negative_2)}），"
                "请先精简负面提示词。"
            )

        warnings: list[str] = []
        if omitted:
            warnings.append(
                f"提示词超过 {limit} token，已按优先级省略 "
                f"{len(omitted)} 个低优先级片段；主体、构图和核心动作已保留。"
            )

        return PromptInspectionResponse(
            prompt=prompt,
            negative_prompt=request.negative_prompt,
            diagnostics=PromptDiagnostics(
                token_usage=PromptTokenUsage(
                    tokenizer_1=tokenizer_1_count,
                    tokenizer_2=tokenizer_2_count,
                    limit=limit,
                ),
                negative_token_usage=PromptTokenUsage(
                    tokenizer_1=negative_1,
                    tokenizer_2=negative_2,
                    limit=limit,
                ),
                omitted_segments=omitted,
                warnings=warnings,
            ),
        )

    async def inspect_prompt(
        self,
        request: PromptInspectionRequest,
    ) -> PromptInspectionResponse:
        return await asyncio.to_thread(self._inspect_sync, request)

    def _generate_sync(
        self, request: GenerationRequest, request_id: str
    ) -> GenerationResponse:
        import torch

        inspection = self._inspect_sync(
            PromptInspectionRequest(
                prompt=request.prompt,
                negative_prompt=request.negative_prompt,
                prompt_segments=request.prompt_segments,
            )
        )
        self._configure_scheduler(request.sampler)

        seed = request.seed if request.seed >= 0 else secrets.randbelow(2**32)
        generator = torch.Generator(device="cuda").manual_seed(seed)
        started = time.perf_counter()

        with torch.inference_mode():
            result = self._pipe(
                prompt=inspection.prompt,
                negative_prompt=inspection.negative_prompt or None,
                width=request.width,
                height=request.height,
                num_inference_steps=request.steps,
                guidance_scale=request.guidance_scale,
                generator=generator,
                clip_skip=request.clip_skip,
                num_images_per_prompt=1,
            )

        image = result.images[0]
        if request.background_mode == "white":
            image = self._whiten_edge_background(image)

        buffer = io.BytesIO()
        image.save(buffer, format="PNG", optimize=True)
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        duration_ms = round((time.perf_counter() - started) * 1000)

        return GenerationResponse(
            request_id=request_id,
            image_base64=encoded,
            seed=seed,
            model=self.settings.model_id,
            width=request.width,
            height=request.height,
            steps=request.steps,
            guidance_scale=request.guidance_scale,
            sampler=request.sampler,
            duration_ms=duration_ms,
            prompt_used=inspection.prompt,
            prompt_diagnostics=inspection.diagnostics,
            background_mode=request.background_mode,
        )

    async def generate(
        self, request: GenerationRequest, request_id: str
    ) -> GenerationResponse:
        async with self._generation_lock:
            self.state.queue_busy = True
            try:
                return await asyncio.to_thread(
                    self._generate_sync, request, request_id
                )
            finally:
                self.state.queue_busy = False
