from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Mapping


SUBJECT_TAGS = (
    "1boy",
    "1girl",
    "2boys",
    "2girls",
    "male focus",
    "multiple boys",
    "multiple girls",
    "multiple people",
)
HUMAN_INTEGRITY_TAGS = (
    "no humans",
    "faceless",
    "faceless male",
    "faceless female",
    "headless",
    "head out of frame",
)
VALIDATION_TAGS = (*SUBJECT_TAGS, *HUMAN_INTEGRITY_TAGS)


@dataclass(frozen=True)
class SubjectVerdict:
    passed: bool
    expected_subject: str
    target_score: float
    conflicting_score: float
    count_score: float
    integrity_conflict_score: float
    integrity_conflicts: list[str]
    scores: dict[str, float]
    reason: str


def evaluate_subject_scores(
    expected_subject: str,
    scores: Mapping[str, float],
    *,
    threshold: float,
    margin: float,
    count_threshold: float,
    integrity_threshold: float,
) -> SubjectVerdict:
    normalized_scores = {
        tag: float(scores.get(tag, 0.0))
        for tag in VALIDATION_TAGS
    }

    def highest(*tags: str) -> float:
        return max((normalized_scores[tag] for tag in tags), default=0.0)

    if expected_subject == "male":
        target = highest("1boy", "male focus")
        conflicting = highest("1girl", "2girls")
        count = highest(
            "2boys",
            "2girls",
            "multiple boys",
            "multiple girls",
            "multiple people",
        )
    elif expected_subject == "female":
        target = highest("1girl")
        conflicting = highest("1boy", "2boys", "male focus")
        count = highest(
            "2boys",
            "2girls",
            "multiple boys",
            "multiple girls",
            "multiple people",
        )
    elif expected_subject == "male_pair":
        target = highest("2boys", "multiple boys")
        conflicting = highest("1girl", "2girls", "multiple girls")
        count = 0.0
    elif expected_subject == "female_pair":
        target = highest("2girls", "multiple girls")
        conflicting = highest("1boy", "2boys", "multiple boys", "male focus")
        count = 0.0
    elif expected_subject == "human":
        target = highest(
            "1boy",
            "1girl",
            "2boys",
            "2girls",
            "male focus",
            "multiple boys",
            "multiple girls",
            "multiple people",
        )
        conflicting = 0.0
        count = 0.0
    else:
        target = min(
            highest("1boy", "male focus"),
            highest("1girl"),
        )
        conflicting = highest("2boys", "2girls")
        count = 0.0

    enough_target = target >= threshold
    clears_conflict = target >= conflicting + margin
    correct_count = count < count_threshold
    integrity_conflicts = [
        tag
        for tag in HUMAN_INTEGRITY_TAGS
        if normalized_scores[tag] >= integrity_threshold
    ]
    integrity_conflict_score = highest(*HUMAN_INTEGRITY_TAGS)
    recognizable_human = not integrity_conflicts
    passed = (
        enough_target
        and clears_conflict
        and correct_count
        and recognizable_human
    )

    if not enough_target:
        reason = "未检测到足够明确的目标主体"
    elif not clears_conflict:
        reason = "检测到冲突性别，或目标性别置信度优势不足"
    elif not correct_count:
        reason = "检测到多余人物"
    elif not recognizable_human:
        rendered = "、".join(integrity_conflicts)
        reason = f"人物不完整或不可辨认：{rendered}"
    else:
        reason = "主体性别、人数与人物完整性符合要求"

    return SubjectVerdict(
        passed=passed,
        expected_subject=expected_subject,
        target_score=target,
        conflicting_score=conflicting,
        count_score=count,
        integrity_conflict_score=integrity_conflict_score,
        integrity_conflicts=integrity_conflicts,
        scores=normalized_scores,
        reason=reason,
    )


class AnimeSubjectVerifier:
    """Lazy CPU verifier for generated anime images.

    The ONNX model and labels are downloaded into the server's Hugging Face
    cache on the first strict generation request. No image leaves the server.
    """

    def __init__(
        self,
        *,
        model_id: str,
        hf_token: str | None,
        threshold: float,
        margin: float,
        count_threshold: float,
        integrity_threshold: float,
    ) -> None:
        self.model_id = model_id
        self.hf_token = hf_token
        self.threshold = threshold
        self.margin = margin
        self.count_threshold = count_threshold
        self.integrity_threshold = integrity_threshold
        self._load_lock = Lock()
        self._session = None
        self._input_name = ""
        self._output_name = ""
        self._target_size = 0
        self._tag_names: list[str] = []

    def _load_sync(self) -> None:
        if self._session is not None:
            return

        with self._load_lock:
            if self._session is not None:
                return

            import onnxruntime
            from huggingface_hub import hf_hub_download

            model_path = hf_hub_download(
                self.model_id,
                "model.onnx",
                token=self.hf_token,
            )
            labels_path = hf_hub_download(
                self.model_id,
                "selected_tags.csv",
                token=self.hf_token,
            )
            with Path(labels_path).open(
                "r",
                encoding="utf-8",
                newline="",
            ) as handle:
                self._tag_names = [
                    row["name"].replace("_", " ").strip().lower()
                    for row in csv.DictReader(handle)
                ]

            session = onnxruntime.InferenceSession(
                model_path,
                providers=["CPUExecutionProvider"],
            )
            input_metadata = session.get_inputs()[0]
            output_metadata = session.get_outputs()[0]
            shape = input_metadata.shape
            target_size = shape[1]
            if not isinstance(target_size, int) or target_size <= 0:
                raise RuntimeError(
                    "主体校验模型没有提供有效的输入尺寸。"
                )

            self._input_name = input_metadata.name
            self._output_name = output_metadata.name
            self._target_size = target_size
            self._session = session

    def _prepare_image(self, image):
        import numpy
        from PIL import Image

        source = image.convert("RGB")
        side = max(source.size)
        canvas = Image.new("RGB", (side, side), (255, 255, 255))
        offset = (
            (side - source.width) // 2,
            (side - source.height) // 2,
        )
        canvas.paste(source, offset)
        if side != self._target_size:
            canvas = canvas.resize(
                (self._target_size, self._target_size),
                Image.Resampling.BICUBIC,
            )
        array = numpy.asarray(canvas, dtype=numpy.float32)
        array = array[:, :, ::-1]
        return numpy.expand_dims(array, axis=0)

    def verify(self, image, expected_subject: str) -> SubjectVerdict:
        self._load_sync()
        prepared = self._prepare_image(image)
        predictions = self._session.run(
            [self._output_name],
            {self._input_name: prepared},
        )[0][0]
        scores = {
            tag: float(score)
            for tag, score in zip(
                self._tag_names,
                predictions,
                strict=False,
            )
            if tag in VALIDATION_TAGS
        }
        return evaluate_subject_scores(
            expected_subject,
            scores,
            threshold=self.threshold,
            margin=self.margin,
            count_threshold=self.count_threshold,
            integrity_threshold=self.integrity_threshold,
        )
