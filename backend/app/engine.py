from __future__ import annotations

import asyncio
import base64
import io
import secrets
import time
from dataclasses import dataclass
from threading import Lock

from .config import Settings
from .schemas import GenerationRequest, GenerationResponse


@dataclass
class EngineState:
    model_loaded: bool = False
    loading: bool = False
    queue_busy: bool = False
    device: str = "cuda"


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

    def _generate_sync(
        self, request: GenerationRequest, request_id: str
    ) -> GenerationResponse:
        import torch

        self._load_sync()
        self._configure_scheduler(request.sampler)

        seed = request.seed if request.seed >= 0 else secrets.randbelow(2**32)
        generator = torch.Generator(device="cuda").manual_seed(seed)
        started = time.perf_counter()

        with torch.inference_mode():
            result = self._pipe(
                prompt=request.prompt,
                negative_prompt=request.negative_prompt or None,
                width=request.width,
                height=request.height,
                num_inference_steps=request.steps,
                guidance_scale=request.guidance_scale,
                generator=generator,
                clip_skip=request.clip_skip,
                num_images_per_prompt=1,
            )

        buffer = io.BytesIO()
        result.images[0].save(buffer, format="PNG", optimize=True)
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
