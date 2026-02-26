/* ─── SONIQ Audio Visualizer — app.js ──────────────────────── */

const canvas      = document.getElementById('visualizer');
const ctx         = canvas.getContext('2d');
const fileInput   = document.getElementById('fileInput');
const playBtn     = document.getElementById('playBtn');
const playIcon    = document.getElementById('playIcon');
const progressEl  = document.getElementById('progress');
const volumeEl    = document.getElementById('volume');
const currentTimeEl = document.getElementById('currentTime');
const durationEl  = document.getElementById('duration');
const fileNameEl  = document.getElementById('fileName');
const idleMsg     = document.getElementById('idleMsg');
const canvasWrapper = document.getElementById('canvasWrapper');
const modeBtns    = document.querySelectorAll('.mode-btn');
const colorBtns   = document.querySelectorAll('.color-btn');

// ─── State ────────────────────────────────────────────────────
let audioCtx, analyser, source, gainNode;
let audioBuffer = null;
let isPlaying   = false;
let startTime   = 0;
let pauseOffset = 0;
let animId      = null;
let mode        = 'bars';

const palettes = {
  neon: ['#00ffe0', '#7b2fff', '#00b4d8'],
  fire: ['#ff6a00', '#ee0979', '#ff9a3c'],
  ice:  ['#74ebd5', '#acb6e5', '#a8edea'],
  gold: ['#ffd200', '#f7971e', '#ffe259'],
};
let currentPalette = palettes.neon;

// ─── Canvas Resize ────────────────────────────────────────────
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const W = canvasWrapper.clientWidth;
  const H = canvasWrapper.clientHeight;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ─── Audio Setup ─────────────────────────────────────────────
function setupAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser  = audioCtx.createAnalyser();
    gainNode  = audioCtx.createGain();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;
    gainNode.connect(audioCtx.destination);
    analyser.connect(gainNode);
  }
}

// ─── File Loading ─────────────────────────────────────────────
fileInput.addEventListener('change', e => loadFile(e.target.files[0]));

function loadFile(file) {
  if (!file || !file.type.startsWith('audio/')) return;
  setupAudio();
  stopAudio();
  fileNameEl.textContent = file.name.length > 22
    ? file.name.slice(0, 20) + '…'
    : file.name;

  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      audioBuffer = await audioCtx.decodeAudioData(ev.target.result);
      durationEl.textContent  = formatTime(audioBuffer.duration);
      progressEl.value        = 0;
      currentTimeEl.textContent = '0:00';
      playBtn.disabled        = false;
      idleMsg.classList.add('hidden');
      playAudio();
    } catch { alert('Could not decode audio file.'); }
  };
  reader.readAsArrayBuffer(file);
}

// ─── Playback ─────────────────────────────────────────────────
function playAudio(offset = 0) {
  if (!audioBuffer) return;
  stopSource();
  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(analyser);
  source.start(0, offset);
  source.onended = () => {
    if (isPlaying) {
      isPlaying   = false;
      pauseOffset = 0;
      progressEl.value = 0;
      currentTimeEl.textContent = '0:00';
      setPlayIcon(false);
    }
  };
  startTime   = audioCtx.currentTime - offset;
  isPlaying   = true;
  setPlayIcon(true);
  if (!animId) renderLoop();
}

function stopSource() {
  if (source) {
    source.onended = null;
    try { source.stop(); } catch {}
    source.disconnect();
    source = null;
  }
}

function stopAudio() {
  stopSource();
  isPlaying   = false;
  pauseOffset = 0;
  setPlayIcon(false);
}

playBtn.addEventListener('click', () => {
  if (!audioBuffer) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  if (isPlaying) {
    pauseOffset = audioCtx.currentTime - startTime;
    stopSource();
    isPlaying = false;
    setPlayIcon(false);
  } else {
    playAudio(pauseOffset);
  }
});

function setPlayIcon(playing) {
  playIcon.innerHTML = playing
    ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
    : '<polygon points="5 3 19 12 5 21 5 3"/>';
}

// ─── Progress & Volume ────────────────────────────────────────
progressEl.addEventListener('input', () => {
  if (!audioBuffer) return;
  const t = (progressEl.value / 100) * audioBuffer.duration;
  pauseOffset = t;
  if (isPlaying) playAudio(t);
  currentTimeEl.textContent = formatTime(t);
});

volumeEl.addEventListener('input', () => {
  if (gainNode) gainNode.gain.value = volumeEl.value / 100;
});

function updateProgress() {
  if (!audioBuffer || !isPlaying) return;
  const elapsed = audioCtx.currentTime - startTime;
  const pct     = Math.min((elapsed / audioBuffer.duration) * 100, 100);
  progressEl.value          = pct;
  currentTimeEl.textContent = formatTime(elapsed);
}

function formatTime(s) {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ─── Mode & Color Buttons ─────────────────────────────────────
modeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    modeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    mode = btn.dataset.mode;
  });
});

colorBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    colorBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentPalette = palettes[btn.dataset.color];
  });
});

// ─── Drag & Drop ──────────────────────────────────────────────
canvasWrapper.addEventListener('dragover', e => {
  e.preventDefault();
  canvasWrapper.classList.add('drag-over');
});
canvasWrapper.addEventListener('dragleave', () => canvasWrapper.classList.remove('drag-over'));
canvasWrapper.addEventListener('drop', e => {
  e.preventDefault();
  canvasWrapper.classList.remove('drag-over');
  loadFile(e.dataTransfer.files[0]);
});
canvasWrapper.addEventListener('click', () => fileInput.click());

// ─── Gradient Helper ─────────────────────────────────────────
function makeLinearGrad(x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  currentPalette.forEach((c, i) =>
    g.addColorStop(i / (currentPalette.length - 1), c)
  );
  return g;
}

// ─── Visualizer Draw Functions ────────────────────────────────
function drawBars(data) {
  const W = canvasWrapper.clientWidth, H = canvasWrapper.clientHeight;
  const count  = Math.floor(W / 7);
  const sliceW = W / count;
  const grad   = makeLinearGrad(0, H, 0, 0);

  for (let i = 0; i < count; i++) {
    const v    = data[Math.floor(i * data.length / count)] / 255;
    const barH = v * H * 0.92;
    const x    = i * sliceW + sliceW * 0.15;
    const w    = sliceW * 0.7;

    ctx.fillStyle = grad;
    ctx.fillRect(x, H - barH, w, barH);

    // reflection
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillRect(x, H + 2, w, barH * 0.35);
    ctx.restore();
  }
}

function drawWave(data) {
  const W = canvasWrapper.clientWidth, H = canvasWrapper.clientHeight;
  const grad = makeLinearGrad(0, 0, W, 0);
  ctx.strokeStyle = grad;
  ctx.lineWidth   = 2.5;
  ctx.shadowBlur  = 12 * devicePixelRatio;
  ctx.shadowColor = currentPalette[0];
  ctx.beginPath();

  const sliceW = W / data.length;
  let x = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 128.0;
    const y = (v * H) / 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    x += sliceW;
  }
  ctx.lineTo(W, H / 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawRadial(data) {
  const W = canvasWrapper.clientWidth, H = canvasWrapper.clientHeight;
  const cx = W / 2, cy = H / 2;
  const baseR = Math.min(W, H) * 0.18;
  const maxR  = Math.min(W, H) * 0.42;
  const count = 180;

  for (let i = 0; i < count; i++) {
    const v      = data[Math.floor(i * data.length / count)] / 255;
    const angle  = (i / count) * Math.PI * 2 - Math.PI / 2;
    const r      = baseR + v * (maxR - baseR);
    const t      = i / count;

    // interpolate color across palette
    const pIdx   = t * (currentPalette.length - 1);
    const pLow   = Math.floor(pIdx);
    const pHigh  = Math.min(pLow + 1, currentPalette.length - 1);
    const frac   = pIdx - pLow;
    const c1     = hexToRgb(currentPalette[pLow]);
    const c2     = hexToRgb(currentPalette[pHigh]);
    const rc     = Math.round(c1.r + (c2.r - c1.r) * frac);
    const gc     = Math.round(c1.g + (c2.g - c1.g) * frac);
    const bc     = Math.round(c1.b + (c2.b - c1.b) * frac);

    ctx.strokeStyle = `rgba(${rc},${gc},${bc},${0.5 + v * 0.5})`;
    ctx.lineWidth   = (1 + v * 3);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * baseR, cy + Math.sin(angle) * baseR);
    ctx.lineTo(cx + Math.cos(angle) * r,     cy + Math.sin(angle) * r);
    ctx.stroke();
  }

  // center circle
  const avg = [...data.slice(0, 64)].reduce((s, v) => s + v, 0) / 64 / 255;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * (0.7 + avg * 0.3));
  grad.addColorStop(0, currentPalette[0] + '66');
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
  ctx.fill();
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

// ─── Idle Animation ───────────────────────────────────────────
let idleT = 0;
function drawIdle() {
  const W = canvasWrapper.clientWidth, H = canvasWrapper.clientHeight;
  idleT += 0.015;
  const count  = Math.floor(W / 7);
  const sliceW = W / count;
  const grad   = makeLinearGrad(0, H, 0, 0);

  for (let i = 0; i < count; i++) {
    const v    = (Math.sin(i * 0.18 + idleT) * 0.5 + 0.5) * 0.12;
    const barH = v * H;
    const x    = i * sliceW + sliceW * 0.15;
    const w    = sliceW * 0.7;
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(x, H - barH, w, barH);
  }
  ctx.globalAlpha = 1;
}

// ─── Render Loop ─────────────────────────────────────────────
function renderLoop() {
  animId = requestAnimationFrame(renderLoop);
  const W = canvasWrapper.clientWidth, H = canvasWrapper.clientHeight;
  ctx.clearRect(0, 0, W, H);

  if (!analyser || !isPlaying) {
    drawIdle();
    return;
  }

  updateProgress();

  let data;
  if (mode === 'wave') {
    data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
  } else {
    data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
  }

  if      (mode === 'bars')   drawBars(data);
  else if (mode === 'wave')   drawWave(data);
  else if (mode === 'circle') drawRadial(data);
}

// Start idle animation immediately
renderLoop();