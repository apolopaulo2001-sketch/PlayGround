import * as THREE from '../vendor/three.module.js';

const $ = (selector) => document.querySelector(selector);
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
const TAU = Math.PI * 2;

const START_Z = 20;
const DEST_Z = -1180;
const RUN_DISTANCE = START_Z - DEST_Z;
const ROAD_HALF = 6;
const MAX_SPEED = 28;
const MAX_REVERSE = 7;

const canvas = $('#scene');
const hud = $('#hud');
const speedPanel = $('#speed-panel');
const speedValue = $('#speed-value');
const gearValue = $('#gear-value');
const surfaceLabel = $('#surface-label');
const timeLabel = $('#time-label');
const panelTime = $('#panel-time');
const distanceLabel = $('#distance-label');
const progressLabel = $('#progress-label');
const progressFill = $('#progress-fill');
const progressTruck = $('#progress-truck');
const hintEl = $('#hint');
const toastEl = $('#toast');
const startScreen = $('#start-screen');
const pauseScreen = $('#pause-screen');
const completeScreen = $('#complete-screen');
const loadingEl = $('#loading');
const bestTimeEl = $('#best-time');
const resultTimeEl = $('#result-time');
const resultSpeedEl = $('#result-speed');
const recordLabel = $('#record-label');
const muteBtn = $('#mute-btn');
const pauseBtn = $('#pause-btn');
const touchControls = $('#touch-controls');

const formatTime = (seconds) => {
  const safe = Math.max(0, seconds || 0);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
};

const readBest = () => {
  try {
    const value = Number.parseFloat(localStorage.getItem('hino-fc-best') || '');
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
};

const writeBest = (value) => {
  try {
    localStorage.setItem('hino-fc-best', String(value));
  } catch {
    /* Storage can be unavailable in private contexts. */
  }
};

/* ------------------------------------------------------------------ audio */

class EngineAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.filter = null;
    this.engineGain = null;
    this.osc1 = null;
    this.osc2 = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    try {
      const ctx = new AudioCtx();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(ctx.destination);

      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 360;
      this.filter.Q.value = 1.7;
      this.filter.connect(this.master);

      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineGain.connect(this.filter);

      this.osc1 = ctx.createOscillator();
      this.osc1.type = 'sawtooth';
      this.osc1.frequency.value = 48;
      const gain1 = ctx.createGain();
      gain1.gain.value = 0.6;
      this.osc1.connect(gain1).connect(this.engineGain);

      this.osc2 = ctx.createOscillator();
      this.osc2.type = 'square';
      this.osc2.frequency.value = 24;
      const gain2 = ctx.createGain();
      gain2.gain.value = 0.22;
      this.osc2.connect(gain2).connect(this.engineGain);

      this.osc1.start();
      this.osc2.start();
    } catch {
      this.ctx = null;
    }
  }

  update(speed, throttle, running) {
    if (!this.ctx || !this.osc1) return;
    const now = this.ctx.currentTime;
    const rpm = clamp(Math.abs(speed) / MAX_SPEED, 0, 1);
    const base = 44 + rpm * 86 + throttle * 9;
    this.osc1.frequency.setTargetAtTime(base, now, 0.06);
    this.osc2.frequency.setTargetAtTime(base * 0.5, now, 0.06);
    this.filter.frequency.setTargetAtTime(280 + rpm * 880 + throttle * 260, now, 0.09);
    const level = running ? 0.03 + throttle * 0.035 + rpm * 0.018 : 0.006;
    this.engineGain.gain.setTargetAtTime(level, now, 0.14);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.03);
    return this.muted;
  }

  horn() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.value = 0.0001;
    bus.connect(this.master);
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.exponentialRampToValueAtTime(0.09, now + 0.02);
    bus.gain.exponentialRampToValueAtTime(0.0001, now + 0.52);
    for (const frequency of [370, 466]) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = frequency;
      osc.connect(bus);
      osc.start(now);
      osc.stop(now + 0.55);
    }
  }

  chime() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      const start = now + index * 0.11;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.09, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
      gain.connect(this.master);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      osc.connect(gain);
      osc.start(start);
      osc.stop(start + 0.6);
    });
  }
}

const audio = new EngineAudio();

/* ------------------------------------------------------------------ scene */

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd9e6ee);
scene.fog = new THREE.Fog(0xd9e6ee, 160, 1250);

const camera = new THREE.PerspectiveCamera(54, window.innerWidth / window.innerHeight, 0.1, 3200);
camera.position.set(8, 6, 32);

const clock = new THREE.Clock();

/* ------------------------------------------------------------------ helpers */

function makeCanvasTexture(width, height, draw, repeatX = 1, repeatY = 1) {
  const surface = document.createElement('canvas');
  surface.width = width;
  surface.height = height;
  const ctx = surface.getContext('2d');
  draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

function makeNoiseTexture(size, base, variance, repeatX = 1, repeatY = 1) {
  return makeCanvasTexture(size, size, (ctx) => {
    const image = ctx.createImageData(size, size);
    for (let i = 0; i < image.data.length; i += 4) {
      const noise = (Math.random() * 2 - 1) * variance;
      image.data[i] = clamp(base[0] + noise, 0, 255);
      image.data[i + 1] = clamp(base[1] + noise, 0, 255);
      image.data[i + 2] = clamp(base[2] + noise, 0, 255);
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    for (let i = 0; i < size * 1.4; i += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const alpha = Math.random() * 0.13;
      ctx.fillStyle = Math.random() > 0.5
        ? `rgba(255,255,255,${alpha})`
        : `rgba(0,0,0,${alpha})`;
      ctx.fillRect(x, y, 1 + Math.random() * 3, 1 + Math.random() * 2);
    }
  }, repeatX, repeatY);
}

function makeTextTexture({
  width = 1024,
  height = 320,
  background = 'rgba(12,18,24,0.92)',
  border = 'rgba(255,255,255,0.28)',
  title = '',
  subtitle = '',
  titleColor = '#f5f7f8',
  subtitleColor = '#ffb347',
  titleSize = 118,
  subtitleSize = 34,
  radius = 34,
  transparent = false,
} = {}) {
  return makeCanvasTexture(width, height, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    if (!transparent) {
      const r = Math.min(radius, h / 2);
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.arcTo(w, 0, w, h, r);
      ctx.arcTo(w, h, 0, h, r);
      ctx.arcTo(0, h, 0, 0, r);
      ctx.arcTo(0, 0, w, 0, r);
      ctx.closePath();
      ctx.fillStyle = background;
      ctx.fill();
      ctx.lineWidth = 7;
      ctx.strokeStyle = border;
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const hasSub = Boolean(subtitle);
    const titleY = hasSub ? h * 0.42 : h * 0.5;
    ctx.fillStyle = titleColor;
    ctx.font = `900 ${titleSize}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(title, w / 2, titleY);
    if (hasSub) {
      ctx.fillStyle = subtitleColor;
      ctx.font = `800 ${subtitleSize}px "Helvetica Neue", Arial, sans-serif`;
      ctx.fillText(subtitle, w / 2, h * 0.75);
    }
  });
}

function makeDecalTexture(lines, color = 'rgba(255,255,255,0.92)', width = 512, height = 160, fontSize = null) {
  return makeCanvasTexture(width, height, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = fontSize ?? (lines.length > 1 ? 78 : 96);
    ctx.fillStyle = color;
    ctx.font = `900 ${size}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(lines[0], w / 2, lines.length > 1 ? h * 0.38 : h * 0.5);
    if (lines[1]) {
      ctx.font = `800 ${size * 0.42}px "Helvetica Neue", Arial, sans-serif`;
      ctx.fillStyle = color;
      ctx.fillText(lines[1], w / 2, h * 0.75);
    }
  });
}

function makeSoftCircleTexture() {
  return makeCanvasTexture(96, 96, (ctx, w, h) => {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(0.42, 'rgba(255,255,255,0.42)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  });
}

function makeCloudTexture() {
  return makeCanvasTexture(320, 160, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const blobs = [
      [0.26, 0.58, 0.19], [0.4, 0.42, 0.24], [0.55, 0.53, 0.22],
      [0.7, 0.58, 0.17], [0.48, 0.66, 0.26], [0.62, 0.68, 0.2],
    ];
    for (const [x, y, r] of blobs) {
      const gradient = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * w);
      gradient.addColorStop(0, 'rgba(255,255,255,0.92)');
      gradient.addColorStop(0.58, 'rgba(255,255,255,0.55)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    }
  });
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addBox(parent, width, height, depth, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addPlane(parent, width, height, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/* --------------------------------------------------------------- sky + light */

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1400, 32, 18),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x3f86c6) },
      horizonColor: { value: new THREE.Color(0xe7eef2) },
      lowColor: { value: new THREE.Color(0xd6dfe0) },
      sunColor: { value: new THREE.Color(0xfff0c4) },
      sunDirection: { value: new THREE.Vector3(-0.34, 0.42, -0.84).normalize() },
    },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 lowColor;
      uniform vec3 sunColor;
      uniform vec3 sunDirection;
      varying vec3 vDirection;
      void main() {
        float h = clamp(vDirection.y, -0.15, 1.0);
        vec3 color = mix(lowColor, horizonColor, smoothstep(-0.15, 0.12, h));
        color = mix(color, topColor, smoothstep(0.02, 0.9, h));
        float sun = pow(max(dot(normalize(vDirection), normalize(sunDirection)), 0.0), 420.0);
        float glow = pow(max(dot(normalize(vDirection), normalize(sunDirection)), 0.0), 12.0);
        color += sunColor * sun * 1.4 + sunColor * glow * 0.09;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  }),
);
sky.frustumCulled = false;
scene.add(sky);

const hemisphere = new THREE.HemisphereLight(0xcfe7ff, 0x63714d, 1.15);
scene.add(hemisphere);

const sun = new THREE.DirectionalLight(0xfff0d2, 2.35);
sun.position.set(55, 90, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(1536, 1536);
sun.shadow.camera.left = -48;
sun.shadow.camera.right = 48;
sun.shadow.camera.top = 48;
sun.shadow.camera.bottom = -48;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 230;
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.025;
scene.add(sun);
scene.add(sun.target);

const fill = new THREE.DirectionalLight(0x9fc6e8, 0.42);
fill.position.set(-60, 40, -80);
scene.add(fill);

/* ------------------------------------------------------------------ ground */

const grassTexture = makeNoiseTexture(256, [91, 116, 67], 24, 420, 420);
const grassMaterial = new THREE.MeshStandardMaterial({
  map: grassTexture,
  color: 0xffffff,
  roughness: 1,
  metalness: 0,
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), grassMaterial);
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -0.06, -650);
ground.receiveShadow = true;
scene.add(ground);

/* -------------------------------------------------------------------- road */

const asphaltTexture = makeNoiseTexture(256, [54, 58, 64], 18, 2, 260);
const asphaltMaterial = new THREE.MeshStandardMaterial({
  map: asphaltTexture,
  color: 0xffffff,
  roughness: 0.97,
  metalness: 0.01,
});
const road = new THREE.Mesh(new THREE.PlaneGeometry(12, 1600), asphaltMaterial);
road.rotation.x = -Math.PI / 2;
road.position.set(0, 0, -700);
road.receiveShadow = true;
scene.add(road);

const gravelTexture = makeNoiseTexture(128, [124, 115, 97], 24, 2, 220);
const gravelMaterial = new THREE.MeshStandardMaterial({
  map: gravelTexture,
  color: 0xffffff,
  roughness: 1,
});
for (const side of [-1, 1]) {
  const shoulder = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1600), gravelMaterial);
  shoulder.rotation.x = -Math.PI / 2;
  shoulder.position.set(side * 7.2, -0.012, -700);
  shoulder.receiveShadow = true;
  scene.add(shoulder);
}

const lineMaterial = new THREE.MeshStandardMaterial({
  color: 0xf4f0dc,
  roughness: 0.82,
  emissive: 0x28261b,
  emissiveIntensity: 0.25,
});

for (const side of [-1, 1]) {
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.022, 1600), lineMaterial);
  edge.position.set(side * 5.52, 0.018, -700);
  edge.receiveShadow = true;
  scene.add(edge);
}

const dashCount = 180;
const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 0.022, 3.3), lineMaterial, dashCount);
const dashDummy = new THREE.Object3D();
let dashIndex = 0;
for (let z = 94; z > -1496 && dashIndex < dashCount; z -= 9) {
  dashDummy.position.set(0, 0.018, z);
  dashDummy.updateMatrix();
  dashes.setMatrixAt(dashIndex, dashDummy.matrix);
  dashIndex += 1;
}
dashes.count = dashIndex;
dashes.receiveShadow = true;
scene.add(dashes);

const checkeredTexture = makeCanvasTexture(512, 64, (ctx, w, h) => {
  const cols = 16;
  const rows = 2;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#f5f3e8' : '#1c2024';
      ctx.fillRect((x * w) / cols, (y * h) / rows, w / cols, h / rows);
    }
  }
});
const checkeredMaterial = new THREE.MeshBasicMaterial({ map: checkeredTexture });
const startLine = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.5), checkeredMaterial);
startLine.rotation.x = -Math.PI / 2;
startLine.position.set(0, 0.027, 10);
scene.add(startLine);

const finishLine = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.2), checkeredMaterial);
finishLine.rotation.x = -Math.PI / 2;
finishLine.position.set(0, 0.027, DEST_Z + 16);
scene.add(finishLine);

/* ------------------------------------------------------------- roadside props */

const metalDark = new THREE.MeshStandardMaterial({ color: 0x343b40, roughness: 0.52, metalness: 0.55 });
const metalLight = new THREE.MeshStandardMaterial({ color: 0xaab3b7, roughness: 0.38, metalness: 0.7 });
const treeTrunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4c32, roughness: 1 });
const treeCanopyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
const bushMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x8b8e89, roughness: 1, flatShading: true });

const treeRandom = seededRandom(20261101);
const treeCount = 260;
const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.27, 3.4, 6), treeTrunkMaterial, treeCount);
const canopies = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), treeCanopyMaterial, treeCount);
trunks.castShadow = true;
trunks.receiveShadow = true;
canopies.castShadow = true;
canopies.receiveShadow = true;
const treeDummy = new THREE.Object3D();
const treeColor = new THREE.Color();
let treeIndex = 0;
for (let attempt = 0; attempt < 2600 && treeIndex < treeCount; attempt += 1) {
  const side = treeRandom() < 0.5 ? -1 : 1;
  const x = side * (10.4 + treeRandom() * 66);
  const z = 62 - treeRandom() * 1610;
  if (z < -1120 && z > -1290 && Math.abs(x) < 48) continue;
  const scale = 0.75 + treeRandom() * 1.65;
  treeDummy.rotation.set(0, treeRandom() * TAU, 0);
  treeDummy.position.set(x, 1.7 * scale, z);
  treeDummy.scale.set(scale, scale, scale);
  treeDummy.updateMatrix();
  trunks.setMatrixAt(treeIndex, treeDummy.matrix);
  treeDummy.position.set(x, 4.15 * scale, z);
  treeDummy.rotation.y = treeRandom() * TAU;
  treeDummy.scale.set(1.55 * scale, 1.35 * scale, 1.55 * scale);
  treeDummy.updateMatrix();
  canopies.setMatrixAt(treeIndex, treeDummy.matrix);
  treeColor.setHSL(0.24 + treeRandom() * 0.08, 0.3 + treeRandom() * 0.12, 0.28 + treeRandom() * 0.1);
  canopies.setColorAt(treeIndex, treeColor);
  treeIndex += 1;
}
trunks.count = treeIndex;
canopies.count = treeIndex;
trunks.instanceMatrix.needsUpdate = true;
canopies.instanceMatrix.needsUpdate = true;
if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
scene.add(trunks, canopies);

const bushCount = 170;
const bushes = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), bushMaterial, bushCount);
bushes.receiveShadow = true;
let bushIndex = 0;
for (let attempt = 0; attempt < 1000 && bushIndex < bushCount; attempt += 1) {
  const side = treeRandom() < 0.5 ? -1 : 1;
  const x = side * (8.3 + treeRandom() * 26);
  const z = 58 - treeRandom() * 1580;
  if (z < -1130 && z > -1270 && Math.abs(x) < 42) continue;
  const scale = 0.4 + treeRandom() * 0.9;
  treeDummy.position.set(x, 0.25 * scale, z);
  treeDummy.rotation.set(0, treeRandom() * TAU, 0);
  treeDummy.scale.set(scale * 1.3, scale, scale * 1.2);
  treeDummy.updateMatrix();
  bushes.setMatrixAt(bushIndex, treeDummy.matrix);
  treeColor.setHSL(0.24 + treeRandom() * 0.06, 0.28, 0.24 + treeRandom() * 0.08);
  bushes.setColorAt(bushIndex, treeColor);
  bushIndex += 1;
}
bushes.count = bushIndex;
bushes.instanceMatrix.needsUpdate = true;
if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
scene.add(bushes);

const rockCount = 70;
const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), rockMaterial, rockCount);
rocks.receiveShadow = true;
let rockIndex = 0;
for (let attempt = 0; attempt < 700 && rockIndex < rockCount; attempt += 1) {
  const side = treeRandom() < 0.5 ? -1 : 1;
  const x = side * (8.5 + treeRandom() * 34);
  const z = 50 - treeRandom() * 1500;
  const scale = 0.25 + treeRandom() * 0.75;
  treeDummy.position.set(x, 0.2 * scale, z);
  treeDummy.rotation.set(treeRandom() * 0.5, treeRandom() * TAU, treeRandom() * 0.5);
  treeDummy.scale.set(scale, scale * 0.7, scale);
  treeDummy.updateMatrix();
  rocks.setMatrixAt(rockIndex, treeDummy.matrix);
  rockIndex += 1;
}
rocks.count = rockIndex;
rocks.instanceMatrix.needsUpdate = true;
scene.add(rocks);

const poleCount = 26;
const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.14, 8.6, 7), metalDark, poleCount);
poles.castShadow = true;
poles.receiveShadow = true;
const crossarms = new THREE.InstancedMesh(new THREE.BoxGeometry(2.5, 0.13, 0.13), metalDark, poleCount);
crossarms.castShadow = true;
const poleDummy = new THREE.Object3D();
for (let i = 0; i < poleCount; i += 1) {
  const z = 58 - i * 62;
  poleDummy.position.set(9.9, 4.3, z);
  poleDummy.updateMatrix();
  poles.setMatrixAt(i, poleDummy.matrix);
  poleDummy.position.set(9.9, 7.9, z);
  poleDummy.updateMatrix();
  crossarms.setMatrixAt(i, poleDummy.matrix);
}
poles.instanceMatrix.needsUpdate = true;
crossarms.instanceMatrix.needsUpdate = true;
scene.add(poles, crossarms);

const wireMaterial = new THREE.LineBasicMaterial({ color: 0x30373b, transparent: true, opacity: 0.5 });
for (const x of [8.75, 11.05]) {
  const points = [];
  for (let i = 0; i < poleCount; i += 1) points.push(new THREE.Vector3(x, 7.9, 58 - i * 62));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  scene.add(new THREE.Line(geometry, wireMaterial));
}

/* ------------------------------------------------------------------ skyline */

const mountainRandom = seededRandom(77113);
const mountainColors = [0xb3c7ce, 0xaabfc8, 0xbfd0d5, 0xa5bbc5];
for (let i = 0; i < 22; i += 1) {
  const height = 80 + mountainRandom() * 160;
  const radius = 160 + mountainRandom() * 260;
  const material = new THREE.MeshBasicMaterial({ color: mountainColors[i % mountainColors.length], fog: false });
  const mountain = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 6), material);
  mountain.scale.set(radius, height, radius);
  mountain.position.set((mountainRandom() - 0.5) * 2100, height / 2 - 8, -1900 - mountainRandom() * 900);
  scene.add(mountain);
}

const hillMaterial = new THREE.MeshBasicMaterial({ color: 0x7f9a6a });
for (const [x, z, sx, sy, sz] of [
  [-520, -620, 190, 24, 150], [540, -900, 210, 28, 170], [-680, -1320, 240, 30, 180],
  [660, -1620, 220, 26, 160], [-480, -1880, 260, 34, 200],
]) {
  const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 5), hillMaterial);
  hill.scale.set(sx, sy, sz);
  hill.position.set(x, -6, z);
  scene.add(hill);
}

const cloudTexture = makeCloudTexture();
const clouds = [];
for (let i = 0; i < 16; i += 1) {
  const material = new THREE.SpriteMaterial({
    map: cloudTexture,
    transparent: true,
    opacity: 0.5 + Math.random() * 0.3,
    depthWrite: false,
    color: 0xffffff,
  });
  const sprite = new THREE.Sprite(material);
  const scale = 80 + Math.random() * 110;
  sprite.scale.set(scale, scale * 0.42, 1);
  sprite.position.set((Math.random() - 0.5) * 1100, 72 + Math.random() * 100, 80 - Math.random() * 1600);
  sprite.userData.speed = 0.5 + Math.random() * 1.2;
  clouds.push(sprite);
  scene.add(sprite);
}

/* ------------------------------------------------------------------ signage */

function createRoadsideSign(title, subtitle, z, side = 1) {
  const group = new THREE.Group();
  group.position.set(side * 7.9, 0, z);
  addBox(group, 0.12, 2.4, 0.12, metalDark, 0, 1.2, 0);
  addBox(group, 2.35, 1.15, 0.12, metalDark, 0, 2.78, 0);
  const texture = makeTextTexture({
    width: 640,
    height: 300,
    title,
    subtitle,
    titleSize: 122,
    subtitleSize: 36,
    background: 'rgba(20,27,33,0.96)',
    border: 'rgba(255,255,255,0.35)',
    titleColor: '#f7f4e8',
    subtitleColor: '#ffb347',
  });
  const face = addPlane(group, 2.2, 1.03, new THREE.MeshBasicMaterial({ map: texture, transparent: true }), 0, 2.78, 0.075);
  face.renderOrder = 1;
  scene.add(group);
}

createRoadsideSign('900 m', 'DEPOT AHEAD', -280, 1);
createRoadsideSign('500 m', 'KEEP RIGHT', -680, 1);
createRoadsideSign('200 m', 'STOP IN ZONE', -980, 1);

function createGantry(z, title, subtitle, accent, lightColor) {
  const group = new THREE.Group();
  group.position.set(0, 0, z);
  for (const side of [-1, 1]) {
    addBox(group, 0.38, 6.8, 0.38, metalDark, side * 7.8, 3.4, 0);
    addBox(group, 1.0, 0.22, 1.0, metalDark, side * 7.8, 0.11, 0);
  }
  addBox(group, 16.2, 0.34, 0.46, metalDark, 0, 6.66, 0);
  addBox(group, 8.9, 1.68, 0.2, metalDark, 0, 6.43, 0.13);
  const texture = makeTextTexture({
    width: 1024,
    height: 300,
    title,
    subtitle,
    titleSize: 104,
    subtitleSize: 32,
    background: 'rgba(12,18,23,0.98)',
    border: accent,
    titleColor: '#f7f4e8',
    subtitleColor: accent,
  });
  addPlane(group, 8.7, 1.53, new THREE.MeshBasicMaterial({ map: texture, transparent: true }), 0, 6.43, 0.25);
  const lightMaterial = new THREE.MeshBasicMaterial({ color: lightColor });
  for (const x of [-6.7, -6.1, 6.1, 6.7]) {
    addBox(group, 0.18, 0.18, 0.18, lightMaterial, x, 6.2, 0.3);
  }
  scene.add(group);
  return group;
}

createGantry(-62, 'RUTA 35', 'HINO FC DELIVERY RUN', '#ffb347', 0xffb347);
createGantry(-1120, 'DELIVERY ZONE', 'STOP INSIDE THE GREEN AREA', '#78ffae', 0x78ffae);

/* ------------------------------------------------------------------- depot */

const depot = new THREE.Group();
depot.position.set(20, 0, -1200);
scene.add(depot);

const yard = new THREE.Mesh(new THREE.PlaneGeometry(30, 42), gravelMaterial);
yard.rotation.x = -Math.PI / 2;
yard.position.set(0, -0.02, 0);
yard.receiveShadow = true;
depot.add(yard);

const depotWall = new THREE.MeshStandardMaterial({ color: 0xe8e5d8, roughness: 0.82, metalness: 0.02 });
const depotRoof = new THREE.MeshStandardMaterial({ color: 0x3c6650, roughness: 0.68, metalness: 0.18 });
const depotDoor = new THREE.MeshStandardMaterial({ color: 0x5d6a70, roughness: 0.7, metalness: 0.3 });
addBox(depot, 24, 7.5, 30, depotWall, 0, 3.75, 0);
addBox(depot, 25, 0.5, 31, depotRoof, 0, 7.7, 0);
addBox(depot, 24.3, 0.35, 30.3, metalDark, 0, 7.35, 0);
addBox(depot, 26, 0.7, 3, metalDark, 0, 0.35, 16.3);
addBox(depot, 26.2, 0.12, 0.22, new THREE.MeshBasicMaterial({ color: 0xffc04a }), 0, 0.78, 17.75);

for (const x of [-7.2, 0, 7.2]) {
  addPlane(depot, 5.4, 4.7, new THREE.MeshStandardMaterial({ color: 0x59656b, roughness: 0.72, metalness: 0.28 }), x, 3.1, 15.06);
  for (let y = 1.2; y < 5.4; y += 0.55) {
    addBox(depot, 5.2, 0.035, 0.035, metalLight, x, y, 15.12);
  }
}

const depotSignTexture = makeTextTexture({
  width: 1024,
  height: 260,
  title: 'HINO CARGO',
  subtitle: 'DEPOT 35 · LOADING BAY',
  titleSize: 126,
  subtitleSize: 34,
  background: 'rgba(18,31,26,0.98)',
  border: 'rgba(120,255,174,0.8)',
  titleColor: '#f7f4e8',
  subtitleColor: '#78ffae',
});
addPlane(depot, 12, 3.05, new THREE.MeshBasicMaterial({ map: depotSignTexture, transparent: true }), 0, 5.95, 15.12);

const crateColors = [0xd24a3c, 0xe9e3d5, 0x3e6b8f, 0xcaa24a];
for (let i = 0; i < 8; i += 1) {
  const size = 1.8 + (i % 3) * 0.45;
  const crate = addBox(
    depot,
    size,
    size,
    size,
    new THREE.MeshStandardMaterial({ color: crateColors[i % crateColors.length], roughness: 0.85 }),
    -10.5 + (i % 4) * 2.2,
    size / 2 + (i > 3 ? 2.1 : 0),
    17.5 + Math.floor(i / 4) * 2.1,
  );
  crate.rotation.y = (i % 3) * 0.08;
}

const depotLightMaterial = new THREE.MeshBasicMaterial({ color: 0xfff2c8 });
for (const x of [-9, 9]) {
  const pole = addBox(depot, 0.16, 7, 0.16, metalDark, x, 3.5, 18.6);
  pole.castShadow = true;
  addBox(depot, 1.0, 0.18, 0.55, metalDark, x, 7.05, 18.4);
  addBox(depot, 0.72, 0.09, 0.4, depotLightMaterial, x, 6.94, 18.4);
}

/* --------------------------------------------------------------- green zone */

const zoneMaterial = new THREE.MeshBasicMaterial({
  color: 0x64ff9f,
  transparent: true,
  opacity: 0.17,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const zone = new THREE.Mesh(new THREE.PlaneGeometry(11.6, 32), zoneMaterial);
zone.rotation.x = -Math.PI / 2;
zone.position.set(0, 0.038, DEST_Z);
scene.add(zone);

const zoneLineMaterial = new THREE.MeshBasicMaterial({
  color: 0x8dffb9,
  transparent: true,
  opacity: 0.8,
  depthWrite: false,
});
for (const x of [-5.8, 5.8]) {
  const line = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 32), zoneLineMaterial);
  line.position.set(x, 0.05, DEST_Z);
  scene.add(line);
}
for (const z of [DEST_Z - 16, DEST_Z + 16]) {
  const line = new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.02, 0.1), zoneLineMaterial);
  line.position.set(0, 0.05, z);
  scene.add(line);
}

const zonePostMaterial = new THREE.MeshStandardMaterial({
  color: 0x20543b,
  roughness: 0.5,
  metalness: 0.3,
  emissive: 0x2bd36f,
  emissiveIntensity: 0.9,
});
const zoneLampMaterial = new THREE.MeshBasicMaterial({ color: 0xa6ffc9 });
for (const x of [-5.8, 5.8]) {
  for (const z of [DEST_Z - 16, DEST_Z + 16]) {
    addBox(scene, 0.16, 2.4, 0.16, zonePostMaterial, x, 1.2, z);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), zoneLampMaterial);
    lamp.position.set(x, 2.48, z);
    scene.add(lamp);
  }
}

const zoneWallMaterial = new THREE.MeshBasicMaterial({
  color: 0x64ff9f,
  transparent: true,
  opacity: 0.055,
  depthWrite: false,
  side: THREE.DoubleSide,
});
for (const x of [-5.8, 5.8]) {
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(32, 2.2), zoneWallMaterial);
  wall.rotation.y = Math.PI / 2;
  wall.position.set(x, 1.1, DEST_Z);
  scene.add(wall);
}

const stopTexture = makeTextTexture({
  width: 512,
  height: 220,
  title: 'STOP',
  subtitle: 'IN THE GREEN ZONE',
  titleSize: 150,
  subtitleSize: 34,
  transparent: true,
  titleColor: 'rgba(190,255,214,0.95)',
  subtitleColor: 'rgba(190,255,214,0.9)',
});
const stopPaint = new THREE.Mesh(
  new THREE.PlaneGeometry(5.4, 2.3),
  new THREE.MeshBasicMaterial({ map: stopTexture, transparent: true, depthWrite: false, opacity: 0.9 }),
);
stopPaint.rotation.x = -Math.PI / 2;
stopPaint.position.set(0, 0.055, DEST_Z + 21);
scene.add(stopPaint);

const goalMarker = new THREE.Mesh(
  new THREE.OctahedronGeometry(0.72, 0),
  new THREE.MeshBasicMaterial({ color: 0x8dffb9 }),
);
goalMarker.position.set(0, 8.2, DEST_Z);
scene.add(goalMarker);

const goalGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeSoftCircleTexture(),
  color: 0x64ff9f,
  transparent: true,
  opacity: 0.62,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
}));
goalGlow.scale.set(5.2, 5.2, 1);
goalGlow.position.set(0, 8.2, DEST_Z);
scene.add(goalGlow);

/* ------------------------------------------------------------------- truck */

const truck = new THREE.Group();
truck.position.set(2.8, 0, START_Z);
truck.rotation.y = 0;
scene.add(truck);

const truckVisual = new THREE.Group();
truck.add(truckVisual);

const paintMaterial = new THREE.MeshStandardMaterial({ color: 0xf4f6f3, roughness: 0.38, metalness: 0.1 });
const paintShadeMaterial = new THREE.MeshStandardMaterial({ color: 0xdde1de, roughness: 0.46, metalness: 0.08 });
const rubberMaterial = new THREE.MeshStandardMaterial({ color: 0x17191b, roughness: 0.94, metalness: 0.02 });
const chromeMaterial = new THREE.MeshStandardMaterial({ color: 0xc7ced1, roughness: 0.24, metalness: 0.88 });
const glassMaterial = new THREE.MeshStandardMaterial({
  color: 0x162a36,
  roughness: 0.12,
  metalness: 0.55,
  transparent: true,
  opacity: 0.93,
});
const darkPlasticMaterial = new THREE.MeshStandardMaterial({ color: 0x242a2e, roughness: 0.78, metalness: 0.08 });
const chassisMaterial = new THREE.MeshStandardMaterial({ color: 0x262c30, roughness: 0.72, metalness: 0.34 });
const headlightMaterial = new THREE.MeshStandardMaterial({
  color: 0xfff4cf,
  emissive: 0xffe8a0,
  emissiveIntensity: 1.8,
  roughness: 0.18,
  metalness: 0.1,
});
const amberMaterial = new THREE.MeshStandardMaterial({
  color: 0xff9b2e,
  emissive: 0xff7300,
  emissiveIntensity: 1.2,
  roughness: 0.35,
});
const redLampMaterial = new THREE.MeshStandardMaterial({
  color: 0xff4433,
  emissive: 0xd51b0c,
  emissiveIntensity: 1.3,
  roughness: 0.32,
});
const tailAmberMaterial = new THREE.MeshStandardMaterial({
  color: 0xffb23e,
  emissive: 0xd66a00,
  emissiveIntensity: 0.9,
  roughness: 0.4,
});

// Chassis and running gear.
addBox(truckVisual, 1.58, 0.24, 6.9, chassisMaterial, 0, 0.7, -0.05);
addBox(truckVisual, 1.7, 0.16, 6.2, chassisMaterial, 0, 0.56, -0.1);
addBox(truckVisual, 0.18, 0.2, 5.8, chassisMaterial, -0.82, 0.56, -0.05);
addBox(truckVisual, 0.18, 0.2, 5.8, chassisMaterial, 0.82, 0.56, -0.05);

// Cab-over lower body.
addBox(truckVisual, 2.26, 1.32, 1.95, paintMaterial, 0, 1.32, -2.45);
addBox(truckVisual, 2.28, 0.14, 1.98, paintShadeMaterial, 0, 0.68, -2.45);
addBox(truckVisual, 0.22, 1.12, 0.14, paintShadeMaterial, -1.08, 1.24, -3.4);
addBox(truckVisual, 0.22, 1.12, 0.14, paintShadeMaterial, 1.08, 1.24, -3.4);

// Upper cab and roof fairing.
addBox(truckVisual, 2.26, 0.94, 1.85, paintMaterial, 0, 2.42, -2.42);
addBox(truckVisual, 2.06, 0.44, 1.28, paintMaterial, 0, 3.05, -2.5).rotation.x = -0.13;
addBox(truckVisual, 2.1, 0.08, 1.3, paintShadeMaterial, 0, 3.29, -2.57).rotation.x = -0.13;
addBox(truckVisual, 2.3, 0.12, 1.9, paintShadeMaterial, 0, 1.98, -2.42);

// Windshield, side glass, and door details.
addPlane(truckVisual, 2.06, 0.9, darkPlasticMaterial, 0, 2.44, -3.353).rotation.x = -0.055;
addPlane(truckVisual, 1.96, 0.78, glassMaterial, 0, 2.44, -3.362).rotation.x = -0.055;
addPlane(truckVisual, 0.94, 0.58, glassMaterial, 1.136, 2.46, -2.56).rotation.y = Math.PI / 2;
addPlane(truckVisual, 0.94, 0.58, glassMaterial, -1.136, 2.46, -2.56).rotation.y = -Math.PI / 2;
addBox(truckVisual, 0.02, 1.76, 0.025, darkPlasticMaterial, 1.142, 1.6, -1.49);
addBox(truckVisual, 0.02, 1.76, 0.025, darkPlasticMaterial, -1.142, 1.6, -1.49);
addBox(truckVisual, 0.035, 0.055, 0.24, chromeMaterial, 1.15, 1.98, -1.72);
addBox(truckVisual, 0.035, 0.055, 0.24, chromeMaterial, -1.15, 1.98, -1.72);
addBox(truckVisual, 0.46, 0.08, 0.03, darkPlasticMaterial, 0.45, 2.03, -3.385).rotation.z = -0.22;
addBox(truckVisual, 0.46, 0.08, 0.03, darkPlasticMaterial, -0.45, 2.03, -3.385).rotation.z = 0.22;

// Front grille, bumper, lamps, and plate.
addBox(truckVisual, 1.52, 0.5, 0.09, darkPlasticMaterial, 0, 1.42, -3.44);
for (const y of [1.28, 1.4, 1.52, 1.64]) {
  addBox(truckVisual, 1.36, 0.035, 0.025, chromeMaterial, 0, y, -3.492);
}
const hinoDecal = makeDecalTexture(['HINO'], 'rgba(226,232,235,0.95)');
addPlane(
  truckVisual,
  1.1,
  0.22,
  new THREE.MeshBasicMaterial({ map: hinoDecal, transparent: true, depthWrite: false }),
  0,
  1.42,
  -3.505,
);
addBox(truckVisual, 2.38, 0.34, 0.22, paintShadeMaterial, 0, 0.8, -3.5);
addBox(truckVisual, 2.24, 0.1, 0.14, darkPlasticMaterial, 0, 0.66, -3.52);
for (const x of [-0.82, 0.82]) {
  addBox(truckVisual, 0.34, 0.24, 0.08, headlightMaterial, x, 1.06, -3.48);
  addBox(truckVisual, 0.15, 0.11, 0.07, amberMaterial, x < 0 ? -1.05 : 1.05, 1.06, -3.47);
}
const frontPlateTexture = makeCanvasTexture(256, 80, (ctx, w, h) => {
  ctx.fillStyle = '#f0eee4';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1d2327';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);
  ctx.fillStyle = '#1d2327';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 42px "Arial Narrow", Arial, sans-serif';
  ctx.fillText('HINO FC', w / 2, h / 2 + 2);
});
addPlane(truckVisual, 0.56, 0.175, new THREE.MeshBasicMaterial({ map: frontPlateTexture }), 0, 0.8, -3.615);

// Mirrors, roof markers, steps, and exhaust.
for (const side of [-1, 1]) {
  addBox(truckVisual, 0.05, 0.05, 0.42, darkPlasticMaterial, side * 1.18, 2.52, -3.18);
  addBox(truckVisual, 0.09, 0.48, 0.32, darkPlasticMaterial, side * 1.32, 2.36, -3.22);
  addPlane(truckVisual, 0.2, 0.34, chromeMaterial, side * 1.365, 2.36, -3.22).rotation.y = side * Math.PI / 2;
  addBox(truckVisual, 0.5, 0.08, 0.42, darkPlasticMaterial, side * 1.1, 0.62, -2.25);
}
for (let i = -2; i <= 2; i += 1) {
  addBox(truckVisual, 0.12, 0.07, 0.06, amberMaterial, i * 0.4, 2.92, -3.23);
}
addBox(truckVisual, 0.13, 0.28, 0.12, chromeMaterial, -1.16, 2.35, -1.45);
const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 2.1, 10), chromeMaterial);
exhaust.position.set(-1.16, 2.05, -1.45);
exhaust.castShadow = true;
truckVisual.add(exhaust);
addBox(truckVisual, 0.18, 0.09, 0.18, darkPlasticMaterial, -1.16, 3.12, -1.45);

// Fuel tank and battery box.
const fuelTank = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.25, 16), chromeMaterial);
fuelTank.rotation.x = Math.PI / 2;
fuelTank.position.set(-1.03, 0.93, -0.75);
fuelTank.castShadow = true;
truckVisual.add(fuelTank);
addBox(truckVisual, 0.42, 0.48, 0.9, darkPlasticMaterial, 1.02, 0.9, -0.72);

// Cargo box.
addBox(truckVisual, 2.42, 2.4, 3.75, paintMaterial, 0, 2.12, 1.0);
addBox(truckVisual, 2.46, 0.1, 3.79, paintShadeMaterial, 0, 3.36, 1.0);
addBox(truckVisual, 2.46, 0.13, 3.79, paintShadeMaterial, 0, 0.94, 1.0);
addBox(truckVisual, 0.08, 2.26, 3.62, paintShadeMaterial, 1.215, 2.12, 1.0);
addBox(truckVisual, 0.08, 2.26, 3.62, paintShadeMaterial, -1.215, 2.12, 1.0);
for (const side of [-1, 1]) {
  for (const z of [-0.45, 0.08, 0.61, 1.14, 1.67, 2.2]) {
    addBox(truckVisual, 0.028, 2.24, 0.04, paintShadeMaterial, side * 1.258, 2.12, z);
  }
}
const sideDecal = makeDecalTexture(['HINO', 'FC 9J'], 'rgba(46, 60, 66, 0.96)', 640, 220, 132);
const sideDecalMaterial = new THREE.MeshBasicMaterial({
  map: sideDecal,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  toneMapped: false,
});
addPlane(truckVisual, 1.95, 0.66, sideDecalMaterial, 1.275, 2.16, 1.0).rotation.y = Math.PI / 2;
addPlane(truckVisual, 1.95, 0.66, sideDecalMaterial, -1.275, 2.16, 1.0).rotation.y = -Math.PI / 2;

// Rear doors, lamps, bumper, and reflective markings.
addBox(truckVisual, 2.42, 2.28, 0.08, paintMaterial, 0, 2.12, 2.89);
addBox(truckVisual, 0.035, 2.2, 0.03, darkPlasticMaterial, 0, 2.12, 2.945);
for (const x of [-0.6, 0.6]) {
  addBox(truckVisual, 1.13, 2.16, 0.03, paintShadeMaterial, x, 2.12, 2.95);
  addBox(truckVisual, 0.06, 0.38, 0.04, chromeMaterial, x + (x < 0 ? 0.4 : -0.4), 2.12, 2.975);
}
const rearDecal = makeDecalTexture(['HINO'], 'rgba(46, 60, 66, 0.92)', 640, 160, 190);
const rearDecalMaterial = new THREE.MeshBasicMaterial({
  map: rearDecal,
  transparent: true,
  depthWrite: false,
  toneMapped: false,
});
addPlane(truckVisual, 1.75, 0.44, rearDecalMaterial, 0, 2.74, 2.985);
for (const x of [-0.85, 0.85]) {
  addBox(truckVisual, 0.36, 0.2, 0.07, redLampMaterial, x, 1.16, 2.97);
  addBox(truckVisual, 0.36, 0.1, 0.07, tailAmberMaterial, x, 1.38, 2.97);
}
addBox(truckVisual, 1.5, 0.16, 0.18, chassisMaterial, 0, 0.74, 3.12);
for (const x of [-1.0, 1.0]) {
  addBox(truckVisual, 0.14, 0.08, 0.06, redLampMaterial, x, 3.4, 2.95);
}
for (const x of [-1.14, 1.14]) {
  addBox(truckVisual, 0.05, 0.09, 0.22, amberMaterial, x, 1.02, 0.4);
  addBox(truckVisual, 0.05, 0.09, 0.22, amberMaterial, x, 1.02, 1.7);
}
for (let i = 0; i < 7; i += 1) {
  const stripe = new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0xf2efe2 : 0xd83b2b });
  addBox(truckVisual, 0.2, 0.09, 0.03, stripe, -0.6 + i * 0.2, 0.74, 3.22);
}
for (let i = 0; i < 12; i += 1) {
  const stripe = new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0xf2efe2 : 0xd83b2b });
  addBox(truckVisual, 0.18, 0.08, 0.025, stripe, -0.99 + i * 0.18, 1.04, 2.995);
}
addPlane(truckVisual, 0.56, 0.175, new THREE.MeshBasicMaterial({ map: frontPlateTexture }), 0, 1.0, 2.982);

// Rear axles and differential.
for (const z of [1.4, 2.55]) {
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 2.3, 10), chassisMaterial);
  axle.rotation.z = Math.PI / 2;
  axle.position.set(0, 0.5, z);
  axle.castShadow = true;
  truckVisual.add(axle);
}
const differential = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), chassisMaterial);
differential.position.set(0, 0.5, 2.55);
differential.castShadow = true;
truckVisual.add(differential);
const driveshaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.1, 8), chassisMaterial);
driveshaft.rotation.x = Math.PI / 2;
driveshaft.position.set(0, 0.55, 1.45);
driveshaft.castShadow = true;
truckVisual.add(driveshaft);

// Wheels. The front pair steers; the rear axles run dual tires.
const wheels = [];
function addWheel(x, z, steerable, width = 0.34) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 0.5, z);
  truck.add(pivot);
  const spin = new THREE.Group();
  pivot.add(spin);
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, width, 22), rubberMaterial);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  tire.receiveShadow = true;
  spin.add(tire);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, width + 0.015, 18), chromeMaterial);
  hub.rotation.z = Math.PI / 2;
  hub.castShadow = true;
  spin.add(hub);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, width + 0.025, 12), darkPlasticMaterial);
  cap.rotation.z = Math.PI / 2;
  spin.add(cap);
  wheels.push({ pivot, spin, steerable });
}

addWheel(-1.06, -2.55, true);
addWheel(1.06, -2.55, true);
for (const z of [1.4, 2.55]) {
  addWheel(-1.18, z, false, 0.34);
  addWheel(-0.86, z, false, 0.26);
  addWheel(1.18, z, false, 0.34);
  addWheel(0.86, z, false, 0.26);
}

// Simple wheel arches over the rear axles.
for (const x of [-1.18, 1.18]) {
  for (const z of [1.4, 2.55]) {
    addBox(truckVisual, 0.5, 0.14, 1.42, darkPlasticMaterial, x, 1.08, z);
  }
}

truck.traverse((child) => {
  if (child.isMesh) {
    child.castShadow = true;
    child.receiveShadow = true;
  }
});
truck.updateMatrixWorld(true);

/* ---------------------------------------------------------------- particles */

const dustTexture = makeSoftCircleTexture();
const DUST_COUNT = 130;
const dustPositions = new Float32Array(DUST_COUNT * 3);
const dustVelocity = new Float32Array(DUST_COUNT * 3);
const dustLife = new Float32Array(DUST_COUNT);
for (let i = 0; i < DUST_COUNT; i += 1) dustPositions[i * 3 + 1] = -100;
const dustGeometry = new THREE.BufferGeometry();
dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
const dustMaterial = new THREE.PointsMaterial({
  map: dustTexture,
  color: 0xcab99e,
  size: 0.62,
  transparent: true,
  opacity: 0.34,
  depthWrite: false,
  sizeAttenuation: true,
  alphaTest: 0.01,
});
const dustPoints = new THREE.Points(dustGeometry, dustMaterial);
dustPoints.frustumCulled = false;
scene.add(dustPoints);
let dustCursor = 0;
let dustTimer = 0;

function spawnDust(x, y, z, strength) {
  const index = dustCursor;
  dustCursor = (dustCursor + 1) % DUST_COUNT;
  dustPositions[index * 3] = x + (Math.random() - 0.5) * 0.8;
  dustPositions[index * 3 + 1] = y + Math.random() * 0.3;
  dustPositions[index * 3 + 2] = z + (Math.random() - 0.5) * 0.8;
  dustVelocity[index * 3] = (Math.random() - 0.5) * 1.6;
  dustVelocity[index * 3 + 1] = 0.35 + Math.random() * 0.55;
  dustVelocity[index * 3 + 2] = (Math.random() - 0.5) * 1.6;
  dustLife[index] = (0.9 + Math.random() * 0.9) * strength;
}

function updateDust(dt) {
  for (let i = 0; i < DUST_COUNT; i += 1) {
    if (dustLife[i] <= 0) continue;
    dustLife[i] -= dt;
    if (dustLife[i] <= 0) {
      dustPositions[i * 3 + 1] = -100;
      continue;
    }
    dustPositions[i * 3] += dustVelocity[i * 3] * dt;
    dustPositions[i * 3 + 1] += dustVelocity[i * 3 + 1] * dt;
    dustPositions[i * 3 + 2] += dustVelocity[i * 3 + 2] * dt;
    dustVelocity[i * 3] *= 0.985;
    dustVelocity[i * 3 + 1] *= 0.99;
    dustVelocity[i * 3 + 2] *= 0.985;
  }
  dustGeometry.attributes.position.needsUpdate = true;
}

const CONFETTI_COUNT = 190;
const confettiPositions = new Float32Array(CONFETTI_COUNT * 3);
const confettiVelocity = new Float32Array(CONFETTI_COUNT * 3);
const confettiColors = new Float32Array(CONFETTI_COUNT * 3);
const confettiLife = new Float32Array(CONFETTI_COUNT);
const confettiPalette = [0x78ffae, 0xffb347, 0xff6b57, 0xf5f7f8, 0x5ab9ff];
for (let i = 0; i < CONFETTI_COUNT; i += 1) confettiPositions[i * 3 + 1] = -100;
const confettiGeometry = new THREE.BufferGeometry();
confettiGeometry.setAttribute('position', new THREE.BufferAttribute(confettiPositions, 3));
confettiGeometry.setAttribute('color', new THREE.BufferAttribute(confettiColors, 3));
const confettiMaterial = new THREE.PointsMaterial({
  size: 0.24,
  vertexColors: true,
  transparent: true,
  opacity: 0.96,
  depthWrite: false,
});
const confettiPoints = new THREE.Points(confettiGeometry, confettiMaterial);
confettiPoints.frustumCulled = false;
scene.add(confettiPoints);

function spawnConfetti(origin) {
  const color = new THREE.Color();
  for (let i = 0; i < CONFETTI_COUNT; i += 1) {
    confettiPositions[i * 3] = origin.x + (Math.random() - 0.5) * 8;
    confettiPositions[i * 3 + 1] = 1.4 + Math.random() * 4;
    confettiPositions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 10;
    const angle = Math.random() * TAU;
    const speed = 1.5 + Math.random() * 5;
    confettiVelocity[i * 3] = Math.cos(angle) * speed;
    confettiVelocity[i * 3 + 1] = 2.5 + Math.random() * 5.5;
    confettiVelocity[i * 3 + 2] = Math.sin(angle) * speed;
    confettiLife[i] = 2.4 + Math.random() * 2.2;
    color.setHex(confettiPalette[i % confettiPalette.length]);
    confettiColors[i * 3] = color.r;
    confettiColors[i * 3 + 1] = color.g;
    confettiColors[i * 3 + 2] = color.b;
  }
  confettiGeometry.attributes.position.needsUpdate = true;
  confettiGeometry.attributes.color.needsUpdate = true;
}

function updateConfetti(dt) {
  for (let i = 0; i < CONFETTI_COUNT; i += 1) {
    if (confettiLife[i] <= 0) continue;
    confettiLife[i] -= dt;
    if (confettiLife[i] <= 0) {
      confettiPositions[i * 3 + 1] = -100;
      continue;
    }
    confettiVelocity[i * 3 + 1] -= 5.5 * dt;
    confettiPositions[i * 3] += confettiVelocity[i * 3] * dt;
    confettiPositions[i * 3 + 1] += confettiVelocity[i * 3 + 1] * dt;
    confettiPositions[i * 3 + 2] += confettiVelocity[i * 3 + 2] * dt;
    confettiVelocity[i * 3] *= 0.99;
    confettiVelocity[i * 3 + 2] *= 0.99;
  }
  confettiGeometry.attributes.position.needsUpdate = true;
}

/* -------------------------------------------------------------------- state */

const state = {
  mode: 'menu',
  time: 0,
  topSpeed: 0,
  best: readBest(),
  showcaseTime: 0,
  completeTime: 0,
  completeDelay: 0,
  lastResult: null,
};

const vehicle = {
  speed: 0,
  heading: 0,
  steer: 0,
  acceleration: 0,
};

const keys = new Set();
const touchState = { left: 0, right: 0, throttle: 0, brake: 0 };
const activePointers = new Map();
const input = { throttle: 0, brake: 0, steer: 0 };
const transientHint = { text: '', time: 0, tone: '' };
let toastTimeout = null;

if (state.best) bestTimeEl.textContent = formatTime(state.best);

/* -------------------------------------------------------------------- input */

function readInput() {
  const left = keys.has('ArrowLeft') || keys.has('KeyA') || touchState.left;
  const right = keys.has('ArrowRight') || keys.has('KeyD') || touchState.right;
  const throttle = keys.has('ArrowUp') || keys.has('KeyW') || touchState.throttle;
  const brake = keys.has('ArrowDown') || keys.has('KeyS') || keys.has('Space') || touchState.brake;
  input.throttle = throttle ? 1 : 0;
  input.brake = brake ? 1 : 0;
  input.steer = (left ? 1 : 0) - (right ? 1 : 0);
}

function bindTouchControls() {
  const buttons = document.querySelectorAll('[data-action]');
  for (const button of buttons) {
    const action = button.dataset.action;
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      activePointers.set(event.pointerId, { action, button });
      touchState[action] = 1;
      button.classList.add('is-active');
      if (state.mode === 'menu') startGame();
    });
    const release = (event) => {
      const record = activePointers.get(event.pointerId);
      if (!record) return;
      activePointers.delete(event.pointerId);
      const stillHeld = [...activePointers.values()].some((entry) => entry.action === action);
      if (!stillHeld) {
        touchState[action] = 0;
        button.classList.remove('is-active');
      }
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  }
}

/* ------------------------------------------------------------- camera + hud */

const cameraDesired = new THREE.Vector3();
const cameraLook = new THREE.Vector3();
const cameraUpAxis = new THREE.Vector3(0, 1, 0);

function portraitFactor() {
  return clamp((1.05 - camera.aspect) * 1.35, 0, 1);
}

function gameCameraOffset(speedFactor, portrait) {
  return new THREE.Vector3(
    -1.4,
    5.7 + speedFactor * 0.42 + portrait * 0.9,
    15.2 + speedFactor * 2.8 + portrait * 6.2,
  );
}

function gameCameraLook(speedFactor) {
  const lookAhead = 8.5 + speedFactor * 7;
  return new THREE.Vector3(
    truck.position.x - Math.sin(vehicle.heading) * lookAhead,
    2.05 + speedFactor * 0.22,
    truck.position.z - Math.cos(vehicle.heading) * lookAhead,
  );
}

function snapGameCamera() {
  const speedFactor = clamp(Math.abs(vehicle.speed) / MAX_SPEED, 0, 1);
  const portrait = portraitFactor();
  const offset = gameCameraOffset(speedFactor, portrait).applyAxisAngle(cameraUpAxis, vehicle.heading);
  camera.position.copy(truck.position).add(offset);
  camera.position.y = Math.max(camera.position.y, 2.6);
  camera.lookAt(gameCameraLook(speedFactor));
  camera.fov = 54 + speedFactor * 10 + portrait * 9;
  camera.updateProjectionMatrix();
}

function menuCameraPose() {
  const portrait = camera.aspect < 1;
  const angle = (portrait ? 0.94 : 1.02) + Math.sin(state.showcaseTime * 0.17) * 0.08;
  const radius = portrait ? 20 : 18;
  const position = new THREE.Vector3(
    truck.position.x + Math.sin(angle) * radius,
    portrait ? 4.1 : 6.2,
    truck.position.z + Math.cos(angle) * radius,
  );
  const look = new THREE.Vector3(
    truck.position.x - (portrait ? 0.8 : 6.0),
    portrait ? 0.7 : 1.7,
    truck.position.z - 1.2,
  );
  return { position, look };
}

function snapMenuCamera() {
  const pose = menuCameraPose();
  camera.position.copy(pose.position);
  camera.lookAt(pose.look);
  camera.fov = 52;
  camera.updateProjectionMatrix();
}

function updateCamera(dt) {
  const speedFactor = clamp(Math.abs(vehicle.speed) / MAX_SPEED, 0, 1);
  if (state.mode === 'menu') {
    const pose = menuCameraPose();
    cameraDesired.copy(pose.position);
    camera.position.lerp(cameraDesired, 1 - Math.exp(-dt * 2.4));
    cameraLook.copy(pose.look);
    camera.lookAt(cameraLook);
    camera.fov = damp(camera.fov, 52, 2.2, dt);
  } else if (state.mode === 'complete') {
    const angle = 0.7 + state.completeTime * 0.16;
    cameraDesired.set(
      truck.position.x + Math.sin(angle) * 11.5,
      5.2,
      truck.position.z + Math.cos(angle) * 11.5,
    );
    camera.position.lerp(cameraDesired, 1 - Math.exp(-dt * 2.1));
    cameraLook.set(truck.position.x, 1.7, truck.position.z);
    camera.lookAt(cameraLook);
    camera.fov = damp(camera.fov, 52, 2, dt);
  } else {
    const portrait = portraitFactor();
    const offset = gameCameraOffset(speedFactor, portrait);
    offset.applyAxisAngle(cameraUpAxis, vehicle.heading);
    cameraDesired.copy(truck.position).add(offset);
    cameraDesired.y = Math.max(cameraDesired.y, 2.6);
    camera.position.lerp(cameraDesired, 1 - Math.exp(-dt * (state.mode === 'paused' ? 2.2 : 4.6)));
    cameraLook.copy(gameCameraLook(speedFactor));
    camera.lookAt(cameraLook);
    camera.fov = damp(camera.fov, 54 + speedFactor * 10 + portrait * 9, 2.6, dt);
    const offRoad = Math.abs(truck.position.x) > ROAD_HALF + 0.8;
    if (offRoad && Math.abs(vehicle.speed) > 2) {
      camera.position.y += (Math.random() - 0.5) * 0.035;
      camera.position.x += (Math.random() - 0.5) * 0.025;
    }
  }
  camera.updateProjectionMatrix();
}

function updateHud() {
  const kmh = Math.round(Math.abs(vehicle.speed) * 3.6);
  speedValue.textContent = String(kmh);
  gearValue.textContent = vehicle.speed < -0.35 ? 'R' : vehicle.speed > 0.35 ? 'D' : 'N';
  timeLabel.textContent = formatTime(state.time);
  panelTime.textContent = formatTime(state.time);

  const remaining = Math.max(0, truck.position.z - DEST_Z);
  distanceLabel.textContent = `${(remaining / 1000).toFixed(2)} km`;
  const progress = clamp((START_Z - truck.position.z) / RUN_DISTANCE, 0, 1);
  const percent = progress * 100;
  progressFill.style.width = `${percent.toFixed(2)}%`;
  progressTruck.style.left = `${percent.toFixed(2)}%`;
  progressLabel.textContent = progress > 0.97 ? 'FINAL APPROACH' : 'DELIVERY RUN';

  const offRoad = Math.abs(truck.position.x) > ROAD_HALF + 0.8;
  surfaceLabel.textContent = offRoad ? 'OFF ROAD' : 'ASPHALT';
  surfaceLabel.classList.toggle('off-road', offRoad);
}

function showHint(text, duration = 2.8, tone = '') {
  transientHint.text = text;
  transientHint.time = duration;
  transientHint.tone = tone;
}

function updateHint(dt) {
  if (transientHint.time > 0) transientHint.time -= dt;
  if (state.mode !== 'playing') {
    hintEl.classList.remove('is-visible', 'is-warning', 'is-go');
    return;
  }
  const offRoad = Math.abs(truck.position.x) > ROAD_HALF + 0.8;
  const inZone = Math.abs(truck.position.z - DEST_Z) < 16 && Math.abs(truck.position.x) < 5.9;
  const remaining = truck.position.z - DEST_Z;
  let text = '';
  let tone = '';
  if (inZone && Math.abs(vehicle.speed) > 1.3) {
    text = 'STOP INSIDE THE GREEN ZONE';
    tone = 'is-go';
  } else if (truck.position.z < DEST_Z - 16) {
    text = 'TURN AROUND — THE DEPOT IS BEHIND YOU';
    tone = 'is-warning';
  } else if (remaining < 280) {
    text = 'DEPOT AHEAD — STOP IN THE GREEN ZONE';
    tone = 'is-go';
  } else if (offRoad) {
    text = 'OFF ROAD — RETURN TO THE ASPHALT';
    tone = 'is-warning';
  } else if (transientHint.time > 0) {
    text = transientHint.text;
    tone = transientHint.tone;
  }
  if (!text) {
    hintEl.classList.remove('is-visible', 'is-warning', 'is-go');
    return;
  }
  hintEl.textContent = text;
  hintEl.classList.add('is-visible');
  hintEl.classList.toggle('is-warning', tone === 'is-warning');
  hintEl.classList.toggle('is-go', tone === 'is-go');
}

function showToast(text, duration = 2400) {
  toastEl.textContent = text;
  toastEl.classList.add('is-visible');
  if (toastTimeout) window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toastEl.classList.remove('is-visible'), duration);
}

function setHudVisible(visible) {
  hud.classList.toggle('is-hidden', !visible);
  speedPanel.classList.toggle('is-hidden', !visible);
  touchControls.classList.toggle('is-hidden', !visible);
}

/* --------------------------------------------------------------- game flow */

function resetRun() {
  vehicle.speed = 0;
  vehicle.heading = 0;
  vehicle.steer = 0;
  vehicle.acceleration = 0;
  truck.position.set(2.8, 0, START_Z);
  truck.rotation.y = 0;
  truckVisual.rotation.set(0, 0, 0);
  truckVisual.position.y = 0;
  truck.updateMatrixWorld(true);
  for (const wheel of wheels) wheel.spin.rotation.x = 0;
  for (const wheel of wheels) wheel.pivot.rotation.y = 0;
  state.time = 0;
  state.topSpeed = 0;
  state.completeTime = 0;
  state.completeDelay = 0;
  state.lastResult = null;
  input.throttle = 0;
  input.brake = 0;
  input.steer = 0;
  transientHint.time = 0;
  updateHud();
}

function startGame() {
  if (state.mode === 'paused') {
    resumeGame();
    return;
  }
  if (state.mode === 'playing') return;
  audio.init();
  if (state.mode === 'menu' || state.mode === 'complete') resetRun();
  state.mode = 'playing';
  snapGameCamera();
  startScreen.hidden = true;
  pauseScreen.hidden = true;
  completeScreen.hidden = true;
  setHudVisible(true);
  showHint('FOLLOW THE ROAD TO THE DEPOT', 3.2);
}

function resumeGame() {
  if (state.mode !== 'paused') return;
  state.mode = 'playing';
  pauseScreen.hidden = true;
  setHudVisible(true);
  showHint('BACK ON THE ROAD', 1.8);
}

function pauseGame() {
  if (state.mode !== 'playing') return;
  state.mode = 'paused';
  pauseScreen.hidden = false;
  setHudVisible(false);
  keys.clear();
  input.throttle = 0;
  input.brake = 0;
  input.steer = 0;
  for (const action of Object.keys(touchState)) touchState[action] = 0;
  for (const button of document.querySelectorAll('[data-action]')) button.classList.remove('is-active');
  activePointers.clear();
}

function togglePause() {
  if (state.mode === 'playing') pauseGame();
  else if (state.mode === 'paused') resumeGame();
}

function restartRun() {
  audio.init();
  resetRun();
  state.mode = 'playing';
  snapGameCamera();
  startScreen.hidden = true;
  pauseScreen.hidden = true;
  completeScreen.hidden = true;
  setHudVisible(true);
  showHint('NEW RUN — FOLLOW THE ROAD', 2.6);
}

function toggleMute() {
  const muted = audio.toggleMute();
  muteBtn.classList.toggle('is-off', muted);
  muteBtn.setAttribute('aria-pressed', String(muted));
  muteBtn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
}

function finishRun() {
  if (state.mode !== 'playing') return;
  state.mode = 'complete';
  state.completeTime = 0;
  state.completeDelay = 1.05;
  vehicle.speed = 0;
  vehicle.steer = 0;
  state.lastResult = {
    time: state.time,
    topSpeed: state.topSpeed,
    isRecord: !state.best || state.time < state.best,
  };
  if (state.lastResult.isRecord) {
    state.best = state.time;
    writeBest(state.best);
    bestTimeEl.textContent = formatTime(state.best);
  }
  audio.chime();
  spawnConfetti(new THREE.Vector3(0, 1.4, DEST_Z));
  showToast('LOAD DELIVERED — NICE PARKING', 2600);
}

function showCompleteScreen() {
  if (!state.lastResult) return;
  resultTimeEl.textContent = formatTime(state.lastResult.time);
  resultSpeedEl.textContent = `${Math.round(state.lastResult.topSpeed)} km/h`;
  recordLabel.hidden = !state.lastResult.isRecord;
  completeScreen.hidden = false;
  setHudVisible(false);
}

/* ----------------------------------------------------------------- physics */

function updateVehicle(dt) {
  const offRoad = Math.abs(truck.position.x) > ROAD_HALF + 0.8;
  const speedAbs = Math.abs(vehicle.speed);
  const speedFactor = clamp(speedAbs / MAX_SPEED, 0, 1);
  const maxSteer = 0.58 * (1 - speedFactor * 0.52);
  const targetSteer = input.steer * maxSteer;
  vehicle.steer = damp(vehicle.steer, targetSteer, input.steer === 0 ? 8 : 5.5, dt);

  let acceleration = 0;
  if (input.throttle) {
    if (vehicle.speed < -0.4) acceleration += 16;
    else acceleration += 7.4 * (1 - clamp(vehicle.speed / MAX_SPEED, 0, 0.94) * 0.58);
  }
  if (input.brake) {
    if (vehicle.speed > 0.4) acceleration -= 19;
    else acceleration -= 5.2;
  }
  if (!input.throttle && !input.brake) {
    const rolling = 1.05 + speedAbs * 0.075;
    acceleration -= Math.sign(vehicle.speed) * Math.min(speedAbs / Math.max(dt, 0.001), rolling);
  }
  acceleration -= vehicle.speed * 0.025;
  if (offRoad) acceleration -= Math.sign(vehicle.speed) * (2.8 + speedAbs * 0.18);

  vehicle.acceleration = acceleration;
  vehicle.speed += acceleration * dt;
  const maxForward = offRoad ? 11 : MAX_SPEED;
  const maxReverse = offRoad ? 5 : MAX_REVERSE;
  vehicle.speed = clamp(vehicle.speed, -maxReverse, maxForward);
  if (Math.abs(vehicle.speed) < 0.035 && !input.throttle && !input.brake) vehicle.speed = 0;

  if (Math.abs(vehicle.speed) > 0.04) {
    vehicle.heading += (vehicle.speed / 4.85) * Math.tan(vehicle.steer) * dt;
  }

  const forwardX = -Math.sin(vehicle.heading);
  const forwardZ = -Math.cos(vehicle.heading);
  truck.position.x += forwardX * vehicle.speed * dt;
  truck.position.z += forwardZ * vehicle.speed * dt;
  truck.position.x = clamp(truck.position.x, -150, 150);
  truck.position.z = clamp(truck.position.z, -1520, 90);
  truck.rotation.y = vehicle.heading;
  truck.updateMatrixWorld(true);

  const targetRoll = -vehicle.steer * clamp(speedAbs / MAX_SPEED, 0, 1) * 0.24;
  const targetPitch = -acceleration * 0.006;
  truckVisual.rotation.z = damp(truckVisual.rotation.z, targetRoll, 5.5, dt);
  truckVisual.rotation.x = damp(truckVisual.rotation.x, targetPitch, 5.5, dt);
  const bob = offRoad && speedAbs > 1 ? Math.sin(performance.now() * 0.03) * 0.012 * speedAbs : 0;
  truckVisual.position.y = damp(truckVisual.position.y, bob, 12, dt);

  const spinDelta = (vehicle.speed * dt) / 0.5;
  for (const wheel of wheels) {
    wheel.spin.rotation.x += spinDelta;
    if (wheel.steerable) wheel.pivot.rotation.y = vehicle.steer;
  }

  state.topSpeed = Math.max(state.topSpeed, speedAbs * 3.6);

  const shouldDust = (offRoad && speedAbs > 2.5) || (input.brake && speedAbs > 11);
  if (shouldDust) {
    dustTimer -= dt;
    if (dustTimer <= 0) {
      dustTimer = 0.035;
      for (const side of [-1, 1]) {
        const localX = side * 0.95;
        const localZ = 2.7;
        const worldX = truck.position.x + Math.cos(vehicle.heading) * localX + Math.sin(vehicle.heading) * localZ;
        const worldZ = truck.position.z - Math.sin(vehicle.heading) * localX + Math.cos(vehicle.heading) * localZ;
        spawnDust(worldX, 0.18, worldZ, offRoad ? 1 : 0.55);
      }
    }
  } else {
    dustTimer = 0;
  }
}

function checkGoal() {
  const inZone = Math.abs(truck.position.z - DEST_Z) < 16 && Math.abs(truck.position.x) < 5.9;
  if (inZone && Math.abs(vehicle.speed) < 1.25) finishRun();
}

/* ------------------------------------------------------------------- update */

function update(dt) {
  state.showcaseTime += dt;

  for (const cloud of clouds) {
    cloud.position.x += cloud.userData.speed * dt;
    if (cloud.position.x > 620) cloud.position.x = -620;
  }

  if (state.mode === 'playing') {
    state.time += dt;
    readInput();
    updateVehicle(dt);
    checkGoal();
  } else if (state.mode === 'complete') {
    state.completeTime += dt;
    if (state.completeDelay > 0) {
      state.completeDelay -= dt;
      if (state.completeDelay <= 0) showCompleteScreen();
    }
  }

  updateDust(dt);
  updateConfetti(dt);
  updateCamera(dt);
  updateHud();
  updateHint(dt);

  sun.position.set(truck.position.x + 55, 90, truck.position.z + 40);
  sun.target.position.set(truck.position.x, 0, truck.position.z - 10);
  sun.target.updateMatrixWorld();
  sky.position.copy(camera.position);

  const pulse = 0.5 + Math.sin(state.showcaseTime * 2.4) * 0.5;
  zoneMaterial.opacity = 0.14 + pulse * 0.075;
  zoneWallMaterial.opacity = 0.035 + pulse * 0.04;
  goalMarker.rotation.y += dt * 1.4;
  goalMarker.position.y = 8.2 + Math.sin(state.showcaseTime * 1.8) * 0.22;
  goalGlow.position.y = goalMarker.position.y;
  goalGlow.material.opacity = 0.44 + pulse * 0.24;
  goalGlow.scale.setScalar(4.8 + pulse * 0.9);

  audio.update(vehicle.speed, state.mode === 'playing' ? input.throttle : 0, state.mode === 'playing');
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
}

/* --------------------------------------------------------------------- boot */

function bindKeyboard() {
  window.addEventListener('keydown', (event) => {
    const code = event.code;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) event.preventDefault();
    if (event.repeat) return;
    keys.add(code);
    if (code === 'Enter') {
      if (state.mode === 'menu' || state.mode === 'complete') startGame();
      else if (state.mode === 'paused') resumeGame();
    } else if (code === 'KeyP' || code === 'Escape') {
      if (state.mode === 'playing') pauseGame();
      else if (state.mode === 'paused') resumeGame();
    } else if (code === 'KeyR') {
      if (state.mode === 'playing' || state.mode === 'paused' || state.mode === 'complete') restartRun();
    } else if (code === 'KeyM') {
      toggleMute();
    } else if (code === 'KeyH') {
      audio.horn();
    }
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => {
    keys.clear();
    for (const action of Object.keys(touchState)) touchState[action] = 0;
    for (const button of document.querySelectorAll('[data-action]')) button.classList.remove('is-active');
    activePointers.clear();
  });
}

function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(width, height, false);
}

function boot() {
  bindTouchControls();
  bindKeyboard();
  $('#start-btn').addEventListener('click', startGame);
  $('#again-btn').addEventListener('click', restartRun);
  $('#resume-btn').addEventListener('click', resumeGame);
  $('#restart-btn').addEventListener('click', restartRun);
  pauseBtn.addEventListener('click', togglePause);
  muteBtn.addEventListener('click', toggleMute);
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.mode === 'playing') pauseGame();
  });

  onResize();
  setHudVisible(false);
  snapMenuCamera();
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
  window.setTimeout(() => loadingEl.classList.add('is-done'), 420);
}

boot();




