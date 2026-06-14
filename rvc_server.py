#!/usr/bin/env python3
"""
MARV RVC Server - Run from inside the rvc folder:
  cd "voice n video/rvc"
  python "../rvc_server.py"
"""

import asyncio, io, json, logging, os, shutil, sys, time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

# RVC must be the working directory when this script runs
RVC_PATH    = Path(os.getcwd())
WEIGHTS_DIR = RVC_PATH / "weights"
WEIGHTS_DIR.mkdir(exist_ok=True)

# Old models folder (we'll check here too)
OLD_MODELS  = RVC_PATH.parent / "models"
OLD_MODELS.mkdir(exist_ok=True)

# ── Download required RVC assets on startup ───────────────────
def ensure_assets():
    hubert_path = RVC_PATH / "assets" / "hubert" / "hubert_base.pt"
    rmvpe_path  = RVC_PATH / "assets" / "rmvpe" / "rmvpe.pt"

    # Multiple mirror sources in case one fails
    assets = [
        (hubert_path, [
            "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/hubert_base.pt",
            "https://hf-mirror.com/lj1995/VoiceConversionWebUI/resolve/main/hubert_base.pt",
        ]),
        (rmvpe_path, [
            "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/rmvpe.pt",
            "https://hf-mirror.com/lj1995/VoiceConversionWebUI/resolve/main/rmvpe.pt",
        ]),
    ]

    import requests
    headers = {"User-Agent": "Mozilla/5.0"}
    for path, urls in assets:
        if path.exists():
            log.info(f"   Asset exists: {path.name}")
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        downloaded = False
        for url in urls:
            try:
                log.info(f"   Downloading {path.name} from {url[:40]}...")
                r = requests.get(url, headers=headers, stream=True, timeout=600)
                r.raise_for_status()
                with open(str(path), "wb") as f:
                    for chunk in r.iter_content(chunk_size=65536):
                        f.write(chunk)
                log.info(f"   Downloaded: {path.name}")
                downloaded = True
                break
            except Exception as e:
                log.warning(f"   Failed from {url[:40]}: {e}")
                if path.exists(): path.unlink()
        if not downloaded:
            log.error(f"   Could not download {path.name} — voice conversion may fail")

sys.path.insert(0, str(RVC_PATH))

HOST        = os.getenv("RVC_HOST", "0.0.0.0")
PORT        = int(os.getenv("RVC_SERVER_PORT", "7865"))
SAMPLE_RATE = 40000
CHUNK_SECS  = 0.5

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s")
log = logging.getLogger("marv-rvc")

app = FastAPI(title="MARV RVC Server", version="4.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

loaded_models = {}


def ensure_in_weights(voice_id: str, pth_url: str, index_url: str):
    """Download or move model files into rvc/weights/ where RVC expects them."""
    pth_name   = f"{voice_id}.pth"
    index_name = f"{voice_id}.index"
    pth_dest   = WEIGHTS_DIR / pth_name
    index_dest = WEIGHTS_DIR / index_name

    for dest, name, url, old_ext in [
        (pth_dest,   pth_name,   pth_url,   "pth"),
        (index_dest, index_name, index_url, "index"),
    ]:
        if dest.exists():
            log.info(f"   Already in weights: {name}")
            continue

        # Check old models folder first
        old_path = OLD_MODELS / name
        if old_path.exists():
            log.info(f"   Moving {name} from models/ to weights/")
            shutil.copy2(str(old_path), str(dest))
            continue

        # Download from R2
        import requests
        log.info(f"   Downloading {name} from R2...")
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        r = requests.get(url, headers=headers, stream=True, timeout=120)
        r.raise_for_status()
        with open(str(dest), "wb") as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)
        log.info(f"   Downloaded {name}")

    return str(pth_dest), str(index_dest)


class RVCPipeline:
    def __init__(self, pth_name: str, index_path: str):
        self.pth_name   = pth_name   # just filename e.g. "voice_123.pth"
        self.index_path = index_path # full path to index file
        self.vc         = None
        self._load()

    def _load(self):
        from configs.config import Config
        from infer.modules.vc.modules import VC
        # RVC uses environment variables for paths
        os.environ["weight_root"] = str(WEIGHTS_DIR)
        os.environ["index_root"]  = str(WEIGHTS_DIR)
        config  = Config()
        self.vc = VC(config)
        self.vc.get_vc(self.pth_name)
        log.info(f"✅ Loaded: {self.pth_name}")

    def convert(self, audio_bytes: bytes, f0_up_key: int = 0) -> bytes:
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(audio_bytes)
            in_path = f.name
        out_path = in_path.replace(".wav", "_out.wav")
        try:
            _, wav_opt = self.vc.vc_single(
                sid=0, input_audio_path=in_path,
                f0_up_key=f0_up_key, f0_file=None,
                f0_method="rmvpe",
                file_index=self.index_path, file_index2="",
                index_rate=0.75, filter_radius=3,
                resample_sr=0, rms_mix_rate=0.25, protect=0.33,
            )
            sf.write(out_path, wav_opt, SAMPLE_RATE)
            with open(out_path, "rb") as f:
                return f.read()
        finally:
            try: os.unlink(in_path)
            except: pass
            try: os.unlink(out_path)
            except: pass


@app.get("/health")
async def health():
    return {"status": "ok", "loaded_models": list(loaded_models.keys()),
            "device": "cuda" if torch.cuda.is_available() else "cpu"}


@app.post("/load-model")
async def load_model(body: dict):
    voice_id  = body.get("voice_id")
    pth_url   = body.get("pth_url")
    index_url = body.get("index_url")
    if not all([voice_id, pth_url, index_url]):
        return {"error": "voice_id, pth_url, index_url required"}
    if voice_id in loaded_models:
        return {"status": "already_loaded", "voice_id": voice_id}
    try:
        pth_dest, index_dest = ensure_in_weights(voice_id, pth_url, index_url)
        pth_name  = Path(pth_dest).name
        pipeline  = RVCPipeline(pth_name, index_dest)
        loaded_models[voice_id] = {"pipeline": pipeline, "loaded_at": time.time()}
        return {"status": "loaded", "voice_id": voice_id}
    except Exception as e:
        log.error(f"load-model error: {e}")
        return {"error": str(e)}


@app.post("/unload-model")
async def unload_model(body: dict):
    voice_id = body.get("voice_id")
    if voice_id in loaded_models:
        del loaded_models[voice_id]
        if torch.cuda.is_available(): torch.cuda.empty_cache()
    return {"status": "unloaded"}


@app.websocket("/convert")
async def websocket_convert(ws: WebSocket):
    await ws.accept()
    voice_id = None
    log.info("🔌 WebSocket connected")
    try:
        config    = json.loads(await ws.receive_text())
        voice_id  = config.get("voice_id")
        f0_up_key = int(config.get("f0_up_key", 0))
        if not voice_id or voice_id not in loaded_models:
            await ws.send_text(json.dumps({"error": f"Model '{voice_id}' not loaded"}))
            await ws.close(); return
        pipeline = loaded_models[voice_id]["pipeline"]
        await ws.send_text(json.dumps({"status": "ready", "voice_id": voice_id}))
        log.info(f"🎤 Streaming: {voice_id}")
        audio_buffer = bytearray()
        CHUNK_BYTES  = int(SAMPLE_RATE * CHUNK_SECS * 2)
        while True:
            data = await ws.receive_bytes()
            audio_buffer.extend(data)
            if len(audio_buffer) >= CHUNK_BYTES:
                chunk        = bytes(audio_buffer[:CHUNK_BYTES])
                audio_buffer = audio_buffer[CHUNK_BYTES:]
                try:
                    audio_np = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0
                    wav_io   = io.BytesIO()
                    sf.write(wav_io, audio_np, SAMPLE_RATE, format="WAV", subtype="PCM_16")
                    converted = await asyncio.get_event_loop().run_in_executor(
                        None, pipeline.convert, wav_io.getvalue(), f0_up_key)
                    await ws.send_bytes(converted)
                except Exception as e:
                    log.error(f"Conversion error: {e}")
    except WebSocketDisconnect:
        log.info(f"🔌 Disconnected ({voice_id})")
    except Exception as e:
        log.error(f"WS error: {e}")
        try: await ws.send_text(json.dumps({"error": str(e)}))
        except: pass


if __name__ == "__main__":
    log.info(f"🚀 MARV RVC Server v4 on {HOST}:{PORT}")
    log.info("   Checking required assets...")
    ensure_assets()
    log.info(f"   CUDA: {torch.cuda.is_available()}")
    log.info(f"   RVC:  {RVC_PATH}")
    log.info(f"   Weights: {WEIGHTS_DIR}")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
