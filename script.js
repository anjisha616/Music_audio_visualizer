/* ─── SONIQ Audio Visualizer — app.js ──────────────────────── */

// ─── DOM References ───────────────────────────────────────────
const canvas        = document.getElementById('visualizer');
const ctx           = canvas.getContext('2d');
const fileInput     = document.getElementById('fileInput');
const playBtn       = document.getElementById('playBtn');
const playIcon      = document.getElementById('playIcon');
const progressEl    = document.getElementById('progress');
const volumeEl      = document.getElementById('volume');
const currentTimeEl = document.getElementById('currentTime');
const durationEl    = document.getElementById('duration');
const fileNameEl    = document.getElementById('fileName');
const idleMsg       = document.getElementById('idleMsg');
const canvasWrapper = document.getElementById('canvasWrapper');
const modeBtns      = document.querySelectorAll('.mode-btn');
const colorBtns     = document.querySelectorAll('.color-btn');
const btnFull       = document.getElementById('viewFull');
const btnStems      = document.getElementById('viewStems');
const fullView      = document.getElementById('fullView');
const stemViewEl    = document.getElementById('stemView');
const vizControls   = document.getElementById('vizControls');

// ─── Stems ────────────────────────────────────────────────────
// Row 1: Drum kit broken into actual drum components
// Row 2: Melodic instruments
const STEMS = ['kick', 'snare', 'hats', 'bass', 'guitar', 'vocals'];

const stemCtx   = {};
const stemMeter = {};
STEMS.forEach(name => {
  stemCtx[name]   = document.getElementById(`canvas-${name}`).getContext('2d');
  stemMeter[name] = document.getElementById(`meter-${name}`);
});

// ─── State ────────────────────────────────────────────────────
let audioCtx, analyser, source, gainNode;
let audioBuffer = null;
let isPlaying   = false;
let startTime   = 0;
let pauseOffset = 0;
let animId      = null;
let mode        = 'bars';
let currentView = 'full';

// ─── Frequency Band Definitions ───────────────────────────────
// Kick: fundamental thud lives 40–150 Hz (below bass guitar)
// Snare/Toms: body and crack 150–600 Hz
// Hi-hats/Cymbals: the sizzle 6 kHz–18 kHz
// Bass instrument: sustained 80–300 Hz (overlaps kick, but energy is sustained not transient)
// Guitar/Keys: melodic mids 300 Hz–5 kHz
// Vocals: speech formants 300 Hz–3 kHz (overlap with guitar, but centered differently)

const BAND_DEFS = {
  kick:   { lo: 40,   hi: 150  },
  snare:  { lo: 150,  hi: 600  },
  hats:   { lo: 6000, hi: 18000},
  bass:   { lo: 80,   hi: 300  },
  guitar: { lo: 300,  hi: 5000 },
  vocals: { lo: 300,  hi: 3000 },
};
const STEM_CONFIG = {
  kick:   { color: '#ff4500' },
  snare:  { color: '#ff2d6f' },
  hats:   { color: '#ffe259' },
  bass:   { color: '#ff8c00' },
  guitar: { color: '#00e5ff' },
  vocals: { color: '#b44fff' },
};

// Smoothed energy + previous frame for transient detection
const stemEnergy = {};
const stemEnergyPrev = {};
STEMS.forEach(s => { stemEnergy[s] = 0; stemEnergyPrev[s] = 0; });

// Ring buffer for history trails (used by kick, snare)
const HIST_LEN = 400;
const stemHistory = {};
STEMS.forEach(s => { stemHistory[s] = new Float32Array(HIST_LEN); stemHistory[s].ptr = 0; });

function pushHistory(name, val) {
  stemHistory[name][stemHistory[name].ptr] = val;
  stemHistory[name].ptr = (stemHistory[name].ptr + 1) % HIST_LEN;
}

function getHistory(name, len) {
  const h = stemHistory[name];
  const out = [];
  const start = (h.ptr - len + HIST_LEN) % HIST_LEN;
  for (let i = 0; i < len; i++) out.push(h[(start + i) % HIST_LEN]);
  return out;
}

// ─── Palettes ─────────────────────────────────────────────────
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
  const W = canvasWrapper.clientWidth, H = canvasWrapper.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(1,0,0,1,0,0); ctx.scale(dpr, dpr);
}

function resizeStemCanvases() {
  const dpr = window.devicePixelRatio || 1;
  STEMS.forEach(name => {
    const c = document.getElementById(`canvas-${name}`);
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    c.width = W * dpr; c.height = H * dpr;
    c.style.width = W + 'px'; c.style.height = H + 'px';
    stemCtx[name].setTransform(1,0,0,1,0,0);
    stemCtx[name].scale(dpr, dpr);
  });
}

resizeCanvas();
window.addEventListener('resize', () => { resizeCanvas(); resizeStemCanvases(); });

// ─── View Toggle ─────────────────────────────────────────────
btnFull.addEventListener('click',  () => switchView('full'));
btnStems.addEventListener('click', () => switchView('stems'));

function switchView(v) {
  currentView = v;
  if (v === 'full') {
    fullView.classList.add('active');    stemViewEl.classList.remove('active');
    btnFull.classList.add('active');     btnStems.classList.remove('active');
    vizControls.style.display = '';
  } else {
    stemViewEl.classList.add('active');  fullView.classList.remove('active');
    btnStems.classList.add('active');    btnFull.classList.remove('active');
    vizControls.style.display = 'none';
    setTimeout(resizeStemCanvases, 40);
  }
}

// ─── Audio Setup ─────────────────────────────────────────────
function setupAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser  = audioCtx.createAnalyser();
    gainNode  = audioCtx.createGain();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.78;
    gainNode.connect(audioCtx.destination);
    analyser.connect(gainNode);
  }
}

// ─── Frequency Helpers ────────────────────────────────────────
function freqToBin(freq) {
  return Math.round((freq / (audioCtx.sampleRate / 2)) * analyser.frequencyBinCount);
}

function getBandEnergy(data, loHz, hiHz) {
  const lo = Math.max(0, freqToBin(loHz));
  const hi = Math.min(data.length - 1, freqToBin(hiHz));
  if (hi <= lo) return 0;
  let sum = 0;
  for (let i = lo; i <= hi; i++) sum += data[i];
  return sum / ((hi - lo + 1) * 255);
}

function getBandSlice(data, loHz, hiHz) {
  const lo = Math.max(0, freqToBin(loHz));
  const hi = Math.min(data.length - 1, freqToBin(hiHz));
  return data.slice(lo, hi + 1);
}

// ─── File Loading ─────────────────────────────────────────────
fileInput.addEventListener('change', e => loadFile(e.target.files[0]));

function loadFile(file) {
  if (!file || !file.type.startsWith('audio/')) return;
  setupAudio(); stopAudio();
  fileNameEl.textContent = file.name.length > 22 ? file.name.slice(0,20)+'…' : file.name;
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      audioBuffer = await audioCtx.decodeAudioData(ev.target.result);
      durationEl.textContent = formatTime(audioBuffer.duration);
      progressEl.value = 0; currentTimeEl.textContent = '0:00';
      playBtn.disabled = false; idleMsg.classList.add('hidden');
      resizeStemCanvases(); playAudio();
    } catch { alert('Could not decode audio file.'); }
  };
  reader.readAsArrayBuffer(file);
}

// ─── Playback ─────────────────────────────────────────────────
function playAudio(offset = 0) {
  if (!audioBuffer) return;
  stopSource();
  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer; source.connect(analyser);
  source.start(0, offset);
  source.onended = () => {
    if (isPlaying) { isPlaying = false; pauseOffset = 0; progressEl.value = 0; currentTimeEl.textContent = '0:00'; setPlayIcon(false); }
  };
  startTime = audioCtx.currentTime - offset;
  isPlaying = true; setPlayIcon(true);
  if (!animId) renderLoop();
}

function stopSource() {
  if (source) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); source = null; }
}
function stopAudio() { stopSource(); isPlaying = false; pauseOffset = 0; setPlayIcon(false); }

playBtn.addEventListener('click', () => {
  if (!audioBuffer) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  if (isPlaying) { pauseOffset = audioCtx.currentTime - startTime; stopSource(); isPlaying = false; setPlayIcon(false); }
  else playAudio(pauseOffset);
});

function setPlayIcon(p) {
  playIcon.innerHTML = p
    ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
    : '<polygon points="5 3 19 12 5 21 5 3"/>';
}

progressEl.addEventListener('input', () => {
  if (!audioBuffer) return;
  const t = (progressEl.value / 100) * audioBuffer.duration;
  pauseOffset = t; if (isPlaying) playAudio(t);
  currentTimeEl.textContent = formatTime(t);
});
volumeEl.addEventListener('input', () => { if (gainNode) gainNode.gain.value = volumeEl.value / 100; });

function updateProgress() {
  if (!audioBuffer || !isPlaying) return;
  const elapsed = audioCtx.currentTime - startTime;
  progressEl.value = Math.min((elapsed / audioBuffer.duration) * 100, 100);
  currentTimeEl.textContent = formatTime(elapsed);
}
function formatTime(s) { s = Math.max(0, Math.floor(s)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }

// ─── Mode & Color ────────────────────────────────────────────
modeBtns.forEach(btn => { btn.addEventListener('click', () => { modeBtns.forEach(b=>b.classList.remove('active')); btn.classList.add('active'); mode = btn.dataset.mode; }); });
colorBtns.forEach(btn => { btn.addEventListener('click', () => { colorBtns.forEach(b=>b.classList.remove('active')); btn.classList.add('active'); currentPalette = palettes[btn.dataset.color]; }); });

// ─── Drag & Drop ─────────────────────────────────────────────
canvasWrapper.addEventListener('dragover', e => { e.preventDefault(); canvasWrapper.classList.add('drag-over'); });
canvasWrapper.addEventListener('dragleave', () => canvasWrapper.classList.remove('drag-over'));
canvasWrapper.addEventListener('drop', e => { e.preventDefault(); canvasWrapper.classList.remove('drag-over'); loadFile(e.dataTransfer.files[0]); });
canvasWrapper.addEventListener('click', () => fileInput.click());

// ─── Full View Helpers ────────────────────────────────────────
function makeGrad(c, x0,y0,x1,y1) {
  const g = c.createLinearGradient(x0,y0,x1,y1);
  currentPalette.forEach((col,i) => g.addColorStop(i/(currentPalette.length-1), col));
  return g;
}
function hexToRgb(hex) { return { r:parseInt(hex.slice(1,3),16), g:parseInt(hex.slice(3,5),16), b:parseInt(hex.slice(5,7),16) }; }

function drawBars(data) {
  const W=canvasWrapper.clientWidth, H=canvasWrapper.clientHeight;
  const count=Math.floor(W/7), sliceW=W/count, grad=makeGrad(ctx,0,H,0,0);
  for (let i=0;i<count;i++) {
    const v=data[Math.floor(i*data.length/count)]/255, barH=v*H*0.92;
    const x=i*sliceW+sliceW*0.15, w=sliceW*0.7;
    ctx.fillStyle=grad; ctx.fillRect(x,H-barH,w,barH);
    ctx.save(); ctx.globalAlpha=0.12; ctx.fillRect(x,H+2,w,barH*0.3); ctx.restore();
  }
}

function drawWave(data) {
  const W=canvasWrapper.clientWidth, H=canvasWrapper.clientHeight;
  ctx.strokeStyle=makeGrad(ctx,0,0,W,0); ctx.lineWidth=2.5;
  ctx.shadowBlur=12; ctx.shadowColor=currentPalette[0]; ctx.beginPath();
  const sw=W/data.length; let x=0;
  for (let i=0;i<data.length;i++) { const y=(data[i]/128)*H/2; i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); x+=sw; }
  ctx.lineTo(W,H/2); ctx.stroke(); ctx.shadowBlur=0;
}

function drawRadial(data) {
  const W=canvasWrapper.clientWidth, H=canvasWrapper.clientHeight;
  const cx=W/2, cy=H/2, baseR=Math.min(W,H)*0.18, maxR=Math.min(W,H)*0.42, count=180;
  for (let i=0;i<count;i++) {
    const v=data[Math.floor(i*data.length/count)]/255;
    const angle=(i/count)*Math.PI*2-Math.PI/2, r=baseR+v*(maxR-baseR), t=i/count;
    const pIdx=t*(currentPalette.length-1), pL=Math.floor(pIdx), pH=Math.min(pL+1,currentPalette.length-1);
    const f=pIdx-pL, c1=hexToRgb(currentPalette[pL]), c2=hexToRgb(currentPalette[pH]);
    ctx.strokeStyle=`rgba(${Math.round(c1.r+(c2.r-c1.r)*f)},${Math.round(c1.g+(c2.g-c1.g)*f)},${Math.round(c1.b+(c2.b-c1.b)*f)},${0.5+v*0.5})`;
    ctx.lineWidth=1+v*3; ctx.beginPath();
    ctx.moveTo(cx+Math.cos(angle)*baseR, cy+Math.sin(angle)*baseR);
    ctx.lineTo(cx+Math.cos(angle)*r, cy+Math.sin(angle)*r); ctx.stroke();
  }
  const avg=[...data.slice(0,64)].reduce((s,v)=>s+v,0)/64/255;
  const g=ctx.createRadialGradient(cx,cy,0,cx,cy,baseR*(0.7+avg*0.3));
  g.addColorStop(0,currentPalette[0]+'66'); g.addColorStop(1,'transparent');
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,baseR,0,Math.PI*2); ctx.fill();
}

let idleT = 0;
function drawIdle() {
  const W=canvasWrapper.clientWidth, H=canvasWrapper.clientHeight; idleT+=0.015;
  const count=Math.floor(W/7), sliceW=W/count, grad=makeGrad(ctx,0,H,0,0);
  for (let i=0;i<count;i++) {
    const v=(Math.sin(i*0.18+idleT)*0.5+0.5)*0.12, barH=v*H;
    ctx.fillStyle=grad; ctx.globalAlpha=0.25;
    ctx.fillRect(i*sliceW+sliceW*0.15, H-barH, sliceW*0.7, barH);
  }
  ctx.globalAlpha=1;
}

// ─────────────────────────────────────────────────────────────
//  STEM DRAW FUNCTIONS
// ─────────────────────────────────────────────────────────────

// ── KICK DRUM ─────────────────────────────────────────────────
// Shows a big concentric shockwave ring on each transient hit,
// plus a running energy bar across the bottom.
function drawKick(sc, band, energy, delta) {
  const c = document.getElementById('canvas-kick');
  const W = c.clientWidth, H = c.clientHeight;

  // Slow fade for persistence
  sc.fillStyle = 'rgba(8,10,15,0.4)'; sc.fillRect(0,0,W,H);

  // Shockwave rings on transient
  if (delta > 0.05) {
    const rings = 3;
    for (let r = 0; r < rings; r++) {
      const radius = delta * (80 + r * 45) * (1 - r * 0.2);
      const alpha  = (1 - r / rings) * delta * 2;
      sc.beginPath();
      sc.arc(W/2, H/2, radius, 0, Math.PI * 2);
      sc.strokeStyle = `rgba(255,69,0,${alpha})`;
      sc.lineWidth = 2 - r * 0.5;
      sc.shadowBlur = 12; sc.shadowColor = '#ff4500';
      sc.stroke(); sc.shadowBlur = 0;
    }
  }

  // Center glow proportional to energy
  if (energy > 0.02) {
    const g = sc.createRadialGradient(W/2,H/2,0, W/2,H/2, energy*120);
    g.addColorStop(0, `rgba(255,69,0,${energy*0.8})`);
    g.addColorStop(1, 'transparent');
    sc.fillStyle = g; sc.fillRect(0,0,W,H);
  }

  // Energy history waveform along bottom (map buffer to canvas width)
  const hist = getHistory('kick', HIST_LEN);
  sc.beginPath();
  for (let i=0; i<W; i++) {
    const idx = Math.floor(i / W * HIST_LEN);
    const v = hist[idx];
    const x = i, y = H - v * H * 0.35;
    i===0 ? sc.moveTo(x,y) : sc.lineTo(x,y);
  }
  sc.strokeStyle = 'rgba(255,69,0,0.5)'; sc.lineWidth = 1.5; sc.stroke();
}

// ── SNARE / TOMS ──────────────────────────────────────────────
// Shows a sharp vertical bar spike on each snare hit,
// plus a scrolling waveform trail showing the crackle.
function drawSnare(sc, band, energy, delta) {
  const c = document.getElementById('canvas-snare');
  const W = c.clientWidth, H = c.clientHeight;

  sc.fillStyle = 'rgba(8,10,15,0.35)'; sc.fillRect(0,0,W,H);

  // Scrolling history bars (map buffer to canvas width)
  const hist = getHistory('snare', HIST_LEN);
  for (let i=0; i<W; i++) {
    const idx = Math.floor(i / W * HIST_LEN);
    const v    = hist[idx];
    const barH = v * H * 0.85;
    const alpha = 0.3 + v * 0.7;
    sc.fillStyle = `rgba(255,45,111,${alpha})`;
    sc.fillRect(i, H - barH, 1, barH);
  }

  // Sharp flash on transient
  if (delta > 0.04) {
    sc.fillStyle = `rgba(255,45,111,${Math.min(delta * 1.5, 0.25)})`;
    sc.fillRect(0,0,W,H);
    // Horizontal crack lines
    const lines = Math.floor(delta * 8);
    for (let l=0; l<lines; l++) {
      const y = Math.random() * H;
      sc.strokeStyle = `rgba(255,200,220,${delta})`;
      sc.lineWidth = 0.5;
      sc.beginPath(); sc.moveTo(0,y); sc.lineTo(W*delta*3,y); sc.stroke();
    }
  }
}

// ── HI-HATS / CYMBALS ─────────────────────────────────────────
// Shimmering gold particle dots that rise upward and fade.
// Density and brightness respond to high-frequency energy.
const hatParticles = [];
function drawHats(sc, band, energy, delta) {
  const c = document.getElementById('canvas-hats');
  const W = c.clientWidth, H = c.clientHeight;

  sc.fillStyle = 'rgba(8,10,15,0.3)'; sc.fillRect(0,0,W,H);

  // Spawn new particles on energy
  if (energy > 0.04) {
    const spawn = Math.floor(energy * 12);
    for (let i=0; i<spawn; i++) {
      hatParticles.push({
        x: Math.random() * W,
        y: H * (0.3 + Math.random() * 0.7),
        vy: -(0.5 + Math.random() * 2) * energy * 4,
        vx: (Math.random() - 0.5) * 0.8,
        life: 1.0,
        size: 0.5 + Math.random() * 2 * energy,
      });
    }
  }

  // Draw & age particles
  for (let i = hatParticles.length - 1; i >= 0; i--) {
    const p = hatParticles[i];
    p.x += p.vx; p.y += p.vy; p.vy *= 0.96; p.life -= 0.025;
    if (p.life <= 0) { hatParticles.splice(i,1); continue; }

    const a = p.life;
    const g = sc.createRadialGradient(p.x,p.y,0, p.x,p.y, p.size*3);
    g.addColorStop(0, `rgba(255,240,100,${a})`);
    g.addColorStop(1, 'transparent');
    sc.fillStyle = g;
    sc.beginPath(); sc.arc(p.x, p.y, p.size*3, 0, Math.PI*2); sc.fill();
  }

  // Frequency bars along top (thin) to show the actual hi-hat spectrum
  const count = Math.min(band.length, 60);
  for (let i=0; i<count; i++) {
    const v = band[Math.floor(i*band.length/count)] / 255;
    if (v < 0.1) continue;
    const x = (i/count) * W;
    const barH = v * H * 0.25;
    sc.fillStyle = `rgba(255,226,89,${v*0.8})`;
    sc.fillRect(x, 0, W/count - 1, barH);
  }
}

// ── BASS (instrument) ─────────────────────────────────────────
// Deep pulsing filled bars with a slow swell — sustained energy
// looks very different from kick transients even in same freq range.
function drawBassInst(sc, band, energy) {
  const c = document.getElementById('canvas-bass');
  const W = c.clientWidth, H = c.clientHeight;
  sc.clearRect(0,0,W,H);

  // Background warm glow
  const bg = sc.createRadialGradient(W/2,H,0, W/2,H, H*0.9);
  bg.addColorStop(0, `rgba(255,140,0,${energy*0.3})`);
  bg.addColorStop(1, 'transparent');
  sc.fillStyle = bg; sc.fillRect(0,0,W,H);

  // Chunky bars
  const count = Math.min(band.length, 28);
  const sliceW = W / count;
  for (let i=0; i<count; i++) {
    const v = band[Math.floor(i*band.length/count)] / 255;
    const barH = v * H * 0.88;
    const g = sc.createLinearGradient(0,H,0,H-barH);
    g.addColorStop(0,'#ff8c00'); g.addColorStop(1,'#ff8c0033');
    sc.fillStyle = g;
    sc.fillRect(i*sliceW+1, H-barH, sliceW-2, barH);
  }
}

// ── GUITAR / KEYS ─────────────────────────────────────────────
// Dual-layer wave — two slightly offset waveforms create depth.
function drawGuitar(sc, band, energy) {
  const c = document.getElementById('canvas-guitar');
  const W = c.clientWidth, H = c.clientHeight;
  sc.clearRect(0,0,W,H);

  // BG gradient tint
  if (energy > 0.04) {
    const bg = sc.createLinearGradient(0,0,0,H);
    bg.addColorStop(0,`rgba(0,229,255,${energy*0.08})`); bg.addColorStop(1,'transparent');
    sc.fillStyle=bg; sc.fillRect(0,0,W,H);
  }

  for (let layer=0; layer<2; layer++) {
    const yOff = layer * 6;
    sc.beginPath();
    const sw = W / band.length; let x=0;
    for (let i=0; i<band.length; i++) {
      const v=band[i]/255, y=H*0.5+(v-0.5)*H*0.72+yOff;
      i===0?sc.moveTo(x,y):sc.lineTo(x,y); x+=sw;
    }
    sc.strokeStyle = layer===0?`rgba(0,229,255,0.85)`:`rgba(0,180,220,0.3)`;
    sc.lineWidth = layer===0?2:1;
    sc.shadowBlur = layer===0?10:0; sc.shadowColor='#00e5ff';
    sc.stroke(); sc.shadowBlur=0;
  }
}

// ── VOCALS ───────────────────────────────────────────────────
// Filled symmetric waveform that "breathes" — the mirrored shape
// makes it feel voice-like.
function drawVocals(sc, band, energy) {
  const c = document.getElementById('canvas-vocals');
  const W = c.clientWidth, H = c.clientHeight;
  sc.clearRect(0,0,W,H);

  const sw = W / band.length;
  sc.beginPath(); sc.moveTo(0, H*0.5);
  let x=0; const top=[];
  for (let i=0; i<band.length; i++) {
    const v=band[i]/255, y=H*0.5-v*H*0.42;
    sc.lineTo(x,y); top.push({x,y}); x+=sw;
  }
  sc.lineTo(W,H*0.5);
  for (let i=top.length-1;i>=0;i--) sc.lineTo(top[i].x, H-(top[i].y));
  sc.closePath();

  const g=sc.createLinearGradient(0,0,0,H);
  g.addColorStop(0,`rgba(180,79,255,${0.12+energy*0.45})`);
  g.addColorStop(0.5,`rgba(180,79,255,${0.28+energy*0.55})`);
  g.addColorStop(1,`rgba(180,79,255,${0.12+energy*0.45})`);
  sc.fillStyle=g; sc.fill();
  sc.strokeStyle=`rgba(180,79,255,${0.55+energy*0.45})`;
  sc.lineWidth=1.5; sc.shadowBlur=7; sc.shadowColor='#b44fff';
  sc.stroke(); sc.shadowBlur=0;
}

// ─── Stem Idle Animation ─────────────────────────────────────
let stemIdleT = 0;
function drawStemIdle() {
  stemIdleT += 0.022;
  STEMS.forEach((name, idx) => {
    const sc = stemCtx[name];
    const c  = document.getElementById(`canvas-${name}`);
    const W  = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    sc.clearRect(0,0,W,H);
    const col = STEM_CONFIG[name].color;
    const count=18, sw=W/count;
    for (let i=0;i<count;i++) {
      const v=(Math.sin(i*0.45+stemIdleT+idx*0.7)*0.5+0.5)*0.06;
      sc.fillStyle = col+'22';
      sc.fillRect(i*sw+1, H-v*H, sw-2, v*H);
    }
    if (stemMeter[name]) stemMeter[name].style.width = '0%';
  });
}

// ─── Main Render Loop ─────────────────────────────────────────
function renderLoop() {
  animId = requestAnimationFrame(renderLoop);

  if (currentView === 'full') {
    const W=canvasWrapper.clientWidth, H=canvasWrapper.clientHeight;
    ctx.clearRect(0,0,W,H);
    if (!analyser || !isPlaying) { drawIdle(); return; }
    updateProgress();
    let data;
    if (mode==='wave') { data=new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(data); }
    else               { data=new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(data); }
    if      (mode==='bars')   drawBars(data);
    else if (mode==='wave')   drawWave(data);
    else if (mode==='circle') drawRadial(data);
    return;
  }

  // ── STEM VIEW ────────────────────────────────────────────────
  if (!analyser || !isPlaying) { drawStemIdle(); return; }
  updateProgress();

  const freqData = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(freqData);

  // Calculate and push history only once per frame for each stem
  STEMS.forEach(name => {
    const def    = BAND_DEFS[name];
    const band   = getBandSlice(freqData, def.lo, def.hi);
    const rawE   = getBandEnergy(freqData, def.lo, def.hi);
    // Smooth energy
    const prev = stemEnergy[name];
    stemEnergy[name] = prev * 0.72 + rawE * 0.28;
    const e = stemEnergy[name];
    // Transient delta (onset detection)
    const delta = Math.max(0, e - (stemEnergyPrev[name] || 0));
    stemEnergyPrev[name] = e;
    // Only push to history for kick and snare once per frame
    if (name === 'kick' || name === 'snare') {
      pushHistory(name, e);
    }
    // Update meter
    if (stemMeter[name]) stemMeter[name].style.width = `${Math.min(e * 210, 100)}%`;
  });
  // Now draw each stem (history is not advanced again)
  STEMS.forEach(name => {
    const def    = BAND_DEFS[name];
    const band   = getBandSlice(freqData, def.lo, def.hi);
    const e      = stemEnergy[name];
    const delta  = Math.max(0, e - (stemEnergyPrev[name] || 0));
    const sc = stemCtx[name];
    if (name === 'kick')   drawKick(sc, band, e, delta);
    if (name === 'snare')  drawSnare(sc, band, e, delta);
    if (name === 'hats')   drawHats(sc, band, e, delta);
    if (name === 'bass')   drawBassInst(sc, band, e);
    if (name === 'guitar') drawGuitar(sc, band, e);
    if (name === 'vocals') drawVocals(sc, band, e);
  });
}

renderLoop();