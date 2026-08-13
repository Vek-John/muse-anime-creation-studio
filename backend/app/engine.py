from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import os
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
    SubjectValidationAttempt,
    SubjectValidationReport,
)
from .subject_verifier import AnimeSubjectVerifier
from .style_adapters import (
    style_adapter_path,
    style_adapter_scale,
    style_adapter_spec,
)

AUTOMATIC_PROMPT_SEGMENT_IDS = {
    "default-human",
    "rating",
    "quality-suffix",
}


@dataclass
class EngineState:
    model_loaded: bool = False
    loading: bool = False
    queue_busy: bool = False
    device: str = "cuda"


class PromptBudgetError(Exception):
    """Raised when protected prompt content cannot fit the model context."""


class SubjectValidationError(Exception):
    """Raised when every generated candidate violates the subject contract."""


class DiffusionEngine:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.state = EngineState()
        self._pipe = None
        self._load_lock = Lock()
        self._generation_lock = asyncio.Lock()
        self._loaded_style_adapters: set[str] = set()
        self._subject_verifier = AnimeSubjectVerifier(
            model_id=settings.subject_verifier_model,
            hf_token=settings.hf_token,
            threshold=settings.subject_validation_threshold,
            margin=settings.subject_validation_margin,
            count_threshold=settings.subject_validation_count_threshold,
            integrity_threshold=settings.human_integrity_threshold,
        )

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
    def _contains_prompt_tag(text: str, expected: str) -> bool:
        expected_tag = " ".join(expected.lower().split())
        return any(
            " ".join(item.lower().split()) == expected_tag
            for item in text.replace("，", ",").split(",")
        )

    def _generation_inspection_request(
        self,
        request: GenerationRequest,
    ) -> PromptInspectionRequest:
        prompt = request.prompt
        segments = list(request.prompt_segments)
        if request.style_adapter:
            trigger = style_adapter_spec(request.style_adapter).trigger
            if segments:
                trigger_found = False
                protected_segments: list[PromptSegment] = []
                for segment in segments:
                    if self._contains_prompt_tag(segment.text, trigger):
                        trigger_found = True
                        segment = segment.model_copy(
                            update={"priority": 0, "protected": True}
                        )
                    protected_segments.append(segment)
                if not trigger_found:
                    protected_segments.append(
                        PromptSegment(
                            id=f"style-adapter:{request.style_adapter}",
                            label=f"风格 LoRA · {request.style_adapter}",
                            text=trigger,
                            slot="style",
                            priority=0,
                            protected=True,
                        )
                    )
                segments = protected_segments
            elif not self._contains_prompt_tag(prompt, trigger):
                prompt = f"{prompt.rstrip(', ')}, {trigger}"

        return PromptInspectionRequest(
            prompt=prompt,
            negative_prompt=request.negative_prompt,
            expected_subject=request.expected_subject,
            prompt_segments=segments,
        )

    def _style_adapter_path(self, adapter_name: str) -> Path:
        return style_adapter_path(self.settings, adapter_name)

    @staticmethod
    def _file_sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def _ensure_style_adapter_file(self, adapter_name: str) -> Path:
        adapter_path = self._style_adapter_path(adapter_name)
        spec = style_adapter_spec(adapter_name)

        def is_valid() -> bool:
            if not adapter_path.is_file():
                return False
            if spec.size is not None and adapter_path.stat().st_size != spec.size:
                if spec.repo_id is None:
                    return True
                return False
            if spec.sha256 is not None and spec.repo_id is not None:
                return self._file_sha256(adapter_path) == spec.sha256
            return True

        if is_valid():
            return adapter_path
        if not all((spec.repo_id, spec.filename, spec.revision, spec.sha256, spec.size)):
            raise RuntimeError(
                f"风格 LoRA 尚未安装：{adapter_path}。"
                "该适配器没有公开的自动下载来源，请先配置对应 LoRA 路径。"
            )

        try:
            from huggingface_hub import hf_hub_download

            adapter_path.parent.mkdir(parents=True, exist_ok=True)
            downloaded_path = Path(
                hf_hub_download(
                    repo_id=spec.repo_id,
                    filename=spec.filename,
                    revision=spec.revision,
                    cache_dir=os.getenv("HF_HOME") or None,
                    token=self.settings.hf_token,
                )
            )
            temporary_path = adapter_path.with_suffix(
                adapter_path.suffix + ".download"
            )
            temporary_path.unlink(missing_ok=True)
            try:
                os.link(downloaded_path, temporary_path)
            except OSError:
                import shutil

                shutil.copyfile(downloaded_path, temporary_path)
            if (
                temporary_path.stat().st_size != spec.size
                or self._file_sha256(temporary_path) != spec.sha256
            ):
                raise RuntimeError(
                    f"下载的 {adapter_name} LoRA 未通过固定版本校验。"
                )
            temporary_path.replace(adapter_path)
        except Exception as exc:
            adapter_path.with_suffix(adapter_path.suffix + ".download").unlink(
                missing_ok=True
            )
            if isinstance(exc, RuntimeError):
                raise
            raise RuntimeError(
                f"风格 LoRA 自动下载失败：{adapter_name}。"
                "请检查网络/HF_ENDPOINT，或手动配置对应 LoRA 路径。"
            ) from exc

        return adapter_path

    def _activate_style_adapter(
        self,
        adapter_name: str | None,
        adapter_scale: float | None,
    ) -> float | None:
        if adapter_name is None:
            if self._loaded_style_adapters:
                self._pipe.disable_lora()
            return None

        resolved_scale = style_adapter_scale(adapter_name, adapter_scale)

        if adapter_name not in self._loaded_style_adapters:
            adapter_path = self._ensure_style_adapter_file(adapter_name)
            self._pipe.load_lora_weights(
                str(adapter_path.parent),
                weight_name=adapter_path.name,
                adapter_name=adapter_name,
            )
            self._loaded_style_adapters.add(adapter_name)

        try:
            self._pipe.set_adapters(
                adapter_name,
                adapter_weights=resolved_scale,
            )
            self._pipe.enable_lora()
        except Exception:
            # A failed adapter switch must never leak a partially enabled
            # LoRA into the next request. Loaded weights remain cached and can
            # be retried after the transient failure is resolved.
            self._pipe.disable_lora()
            raise
        return resolved_scale

    @staticmethod
    def _validate_expected_subject(
        prompt: str,
        expected_subject: str | None,
    ) -> None:
        if expected_subject is None:
            return
        if expected_subject == "human":
            return

        tags = [
            item.strip().lower()
            for item in prompt.replace("，", ",").split(",")
            if item.strip()
        ]
        prefixes = {
            "male": ["1boy"],
            "female": ["1girl"],
            "male_pair": ["2boys"],
            "female_pair": ["2girls"],
            "mixed": ["1boy", "1girl"],
        }
        expected_prefix = prefixes[expected_subject]
        if tags[: len(expected_prefix)] != expected_prefix:
            rendered = ", ".join(expected_prefix)
            actual = ", ".join(tags[: len(expected_prefix)]) or "空"
            raise PromptBudgetError(
                "主体约束检查失败：期望提示词以 "
                f"“{rendered}”开头，实际为“{actual}”。"
            )

        forbidden = {
            "male": {"1girl", "2girls"},
            "female": {"1boy", "2boys"},
            "male_pair": {"1girl", "2girls", "1boy"},
            "female_pair": {"1boy", "2boys", "1girl"},
            "mixed": {"2boys", "2girls"},
        }[expected_subject]
        conflicts = sorted(forbidden.intersection(tags))
        if conflicts:
            raise PromptBudgetError(
                "主体约束检查失败：提示词仍包含冲突主体 "
                f"“{', '.join(conflicts)}”。"
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
                    "输入框与核心主体、构图或动作超过模型的 "
                    f"{limit} token 上限，请精简自定义描述或减少核心标签。"
                )

            drop_index, dropped = max(
                candidates,
                key=lambda item: (
                    item[1].id in AUTOMATIC_PROMPT_SEGMENT_IDS,
                    item[1].priority,
                    item[0],
                ),
            )
            omitted.append(dropped)
            del active_segments[drop_index]
            prompt = self._join_segments(active_segments)
            tokenizer_1_count, tokenizer_2_count = usage(prompt)

        self._validate_expected_subject(prompt, request.expected_subject)

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
        strict_subject = request.subject_validation == "strict"
        if strict_subject and request.expected_subject is None:
            raise PromptBudgetError(
                "严格主体校验需要 expected_subject。"
            )

        import torch

        active_style_adapter_scale = None
        try:
            inspection = self._inspect_sync(
                self._generation_inspection_request(request)
            )
            self._configure_scheduler(request.sampler)
            active_style_adapter_scale = self._activate_style_adapter(
                request.style_adapter,
                request.style_adapter_scale,
            )

            base_seed = (
                request.seed
                if request.seed >= 0
                else secrets.randbelow(2**32)
            )
            attempt_limit = (
                request.max_subject_attempts if strict_subject else 1
            )
            validation_attempts: list[SubjectValidationAttempt] = []
            accepted_image = None
            accepted_seed = base_seed
            started = time.perf_counter()

            for attempt_index in range(attempt_limit):
                candidate_seed = (base_seed + attempt_index) % (2**32)
                generator = torch.Generator(device="cuda").manual_seed(
                    candidate_seed
                )
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

                candidate_image = result.images[0]
                if strict_subject:
                    verdict = self._subject_verifier.verify(
                        candidate_image,
                        request.expected_subject,
                    )
                    validation_attempts.append(
                        SubjectValidationAttempt(
                            seed=candidate_seed,
                            passed=verdict.passed,
                            target_score=verdict.target_score,
                            conflicting_score=verdict.conflicting_score,
                            count_score=verdict.count_score,
                            integrity_conflict_score=(
                                verdict.integrity_conflict_score
                            ),
                            integrity_conflicts=verdict.integrity_conflicts,
                            scores=verdict.scores,
                            reason=verdict.reason,
                        )
                    )
                    if not verdict.passed:
                        continue

                accepted_image = candidate_image
                accepted_seed = candidate_seed
                break
        finally:
            if request.style_adapter:
                self._pipe.disable_lora()

        if accepted_image is None:
            summary = "；".join(
                f"seed {attempt.seed}: {attempt.reason}"
                for attempt in validation_attempts
            )
            raise SubjectValidationError(
                "严格主体校验未通过，已拒绝返回可能错误的图片。"
                f"共尝试 {attempt_limit} 次。{summary}"
            )

        image = accepted_image
        if request.background_mode == "white":
            image = self._whiten_edge_background(image)

        buffer = io.BytesIO()
        image.save(buffer, format="PNG", optimize=True)
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        duration_ms = round((time.perf_counter() - started) * 1000)

        return GenerationResponse(
            request_id=request_id,
            image_base64=encoded,
            seed=accepted_seed,
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
            style_adapter=request.style_adapter,
            style_adapter_scale=active_style_adapter_scale,
            subject_validation=SubjectValidationReport(
                status="passed" if strict_subject else "skipped",
                expected_subject=request.expected_subject,
                attempts=validation_attempts,
            ),
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
