// ─────────────────────────────────────────────────────────────────────────────
//  MARV — Realtime AI Video Transform
//  Powered by fal.ai decart/lucy-realtime-2/realtime
// ─────────────────────────────────────────────────────────────────────────────

// ── MSGPACK (full encoder + decoder for fal.ai binary protocol) ───────────────
const Msgpack = (() => {
  const _enc = new TextEncoder();
  const _dec = new TextDecoder();

  // ── ENCODER ──────────────────────────────────────────────────────────────────
  function _val(v, bufs) {
    if (v === null || v === undefined) {
      bufs.push(new Uint8Array([0xc0]));
    } else if (typeof v === 'boolean') {
      bufs.push(new Uint8Array([v ? 0xc3 : 0xc2]));
    } else if (typeof v === 'number') {
      if (Number.isInteger(v) && v >= 0 && v <= 127) {
        bufs.push(new Uint8Array([v]));
      } else if (Number.isInteger(v) && v >= -32 && v < 0) {
        bufs.push(new Uint8Array([v & 0xff]));
      } else if (Number.isInteger(v) && v >= 0 && v <= 0xff) {
        bufs.push(new Uint8Array([0xcc, v]));
      } else if (Number.isInteger(v) && v >= 0 && v <= 0xffff) {
        bufs.push(new Uint8Array([0xcd, (v >> 8) & 0xff, v & 0xff]));
      } else if (Number.isInteger(v) && v >= 0 && v <= 0xffffffff) {
        const b = new Uint8Array(5); b[0] = 0xce;
        new DataView(b.buffer).setUint32(1, v, false); bufs.push(b);
      } else {
        const b = new Uint8Array(9); b[0] = 0xcb;
        new DataView(b.buffer).setFloat64(1, v, false); bufs.push(b);
      }
    } else if (typeof v === 'string') {
      const bytes = _enc.encode(v), n = bytes.length;
      if      (n <= 31)     bufs.push(new Uint8Array([0xa0 | n]));
      else if (n <= 0xff)   bufs.push(new Uint8Array([0xd9, n]));
      else if (n <= 0xffff) bufs.push(new Uint8Array([0xda, (n >> 8) & 0xff, n & 0xff]));
      else { const h = new Uint8Array(5); h[0] = 0xdb; new DataView(h.buffer).setUint32(1, n, false); bufs.push(h); }
      bufs.push(bytes);
    } else if (Array.isArray(v)) {
      const n = v.length;
      if      (n <= 15)     bufs.push(new Uint8Array([0x90 | n]));
      else if (n <= 0xffff) bufs.push(new Uint8Array([0xdc, (n >> 8) & 0xff, n & 0xff]));
      else { const h = new Uint8Array(5); h[0] = 0xdd; new DataView(h.buffer).setUint32(1, n, false); bufs.push(h); }
      for (const item of v) _val(item, bufs);
    } else if (typeof v === 'object') {
      const keys = Object.keys(v), n = keys.length;
      if      (n <= 15)     bufs.push(new Uint8Array([0x80 | n]));
      else if (n <= 0xffff) bufs.push(new Uint8Array([0xde, (n >> 8) & 0xff, n & 0xff]));
      else { const h = new Uint8Array(5); h[0] = 0xdf; new DataView(h.buffer).setUint32(1, n, false); bufs.push(h); }
      for (const k of keys) { _val(k, bufs); _val(v[k], bufs); }
    }
  }

  function encode(obj) {
    const bufs = [];
    _val(obj, bufs);
    const out = new Uint8Array(bufs.reduce((n, b) => n + b.length, 0));
    let off = 0;
    for (const b of bufs) { out.set(b, off); off += b.length; }
    return out;
  }

  // ── DECODER ──────────────────────────────────────────────────────────────────
  function decode(data) {
    try {
      // First try: plain JSON text (for simple server messages like timings)
      if (typeof data === 'string') return JSON.parse(data);

      const buf   = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      const bytes = new Uint8Array(buf);
      const dv    = new DataView(buf);

      // Quick check: if it starts with '{' or '[' it's JSON-in-binary
      if (bytes[0] === 0x7b || bytes[0] === 0x5b) {
        try { return JSON.parse(_dec.decode(bytes)); } catch(_) {}
      }

      let pos = 0;

      function readVal() {
        const b = bytes[pos++];
        if (b <= 0x7f) return b;                                  // positive fixint
        if (b >= 0xe0) return b - 256;                            // negative fixint
        if ((b & 0xf0) === 0x80) return readMap(b & 0x0f);       // fixmap
        if ((b & 0xf0) === 0x90) return readArr(b & 0x0f);       // fixarray
        if ((b & 0xe0) === 0xa0) return readStr(b & 0x1f);       // fixstr
        switch (b) {
          case 0xc0: return null;
          case 0xc2: return false;
          case 0xc3: return true;
          case 0xc4: return readBin(bytes[pos++]);                                                            // bin8
          case 0xc5: { const n=(bytes[pos++]<<8)|bytes[pos++]; return readBin(n); }                          // bin16
          case 0xc6: { const n=dv.getUint32(pos,false); pos+=4; return readBin(n); }                         // bin32
          case 0xca: { const v=dv.getFloat32(pos,false); pos+=4; return v; }                                 // float32
          case 0xcb: { const v=dv.getFloat64(pos,false); pos+=8; return v; }                                 // float64
          case 0xcc: return bytes[pos++];                                                                     // uint8
          case 0xcd: { const v=(bytes[pos++]<<8)|bytes[pos++]; return v; }                                   // uint16
          case 0xce: { const v=dv.getUint32(pos,false); pos+=4; return v; }                                  // uint32
          case 0xcf: { const h=dv.getUint32(pos,false); pos+=4; const l=dv.getUint32(pos,false); pos+=4; return h*0x100000000+l; } // uint64
          case 0xd0: { const v=bytes[pos++]; return v>127?v-256:v; }                                         // int8
          case 0xd1: { const v=(bytes[pos++]<<8)|bytes[pos++]; return v>32767?v-65536:v; }                   // int16
          case 0xd2: { const v=dv.getInt32(pos,false); pos+=4; return v; }                                   // int32
          case 0xd9: return readStr(bytes[pos++]);                                                            // str8
          case 0xda: { const n=(bytes[pos++]<<8)|bytes[pos++]; return readStr(n); }                          // str16
          case 0xdb: { const n=dv.getUint32(pos,false); pos+=4; return readStr(n); }                         // str32
          case 0xdc: { const n=(bytes[pos++]<<8)|bytes[pos++]; return readArr(n); }                          // array16
          case 0xdd: { const n=dv.getUint32(pos,false); pos+=4; return readArr(n); }                         // array32
          case 0xde: { const n=(bytes[pos++]<<8)|bytes[pos++]; return readMap(n); }                          // map16
          case 0xdf: { const n=dv.getUint32(pos,false); pos+=4; return readMap(n); }                         // map32
          default: return null;
        }
      }
      function readStr(n) { const s=_dec.decode(bytes.subarray(pos,pos+n)); pos+=n; return s; }
      function readBin(n) { const s=bytes.slice(pos,pos+n); pos+=n; return s; }
      function readArr(n) { const a=[]; for(let i=0;i<n;i++) a.push(readVal()); return a; }
      function readMap(n) { const o={}; for(let i=0;i<n;i++){const k=readVal();o[k]=readVal();} return o; }

      return readVal();
    } catch(e) { return null; }
  }

  return { encode, decode };
})();

// ── DOM REFS ──────────────────────────────────────────────────────────────────
const inputVideo        = document.getElementById("input-video");
const outputVideo       = document.getElementById("output-video");
const inputPlaceholder  = document.getElementById("input-placeholder");
const outputPlaceholder = document.getElementById("output-placeholder");
const statusBadge       = document.getElementById("status-badge");
const statusText        = document.getElementById("status-text");
const promptInput       = document.getElementById("prompt-input");
const presetBtns        = document.querySelectorAll(".preset-btn");
const uploadZone        = document.getElementById("upload-zone");
const imageUpload       = document.getElementById("image-upload");
const imagePreviewWrap  = document.getElementById("image-preview-wrap");
const imagePreview      = document.getElementById("image-preview");
const removeImageBtn    = document.getElementById("remove-image");
const applyBtn          = document.getElementById("apply-btn");
const startBtn          = document.getElementById("start-btn");
const stopBtn           = document.getElementById("stop-btn");
const billingCounter    = document.getElementById("billing-counter");
const billingSecs       = document.getElementById("billing-secs");
const toast             = document.getElementById("toast");
const fmtLaptopBtn      = document.getElementById("fmt-laptop");
const fmtMobileBtn      = document.getElementById("fmt-mobile");
const coinChip          = document.getElementById("coin-chip");
const coinBalance       = document.getElementById("coin-balance");
const coinBalanceMain   = document.getElementById("coin-balance-main");
const coinBarFill       = document.getElementById("coin-bar-fill");
const coinWarning       = document.getElementById("coin-warning");
const drainModeLabel    = document.getElementById("drain-mode-label");
const buyCoinBtn        = document.getElementById("buy-coins-btn");
const voiceGrid         = document.getElementById("voice-grid");

// ── STATE ─────────────────────────────────────────────────────────────────────
let falWs           = null;
let localStream     = null;
let referenceFile   = null;
let referenceBase64 = null;
let isConnected     = false;
let settingsApplied = false;
let outputTab       = null;
let selectedFormat  = window.__forcedFormat || "laptop";
let currentEmail    = null;
let drainInterval   = null;
let drainRates      = { video: 1.0, video_voice: 1.1 };
let balance         = 0;
let activeVoiceId   = null;

// Frame capture (replaces WebRTC)
let captureCanvas  = null;
let captureCtx     = null;
let outputCanvas   = null;
let outputCtx      = null;
let frameLoopId    = null;
let frameInFlight  = false;

// ── BROADCAST CHANNEL ─────────────────────────────────────────────────────────
const channel = new BroadcastChannel("lucy_stream");

// ── TOAST ─────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, green = false, duration = 4500) {
  toast.textContent = msg;
  toast.className   = "show" + (green ? " green" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), duration);
}

// ── STATUS ────────────────────────────────────────────────────────────────────
function setStatus(label, mode = "") {
  statusText.textContent = label;
  statusBadge.className  = "";
  if (mode) statusBadge.classList.add(mode);
}

// ── FORMAT BUTTONS ────────────────────────────────────────────────────────────
fmtLaptopBtn?.addEventListener("click", () => {
  selectedFormat = "laptop";
  fmtLaptopBtn.classList.add("active");
  fmtMobileBtn.classList.remove("active");
});
fmtMobileBtn?.addEventListener("click", () => {
  selectedFormat = "mobile";
  fmtMobileBtn.classList.add("active");
  fmtLaptopBtn.classList.remove("active");
});

// ── PRESETS ───────────────────────────────────────────────────────────────────
presetBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    presetBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    promptInput.value = btn.dataset.prompt;
  });
});

// ── IMAGE UPLOAD ──────────────────────────────────────────────────────────────
uploadZone.addEventListener("dragover", e => { e.preventDefault(); uploadZone.classList.add("drag-over"); });
uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("drag-over"));
uploadZone.addEventListener("drop", e => {
  e.preventDefault(); uploadZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0]; if (file) handleImageFile(file);
});
imageUpload.addEventListener("change", () => { if (imageUpload.files[0]) handleImageFile(imageUpload.files[0]); });

const enhanceToggle = document.getElementById("enhance-toggle");

function handleImageFile(file) {
  if (!file.type.startsWith("image/")) { showToast("⚠ Invalid file type."); return; }
  if (file.size > 10 * 1024 * 1024)   { showToast("⚠ Image too large (max 10MB)."); return; }
  const maxSize = enhanceToggle?.checked ? 1024 : 768;
  const quality = enhanceToggle?.checked ? 0.95 : 0.88;
  compressImage(file, maxSize, quality).then(compressed => {
    referenceFile = compressed;
    imagePreview.src = URL.createObjectURL(compressed);
    imagePreviewWrap.style.display = "block";
    uploadZone.style.display = "none";
    settingsApplied = false;
    fileToBase64(compressed).then(b64 => { referenceBase64 = b64; });
  });
}

// Re-compress reference when enhance toggle changes
enhanceToggle?.addEventListener("change", () => {
  if (referenceFile) handleImageFile(referenceFile);
});

function compressImage(file, maxSize = 1024, quality = 0.95) {
  return new Promise(resolve => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width, h = img.height;
      if (w > h && w > maxSize) { h = h * maxSize / w; w = maxSize; }
      else if (h > maxSize)     { w = w * maxSize / h; h = maxSize; }
      canvas.width = Math.round(w); canvas.height = Math.round(h);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => resolve(blob || file), "image/jpeg", quality);
    };
    img.onerror = () => resolve(file);
    img.src = url;
  });
}

removeImageBtn.addEventListener("click", () => {
  referenceFile = null; referenceBase64 = null; imagePreview.src = "";
  imagePreviewWrap.style.display = "none"; uploadZone.style.display = "block";
  imageUpload.value = ""; settingsApplied = false;
});

// ── APPLY SETTINGS ────────────────────────────────────────────────────────────
applyBtn.addEventListener("click", async () => {
  if (!falWs) return;
  applyBtn.textContent = "⟳ Applying…"; applyBtn.disabled = true; settingsApplied = false;
  try {
    await applySettings();
    applyBtn.textContent = "✓ Applied!";
    setTimeout(() => { applyBtn.textContent = "⟳ Apply Settings"; applyBtn.disabled = false; }, 1800);
  } catch (err) {
    showToast("⚠ Failed: " + (err.message || err));
    applyBtn.textContent = "⟳ Apply Settings"; applyBtn.disabled = false;
  }
});

async function applySettings() {
  // Settings (prompt + reference image) are sent with every frame automatically.
  // Calling this re-enables reference image sending on the next frame.
  settingsApplied = false;
  if (referenceFile && !referenceBase64) {
    referenceBase64 = await fileToBase64(referenceFile);
  }
}

function fileToBase64(file) {
  return new Promise(resolve => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
}

// ── SEND VIA WEBSOCKET ────────────────────────────────────────────────────────
function wsSend(obj) {
  if (!falWs || falWs.readyState !== WebSocket.OPEN) return;
  falWs.send(Msgpack.encode(obj)); // fal.ai requires binary msgpack frames
}

// ── COIN SYSTEM ───────────────────────────────────────────────────────────────
async function fetchBalance() {
  if (!currentEmail) return;
  try {
    const res  = await fetch("/api/coins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "balance", email: currentEmail }) });
    const data = await res.json();
    balance = data.balance || 0;
    updateCoinUI();
  } catch(e) {}
}

async function fetchDrainRates() {
  try {
    const res  = await fetch("/api/coins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "get_rates" }) });
    const data = await res.json();
    drainRates = data.rates || drainRates;
  } catch(e) {}
}

function updateCoinUI() {
  const bal = Math.floor(balance);
  // Header chip
  if (coinBalance) coinBalance.textContent = bal;
  if (coinChip) { coinChip.style.display = "flex"; coinChip.classList.toggle("low", balance < 100); }
  // Main card balance
  if (coinBalanceMain) coinBalanceMain.textContent = bal;
  // Progress bar (100% = 5000 coins)
  if (coinBarFill) {
    const pct = Math.min(100, (balance / 5000) * 100);
    coinBarFill.style.width = pct + "%";
    coinBarFill.className = "coin-bar-fill" + (pct < 10 ? " low" : pct < 30 ? " mid" : "");
  }
  // Low-balance warning
  if (coinWarning) coinWarning.style.display = balance < 100 ? "flex" : "none";
  // Mode label
  if (drainModeLabel) drainModeLabel.textContent = activeVoiceId ? "Video + Voice" : "Video Only";
}

function startDrain() {
  stopDrain();
  let secs = 0;
  drainInterval = setInterval(async () => {
    secs++; billingSecs.textContent = secs;
    if (secs % 5 === 0) {
      try {
        const res  = await fetch("/api/coins", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "drain", email: currentEmail, mode: activeVoiceId ? "video_voice" : "video", seconds: 5 }),
        });
        const data = await res.json();
        balance = data.balance ?? balance;
        updateCoinUI();
        if (balance <= 0) { showToast("⚠ Out of coins! Stream stopped."); stopStream(); }
      } catch(e) {}
    }
  }, 1000);
}

function stopDrain() { clearInterval(drainInterval); drainInterval = null; }

// ── VOICE SYSTEM ──────────────────────────────────────────────────────────────
let availableVoices = [];
let activeAudio     = null;

async function loadVoices(email) {
  if (!email || !voiceGrid) return;
  voiceGrid.innerHTML = '<div class="voice-empty">Loading voices…</div>';
  try {
    const res  = await fetch("/api/voices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list_for_user", email }) });
    const data = await res.json();
    availableVoices = data.voices || [];
    renderVoiceGrid();
  } catch(e) {
    if (voiceGrid) voiceGrid.innerHTML = '<div class="voice-empty">Could not load voices.</div>';
  }
}

function renderVoiceGrid() {
  if (!voiceGrid) return;
  if (!availableVoices.length) {
    voiceGrid.innerHTML = '<div class="voice-empty">No voice models available yet.</div>';
    return;
  }
  voiceGrid.innerHTML = availableVoices.map(v => `
    <div class="voice-row" id="vr-${v.id}">
      <div class="voice-row-info">
        <span class="voice-row-icon">🎙</span>
        <span class="voice-row-name">${v.name}</span>
        <span class="voice-row-badge">${v.global ? 'GLOBAL' : 'PRIVATE'}</span>
      </div>
      <div class="voice-row-btns">
        ${v.sampleUrl ? `<button class="voice-play-btn" data-voice-id="${v.id}" data-sample-url="${v.sampleUrl}">▶ Preview</button>` : ''}
        <button class="voice-use-btn ${activeVoiceId === v.id ? 'active' : ''}" data-voice-id="${v.id}" data-pth-url="${v.pthUrl}" data-index-url="${v.indexUrl}">
          ${activeVoiceId === v.id ? '✓ Active' : 'Use Voice'}
        </button>
      </div>
    </div>
  `).join('');

  // Preview buttons
  voiceGrid.querySelectorAll('.voice-play-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.sampleUrl;
      if (activeAudio) {
        activeAudio.pause(); activeAudio = null;
        voiceGrid.querySelectorAll('.voice-play-btn.playing').forEach(b => { b.textContent = '▶ Preview'; b.classList.remove('playing'); });
      }
      if (btn.classList.contains('playing')) return;
      activeAudio = new Audio(url);
      activeAudio.play().catch(() => showToast("⚠ Could not play sample."));
      btn.textContent = '■ Stop'; btn.classList.add('playing');
      activeAudio.onended = () => { btn.textContent = '▶ Preview'; btn.classList.remove('playing'); activeAudio = null; };
    });
  });

  // Use voice buttons
  voiceGrid.querySelectorAll('.voice-use-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id       = btn.dataset.voiceId;
      const pthUrl   = btn.dataset.pthUrl;
      const indexUrl = btn.dataset.indexUrl;
      if (activeVoiceId === id) { window.deactivateVoice(); }
      else                      { window.activateVoice(id, pthUrl, indexUrl); }
    });
  });
}

window.activateVoice = async function(voiceId, pthUrl, indexUrl) {
  activeVoiceId = voiceId;
  updateCoinUI();
  voiceGrid?.querySelectorAll('.voice-use-btn').forEach(b => { b.textContent = 'Use Voice'; b.classList.remove('active'); });
  const btn = voiceGrid?.querySelector(`#vr-${voiceId} .voice-use-btn`);
  if (btn) { btn.textContent = '✓ Active'; btn.classList.add('active'); }
  const el = document.getElementById("voice-status");
  if (el) { el.textContent = "⟳ Loading voice model…"; el.className = "warming"; }
  try {
    const res  = await fetch("/api/rvc-proxy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "load_model", voice_id: voiceId, pth_url: pthUrl, index_url: indexUrl }) });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (el) { el.textContent = "● Voice active"; el.className = "active"; }
  } catch(e) {
    if (el) { el.textContent = "⚠ " + (e.message || "Voice failed"); el.className = "error"; }
    activeVoiceId = null; updateCoinUI();
    voiceGrid?.querySelectorAll('.voice-use-btn').forEach(b => { b.textContent = 'Use Voice'; b.classList.remove('active'); });
  }
};

window.deactivateVoice = function() {
  activeVoiceId = null;
  updateCoinUI();
  voiceGrid?.querySelectorAll('.voice-use-btn').forEach(b => { b.textContent = 'Use Voice'; b.classList.remove('active'); });
  const el = document.getElementById("voice-status");
  if (el) { el.textContent = ""; el.className = ""; }
};

// ── OUTPUT TAB ────────────────────────────────────────────────────────────────
function openOutputTab() {
  outputTab = window.open("output.html?format=" + selectedFormat, "lucy_output");
}

function injectStream(stream) {
  outputVideo.srcObject = stream;
  outputPlaceholder.style.display = "none";
  outputVideo.style.display       = "block";
  window.lucyOutputStream = stream;
  channel.postMessage({ type: "stream_ready" });
}

// ── FRAME CAPTURE & DISPLAY ───────────────────────────────────────────────────
function setupOutputStream() {
  outputCanvas = document.createElement("canvas");
  outputCanvas.width  = 512;
  outputCanvas.height = 512;
  outputCtx = outputCanvas.getContext("2d");
  outputCtx.fillStyle = "#111";
  outputCtx.fillRect(0, 0, 512, 512);
  const stream = outputCanvas.captureStream(30);
  injectStream(stream);
}

function displayOutputFrame(bytes) {
  // Forward raw JPEG to output.html via BroadcastChannel (drawn there directly on canvas)
  channel.postMessage({ type: "frame", data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });

  // Also draw to the main-page output video via captureStream canvas
  if (!outputCtx) return;
  const ctx    = outputCtx;
  const canvas = outputCanvas;
  const blob = new Blob([bytes], { type: "image/jpeg" });
  createImageBitmap(blob).then(bitmap => {
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
  }).catch(e => console.warn("frame draw error:", e));
}

function startFrameLoop() {
  captureCanvas = document.createElement("canvas");
  // Size to match model output aspect ratio (1088×624, 16:9) — use video native dims if available
  const capW = inputVideo.videoWidth  || 1088;
  const capH = inputVideo.videoHeight || 624;
  // cap at 1088×624 to avoid oversized payloads
  const scale = Math.min(1088 / capW, 624 / capH, 1);
  captureCanvas.width  = Math.round(capW * scale);
  captureCanvas.height = Math.round(capH * scale);
  captureCtx = captureCanvas.getContext("2d");
  frameInFlight = false;

  function loop() {
    if (!falWs || falWs.readyState !== WebSocket.OPEN) return;
    if (!frameInFlight && inputVideo.videoWidth > 0) {
      // Resize capture canvas to actual video dimensions on first real frame
      if (captureCanvas.width !== inputVideo.videoWidth || captureCanvas.height !== inputVideo.videoHeight) {
        const s = Math.min(1088 / inputVideo.videoWidth, 624 / inputVideo.videoHeight, 1);
        captureCanvas.width  = Math.round(inputVideo.videoWidth  * s);
        captureCanvas.height = Math.round(inputVideo.videoHeight * s);
      }
      captureCtx.drawImage(inputVideo, 0, 0, captureCanvas.width, captureCanvas.height);
      const imageUrl = captureCanvas.toDataURL("image/jpeg", 0.88);
      const prompt = promptInput.value.trim() ||
        "Transform my face and body realistically with enhanced lighting and clarity. Keep all objects and background unchanged.";
      const payload = { prompt, image_url: imageUrl };
      if (referenceBase64) {
        payload.reference_image_url = referenceBase64;
      }
      wsSend(payload);
      frameInFlight = true;
    }
    frameLoopId = requestAnimationFrame(loop);
  }
  frameLoopId = requestAnimationFrame(loop);
}

function stopFrameLoop(keepOutput = false) {
  if (frameLoopId) { cancelAnimationFrame(frameLoopId); frameLoopId = null; }
  frameInFlight = false;
  captureCanvas = null; captureCtx = null;
  if (!keepOutput) { outputCanvas = null; outputCtx = null; }
}

// ── FAL.AI MESSAGE HANDLER ────────────────────────────────────────────────────
async function handleFalMessage(data) {
  if (!data || typeof data !== "object") return;

  // Extract image bytes from any response shape fal.ai might use
  const raw0     = data?.images?.[0];
  const imgBytes = (raw0?.content instanceof Uint8Array) ? raw0.content
    : (raw0 instanceof Uint8Array)                        ? raw0
    : (data?.image instanceof Uint8Array)                 ? data.image
    : null;
  const imgStrUrl = raw0?.content?.url || raw0?.url || data?.image?.url
    || data?.output?.url || data?.result?.url
    || (typeof raw0 === "string" ? raw0 : null);

  if (imgBytes || imgStrUrl) {
    frameInFlight = false;
    if (imgBytes) {
      displayOutputFrame(imgBytes);
    } else {
      const img = new Image();
      img.onload = () => outputCtx && outputCtx.drawImage(img, 0, 0, outputCanvas.width, outputCanvas.height);
      img.src = imgStrUrl;
    }
    if (!isConnected) {
      isConnected = true;
      console.log("Going LIVE");
      setStatus("LIVE", "live");
      stopBtn.disabled  = false;
      applyBtn.disabled = false;
      billingCounter.style.display = "block";
      startDrain();
    }
    return;
  }

  // fal.ai system messages
  if (data.type === "x-fal-message") {
    if (data.action === "timings") {
      frameInFlight = false; // server acknowledged, ready for next frame
    } else {
      console.log("fal.ai x-fal-message:", data.action, JSON.stringify(data));
      frameInFlight = false;
    }
    return;
  }

  // Errors
  if (data.type === "x-fal-error" || data.type === "error" || data.status === "error") {
    console.error("fal.ai error:", data.error || data.message, data.reason || "");
    showToast("⚠ Stream error: " + (data.error || data.message || "Unknown"));
    frameInFlight = false;
    return;
  }

  // Unknown — log fully for debugging
  console.log("fal.ai msg:", JSON.stringify(data));
  frameInFlight = false;
}

// ── START STREAM ──────────────────────────────────────────────────────────────
startBtn.addEventListener("click", startStream);
stopBtn.addEventListener("click",  () => stopStream());

async function startStream() {
  if (!currentEmail) { showToast("⚠ Please log in first."); return; }

  await fetchBalance();
  if (balance <= 0) {
    showToast("⚠ No coins. Please top up.");
    openBuyModal();
    return;
  }

  startBtn.disabled = true;
  stopBtn.disabled  = false;
  setStatus("STARTING…", "connecting");
  settingsApplied   = false;
  openOutputTab();

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { frameRate: { ideal: 30, min: 24 }, width: { ideal: 1920, min: 1280 }, height: { ideal: 1080, min: 720 }, facingMode: "user" },
      audio: false,
    }).catch(err => {
      if (err.name === "NotAllowedError") throw new Error("Camera access denied.");
      if (err.name === "NotFoundError")   throw new Error("No camera found.");
      throw err;
    });

    inputVideo.srcObject = localStream;
    inputPlaceholder.style.display = "none";
    inputVideo.style.display       = "block";
    setStatus("CONNECTING…", "connecting");

    // Get short-lived JWT from our server (verifies coins, returns fal.ai token)
    const tokenRes  = await fetch("/api/decart-token", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email: currentEmail }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(tokenData.error);
    balance = tokenData.balance ?? balance;
    updateCoinUI();

    const falToken = tokenData.falToken;
    if (!falToken) throw new Error("Failed to get fal.ai token. Please try again.");

    const wsUrl = `wss://fal.run/decart/lucy-realtime-2/realtime?fal_jwt_token=${encodeURIComponent(falToken)}`;
    falWs = new WebSocket(wsUrl);
    falWs.binaryType = "arraybuffer";
    falWs.onopen = () => {
      console.log("fal.ai WebSocket connected — starting frame capture…");
      setupOutputStream();
      startFrameLoop();
      setStatus("CONNECTING…", "connecting");
    };
    attachFalWsHandlers(falWs);

  } catch (err) {
    console.error("Start error:", err);
    showToast("⚠ " + (err.message || "Failed to start stream."));
    setStatus("ERROR", "error");
    startBtn.disabled = false;
    stopStream(true);
  }
}

function attachFalWsHandlers(ws) {
  ws.onmessage = async (event) => {
    const raw  = event.data;
    const data = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch(_) { return null; } })() : Msgpack.decode(raw);
    if (data) {
      const keys = Object.keys(data);
      console.log("fal.ai decoded keys:", keys, "| sample:", JSON.stringify(data, (k,v) => v instanceof Uint8Array ? `<Uint8Array len=${v.length}>` : v).slice(0, 300));
      await handleFalMessage(data);
    } else {
      console.log("fal.ai decode failed, raw size:", typeof raw === "string" ? raw.length : raw.byteLength, "first byte:", new Uint8Array(raw instanceof ArrayBuffer ? raw : raw.buffer)[0]?.toString(16));
    }
  };

  ws.onerror = () => {
    showToast("⚠ Connection error. Please try again.");
    startBtn.disabled = false;
    setStatus("ERROR", "error");
  };

  ws.onclose = (evt) => {
    console.log("WebSocket closed:", evt.code, evt.reason);
    if (isConnected && evt.code === 1000) {
      console.log("WS normal close — auto-reconnecting…");
      reconnectFalWs();
    } else if (isConnected) {
      handleDisconnect();
    } else {
      startBtn.disabled = false;
      setStatus("IDLE", "");
    }
  };
}

async function reconnectFalWs() {
  setStatus("RECONNECTING…", "connecting");
  stopFrameLoop(true);   // keep outputCanvas/outputCtx alive
  if (falWs) { try { falWs.close(); } catch(_) {} falWs = null; }

  try {
    const tokenRes  = await fetch("/api/decart-token", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email: currentEmail }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error || !tokenData.falToken) throw new Error("Token refresh failed");
    balance = tokenData.balance ?? balance;
    updateCoinUI();

    const wsUrl = `wss://fal.run/decart/lucy-realtime-2/realtime?fal_jwt_token=${encodeURIComponent(tokenData.falToken)}`;
    falWs = new WebSocket(wsUrl);
    falWs.binaryType = "arraybuffer";
    falWs.onopen = () => {
      console.log("fal.ai WebSocket reconnected");
      startFrameLoop();
      setStatus("LIVE", "live");
    };
    attachFalWsHandlers(falWs);
  } catch(err) {
    console.error("Reconnect error:", err);
    handleDisconnect();
  }
}

function handleDisconnect() {
  if (isConnected) {
    isConnected = false;
    stopStream(true);
    showToast("⚠ Stream disconnected. Click Start to reconnect.");
  }
}

// ── STOP STREAM ───────────────────────────────────────────────────────────────
function stopStream(silent = false) {
  stopFrameLoop();
  if (falWs)       { try { falWs.close();    } catch(_) {} falWs = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }

  stopDrain();
  channel.postMessage({ type: "stream_stopped" });
  window.lucyOutputStream = null;

  try { if (outputTab && !outputTab.closed) { outputTab.close(); outputTab = null; } } catch(e) {}

  inputVideo.srcObject  = null;
  outputVideo.srcObject = null;
  inputVideo.style.display  = "none";
  outputVideo.style.display = "none";
  inputPlaceholder.style.display  = "";
  outputPlaceholder.style.display = "";
  billingCounter.style.display    = "none";
  isConnected       = false;
  settingsApplied   = false;
  startBtn.disabled = false;
  stopBtn.disabled  = true;
  applyBtn.disabled = true;
  setStatus("IDLE", "");
  if (!silent) showToast("✓ Stream stopped.", true);
}

// ── KEYBOARD Q ────────────────────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if ((e.key === "q" || e.key === "Q") &&
      document.activeElement?.tagName !== "INPUT" &&
      document.activeElement?.tagName !== "TEXTAREA") {
    if (isConnected) stopStream();
  }
});

// ── BUY COINS MODAL ───────────────────────────────────────────────────────────
let selectedPackage  = null;
let availablePackages = [];
let currentNetwork   = "trc20";
let walletAddresses  = {};

function openBuyModal() {
  document.getElementById("buy-coins-modal").classList.add("open");
  loadPackages();
}

function closeBuyModal() {
  document.getElementById("buy-coins-modal").classList.remove("open");
  selectedPackage = null;
  document.getElementById("pay-section").style.display = "none";
  document.getElementById("tx-hash-input").value = "";
}

async function loadPackages() {
  const grid = document.getElementById("packages-grid");
  if (!grid) return;
  grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);font-family:\'Space Mono\',monospace;font-size:0.7rem;padding:20px">Loading packages…</div>';
  try {
    const res  = await fetch("/api/coin-packages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list" }) });
    const data = await res.json();
    availablePackages = data.packages || [];
    if (!availablePackages.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);font-family:\'Space Mono\',monospace;font-size:0.7rem;padding:20px">No packages available yet.</div>';
      return;
    }
    grid.innerHTML = availablePackages.map(p => `
      <div class="pkg-card" data-pkg-id="${p.id}">
        ${p.popular ? '<div class="pkg-badge">POPULAR</div>' : ''}
        <div class="pkg-label">${p.name}</div>
        <div class="pkg-coins">${p.coins.toLocaleString()}</div>
        <div class="pkg-label" style="font-size:0.5rem;margin-bottom:8px">COINS</div>
        <div class="pkg-naira">₦${p.priceNaira.toLocaleString()}</div>
        ${p.priceUsd ? `<div class="pkg-usd">~$${p.priceUsd.toFixed(2)}</div>` : ''}
      </div>
    `).join('');

    grid.querySelectorAll('.pkg-card').forEach(card => {
      card.addEventListener('click', () => {
        selectedPackage = availablePackages.find(p => p.id === card.dataset.pkgId);
        grid.querySelectorAll('.pkg-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        document.getElementById("pay-section").style.display = "block";
        loadWallets();
        updatePaymentDisplay();
      });
    });
  } catch(e) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);font-family:\'Space Mono\',monospace;font-size:0.7rem;padding:20px">Failed to load packages.</div>';
  }
}

async function loadWallets() {
  try {
    const res  = await fetch("/api/crypto-payment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "get_wallets" }) });
    const data = await res.json();
    walletAddresses = data.wallets || {};
    updatePaymentDisplay();
  } catch(e) {}
}

function updatePaymentDisplay() {
  if (!selectedPackage) return;
  const addr   = walletAddresses[currentNetwork] || "Not configured — contact admin";
  const amount = currentNetwork === "btc"
    ? `≈ $${selectedPackage.priceUsd?.toFixed(2) || "?"} in BTC`
    : `$${selectedPackage.priceUsd?.toFixed(2) || "?"} USDT`;
  const addrEl   = document.getElementById("wallet-addr");
  const amountEl = document.getElementById("wallet-amount");
  if (addrEl)   addrEl.textContent   = addr;
  if (amountEl) amountEl.textContent = amount;
}

// Network tab switching
document.querySelectorAll('.net-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.net-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentNetwork = tab.dataset.net;
    updatePaymentDisplay();
  });
});

// Copy wallet address
document.getElementById("copy-addr-btn")?.addEventListener("click", () => {
  const addr = document.getElementById("wallet-addr")?.textContent || "";
  navigator.clipboard.writeText(addr)
    .then(() => showToast("✓ Address copied!", true))
    .catch(() => showToast("⚠ Copy failed — please copy manually."));
});

// Verify crypto payment
document.getElementById("verify-btn")?.addEventListener("click", async () => {
  if (!currentEmail)    { showToast("⚠ Please log in first."); return; }
  if (!selectedPackage) { showToast("⚠ Please select a package first."); return; }
  const txHash = document.getElementById("tx-hash-input")?.value.trim();
  if (!txHash) { showToast("⚠ Please paste your transaction hash."); return; }

  const btn = document.getElementById("verify-btn");
  btn.disabled = true; btn.textContent = "Verifying…";
  try {
    const res  = await fetch("/api/crypto-payment", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verify", txHash, network: currentNetwork, email: currentEmail, packageId: selectedPackage.id }),
    });
    const data = await res.json();
    if (data.ok) {
      balance = data.newBalance || balance;
      updateCoinUI();
      showToast(`✓ Payment verified! ${data.coins.toLocaleString()} coins added.`, true, 6000);
      closeBuyModal();
    } else {
      showToast("⚠ " + (data.error || "Verification failed. Please try again."));
    }
  } catch(e) {
    showToast("⚠ Network error. Please try again.");
  } finally {
    btn.disabled = false; btn.textContent = "Verify Payment";
  }
});

// Close buy modal
document.getElementById("close-buy-modal")?.addEventListener("click", closeBuyModal);
document.getElementById("buy-coins-modal")?.addEventListener("click", e => { if (e.target === e.currentTarget) closeBuyModal(); });

// ── VOICE REQUEST MODAL ───────────────────────────────────────────────────────
document.getElementById("request-voice-btn")?.addEventListener("click", () => {
  if (!currentEmail) { showToast("⚠ Please log in first."); return; }
  document.getElementById("voice-request-modal").classList.add("open");
});

document.getElementById("close-voice-modal")?.addEventListener("click", () => {
  document.getElementById("voice-request-modal").classList.remove("open");
});

document.getElementById("voice-request-modal")?.addEventListener("click", e => {
  if (e.target === e.currentTarget) document.getElementById("voice-request-modal").classList.remove("open");
});

document.getElementById("submit-voice-request")?.addEventListener("click", async () => {
  if (!currentEmail) { showToast("⚠ Please log in first."); return; }
  const voiceName = document.getElementById("req-voice-name")?.value.trim();
  const audioUrl  = document.getElementById("req-audio-url")?.value.trim();
  const notes     = document.getElementById("req-notes")?.value.trim();
  if (!voiceName) { showToast("⚠ Please enter a voice name."); return; }
  if (!audioUrl)  { showToast("⚠ Please provide your audio sample URL."); return; }

  const btn = document.getElementById("submit-voice-request");
  btn.disabled = true; btn.textContent = "Submitting…";
  try {
    const res  = await fetch("/api/voice-request", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit", email: currentEmail, voiceName, audioUrl, notes }),
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`✓ Request submitted! Training fee: ₦${(data.trainingFeeNaira || 5000).toLocaleString()}`, true, 7000);
      document.getElementById("voice-request-modal").classList.remove("open");
      document.getElementById("req-voice-name").value = "";
      document.getElementById("req-audio-url").value  = "";
      document.getElementById("req-notes").value      = "";
    } else {
      showToast("⚠ " + (data.error || "Submission failed."));
    }
  } catch(e) {
    showToast("⚠ Network error. Please try again.");
  } finally {
    btn.disabled = false; btn.textContent = "Submit & Pay Training Fee";
  }
});

// ── SESSION ───────────────────────────────────────────────────────────────────
window.addEventListener("marv:logged-in", async (e) => {
  currentEmail = e.detail?.email;
  if (!currentEmail) return;
  await fetchDrainRates();
  await fetchBalance();
  await loadVoices(currentEmail);
});

(function checkExistingSession() {
  const session = JSON.parse(localStorage.getItem("marv_session") || "null");
  if (session?.email) {
    currentEmail = session.email;
    fetchDrainRates()
      .then(() => fetchBalance())
      .then(() => loadVoices(currentEmail));
  }
})();

// ── COIN MODAL TRIGGERS ────────────────────────────────────────────────────────
coinChip?.addEventListener("click",   openBuyModal);
buyCoinBtn?.addEventListener("click", openBuyModal);

// ── INITIAL STATE ─────────────────────────────────────────────────────────────
inputVideo.style.display  = "none";
outputVideo.style.display = "none";
stopBtn.disabled  = true;
applyBtn.disabled = true;
