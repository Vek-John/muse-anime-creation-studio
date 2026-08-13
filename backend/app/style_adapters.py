from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class StyleAdapterSpec:
    trigger: str
    settings_attr: str
    default_scale: float
    repo_id: str | None = None
    filename: str | None = None
    revision: str | None = None
    sha256: str | None = None
    size: int | None = None


STYLE_ADAPTER_REGISTRY: dict[str, StyleAdapterSpec] = {
    "demonslayer": StyleAdapterSpec(
        trigger="demonslayer style",
        settings_attr="demonslayer_lora_path",
        default_scale=0.65,
        repo_id="Rudra973592/Demonslayer_style_lora",
        filename="Demonslayer_style_lora-.safetensors",
        revision="96f2249b16f4d152c22908e585f5616c4bd9a955",
        sha256=(
            "0f85a1efc816cc46913cfe5e4993261c5874f680a7113d1a3d802a11282efed3"
        ),
        size=405_057_460,
    ),
    "naruto": StyleAdapterSpec(
        trigger="in naruto-style",
        settings_attr="naruto_lora_path",
        default_scale=0.65,
        repo_id="shawn323/sd-xl-lora-naruto",
        filename="pytorch_lora_weights.safetensors",
        revision="0ce4679e020c721adada507ee26970ccdea105fe",
        sha256=(
            "d4b2a59f69bc4a4db2b4a02ce78a79daffbfbc69078574842a522194a40396ea"
        ),
        size=185_963_768,
    ),
    "genshin": StyleAdapterSpec(
        trigger="genshin-style character",
        settings_attr="genshin_lora_path",
        default_scale=0.6,
        repo_id="mary-ruiliii/genshin-style_character_generator",
        filename="pytorch_lora_weights.safetensors",
        revision="294b0f1bacccc72ba1fd13693fbc897fad57e78b",
        sha256=(
            "3bac9e3db1038a59f3526ffcd2933571cc07764c4b801e37a9a10c0dd3728cda"
        ),
        size=23_390_424,
    ),
    "onepiece": StyleAdapterSpec(
        trigger="one_piece_style",
        settings_attr="onepiece_lora_path",
        default_scale=0.6,
        repo_id="andinmaro146/LoRA",
        filename=(
            "civitai/476041-one-piece-anime-style-lora/"
            "1067881-ilxl-v0-1/one_piece_style_ilxl.safetensors"
        ),
        revision="5f9fa99cf3faa8c42b06d872b7bffff5c1a4435f",
        sha256=(
            "26b37729ff3bc91b11f860d1e97177f9b8c4c78510e7fc35a45b7d8ec0b360ab"
        ),
        size=228_479_220,
    ),
    "luoxiaohei": StyleAdapterSpec(
        trigger="muse_lxh_style",
        settings_attr="luoxiaohei_lora_path",
        default_scale=0.6,
    ),
}


def style_adapter_spec(adapter_name: str) -> StyleAdapterSpec:
    try:
        return STYLE_ADAPTER_REGISTRY[adapter_name]
    except KeyError as exc:
        raise RuntimeError(f"不支持的风格 LoRA：{adapter_name}") from exc


def style_adapter_path(settings: object, adapter_name: str) -> Path:
    spec = style_adapter_spec(adapter_name)
    configured_path = getattr(settings, spec.settings_attr, "")
    if not configured_path:
        raise RuntimeError(f"风格 LoRA 路径尚未配置：{adapter_name}")
    return Path(configured_path).expanduser()


def style_adapter_scale(
    adapter_name: str,
    requested_scale: float | None,
) -> float:
    if requested_scale is not None:
        return requested_scale
    return style_adapter_spec(adapter_name).default_scale
