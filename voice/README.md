# Voice service

Speech recognition and speech synthesis for `/talk`, running **on the Mac
itself** rather than in a container.

That is not a preference. Docker Desktop on macOS provides no Metal
passthrough — the Hypervisor framework has no virtual GPU — so a containerised
model runs CPU-only and throws away most of the machine. The bot reaches this
over `host.docker.internal:8931`.

## Running it

```
npm run voice:install
```

Once. After that it starts at login, restarts if it crashes, and you never
think about it again — `/zenitsu` and `/talk` just work.

The runtime is installed to `~/Library/Application Support/zenitsubot-voice`
rather than run from the repo, and that is not tidiness. macOS protects
`~/Downloads`, `~/Documents` and `~/Desktop` with TCC, and a LaunchAgent gets
"Operation not permitted" trying to read any of them. Application Support is
not protected. Re-run the installer after changing `server.py`.

A cold start takes about a minute while the models load and warm; the bot
reports the service as still starting until then.

```
npm run voice:log       # tail the log
```

## What it runs, and why

| | model | size | measured on this M2 |
| --- | --- | --- | --- |
| Speech to text | `parakeet-tdt_ctc-110m` | 437MB | ~40-350ms per utterance |
| Text to speech | Kokoro 82M via ONNX + CoreML | 325MB | ~600ms for a short sentence |

The obvious choice for STT is `parakeet-tdt-0.6b-v3`, and it was the wrong one
on 8GB: at 2.3GB it paged in and out between requests, and transcription
degraded from 900ms to 22 seconds over five turns as swap grew past 6GB. The
110m model is a twentieth of the latency at a fifth of the size, with identical
transcriptions on every phrase tested. It is English-only, which is the
tradeoff — set `STT_MODEL` to go back to the multilingual one if that matters
more than speed.

## Things that cost an afternoon to learn

**Warming with silence does nothing.** Silence transcribes to an empty string,
so the decoder loop never runs and never compiles. A server warmed on silence
still stalled 14 seconds on its first real utterance.

**Compilation is per decode length, not per model.** One warm phrase warms one
path: latency fell 17s, 3.9s, 2.4s, 1.0s across four different sentences before
settling. `WARM_PHRASES` is deliberately varied in length for this reason.

**Idle models go cold.** After about fifteen minutes the first request went
back to 21 seconds. `_keep_warm_loop` runs a trivial inference every minute.

**The keep-warm caused the stall it was meant to prevent.** MLX and the Metal
command queue do not tolerate concurrent use; a background pass overlapping a
live request turned a 200ms transcription into a nineteen second one. Every
inference now takes `_model_lock`, and the keep-warm skips rather than waits.

## Configuration

| Variable | Default |
| --- | --- |
| `VOICE_PORT` | `8931` |
| `VOICE_HOST` | `127.0.0.1` — set `0.0.0.0` for Docker to reach it |
| `STT_MODEL` | `mlx-community/parakeet-tdt_ctc-110m` |
| `VOICE_NAME` | `af_heart` |
| `KEEP_WARM_SECONDS` | `60` |

The bot finds it via `VOICE_SERVICE_URL`, already set in `docker-compose.yml`.

## Endpoints

- `POST /stt?rate=48000` — raw signed 16-bit mono PCM in, `{text, seconds, ms}` out
- `POST /tts` — `{text, voice, speed}` in, raw PCM out with the rate in `X-Sample-Rate`
- `POST /tts.wav` — same, WAV-wrapped, for auditioning a voice
- `POST /warm` — warms on demand; `/talk` calls this while joining
- `GET /voices` — voice names, so the bot's picker is never stale
- `GET /health`
