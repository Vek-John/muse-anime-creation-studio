from PIL import Image

from app.config import Settings
from app.engine import DiffusionEngine
from app.schemas import GenerationRequest


def test_white_background_mode_is_opt_in():
    request = GenerationRequest(prompt="1girl")
    assert request.background_mode == "none"
    assert request.sampler == "euler_a"


def test_edge_background_whitening_preserves_center_subject():
    image = Image.new("RGB", (128, 128), (174, 193, 214))
    for x in range(42, 86):
        for y in range(22, 116):
            image.putpixel((x, y), (180, 32, 52))

    engine = DiffusionEngine(Settings.from_env())
    processed = engine._whiten_edge_background(image)

    assert processed.getpixel((0, 0)) == (255, 255, 255)
    assert processed.getpixel((127, 127)) == (255, 255, 255)
    assert processed.getpixel((64, 64)) == (180, 32, 52)


def test_complex_background_is_not_destructively_whitened():
    image = Image.new("RGB", (128, 128))
    colors = [
        (32 + index * 11, 48 + index * 7, 74 + index * 5)
        for index in range(12)
    ]
    for x in range(128):
        for y in range(128):
            image.putpixel((x, y), colors[(x // 8 + y // 8) % len(colors)])

    engine = DiffusionEngine(Settings.from_env())
    processed = engine._whiten_edge_background(image)

    assert processed.tobytes() == image.tobytes()
