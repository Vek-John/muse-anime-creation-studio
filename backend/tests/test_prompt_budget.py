from types import SimpleNamespace

import pytest

from app.config import Settings
from app.engine import DiffusionEngine, PromptBudgetError
from app.schemas import PromptInspectionRequest, PromptSegment


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
