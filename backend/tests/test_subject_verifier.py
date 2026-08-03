import sys
from contextlib import nullcontext
from types import SimpleNamespace

import pytest

from app.config import Settings
from app.engine import (
    DiffusionEngine,
    PromptBudgetError,
    SubjectValidationError,
)
from app.schemas import (
    GenerationRequest,
    PromptDiagnostics,
    PromptInspectionResponse,
    PromptTokenUsage,
)
from app.subject_verifier import SubjectVerdict, evaluate_subject_scores


DEFAULTS = {
    "threshold": 0.28,
    "margin": 0.08,
    "count_threshold": 0.28,
    "integrity_threshold": 0.28,
}


def verdict(expected_subject: str, **scores: float):
    return evaluate_subject_scores(
        expected_subject,
        scores,
        **DEFAULTS,
    )


def test_single_male_passes_only_with_clear_male_advantage():
    accepted = verdict(
        "male",
        **{"1boy": 0.88, "1girl": 0.08, "2boys": 0.03},
    )
    assert accepted.passed is True

    ambiguous = verdict(
        "male",
        **{"1boy": 0.55, "1girl": 0.51},
    )
    assert ambiguous.passed is False
    assert "冲突性别" in ambiguous.reason


def test_single_subject_rejects_extra_people():
    result = verdict(
        "male",
        **{
            "1boy": 0.9,
            "1girl": 0.05,
            "multiple people": 0.62,
        },
    )
    assert result.passed is False
    assert "多余人物" in result.reason


def test_subject_with_a_missing_head_is_rejected_even_when_gender_is_clear():
    result = verdict(
        "male",
        **{
            "1boy": 0.77,
            "male focus": 0.84,
            "1girl": 0.12,
            "head out of frame": 0.71,
        },
    )

    assert result.passed is False
    assert result.integrity_conflict_score == 0.71
    assert result.integrity_conflicts == ["head out of frame"]
    assert "人物不完整" in result.reason


def test_single_female_uses_the_inverse_contract():
    accepted = verdict(
        "female",
        **{"1girl": 0.91, "1boy": 0.04},
    )
    rejected = verdict(
        "female",
        **{"1girl": 0.41, "male focus": 0.72},
    )
    assert accepted.passed is True
    assert rejected.passed is False


def test_pair_and_mixed_contracts_are_supported():
    assert verdict(
        "male_pair",
        **{"2boys": 0.8, "2girls": 0.02},
    ).passed
    assert verdict(
        "female_pair",
        **{"2girls": 0.84, "2boys": 0.03},
    ).passed
    assert verdict(
        "mixed",
        **{"1boy": 0.75, "1girl": 0.78, "2girls": 0.02},
    ).passed


def test_generic_human_accepts_either_gender_but_rejects_missing_people():
    assert verdict("human", **{"1boy": 0.82}).passed
    assert verdict("human", **{"1girl": 0.84}).passed

    missing = verdict("human", **{"no humans": 0.78})
    assert missing.passed is False
    assert "未检测到" in missing.reason


def test_generic_human_rejects_unrecognizable_or_incomplete_people():
    result = verdict(
        "human",
        **{
            "multiple people": 0.81,
            "faceless": 0.69,
        },
    )

    assert result.passed is False
    assert result.integrity_conflicts == ["faceless"]
    assert "不可辨认" in result.reason


class FakeGenerator:
    def __init__(self, device: str):
        self.device = device
        self.seed = -1

    def manual_seed(self, seed: int):
        self.seed = seed
        return self


class FakeImage:
    def __init__(self, seed: int):
        self.seed = seed

    def save(self, output, **_kwargs):
        output.write(f"image-{self.seed}".encode())


class FakePipeline:
    def __call__(self, *, generator, **_kwargs):
        return SimpleNamespace(images=[FakeImage(generator.seed)])


def prepared_engine(monkeypatch) -> DiffusionEngine:
    engine = DiffusionEngine(Settings.from_env())
    engine._pipe = FakePipeline()
    diagnostics = PromptDiagnostics(
        token_usage=PromptTokenUsage(
            tokenizer_1=12,
            tokenizer_2=12,
            limit=75,
        ),
        negative_token_usage=PromptTokenUsage(
            tokenizer_1=4,
            tokenizer_2=4,
            limit=75,
        ),
    )
    monkeypatch.setattr(
        engine,
        "_inspect_sync",
        lambda _request: PromptInspectionResponse(
            prompt="1boy, solo, male focus",
            negative_prompt="1girl",
            diagnostics=diagnostics,
        ),
    )
    monkeypatch.setattr(engine, "_configure_scheduler", lambda _sampler: None)
    monkeypatch.setattr(
        engine,
        "_activate_style_adapter",
        lambda _adapter, _scale: None,
    )
    monkeypatch.setitem(
        sys.modules,
        "torch",
        SimpleNamespace(
            Generator=FakeGenerator,
            inference_mode=nullcontext,
        ),
    )
    return engine


def subject_result(*, passed: bool) -> SubjectVerdict:
    return SubjectVerdict(
        passed=passed,
        expected_subject="male",
        target_score=0.9 if passed else 0.2,
        conflicting_score=0.05 if passed else 0.7,
        count_score=0.01,
        integrity_conflict_score=0.01,
        integrity_conflicts=[],
        scores={"1boy": 0.9 if passed else 0.2, "1girl": 0.05 if passed else 0.7},
        reason=(
            "主体性别与人数符合要求"
            if passed
            else "检测到冲突性别，或目标性别置信度优势不足"
        ),
    )


def test_strict_generation_retries_and_returns_only_a_passing_subject(
    monkeypatch,
):
    engine = prepared_engine(monkeypatch)
    verdicts = iter([subject_result(passed=False), subject_result(passed=True)])
    monkeypatch.setattr(
        engine._subject_verifier,
        "verify",
        lambda _image, _expected: next(verdicts),
    )
    request = GenerationRequest(
        prompt="1boy, solo, male focus",
        expected_subject="male",
        subject_validation="strict",
        max_subject_attempts=4,
        seed=1200,
    )

    result = engine._generate_sync(request, "request-test")

    assert result.seed == 1201
    assert result.subject_validation.status == "passed"
    assert [attempt.passed for attempt in result.subject_validation.attempts] == [
        False,
        True,
    ]


def test_strict_generation_returns_no_image_when_all_subjects_fail(
    monkeypatch,
):
    engine = prepared_engine(monkeypatch)
    monkeypatch.setattr(
        engine._subject_verifier,
        "verify",
        lambda _image, _expected: subject_result(passed=False),
    )
    request = GenerationRequest(
        prompt="1boy, solo, male focus",
        expected_subject="male",
        subject_validation="strict",
        max_subject_attempts=3,
        seed=2200,
    )

    with pytest.raises(SubjectValidationError, match="共尝试 3 次"):
        engine._generate_sync(request, "request-test")


def test_strict_generation_rejects_missing_subject_before_loading(
    monkeypatch,
):
    engine = DiffusionEngine(Settings.from_env())
    monkeypatch.setattr(
        engine,
        "_inspect_sync",
        lambda _request: pytest.fail("prompt inspection should not start"),
    )

    with pytest.raises(PromptBudgetError, match="严格主体校验需要"):
        engine._generate_sync(
            GenerationRequest(
                prompt="solo",
                subject_validation="strict",
            ),
            "request-test",
        )
