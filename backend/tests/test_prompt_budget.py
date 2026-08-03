from dataclasses import replace
from types import SimpleNamespace

import pytest

from app.config import Settings
from app.engine import DiffusionEngine, PromptBudgetError
from app.schemas import GenerationRequest, PromptInspectionRequest, PromptSegment


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


def test_generation_protects_the_selected_lora_trigger():
    engine = make_engine()
    request = GenerationRequest(
        prompt="1boy, demonslayer style",
        style_adapter="demonslayer",
        prompt_segments=[
            segment("subject", "1boy", priority=0, protected=True),
            segment(
                "style",
                "demonslayer style",
                priority=2,
                protected=False,
            ),
        ],
    )

    inspection = engine._generation_inspection_request(request)
    style = next(item for item in inspection.prompt_segments if item.id == "style")

    assert style.priority == 0
    assert style.protected is True


def test_generation_adds_a_missing_lora_trigger():
    engine = make_engine()
    request = GenerationRequest(
        prompt="1girl, solo",
        style_adapter="demonslayer",
        prompt_segments=[
            segment("subject", "1girl, solo", priority=0, protected=True),
        ],
    )

    inspection = engine._generation_inspection_request(request)

    assert inspection.prompt_segments[-1].text == "demonslayer style"
    assert inspection.prompt_segments[-1].protected is True


def test_style_adapter_is_loaded_once_and_scaled(tmp_path):
    adapter_path = tmp_path / "demonslayer.safetensors"
    adapter_path.write_bytes(b"test")
    settings = replace(
        Settings.from_env(),
        demonslayer_lora_path=str(adapter_path),
    )
    engine = DiffusionEngine(settings)

    class FakePipe:
        def __init__(self):
            self.loaded = []
            self.scaled = []
            self.enabled = 0

        def load_lora_weights(self, directory, *, weight_name, adapter_name):
            self.loaded.append((directory, weight_name, adapter_name))

        def set_adapters(self, adapter_name, *, adapter_weights):
            self.scaled.append((adapter_name, adapter_weights))

        def enable_lora(self):
            self.enabled += 1

    engine._pipe = FakePipe()
    engine._activate_style_adapter("demonslayer", 0.65)
    engine._activate_style_adapter("demonslayer", 0.5)

    assert len(engine._pipe.loaded) == 1
    assert engine._pipe.scaled == [
        ("demonslayer", 0.65),
        ("demonslayer", 0.5),
    ]
    assert engine._pipe.enabled == 2
