import hashlib
import sys
from dataclasses import replace
from types import SimpleNamespace

import pytest

from app.config import Settings
from app.engine import DiffusionEngine, PromptBudgetError
from app.schemas import GenerationRequest, PromptInspectionRequest, PromptSegment
from app.style_adapters import STYLE_ADAPTER_REGISTRY


STYLE_ADAPTER_CASES = {
    "demonslayer": ("demonslayer style", 0.65),
    "naruto": ("in naruto-style", 0.65),
    "genshin": ("genshin-style character", 0.60),
    "onepiece": ("one_piece_style", 0.60),
    "luoxiaohei": ("muse_lxh_style", 0.60),
}


class FakeTokenizer:
    model_max_length = 8

    def num_special_tokens_to_add(self, pair=False):
        return 2

    def __call__(self, text, *, add_special_tokens, truncation):
        tokens = text.replace(",", " ").split()
        return {"input_ids": [0, *range(1, len(tokens) + 1), 99]}


def make_engine() -> DiffusionEngine:
    engine = DiffusionEngine(Settings.from_env())
    engine._pipe = SimpleNamespace(
        tokenizer=FakeTokenizer(),
        tokenizer_2=FakeTokenizer(),
    )
    engine.state.model_loaded = True
    return engine


def segment(
    segment_id: str,
    text: str,
    *,
    priority: int,
    protected: bool,
) -> PromptSegment:
    return PromptSegment(
        id=segment_id,
        label=segment_id,
        text=text,
        priority=priority,
        protected=protected,
    )


def test_budget_removes_low_priority_whole_segment_first():
    engine = make_engine()
    request = PromptInspectionRequest(
        prompt="fallback is ignored",
        prompt_segments=[
            segment("subject", "1girl", priority=0, protected=True),
            segment("pose", "full body", priority=0, protected=True),
            segment(
                "accessory",
                "school bag with ribbon",
                priority=3,
                protected=False,
            ),
            segment("style", "anime style", priority=1, protected=False),
            segment("suffix", "masterpiece", priority=0, protected=True),
        ],
    )

    result = engine._inspect_sync(request)

    assert result.prompt == "1girl, full body, anime style, masterpiece"
    assert [
        omitted.id for omitted in result.diagnostics.omitted_segments
    ] == ["accessory"]
    assert result.diagnostics.token_usage.tokenizer_1 == 6
    assert result.diagnostics.token_usage.tokenizer_2 == 6
    assert result.diagnostics.token_usage.limit == 6
    assert result.diagnostics.negative_token_usage.tokenizer_1 == 0
    assert result.diagnostics.negative_token_usage.tokenizer_2 == 0


def test_budget_drops_automatic_hints_before_user_content():
    engine = make_engine()
    request = PromptInspectionRequest(
        prompt="fallback",
        prompt_segments=[
            segment("default-human", "solo", priority=3, protected=False),
            segment(
                "custom",
                "blonde hair",
                priority=0,
                protected=True,
            ),
            segment(
                "selection",
                "anime style rain outdoors",
                priority=3,
                protected=False,
            ),
            segment("rating", "safe", priority=3, protected=False),
            segment("quality-suffix", "masterpiece", priority=3, protected=False),
        ],
    )

    result = engine._inspect_sync(request)

    assert result.prompt == "blonde hair, anime style rain outdoors"
    assert [
        omitted.id for omitted in result.diagnostics.omitted_segments
    ] == ["quality-suffix", "rating", "default-human"]
    assert result.diagnostics.token_usage.tokenizer_1 == 6


def test_budget_rejects_protected_content_that_cannot_fit():
    engine = make_engine()
    request = PromptInspectionRequest(
        prompt="fallback",
        prompt_segments=[
            segment(
                "subject",
                "one two three four",
                priority=0,
                protected=True,
            ),
            segment(
                "pose",
                "five six seven",
                priority=0,
                protected=True,
            ),
        ],
    )

    with pytest.raises(PromptBudgetError, match="核心主体"):
        engine._inspect_sync(request)


def test_budget_rejects_overlong_negative_prompt():
    engine = make_engine()
    request = PromptInspectionRequest(
        prompt="1girl",
        negative_prompt="one two three four five six seven",
    )

    with pytest.raises(PromptBudgetError, match="负面提示词"):
        engine._inspect_sync(request)


def test_expected_subject_accepts_matching_model_prefix():
    engine = make_engine()
    request = PromptInspectionRequest(
        prompt="1boy, solo, male focus, full body",
        expected_subject="male",
    )

    result = engine._inspect_sync(request)

    assert result.prompt.startswith("1boy, solo, male focus")


def test_generic_human_subject_does_not_require_a_gender_prefix():
    engine = make_engine()
    request = PromptInspectionRequest(
        prompt="solo, safe, masterpiece",
        expected_subject="human",
    )

    assert engine._inspect_sync(request).prompt == "solo, safe, masterpiece"


def test_expected_subject_rejects_wrong_prefix():
    engine = make_engine()
    request = PromptInspectionRequest(
        prompt="1girl, solo, 1man, school uniform",
        expected_subject="male",
    )

    with pytest.raises(PromptBudgetError, match="期望提示词以"):
        engine._inspect_sync(request)


def test_expected_subject_rejects_later_conflicting_subject_tag():
    engine = make_engine()
    request = PromptInspectionRequest(
        prompt="1boy, solo, male focus, 1girl",
        expected_subject="male",
    )

    with pytest.raises(PromptBudgetError, match="冲突主体"):
        engine._inspect_sync(request)


def test_expected_mixed_subject_requires_both_prefix_tags():
    engine = make_engine()
    accepted = PromptInspectionRequest(
        prompt="1boy, 1girl, standing together",
        expected_subject="mixed",
    )
    assert engine._inspect_sync(accepted).prompt.startswith("1boy, 1girl")

    rejected = PromptInspectionRequest(
        prompt="1boy, solo",
        expected_subject="mixed",
    )
    with pytest.raises(PromptBudgetError, match="期望提示词以"):
        engine._inspect_sync(rejected)


@pytest.mark.parametrize(
    ("adapter_name", "trigger"),
    [
        (adapter_name, values[0])
        for adapter_name, values in STYLE_ADAPTER_CASES.items()
    ],
)
def test_generation_protects_the_selected_lora_trigger(
    adapter_name,
    trigger,
):
    engine = make_engine()
    request = GenerationRequest(
        prompt=f"1boy, {trigger}",
        style_adapter=adapter_name,
        prompt_segments=[
            segment("subject", "1boy", priority=0, protected=True),
            segment(
                "style",
                trigger,
                priority=2,
                protected=False,
            ),
        ],
    )

    inspection = engine._generation_inspection_request(request)
    style = next(item for item in inspection.prompt_segments if item.id == "style")

    assert style.priority == 0
    assert style.protected is True
    assert sum(
        engine._contains_prompt_tag(item.text, trigger)
        for item in inspection.prompt_segments
    ) == 1
    assert not any(
        item.id == f"style-adapter:{adapter_name}"
        for item in inspection.prompt_segments
    )


@pytest.mark.parametrize(
    ("adapter_name", "trigger"),
    [
        (adapter_name, values[0])
        for adapter_name, values in STYLE_ADAPTER_CASES.items()
    ],
)
def test_generation_adds_a_missing_lora_trigger(adapter_name, trigger):
    engine = make_engine()
    request = GenerationRequest(
        prompt="1girl, solo",
        style_adapter=adapter_name,
        prompt_segments=[
            segment("subject", "1girl, solo", priority=0, protected=True),
        ],
    )

    inspection = engine._generation_inspection_request(request)

    assert inspection.prompt_segments[-1].id == f"style-adapter:{adapter_name}"
    assert inspection.prompt_segments[-1].text == trigger
    assert inspection.prompt_segments[-1].slot == "style"
    assert inspection.prompt_segments[-1].priority == 0
    assert inspection.prompt_segments[-1].protected is True
    assert sum(
        engine._contains_prompt_tag(item.text, trigger)
        for item in inspection.prompt_segments
    ) == 1


def test_style_adapters_are_loaded_once_switched_and_default_scaled(
    tmp_path,
    monkeypatch,
):
    adapter_paths = {
        adapter_name: tmp_path / f"{adapter_name}.safetensors"
        for adapter_name in STYLE_ADAPTER_CASES
    }
    for adapter_name, adapter_path in adapter_paths.items():
        adapter_path.write_bytes(adapter_name.encode())
    settings = replace(
        Settings.from_env(),
        **{
            f"{adapter_name}_lora_path": str(adapter_path)
            for adapter_name, adapter_path in adapter_paths.items()
        },
    )
    engine = DiffusionEngine(settings)
    monkeypatch.setattr(
        engine,
        "_ensure_style_adapter_file",
        lambda adapter_name: adapter_paths[adapter_name],
    )

    class FakePipe:
        def __init__(self):
            self.loaded = []
            self.scaled = []
            self.enabled = 0
            self.disabled = 0

        def load_lora_weights(self, directory, *, weight_name, adapter_name):
            self.loaded.append((directory, weight_name, adapter_name))

        def set_adapters(self, adapter_name, *, adapter_weights):
            self.scaled.append((adapter_name, adapter_weights))

        def enable_lora(self):
            self.enabled += 1

        def disable_lora(self):
            self.disabled += 1

    engine._pipe = FakePipe()
    assert list(STYLE_ADAPTER_REGISTRY) == list(STYLE_ADAPTER_CASES)
    for adapter_name, adapter_path in adapter_paths.items():
        assert engine._style_adapter_path(adapter_name) == adapter_path

    resolved_scales = {
        adapter_name: engine._activate_style_adapter(adapter_name, None)
        for adapter_name in STYLE_ADAPTER_CASES
    }
    engine._activate_style_adapter("naruto", 0.0)
    engine._activate_style_adapter("onepiece", 1.0)
    engine._activate_style_adapter(None, None)

    assert resolved_scales == {
        adapter_name: values[1]
        for adapter_name, values in STYLE_ADAPTER_CASES.items()
    }
    assert engine._pipe.loaded == [
        (
            str(adapter_paths[adapter_name].parent),
            adapter_paths[adapter_name].name,
            adapter_name,
        )
        for adapter_name in STYLE_ADAPTER_CASES
    ]
    assert engine._pipe.scaled == [
        *[
            (adapter_name, default_scale)
            for adapter_name, (_, default_scale) in STYLE_ADAPTER_CASES.items()
        ],
        ("naruto", 0.0),
        ("onepiece", 1.0),
    ]
    assert engine._pipe.enabled == len(STYLE_ADAPTER_CASES) + 2
    assert engine._pipe.disabled == 1


def test_style_adapter_activation_disables_lora_when_enable_fails(
    tmp_path,
    monkeypatch,
):
    naruto_path = tmp_path / "naruto.safetensors"
    naruto_path.write_bytes(b"naruto")
    settings = replace(
        Settings.from_env(),
        naruto_lora_path=str(naruto_path),
    )
    engine = DiffusionEngine(settings)
    monkeypatch.setattr(
        engine,
        "_ensure_style_adapter_file",
        lambda _adapter_name: naruto_path,
    )

    class FailingPipe:
        def __init__(self):
            self.disabled = 0

        def load_lora_weights(self, *_args, **_kwargs):
            return None

        def set_adapters(self, *_args, **_kwargs):
            return None

        def enable_lora(self):
            raise RuntimeError("enable failed")

        def disable_lora(self):
            self.disabled += 1

    engine._pipe = FailingPipe()

    with pytest.raises(RuntimeError, match="enable failed"):
        engine._activate_style_adapter("naruto", None)

    assert engine._pipe.disabled == 1


def test_public_style_adapter_is_downloaded_at_a_pinned_revision_and_verified(
    tmp_path,
    monkeypatch,
):
    content = b"verified-naruto-lora"
    source = tmp_path / "hub-cache" / "weights.safetensors"
    source.parent.mkdir()
    source.write_bytes(content)
    destination = tmp_path / "local-cache" / "naruto.safetensors"
    settings = replace(
        Settings.from_env(),
        naruto_lora_path=str(destination),
    )
    engine = DiffusionEngine(settings)
    original = STYLE_ADAPTER_REGISTRY["naruto"]
    monkeypatch.setitem(
        STYLE_ADAPTER_REGISTRY,
        "naruto",
        replace(
            original,
            sha256=hashlib.sha256(content).hexdigest(),
            size=len(content),
        ),
    )
    calls = []

    def fake_download(**kwargs):
        calls.append(kwargs)
        return str(source)

    monkeypatch.setitem(
        sys.modules,
        "huggingface_hub",
        SimpleNamespace(hf_hub_download=fake_download),
    )

    resolved = engine._ensure_style_adapter_file("naruto")

    assert resolved == destination
    assert destination.read_bytes() == content
    assert not destination.with_suffix(".safetensors.download").exists()
    assert calls == [
        {
            "repo_id": original.repo_id,
            "filename": original.filename,
            "revision": original.revision,
            "cache_dir": None,
            "token": settings.hf_token,
        }
    ]


def test_project_trained_adapter_without_a_source_requires_a_local_file(
    tmp_path,
):
    missing = tmp_path / "missing-luoxiaohei.safetensors"
    engine = DiffusionEngine(
        replace(Settings.from_env(), luoxiaohei_lora_path=str(missing))
    )

    with pytest.raises(RuntimeError, match="没有公开的自动下载来源"):
        engine._ensure_style_adapter_file("luoxiaohei")
