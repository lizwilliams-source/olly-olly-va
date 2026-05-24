import os, uuid, time, tempfile, asyncio, threading
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import faster_whisper

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

SECRET_KEY = os.environ.get("WHISPER_SECRET_KEY", "")
MODEL_SIZE = os.environ.get("WHISPER_MODEL", "large-v3-turbo")

print(f"Loading Whisper model: {MODEL_SIZE} ...")
model = faster_whisper.WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
print("Model ready.")

jobs = {}
executor = ThreadPoolExecutor(max_workers=1)  # one transcription at a time

def check_auth(request: Request):
    if SECRET_KEY and request.headers.get("Authorization") != f"Bearer {SECRET_KEY}":
        raise HTTPException(status_code=401, detail="Unauthorized")

def run_transcription(job_id: str, audio_bytes: bytes):
    start = time.time()
    with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as f:
        f.write(audio_bytes)
        tmp = f.name
    try:
        segments, _ = model.transcribe(tmp, beam_size=5)
        transcript = " ".join(s.text.strip() for s in segments)
        jobs[job_id] = {"status": "done", "transcript": transcript, "elapsed": round(time.time() - start)}
    except Exception as e:
        jobs[job_id] = {"status": "error", "error": str(e)}
    finally:
        os.unlink(tmp)

def cleanup_loop():
    while True:
        time.sleep(3600)
        cutoff = time.time() - 3600
        for jid in [k for k, v in jobs.items() if v.get("created_at", cutoff + 1) < cutoff]:
            jobs.pop(jid, None)

threading.Thread(target=cleanup_loop, daemon=True).start()

@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL_SIZE}

@app.post("/transcribe")
async def transcribe(request: Request):
    check_auth(request)
    audio_bytes = await request.body()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="No audio data")
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "processing", "created_at": time.time()}
    loop = asyncio.get_event_loop()
    loop.run_in_executor(executor, run_transcription, job_id, audio_bytes)
    return JSONResponse({"job_id": job_id})

@app.get("/status/{job_id}")
async def status(job_id: str, request: Request):
    check_auth(request)
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return JSONResponse(job)
