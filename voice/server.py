"""
Speech in, speech out, on the Mac's own GPU.

This runs on the host rather than in a container, and that is not a preference.
Docker Desktop on macOS provides no Metal passthrough — the Hypervisor
framework has no virtual GPU — so a containerised model runs CPU-only and
throws away most of the machine. The bot reaches this over
host.docker.internal instead.

Measured on the M2 this was built on:

    Parakeet TDT 0.6B    ~180ms for 4s of speech once warm  (RTF 0.05)
    Kokoro 82M + CoreML  ~600ms for a short sentence        (RTF 0.30)

Both numbers are *once warm*. Cold, the first Parakeet call takes over ten
seconds while Metal compiles its shaders, which is why startup does a throwaway
pass of each before reporting ready.
"""

from __future__ import annotations

import io
import logging
import os
import time
import wave

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("voice")

HOST = os.environ.get("VOICE_HOST", "127.0.0.1")
PORT = int(os.environ.get("VOICE_PORT", "8931"))

# The small Parakeet, not the large one.
#
# parakeet-tdt-0.6b-v3 is 2.3GB on disk and was the wrong choice on an 8GB
# machine already running six containers: it paged in and out between requests,
# and transcription degraded from 900ms to 22 seconds over five turns as swap
# grew past 6GB.
#
# tdt_ctc-110m is 437MB and averages 43ms on the same clips, with identical
# transcriptions on every test phrase. English only, which is the tradeoff —
# the 0.6b covers 25 languages. Set STT_MODEL to change it back.
STT_MODEL = os.environ.get("STT_MODEL", "mlx-community/parakeet-tdt_ctc-110m")
KOKORO_MODEL = os.environ.get("KOKORO_MODEL", "kokoro-v1.0.onnx")
KOKORO_VOICES = os.environ.get("KOKORO_VOICES", "voices-v1.0.bin")
DEFAULT_VOICE = os.environ.get("VOICE_NAME", "af_heart")

# Discord decodes to 48kHz; these are what each model wants.
STT_SAMPLE_RATE = 16_000
TTS_SAMPLE_RATE = 24_000

# Seconds. Every clip is padded up to one of these so the model only ever sees
# a handful of tensor shapes; see _bucket.
STT_BUCKETS = (2, 4, 8, 15, 30)

# Idle long enough and Metal discards its compiled kernels; the first request
# after that took 21 seconds. See _keep_warm_loop.
KEEP_WARM_SECONDS = int(os.environ.get("KEEP_WARM_SECONDS", "60"))

# Deliberately varied in length: see _warm for why one phrase is not enough.
WARM_PHRASES = (
    "Okay.",
    "What time is it.",
    "Can you explain that in simple terms.",
    "I was wondering if you could tell me about the history of something.",
    "Right, so the longer answer is that there are several things going on here "
    "and it is worth taking them one at a time before drawing any conclusion.",
)

app = FastAPI(title="zenitsu-voice")

import threading

_stt = None
_stt_preprocess = None
_tts = None

# One inference at a time.
#
# MLX and the Metal command queue do not take kindly to concurrent use: two
# threads reaching the GPU together do not run twice as fast, they contend, and
# a background keep-warm overlapping a live request turned a 200ms
# transcription into a nineteen second one.
_model_lock = threading.Lock()


def _resample(samples: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    """
    Linear resampling, which is enough here.

    Speech recognition is unbothered by the aliasing a proper windowed filter
    would remove, and this keeps ffmpeg — unavailable on this host — out of the
    hot path entirely.
    """
    if source_rate == target_rate:
        return samples.astype(np.float32)

    count = int(len(samples) * target_rate / source_rate)
    if count <= 0:
        return np.zeros(0, dtype=np.float32)

    positions = np.linspace(0, len(samples) - 1, count)
    return np.interp(positions, np.arange(len(samples)), samples).astype(np.float32)


def _pcm16_to_float(raw: bytes) -> np.ndarray:
    """Signed 16-bit little-endian, which is what both Discord and WAV carry."""
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0


def _float_to_pcm16(samples: np.ndarray) -> bytes:
    clipped = np.clip(samples, -1.0, 1.0)
    return (clipped * 32767.0).astype("<i2").tobytes()


def _load_models() -> None:
    global _stt, _stt_preprocess, _tts

    from parakeet_mlx import from_pretrained
    from parakeet_mlx.audio import get_logmel

    log.info("loading STT %s", STT_MODEL)
    started = time.time()
    _stt = from_pretrained(STT_MODEL)
    _stt_preprocess = get_logmel
    log.info("STT loaded in %.1fs", time.time() - started)

    import onnxruntime as ort
    from kokoro_onnx import Kokoro

    log.info("loading TTS %s", KOKORO_MODEL)
    started = time.time()
    # CoreML where the graph allows it, CPU for the operators it does not.
    # Falling back per-operator is automatic and roughly a third faster on the
    # short sentences that decide perceived latency.
    session = ort.InferenceSession(
        KOKORO_MODEL,
        providers=["CoreMLExecutionProvider", "CPUExecutionProvider"],
    )
    _tts = Kokoro.from_session(session, KOKORO_VOICES)
    log.info("TTS loaded in %.1fs", time.time() - started)


def _bucket(samples: np.ndarray) -> np.ndarray:
    """
    Pads audio up to the next fixed length.

    MLX compiles Metal shaders per tensor shape, not once per model. Warming
    with one duration therefore warms exactly that duration: a server warmed on
    1s of silence still stalled 15 seconds on the first 3.8s utterance, which
    is worse than not warming at all because it looks fixed.

    Rounding every clip up to one of a handful of sizes means only those shapes
    ever reach the model, and all of them can be warmed at startup. The padding
    is silence, which the model transcribes as nothing.
    """
    length = len(samples)
    for bucket in STT_BUCKETS:
        size = bucket * STT_SAMPLE_RATE
        if length <= size:
            return np.pad(samples, (0, size - length))

    # Longer than the largest bucket: truncate rather than invent a new shape.
    return samples[: STT_BUCKETS[-1] * STT_SAMPLE_RATE]


def _warm() -> None:
    """
    A throwaway pass of each model, at every shape that can occur.

    Metal compiles on first use and Parakeet's first call is a ten-second
    stall. Paying it once per bucket at startup means nobody speaking into it
    ever does.
    """
    import mlx.core as mx

    started = time.time()
    for phrase in WARM_PHRASES[:3]:
        _tts.create(phrase, voice=DEFAULT_VOICE, speed=1.0, lang="en-us")
    log.info("TTS warm in %.1fs", time.time() - started)

    # Warmed with varied real speech, not silence and not one phrase repeated.
    #
    # Two things had to be learned the hard way here. Silence transcribes to
    # nothing, so the decoder loop never runs and never compiles — a server
    # warmed on silence still stalled 14 seconds on the first real utterance.
    # And compilation is per decode length, not per input shape, so one phrase
    # warms one path: latency fell 17s, 3.9s, 2.4s, 1.0s across four different
    # sentences before settling.
    #
    # Varied lengths cover enough paths that a live session converges to
    # ~130-270ms within the first exchange or two rather than the fifth.
    started = time.time()

    for phrase in WARM_PHRASES:
        speech, tts_rate = _tts.create(phrase, voice=DEFAULT_VOICE, speed=1.0, lang="en-us")
        spoken = _resample(np.asarray(speech, dtype=np.float32), tts_rate, STT_SAMPLE_RATE)
        mel = _stt_preprocess(mx.array(_bucket(spoken)), _stt.preprocessor_config)
        _stt.generate(mel)

    log.info("STT warm in %.1fs across %d phrases", time.time() - started, len(WARM_PHRASES))


def _keep_warm_loop() -> None:
    """
    A tiny inference on a timer, forever.

    Warming at startup is not enough on its own: after roughly fifteen minutes
    idle the first request went back to twenty seconds, because Metal releases
    what it had compiled.

    Skips rather than waits when a real request holds the lock. An earlier
    version blocked, and a keep-warm pass landing mid-conversation contended
    with the request for the GPU and pushed transcription from 200ms to
    nineteen seconds — the keep-warm was causing exactly the stall it existed
    to prevent.
    """
    import mlx.core as mx

    silence = np.zeros(STT_BUCKETS[0] * STT_SAMPLE_RATE, dtype=np.float32)

    while True:
        time.sleep(KEEP_WARM_SECONDS)

        if not _model_lock.acquire(blocking=False):
            continue

        try:
            mel = _stt_preprocess(mx.array(silence), _stt.preprocessor_config)
            _stt.generate(mel)
            _tts.create("Okay.", voice=DEFAULT_VOICE, speed=1.0, lang="en-us")
        except Exception as exc:  # noqa: BLE001
            log.debug("keep-warm failed: %s", exc)
        finally:
            _model_lock.release()


@app.post("/warm")
def warm_now() -> JSONResponse:
    """
    Warms on demand, so a session can pay the cost while it is still joining.

    /talk calls this before it tells anyone it is listening — much better than
    the first question of the conversation being the one that waits.
    """
    started = time.time()
    _warm()
    return JSONResponse({"ok": True, "ms": int((time.time() - started) * 1000)})


@app.on_event("startup")
def startup() -> None:
    import threading

    _load_models()
    _warm()

    threading.Thread(target=_keep_warm_loop, daemon=True).start()
    log.info("listening on %s:%s (keep-warm every %ss)", HOST, PORT, KEEP_WARM_SECONDS)


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse({"ok": _stt is not None and _tts is not None})


@app.post("/stt")
async def stt(request: Request) -> JSONResponse:
    """
    Raw PCM in, text out.

    Takes signed 16-bit mono at whatever rate the caller has — Discord's is
    48kHz — because making the bot resample would mean shipping a resampler
    into Node for no reason.
    """
    raw = await request.body()
    if not raw:
        raise HTTPException(status_code=400, detail="empty body")

    rate = int(request.query_params.get("rate", 48_000))
    started = time.time()

    samples = _resample(_pcm16_to_float(raw), rate, STT_SAMPLE_RATE)
    seconds = len(samples) / STT_SAMPLE_RATE

    # Below this there is no word to find, and the model returns noise-shaped
    # nonsense rather than an empty string.
    if seconds < 0.30:
        return JSONResponse({"text": "", "seconds": seconds, "ms": 0})

    import mlx.core as mx

    def run() -> str:
        # Serialised: concurrent Metal work contends rather than parallelises.
        with _model_lock:
            mel = _stt_preprocess(mx.array(_bucket(samples)), _stt.preprocessor_config)
            return _stt.generate(mel)[0].text

    # Off the event loop, so /health still answers while a long clip decodes.
    result_text = await run_in_threadpool(run)
    elapsed = int((time.time() - started) * 1000)

    text = result_text.strip()
    log.info("stt %.2fs audio -> %dms -> %r", seconds, elapsed, text[:60])

    return JSONResponse({"text": text, "seconds": seconds, "ms": elapsed})


@app.post("/tts")
async def tts(request: Request) -> Response:
    """
    Text in, raw PCM out.

    PCM rather than WAV because the caller pipes it straight into Discord,
    which wants samples and not a container. The rate is in the response
    headers so the bot never has to assume it.
    """
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="no text")

    voice = body.get("voice") or DEFAULT_VOICE
    speed = float(body.get("speed") or 1.0)

    started = time.time()

    def run():
        with _model_lock:
            return _tts.create(text, voice=voice, speed=speed, lang="en-us")

    try:
        samples, rate = await run_in_threadpool(run)
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller as a 500
        log.warning("tts failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    pcm = _float_to_pcm16(np.asarray(samples, dtype=np.float32))
    elapsed = int((time.time() - started) * 1000)
    duration = len(pcm) / 2 / rate

    log.info("tts %d chars -> %dms for %.2fs audio", len(text), elapsed, duration)

    return Response(
        content=pcm,
        media_type="application/octet-stream",
        headers={
            "X-Sample-Rate": str(rate),
            "X-Duration-Ms": str(int(duration * 1000)),
            "X-Generate-Ms": str(elapsed),
        },
    )


@app.get("/voices")
def voices() -> JSONResponse:
    """Lets /talk offer a voice picker without hardcoding the list in the bot."""
    try:
        return JSONResponse({"voices": sorted(_tts.get_voices())})
    except Exception:  # noqa: BLE001
        return JSONResponse({"voices": [DEFAULT_VOICE]})


@app.post("/tts.wav")
async def tts_wav(request: Request) -> Response:
    """A WAV-wrapped variant, for listening to a voice while choosing one."""
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="no text")

    samples, rate = _tts.create(
        text, voice=body.get("voice") or DEFAULT_VOICE, speed=float(body.get("speed") or 1.0), lang="en-us"
    )

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(_float_to_pcm16(np.asarray(samples, dtype=np.float32)))

    return Response(content=buffer.getvalue(), media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
