const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { verifyToken, extractTokenFromRequest } = require('./auth.js');

const SERVER_BOOT_ID = typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : crypto.randomBytes(16).toString('hex');

function withBootId(state) {
  if (!state || typeof state !== 'object') return state;
  return { ...state, serverBootId: SERVER_BOOT_ID };
}

const SEED_FILE = path.join(process.cwd(), 'CCHSMeetingDashboard', 'data.json');
const DEFAULT_RUNTIME_STATE_PATH = path.join(process.cwd(), 'data', 'runtime-state.json');
const READONLY_FS_FALLBACK_PATH = path.join(os.tmpdir(), 'cchs_hq_runtime_state.json');
const FIREBASE_RTDB_URL = process.env.FIREBASE_DATABASE_URL || 'https://cchsmeetingdashboard-default-rtdb.asia-southeast1.firebasedatabase.app';

const SERVICE_KEYS = ['departmentUpdate', 'roomBooking', 'screenShare', 'pdfStudio'];
const DEFAULT_SERVICE_TOGGLES = {
  departmentUpdate: { enabled: true, notice: '', updatedAt: 0 },
  roomBooking: { enabled: true, notice: '', updatedAt: 0 },
  screenShare: { enabled: true, notice: '', updatedAt: 0 },
  pdfStudio: { enabled: true, notice: '', updatedAt: 0 }
};

const DEFAULT_SLIDE_CONTROL = {
  currentSlideIndex: 0,
  totalSlides: 0,
  currentSlideLabel: 'Overview',
  autoPlay: false,
  autoPlayIntervalMs: 8000,
  commandSeq: 0,
  lastCommand: null,
  refreshNonce: 0,
  updatedAt: 0
};

const DEFAULT_ROOMS = [
  {
    id: "boardroom-main",
    name: "HQ Main Boardroom",
    floor: "Level 1 - Executive Wing",
    capacity: 20,
    amenities: ["75\" 4K Smart TV", "Video Conferencing", "Glass Whiteboard", "HDMI / Wireless Cast"],
    color: "#1863dc",
    status: "available"
  },
  {
    id: "discussion-a",
    name: "Discussion Room A (CareHub)",
    floor: "Level 1 - Central Zone",
    capacity: 8,
    amenities: ["55\" TV Display", "Whiteboard", "Speakerphone"],
    color: "#00b894",
    status: "available"
  },
  {
    id: "discussion-b",
    name: "Discussion Room B (Clinical)",
    floor: "Level 1 - Operations Wing",
    capacity: 6,
    amenities: ["50\" Monitor", "Whiteboard"],
    color: "#6c5ce7",
    status: "available"
  },
  {
    id: "townhall-hub",
    name: "Townhall & Training Suite",
    floor: "Level 2 - Training Center",
    capacity: 50,
    amenities: ["Dual Projector / TV", "Wireless Mic System", "Livestream Setup"],
    color: "#e17055",
    status: "available"
  },
  {
    id: "pod-telehealth",
    name: "Focus Pod 1 (Telehealth / PMI)",
    floor: "Level 1 - Quiet Zone",
    capacity: 4,
    amenities: ["Acoustic Soundproofing", "Ring Light & Webcam"],
    color: "#0984e3",
    status: "available"
  }
];

function getDefaultBookings() {
  const today = new Date().toISOString().slice(0, 10);
  return [
    {
      id: "bk-seed-1",
      roomId: "boardroom-main",
      title: "Weekly HQ Management Alignment",
      department: "CEO OFFICE",
      organizer: "HQ Management",
      date: today,
      startTime: "09:00",
      endTime: "10:30",
      notes: "Monthly & Weekly Department Alignment Broadcast on Main TV.",
      createdAt: Date.now() - 3600000
    },
    {
      id: "bk-seed-2",
      roomId: "discussion-a",
      title: "IT Asset Audit & Laptop Inventory Sync",
      department: "IT",
      organizer: "IT Support Team",
      date: today,
      startTime: "11:00",
      endTime: "12:00",
      notes: "Reviewing HQ staff laptop and monitor serial numbers.",
      createdAt: Date.now() - 1800000
    },
    {
      id: "bk-seed-3",
      roomId: "townhall-hub",
      title: "TPP SystmOne Clinical Workflow Onboarding",
      department: "TPP SYSTMONE",
      organizer: "Clinical & SystmOne Team",
      date: today,
      startTime: "14:00",
      endTime: "16:00",
      notes: "Training session for clinic operations and digital integration.",
      createdAt: Date.now() - 900000
    }
  ];
}

function getConfiguredRuntimePath() {
  return process.env.CCHS_RUNTIME_STATE_PATH
    ? path.resolve(process.env.CCHS_RUNTIME_STATE_PATH)
    : DEFAULT_RUNTIME_STATE_PATH;
}

function isReadonlyFsError(err) {
  return Boolean(err && (err.code === 'EROFS' || err.code === 'EACCES' || err.code === 'EPERM'));
}

function writeAtomicFile(targetPath, dataStr) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, dataStr, 'utf8');
    try {
      fs.renameSync(tmpPath, targetPath);
    } catch (renameErr) {
      fs.writeFileSync(targetPath, dataStr, 'utf8');
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    throw err;
  }
}

function writeRuntimeFile(state) {
  const payload = JSON.stringify(state, null, 2);
  const configured = getConfiguredRuntimePath();
  try {
    writeAtomicFile(configured, payload);
    return configured;
  } catch (err) {
    if (isReadonlyFsError(err) && configured !== READONLY_FS_FALLBACK_PATH) {
      try {
        writeAtomicFile(READONLY_FS_FALLBACK_PATH, payload);
        return READONLY_FS_FALLBACK_PATH;
      } catch (_) {
        return null;
      }
    }
    return null;
  }
}

function normalizeFirebaseArray(val) {
  if (!val) return null;
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === 'object') return Object.values(val).filter(Boolean);
  return null;
}

function getMaxRoomUpdatedAt(rooms) {
  if (!Array.isArray(rooms) || rooms.length === 0) return 0;
  let maxTs = 0;
  for (const r of rooms) {
    const ts = Number(r && r.updatedAt) || 0;
    if (ts > maxTs) maxTs = ts;
  }
  return maxTs;
}

function normalizeServiceToggles(rawToggles, fallbackToggles = DEFAULT_SERVICE_TOGGLES) {
  const src = rawToggles && typeof rawToggles === 'object' ? rawToggles : {};
  const fb = fallbackToggles && typeof fallbackToggles === 'object' ? fallbackToggles : DEFAULT_SERVICE_TOGGLES;
  const out = {};
  for (const key of SERVICE_KEYS) {
    const baseEntry = fb[key] && typeof fb[key] === 'object' ? fb[key] : DEFAULT_SERVICE_TOGGLES[key];
    const entry = src[key];
    if (entry === undefined) {
      out[key] = {
        enabled: baseEntry.enabled !== false,
        notice: typeof baseEntry.notice === 'string' ? baseEntry.notice : '',
        updatedAt: Number.isFinite(Number(baseEntry.updatedAt)) ? Number(baseEntry.updatedAt) : 0
      };
    } else if (typeof entry === 'boolean') {
      out[key] = {
        enabled: entry,
        notice: typeof baseEntry.notice === 'string' ? baseEntry.notice : '',
        updatedAt: Number.isFinite(Number(baseEntry.updatedAt)) ? Number(baseEntry.updatedAt) : 0
      };
    } else if (entry && typeof entry === 'object') {
      out[key] = {
        enabled: entry.enabled !== false,
        notice: typeof entry.notice === 'string' ? entry.notice : '',
        updatedAt: Number.isFinite(Number(entry.updatedAt)) ? Number(entry.updatedAt) : (Number(baseEntry.updatedAt) || 0)
      };
    } else {
      out[key] = { ...DEFAULT_SERVICE_TOGGLES[key] };
    }
  }
  return out;
}

function computeMeetingSlides(state) {
  const departments = Object.keys((state && state.departments) || {});
  const config = (state && state.config) || {};
  const slides = [{ index: 0, label: 'Overview', type: 'overview', icon: '❯' }];

  for (const dept of departments) {
    slides.push({
      index: slides.length,
      label: `${dept} Update`,
      type: 'department-update',
      department: dept,
      icon: '❯'
    });
    if (config.showQnA !== false) {
      slides.push({
        index: slides.length,
        label: `${dept} Q&A`,
        type: 'department-qna',
        department: dept,
        icon: '🎲'
      });
    }
  }

  if (config.showVisionMission !== false) {
    slides.push({
      index: slides.length,
      label: 'Vision & Mission',
      type: 'vision-mission',
      icon: '❯'
    });
  }

  slides.push({
    index: slides.length,
    label: 'Tagline',
    type: 'tagline',
    icon: '❯'
  });

  if (config.showDailyPhrases !== false) {
    slides.push({
      index: slides.length,
      label: 'Care Quality Phrases',
      type: 'phrases',
      icon: '❯'
    });
  }

  if (config.showLastMinuteSpeech === true) {
    slides.push({
      index: slides.length,
      label: 'C-Suite Closing Remarks',
      type: 'closing-remarks',
      icon: '❯'
    });
  }

  return slides;
}

function normalizeSlideControl(state) {
  if (!state.remoteDisplay || typeof state.remoteDisplay !== 'object') {
    state.remoteDisplay = {
      activeMode: 'meeting-tv',
      activePresenterId: null,
      presenters: [],
      modeUpdatedAt: 0
    };
  }
  const slides = computeMeetingSlides(state);
  const totalSlides = slides.length;
  const rawSc = state.remoteDisplay.slideControl && typeof state.remoteDisplay.slideControl === 'object'
    ? state.remoteDisplay.slideControl
    : {};

  let idx = Math.trunc(Number(rawSc.currentSlideIndex) || 0);
  if (!Number.isFinite(idx) || idx < 0) idx = 0;
  if (idx >= totalSlides) idx = totalSlides - 1;

  const rawInterval = Number(rawSc.autoPlayIntervalMs);
  const autoPlayIntervalMs = Number.isFinite(rawInterval) && rawInterval >= 1000
    ? Math.trunc(rawInterval)
    : DEFAULT_SLIDE_CONTROL.autoPlayIntervalMs;

  const rawSeq = Number(rawSc.commandSeq);
  const commandSeq = Number.isFinite(rawSeq) && rawSeq >= 0 ? Math.trunc(rawSeq) : 0;

  const rawNonce = Number(rawSc.refreshNonce);
  const refreshNonce = Number.isFinite(rawNonce) && rawNonce >= 0 ? Math.trunc(rawNonce) : 0;

  const rawUpdated = Number(rawSc.updatedAt);
  const updatedAt = Number.isFinite(rawUpdated) && rawUpdated >= 0 ? rawUpdated : 0;

  state.remoteDisplay.slideControl = {
    currentSlideIndex: idx,
    totalSlides,
    currentSlideLabel: (slides[idx] && slides[idx].label) || 'Overview',
    autoPlay: Boolean(rawSc.autoPlay),
    autoPlayIntervalMs,
    commandSeq,
    lastCommand: typeof rawSc.lastCommand === 'string' ? rawSc.lastCommand : null,
    refreshNonce,
    updatedAt
  };
  return state.remoteDisplay.slideControl;
}

function ensureRemoteDisplay(state) {
  if (!state.remoteDisplay || typeof state.remoteDisplay !== 'object') {
    state.remoteDisplay = {
      activeMode: 'meeting-tv',
      activePresenterId: null,
      presenters: [],
      modeUpdatedAt: 0
    };
  }
  if (!Array.isArray(state.remoteDisplay.presenters)) {
    state.remoteDisplay.presenters = [];
  }
  normalizeSlideControl(state);
  return state.remoteDisplay;
}

// Non-blocking background sync to Firebase Realtime Database REST API when rules/secret permit
function mirrorNodeToFirebase(nodePath, payload) {
  try {
    if (!FIREBASE_RTDB_URL || FIREBASE_RTDB_URL === 'disabled') return;
    const secret = process.env.FIREBASE_DATABASE_SECRET || process.env.FIREBASE_AUTH_TOKEN || '';
    const cleanPath = String(nodePath || '').replace(/^\/+/, '');
    const baseUrl = FIREBASE_RTDB_URL.replace(/\/+$/, '');
    const targetUrl = `${baseUrl}/${cleanPath}.json${secret ? `?auth=${encodeURIComponent(secret)}` : ''}`;
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'http:' ? http : https;
    const bodyStr = JSON.stringify(payload);
    const req = client.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr)
        },
        timeout: 4000
      },
      (res) => { res.resume(); }
    );
    req.on('error', () => {});
    req.write(bodyStr);
    req.end();
  } catch (e) {
    // ignore
  }
}

function fetchFirebaseNode(nodePath, timeoutMs = 2500) {
  return new Promise((resolve) => {
    if (!FIREBASE_RTDB_URL || FIREBASE_RTDB_URL === 'disabled' || process.env.CCHS_DISABLE_FIREBASE_HYDRATION === '1') {
      return resolve(null);
    }
    let settled = false;
    let timer = null;
    let req = null;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(val);
    };
    try {
      const secret = process.env.FIREBASE_DATABASE_SECRET || process.env.FIREBASE_AUTH_TOKEN || '';
      const cleanPath = String(nodePath || '').replace(/^\/+/, '');
      const baseUrl = FIREBASE_RTDB_URL.replace(/\/+$/, '');
      const targetUrl = `${baseUrl}/${cleanPath}.json${secret ? `?auth=${encodeURIComponent(secret)}` : ''}`;
      const parsed = new URL(targetUrl);
      const client = parsed.protocol === 'http:' ? http : https;

      timer = setTimeout(() => {
        try { if (req) req.destroy(); } catch (_) {}
        finish(null);
      }, timeoutMs);

      req = client.get(
        {
          hostname: parsed.hostname,
          port: parsed.port || undefined,
          path: parsed.pathname + parsed.search,
          timeout: timeoutMs
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            return finish(null);
          }
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { raw += chunk; });
          res.on('end', () => {
            try {
              finish(raw ? JSON.parse(raw) : null);
            } catch (_) {
              finish(null);
            }
          });
        }
      );
      req.setTimeout(timeoutMs, () => {
        try { req.destroy(); } catch (_) {}
        finish(null);
      });
      req.on('error', () => finish(null));
    } catch (_) {
      finish(null);
    }
  });
}

function loadDefaultState() {
  const defaultConfig = {
    showQnA: false,
    showDailyPhrases: true,
    showVisionMission: true,
    showLastMinuteSpeech: true,
    visionText: "Empower patients with the freedom to access quality healthcare services through digital integration anytime, anywhere.",
    missionText: "Deliver quality personalised care by merging of best medical practises with modern technology. ",
    phrases: ["Humanising Care."],
    lastMinuteSpeechText: "Good afternoon, everyone. Thank you for being here today.As we look back at where we started this year, I want to begin with a simple thank you. We faced real shifts and unexpected hurdles. Because of your hard work, your creativity, and your care for one another, we did not just get through it—we adapted and grew. Every milestone we reached belongs to this team.",
    serviceToggles: normalizeServiceToggles(DEFAULT_SERVICE_TOGGLES)
  };

  let seed = {
    config: defaultConfig,
    departments: {},
    history: [],
    rooms: DEFAULT_ROOMS,
    roomsUpdatedAt: 0,
    roomsMeta: { updatedAt: 0, source: 'seed' },
    bookings: getDefaultBookings(),
    remoteDisplay: {
      activeMode: 'meeting-tv',
      activePresenterId: null,
      presenters: [],
      modeUpdatedAt: 0,
      slideControl: { ...DEFAULT_SLIDE_CONTROL }
    }
  };

  try {
    if (fs.existsSync(SEED_FILE)) {
      const diskSeed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
      const diskConfig = (diskSeed && diskSeed.config && typeof diskSeed.config === 'object') ? diskSeed.config : {};
      seed = {
        ...seed,
        ...diskSeed,
        config: {
          ...defaultConfig,
          ...diskConfig,
          serviceToggles: normalizeServiceToggles(diskConfig.serviceToggles, defaultConfig.serviceToggles)
        },
        rooms: Array.isArray(diskSeed.rooms) && diskSeed.rooms.length > 0 ? diskSeed.rooms : seed.rooms,
        roomsUpdatedAt: 0,
        roomsMeta: { updatedAt: 0, source: 'seed' },
        bookings: Array.isArray(diskSeed.bookings) ? diskSeed.bookings : seed.bookings
      };
    }
  } catch (e) {
    // Use fallback seed
  }

  ensureRemoteDisplay(seed);
  return seed;
}

function normalizeLoadedState(raw, fallbackState) {
  const base = fallbackState || loadDefaultState();
  if (!raw || typeof raw !== 'object') return base;

  const rawConfig = raw.config && typeof raw.config === 'object' ? raw.config : {};
  const normRooms = normalizeFirebaseArray(raw.rooms);
  const rooms = Array.isArray(normRooms) && normRooms.length > 0 ? normRooms : base.rooms;
  const normBookings = normalizeFirebaseArray(raw.bookings);
  const bookings = Array.isArray(normBookings) ? normBookings : base.bookings;
  const normHistory = normalizeFirebaseArray(raw.history);

  const computedRoomsTs = Math.max(
    Number(raw.roomsUpdatedAt) || 0,
    Number(raw.roomsMeta && raw.roomsMeta.updatedAt) || 0,
    getMaxRoomUpdatedAt(rooms)
  );

  const merged = {
    ...base,
    ...raw,
    config: {
      ...base.config,
      ...rawConfig,
      serviceToggles: normalizeServiceToggles(rawConfig.serviceToggles, base.config.serviceToggles)
    },
    departments: raw.departments && typeof raw.departments === 'object' && Object.keys(raw.departments).length > 0
      ? raw.departments
      : base.departments,
    history: Array.isArray(normHistory) ? normHistory : base.history,
    rooms,
    roomsUpdatedAt: computedRoomsTs,
    roomsMeta: raw.roomsMeta && typeof raw.roomsMeta === 'object'
      ? {
          updatedAt: Math.max(computedRoomsTs, Number(raw.roomsMeta.updatedAt) || 0),
          source: raw.roomsMeta.source || (computedRoomsTs > 0 ? 'persisted' : 'seed')
        }
      : { updatedAt: computedRoomsTs, source: computedRoomsTs > 0 ? 'persisted' : 'seed' },
    bookings,
    remoteDisplay: {
      ...base.remoteDisplay,
      ...(raw.remoteDisplay && typeof raw.remoteDisplay === 'object' ? raw.remoteDisplay : {}),
      presenters: Array.isArray(raw.remoteDisplay && raw.remoteDisplay.presenters)
        ? raw.remoteDisplay.presenters
        : base.remoteDisplay.presenters
    }
  };

  ensureRemoteDisplay(merged);
  return merged;
}

async function hydrateFromFirebaseIfNeeded(baseState) {
  if (!FIREBASE_RTDB_URL || FIREBASE_RTDB_URL === 'disabled' || process.env.CCHS_DISABLE_FIREBASE_HYDRATION === '1') {
    return baseState;
  }

  const [fbRoomsRaw, fbBookingsRaw, fbConfigRaw, fbDepartmentsRaw, fbRemoteDisplayRaw, fbHistoryRaw] = await Promise.all([
    fetchFirebaseNode('rooms', 2500),
    fetchFirebaseNode('bookings', 2500),
    fetchFirebaseNode('config', 2500),
    fetchFirebaseNode('departments', 2500),
    fetchFirebaseNode('remoteDisplay', 2500),
    fetchFirebaseNode('history', 2500)
  ]);

  let hydratedAny = false;
  const fbRooms = normalizeFirebaseArray(fbRoomsRaw);
  if (Array.isArray(fbRooms) && fbRooms.length > 0) {
    const maxRoomTs = getMaxRoomUpdatedAt(fbRooms);
    const roomsTs = maxRoomTs || 1;
    baseState.rooms = fbRooms;
    baseState.roomsUpdatedAt = roomsTs;
    baseState.roomsMeta = { updatedAt: roomsTs, source: 'firebase' };
    hydratedAny = true;
  }

  const fbBookings = normalizeFirebaseArray(fbBookingsRaw);
  if (Array.isArray(fbBookings)) {
    baseState.bookings = fbBookings;
    hydratedAny = true;
  }

  if (fbConfigRaw && typeof fbConfigRaw === 'object') {
    baseState.config = {
      ...baseState.config,
      ...fbConfigRaw,
      serviceToggles: normalizeServiceToggles(fbConfigRaw.serviceToggles, baseState.config.serviceToggles)
    };
    hydratedAny = true;
  }

  if (fbDepartmentsRaw && typeof fbDepartmentsRaw === 'object' && Object.keys(fbDepartmentsRaw).length > 0) {
    baseState.departments = fbDepartmentsRaw;
    hydratedAny = true;
  }

  const fbHistory = normalizeFirebaseArray(fbHistoryRaw);
  if (Array.isArray(fbHistory)) {
    baseState.history = fbHistory;
    hydratedAny = true;
  }

  if (fbRemoteDisplayRaw && typeof fbRemoteDisplayRaw === 'object') {
    const fbPresenters = normalizeFirebaseArray(fbRemoteDisplayRaw.presenters);
    baseState.remoteDisplay = {
      ...baseState.remoteDisplay,
      ...fbRemoteDisplayRaw,
      presenters: Array.isArray(fbPresenters) ? fbPresenters : baseState.remoteDisplay.presenters,
      announcement: fbRemoteDisplayRaw.announcement && typeof fbRemoteDisplayRaw.announcement === 'object'
        ? { ...(baseState.remoteDisplay.announcement || {}), ...fbRemoteDisplayRaw.announcement }
        : baseState.remoteDisplay.announcement,
      welcomeBoard: fbRemoteDisplayRaw.welcomeBoard && typeof fbRemoteDisplayRaw.welcomeBoard === 'object'
        ? { ...(baseState.remoteDisplay.welcomeBoard || {}), ...fbRemoteDisplayRaw.welcomeBoard }
        : baseState.remoteDisplay.welcomeBoard,
      slideControl: fbRemoteDisplayRaw.slideControl && typeof fbRemoteDisplayRaw.slideControl === 'object'
        ? fbRemoteDisplayRaw.slideControl
        : baseState.remoteDisplay.slideControl
    };
    hydratedAny = true;
  }

  if (hydratedAny) {
    baseState.hydratedAt = Date.now();
  }
  ensureRemoteDisplay(baseState);
  return baseState;
}

let memoryState = null;
let hydrationPromise = null;

async function readStateAsync() {
  if (memoryState) return memoryState;
  if (hydrationPromise) return hydrationPromise;

  hydrationPromise = (async () => {
    const def = loadDefaultState();
    const configuredPath = getConfiguredRuntimePath();
    let existingFilePath = null;

    if (fs.existsSync(configuredPath)) {
      existingFilePath = configuredPath;
    } else if (!process.env.CCHS_RUNTIME_STATE_PATH && fs.existsSync(READONLY_FS_FALLBACK_PATH)) {
      // Only read fallback if default workspace data dir is not present/writable
      try {
        fs.mkdirSync(path.dirname(configuredPath), { recursive: true });
      } catch (err) {
        if (isReadonlyFsError(err)) {
          existingFilePath = READONLY_FS_FALLBACK_PATH;
        }
      }
    }

    if (existingFilePath) {
      try {
        const diskData = JSON.parse(fs.readFileSync(existingFilePath, 'utf8'));
        memoryState = normalizeLoadedState(diskData, def);
        return memoryState;
      } catch (_) {
        // Fall through to cold-start hydration + seed fallback
      }
    }

    const hydrated = await hydrateFromFirebaseIfNeeded(def);
    memoryState = hydrated;
    writeRuntimeFile(memoryState);
    return memoryState;
  })().finally(() => {
    hydrationPromise = null;
  });

  return hydrationPromise;
}

function writeState(nextState, changedNode = null) {
  if (!Array.isArray(nextState.rooms) || nextState.rooms.length === 0) {
    nextState.rooms = DEFAULT_ROOMS;
  }
  if (!Array.isArray(nextState.bookings)) {
    nextState.bookings = [];
  }
  if (!nextState.config || typeof nextState.config !== 'object') {
    nextState.config = loadDefaultState().config;
  } else {
    nextState.config.serviceToggles = normalizeServiceToggles(nextState.config.serviceToggles);
  }
  if (typeof nextState.roomsUpdatedAt !== 'number' || !Number.isFinite(nextState.roomsUpdatedAt)) {
    nextState.roomsUpdatedAt = Math.max(
      Number(nextState.roomsMeta && nextState.roomsMeta.updatedAt) || 0,
      getMaxRoomUpdatedAt(nextState.rooms)
    );
  }
  if (!nextState.roomsMeta || typeof nextState.roomsMeta !== 'object') {
    nextState.roomsMeta = {
      updatedAt: nextState.roomsUpdatedAt,
      source: nextState.roomsUpdatedAt > 0 ? 'persisted' : 'seed'
    };
  }
  ensureRemoteDisplay(nextState);

  memoryState = nextState;
  writeRuntimeFile(nextState);

  if (changedNode === 'rooms') {
    mirrorNodeToFirebase('rooms', nextState.rooms);
  } else if (changedNode === 'bookings') {
    mirrorNodeToFirebase('bookings', nextState.bookings);
  } else if (changedNode === 'config') {
    mirrorNodeToFirebase('config', nextState.config);
  } else if (changedNode === 'departments') {
    mirrorNodeToFirebase('departments', nextState.departments || {});
    mirrorNodeToFirebase('history', nextState.history || []);
  } else if (changedNode === 'history') {
    mirrorNodeToFirebase('history', nextState.history || []);
  } else if (changedNode === 'meeting') {
    mirrorNodeToFirebase('config', nextState.config);
    mirrorNodeToFirebase('departments', nextState.departments || {});
    mirrorNodeToFirebase('history', nextState.history || []);
  } else if (changedNode === 'remoteDisplay' && nextState.remoteDisplay) {
    mirrorNodeToFirebase('remoteDisplay/activeMode', nextState.remoteDisplay.activeMode);
    mirrorNodeToFirebase('remoteDisplay/activePresenterId', nextState.remoteDisplay.activePresenterId || null);
    mirrorNodeToFirebase('remoteDisplay/modeUpdatedAt', nextState.remoteDisplay.modeUpdatedAt || Date.now());
    mirrorNodeToFirebase('remoteDisplay/slideControl', nextState.remoteDisplay.slideControl);
  } else if (changedNode === 'remoteDisplay/slideControl' && nextState.remoteDisplay) {
    mirrorNodeToFirebase('remoteDisplay/slideControl', nextState.remoteDisplay.slideControl);
  }
}

function formatWhatsAppPhone(rawPhone) {
  if (!rawPhone) return '';
  let digits = String(rawPhone).replace(/[^0-9]/g, '');
  if (digits.startsWith('01')) {
    digits = '6' + digits;
  } else if (digits.startsWith('1') && digits.length >= 9 && digits.length <= 10) {
    digits = '60' + digits;
  }
  return digits;
}

function buildWhatsAppBookingMessage(booking, room, type = 'confirmed') {
  const b = booking || {};
  const roomName = (room && room.name) || b.roomId || 'HQ Meeting Room';
  const roomFloor = room && room.floor ? ` (${room.floor})` : '';
  const header = type === 'starting'
    ? '▸ *CARECLINICS HQ — YOUR ROOM BOOKING IS STARTING NOW*'
    : '✓ *CARECLINICS HQ — ROOM BOOKING CONFIRMED*';

  const statusLine = type === 'starting'
    ? `Hi *${b.organizer || 'Staff'}*, your reserved meeting room is ready and your session time has arrived!`
    : `Hi *${b.organizer || 'Staff'}*, your meeting room reservation at Careclinics HQ has been scheduled.`;

  const bullet = type === 'starting' ? '-' : '•';
  const lines = [
    header,
    '',
    statusLine,
    '',
    `${bullet} *Room:* ${roomName}${roomFloor}`,
    `${bullet} *Meeting:* ${b.title || 'Meeting'}`,
    `${bullet} *Department:* ${b.department || 'HQ'}`,
    `${bullet} *Date:* ${b.date || ''}`,
    `${bullet} *Time:* ${b.startTime || ''} – ${b.endTime || ''}`,
    b.notes ? `${bullet} *Notes:* ${b.notes}` : '',
    '',
    '_Careclinics Healthcare Services HQ Portal_'
  ].filter(Boolean);

  return lines.join('\n');
}

function dispatchBookingWebhook(booking, state) {
  try {
    const webhookUrl = process.env.WHATSAPP_WEBHOOK_URL;
    if (!webhookUrl || !/^https?:\/\//i.test(webhookUrl) || (booking && booking.notifyWhatsapp === false)) {
      return;
    }
    const room = ((state && state.rooms) || []).find((r) => r.id === booking.roomId) || null;
    const recipientPhone = formatWhatsAppPhone(booking.phone || '');
    const message = buildWhatsAppBookingMessage(booking, room, 'confirmed');
    const encodedMsg = encodeURIComponent(message);
    const waUrl = recipientPhone
      ? `https://wa.me/${recipientPhone}?text=${encodedMsg}`
      : `https://wa.me/?text=${encodedMsg}`;

    const headers = { 'Content-Type': 'application/json' };
    if (process.env.WHATSAPP_WEBHOOK_SECRET) {
      headers['X-Webhook-Secret'] = process.env.WHATSAPP_WEBHOOK_SECRET;
    }

    const payload = {
      event: 'booking.created',
      timestamp: new Date().toISOString(),
      booking,
      room,
      recipientPhone,
      message,
      waUrl
    };

    if (typeof fetch === 'function') {
      const fetchOptions = {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      };
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        fetchOptions.signal = AbortSignal.timeout(3000);
      }
      fetch(webhookUrl, fetchOptions).catch(() => {});
    }
  } catch (_) {
    // Never delay or fail ADD_BOOKING
  }
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method === 'GET') {
      const current = await readStateAsync();
      const rd = ensureRemoteDisplay(current);
      // Clean up disconnected presenters whose heartbeat is older than 60s
      const now = Date.now();
      rd.presenters = rd.presenters.filter(p => !p.lastHeartbeat || (now - p.lastHeartbeat) < 60000);
      return res.status(200).json(withBootId(current));
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body || '{}');
        } catch (e) {
          return res.status(400).json({ error: 'Invalid JSON payload' });
        }
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ error: 'Invalid state payload' });
      }

      const rawToken = extractTokenFromRequest(req);
      const adminPayload = rawToken ? verifyToken(rawToken) : null;
      const isAdmin = Boolean(adminPayload);

      const requireAdmin = () => {
        if (!rawToken) {
          res.status(401).json({ error: 'Admin authentication required', code: 'UNAUTHORIZED' });
          return false;
        }
        if (!adminPayload) {
          res.status(403).json({ error: 'Invalid or expired admin token', code: 'FORBIDDEN' });
          return false;
        }
        return true;
      };

      const current = await readStateAsync();
      const rd = ensureRemoteDisplay(current);

      const requireServiceEnabled = (serviceKey) => {
        if (isAdmin) return true;
        const toggles = normalizeServiceToggles(current.config && current.config.serviceToggles);
        const toggle = toggles[serviceKey];
        if (toggle && toggle.enabled === false) {
          res.status(403).json({
            error: 'Service is currently disabled by administrator',
            code: 'SERVICE_DISABLED',
            service: serviceKey,
            notice: toggle.notice || ''
          });
          return false;
        }
        return true;
      };

      // Handle atomic surgical actions so presenter frame updates NEVER overwrite admin mode switches
      if (body.__action) {
        const action = body.__action;
        const payload = (body.payload && typeof body.payload === 'object') ? body.payload : {};

        if (action === 'UPDATE_SERVICE_TOGGLES') {
          if (!requireAdmin()) return;
          if (!payload.serviceToggles || typeof payload.serviceToggles !== 'object') {
            return res.status(400).json({ error: 'Missing serviceToggles payload' });
          }
          const now = Date.now();
          const prevToggles = normalizeServiceToggles(current.config && current.config.serviceToggles);
          const incomingToggles = payload.serviceToggles;
          const nextToggles = { ...prevToggles };
          for (const key of SERVICE_KEYS) {
            if (Object.prototype.hasOwnProperty.call(incomingToggles, key)) {
              const rawEntry = incomingToggles[key];
              if (typeof rawEntry === 'boolean') {
                nextToggles[key] = {
                  enabled: rawEntry,
                  notice: prevToggles[key].notice || '',
                  updatedAt: now
                };
              } else if (rawEntry && typeof rawEntry === 'object') {
                nextToggles[key] = {
                  enabled: rawEntry.enabled !== false,
                  notice: typeof rawEntry.notice === 'string' ? rawEntry.notice : (prevToggles[key].notice || ''),
                  updatedAt: now
                };
              }
            }
          }
          current.config = current.config || {};
          current.config.serviceToggles = nextToggles;
          writeState(current, 'config');
          return res.status(200).json({ ok: true, serviceToggles: nextToggles, state: current });
        }

        if (action === 'REGISTER_PRESENTER' && payload.presenter) {
          if (!requireServiceEnabled('screenShare')) return;
          const p = payload.presenter;
          rd.presenters = rd.presenters.filter(item => item.id !== p.id);
          rd.presenters.push({
            ...p,
            startedAt: p.startedAt || Date.now(),
            lastHeartbeat: Date.now()
          });
          // If TV is already in screen-share mode and has no active presenter, auto-attach
          if (rd.activeMode === 'screen-share' && !rd.activePresenterId) {
            rd.activePresenterId = p.id;
          }
          rd.updatedAt = Date.now();
          writeState(current, 'remoteDisplay');
          return res.status(200).json({ ok: true, state: current });
        }

        if (action === 'UPDATE_PRESENTER' && payload.presenterId) {
          if (!requireServiceEnabled('screenShare')) return;
          const idx = rd.presenters.findIndex(item => item.id === payload.presenterId);
          if (idx !== -1) {
            rd.presenters[idx] = {
              ...rd.presenters[idx],
              ...(payload.patch || {}),
              lastHeartbeat: Date.now()
            };
            rd.updatedAt = Date.now();
            writeState(current);
          }
          return res.status(200).json({ ok: true, state: current });
        }

        if (action === 'REMOVE_PRESENTER' && payload.presenterId) {
          rd.presenters = rd.presenters.filter(item => item.id !== payload.presenterId);
          if (rd.activePresenterId === payload.presenterId) {
            rd.activePresenterId = rd.presenters[0]?.id || null;
            if (!rd.activePresenterId && rd.activeMode === 'screen-share') {
              rd.activeMode = 'meeting-tv';
              rd.modeUpdatedAt = Date.now();
            }
          }
          rd.updatedAt = Date.now();
          writeState(current, 'remoteDisplay');
          return res.status(200).json({ ok: true, state: current });
        }

        if (action === 'SELECT_PRESENTER') {
          if (!requireAdmin()) return;
          const presenterId = payload.presenterId || null;
          rd.activePresenterId = presenterId;
          rd.activeMode = presenterId ? 'screen-share' : (payload.fallbackMode || 'meeting-tv');
          rd.modeUpdatedAt = Date.now();
          rd.updatedAt = Date.now();
          writeState(current, 'remoteDisplay');
          return res.status(200).json({ ok: true, state: current });
        }

        if (action === 'UPDATE_REMOTE_DISPLAY' && payload.patch) {
          if (!requireAdmin()) return;
          const patch = payload.patch;
          const existingPresenters = rd.presenters;
          const existingActivePresenterId = rd.activePresenterId;
          const existingSlideControl = rd.slideControl;

          Object.assign(rd, patch);
          // Preserve active presenter queue unless explicitly replaced
          if (!Array.isArray(patch.presenters)) {
            rd.presenters = existingPresenters;
          }
          // Protect slideControl from stale patches unless patch explicitly brings newer commandSeq/updatedAt
          if (patch.slideControl && typeof patch.slideControl === 'object') {
            const pSc = patch.slideControl;
            const eSc = existingSlideControl || {};
            const pUpdated = Number(pSc.updatedAt) || 0;
            const eUpdated = Number(eSc.updatedAt) || 0;
            const pSeq = Number(pSc.commandSeq) || 0;
            const eSeq = Number(eSc.commandSeq) || 0;
            if (pUpdated < eUpdated || (pUpdated === eUpdated && pSeq <= eSeq)) {
              rd.slideControl = existingSlideControl;
            }
          } else {
            rd.slideControl = existingSlideControl;
          }
          normalizeSlideControl(current);

          // If admin switched to 'screen-share' mode and didn't specify activePresenterId, keep existing or pick first available in queue
          if (patch.activeMode === 'screen-share' && patch.activePresenterId === undefined) {
            rd.activePresenterId = existingActivePresenterId || existingPresenters[0]?.id || null;
          }
          rd.modeUpdatedAt = Date.now();
          rd.updatedAt = Date.now();
          writeState(current, 'remoteDisplay');
          return res.status(200).json({ ok: true, state: current });
        }

        if (action === 'SLIDE_COMMAND') {
          if (!requireAdmin()) return;
          const command = payload.command;
          const validCommands = ['prev', 'next', 'goto', 'pause', 'resume', 'refresh', 'sync'];
          if (!validCommands.includes(command)) {
            return res.status(400).json({ error: 'Invalid slide command' });
          }

          const slides = computeMeetingSlides(current);
          const totalSlides = slides.length;
          const sc = normalizeSlideControl(current);

          const rawInt = Number(payload.autoPlayIntervalMs);
          if (Number.isFinite(rawInt) && rawInt >= 1000) {
            sc.autoPlayIntervalMs = Math.trunc(rawInt);
          }

          if (command === 'prev') {
            sc.currentSlideIndex = Math.max(0, sc.currentSlideIndex - 1);
          } else if (command === 'next') {
            sc.currentSlideIndex = Math.min(totalSlides - 1, sc.currentSlideIndex + 1);
          } else if (command === 'goto') {
            const rawIdx = Number(payload.slideIndex);
            if (payload.slideIndex === undefined || payload.slideIndex === null || payload.slideIndex === '' || !Number.isFinite(rawIdx)) {
              return res.status(400).json({ error: 'Invalid slideIndex' });
            }
            sc.currentSlideIndex = Math.max(0, Math.min(totalSlides - 1, Math.trunc(rawIdx)));
          } else if (command === 'pause') {
            sc.autoPlay = false;
          } else if (command === 'resume') {
            sc.autoPlay = true;
          } else if (command === 'refresh') {
            sc.refreshNonce = (sc.refreshNonce || 0) + 1;
          } else if (command === 'sync') {
            if (payload.slideIndex !== undefined && payload.slideIndex !== null && payload.slideIndex !== '') {
              const rawIdx = Number(payload.slideIndex);
              if (Number.isFinite(rawIdx)) {
                sc.currentSlideIndex = Math.max(0, Math.min(totalSlides - 1, Math.trunc(rawIdx)));
              }
            }
            if (typeof payload.autoPlay === 'boolean') {
              sc.autoPlay = payload.autoPlay;
            }
          }

          sc.totalSlides = totalSlides;
          sc.currentSlideLabel = (slides[sc.currentSlideIndex] && slides[sc.currentSlideIndex].label) || 'Overview';
          sc.commandSeq = (sc.commandSeq || 0) + 1;
          sc.lastCommand = command;
          sc.updatedAt = Math.max(Date.now(), (sc.updatedAt || 0) + 1);
          rd.updatedAt = sc.updatedAt;

          writeState(current, 'remoteDisplay');
          return res.status(200).json({ ok: true, slideControl: sc, state: withBootId(current) });
        }

        if (action === 'ADD_BOOKING' && payload.booking) {
          if (!requireServiceEnabled('roomBooking')) return;
          if (!Array.isArray(current.bookings)) current.bookings = [];
          const b = payload.booking;
          if (!b.roomId || !b.date || !b.startTime || !b.endTime || b.endTime <= b.startTime) {
            return res.status(400).json({ error: 'Invalid booking date or time range.' });
          }
          // Server-side non-redundant / overlap check
          const conflict = current.bookings.find(
            item => item.roomId === b.roomId && item.date === b.date && b.startTime < item.endTime && b.endTime > item.startTime
          );
          if (conflict) {
            return res.status(409).json({
              error: `Redundant booking blocked: Room is already reserved from ${conflict.startTime} to ${conflict.endTime} for "${conflict.title}" (${conflict.department}).`,
              conflict
            });
          }
          current.bookings.push(b);
          writeState(current, 'bookings');
          dispatchBookingWebhook(b, current);
          return res.status(200).json({ ok: true, booking: b, state: current });
        }

        if (action === 'UPDATE_BOOKING' && payload.bookingId && payload.updatedFields) {
          if (!requireAdmin()) return;
          if (!Array.isArray(current.bookings)) current.bookings = [];
          const idx = current.bookings.findIndex(item => item.id === payload.bookingId);
          if (idx === -1) {
            return res.status(404).json({ error: 'Booking not found' });
          }
          const candidate = {
            ...current.bookings[idx],
            ...payload.updatedFields,
            id: payload.bookingId,
            updatedAt: Date.now()
          };
          if (candidate.endTime <= candidate.startTime) {
            return res.status(400).json({ error: 'End time must be after start time.' });
          }
          const conflict = current.bookings.find(
            item => item.id !== payload.bookingId && item.roomId === candidate.roomId && item.date === candidate.date && candidate.startTime < item.endTime && candidate.endTime > item.startTime
          );
          if (conflict) {
            return res.status(409).json({
              error: `Redundant booking blocked: Room is already reserved from ${conflict.startTime} to ${conflict.endTime} for "${conflict.title}" (${conflict.department}).`,
              conflict
            });
          }
          current.bookings[idx] = candidate;
          writeState(current, 'bookings');
          return res.status(200).json({ ok: true, booking: candidate, state: current });
        }

        if (action === 'DELETE_BOOKING' && payload.bookingId) {
          if (!requireAdmin()) return;
          current.bookings = (current.bookings || []).filter(item => item.id !== payload.bookingId);
          writeState(current, 'bookings');
          return res.status(200).json({ ok: true, state: current });
        }

        if (action === 'MARK_BOOKING_NOTIFIED' && payload.bookingId) {
          if (Array.isArray(current.bookings)) {
            const idx = current.bookings.findIndex(item => item.id === payload.bookingId);
            if (idx !== -1) {
              current.bookings[idx].whatsappNotified = true;
              current.bookings[idx].notifiedAt = Date.now();
              writeState(current, 'bookings');
            }
          }
          return res.status(200).json({ ok: true, state: current });
        }

        if (action === 'SAVE_ROOMS' && Array.isArray(payload.rooms)) {
          if (!requireAdmin()) return;
          if (payload.rooms.length === 0) {
            return res.status(400).json({ error: 'At least 1 meeting room must remain in the system.' });
          }
          const now = Math.max(Date.now(), Number(payload.roomsUpdatedAt) || 0, (current.roomsUpdatedAt || 0) + 1);
          current.rooms = payload.rooms.map(r => ({ ...r, updatedAt: now }));
          current.roomsUpdatedAt = now;
          current.roomsMeta = { updatedAt: now, source: 'admin' };
          writeState(current, 'rooms');
          return res.status(200).json({ ok: true, state: current });
        }

        if (action === 'SUBMIT_DEPARTMENT_UPDATE') {
          if (!requireServiceEnabled('departmentUpdate')) return;
          const dept = typeof payload.department === 'string' ? payload.department.trim() : '';
          if (!dept || typeof payload.updateText !== 'string') {
            return res.status(400).json({ error: 'Department and updateText are required' });
          }
          if (!current.departments || typeof current.departments !== 'object') {
            current.departments = {};
          }
          const qText = typeof payload.questionText === 'string' && payload.questionText.trim()
            ? payload.questionText
            : 'N/A';
          current.departments[dept] = {
            update: payload.updateText,
            question: qText
          };
          if (!Array.isArray(current.history)) current.history = [];
          const entry = payload.entry && typeof payload.entry === 'object'
            ? {
                timestamp: Number(payload.entry.timestamp) || Date.now(),
                dateString: payload.entry.dateString || new Date().toLocaleString('en-MY'),
                department: dept,
                update: payload.updateText,
                question: qText
              }
            : {
                timestamp: Date.now(),
                dateString: new Date().toLocaleString('en-MY'),
                department: dept,
                update: payload.updateText,
                question: qText
              };
          current.history.unshift(entry);
          if (current.history.length > 200) {
            current.history = current.history.slice(0, 200);
          }
          normalizeSlideControl(current);
          writeState(current, 'departments');
          return res.status(200).json({ ok: true, state: withBootId(current) });
        }

        if (action === 'SAVE_ADMIN_CONFIG') {
          if (!requireAdmin()) return;
          const existingToggles = normalizeServiceToggles(current.config && current.config.serviceToggles);
          if (payload.config && typeof payload.config === 'object') {
            const incomingToggles = payload.config.serviceToggles
              ? normalizeServiceToggles(payload.config.serviceToggles, existingToggles)
              : existingToggles;
            current.config = {
              ...(current.config || {}),
              ...payload.config,
              serviceToggles: incomingToggles
            };
          }
          if (payload.departments && typeof payload.departments === 'object') {
            current.departments = payload.departments;
          }
          normalizeSlideControl(current);
          writeState(current, 'meeting');
          return res.status(200).json({ ok: true, state: current });
        }

        if (action === 'RESET_MEETING_SESSION') {
          if (!requireAdmin()) return;
          if (!current.departments || typeof current.departments !== 'object') {
            current.departments = {};
          }
          for (const dept of Object.keys(current.departments)) {
            current.departments[dept] = { update: 'Pending update...', question: 'N/A' };
          }
          normalizeSlideControl(current);
          writeState(current, 'meeting');
          return res.status(200).json({ ok: true, state: current });
        }

        if (action === 'RESET_TO_INITIAL_SEED') {
          if (!requireAdmin()) return;
          const def = loadDefaultState();
          const preservedToggles = normalizeServiceToggles(current.config && current.config.serviceToggles);
          current.config = {
            ...def.config,
            serviceToggles: payload.resetServiceToggles === true ? def.config.serviceToggles : preservedToggles
          };
          current.departments = def.departments;
          current.history = def.history;
          if (payload.includeRooms === true) {
            const now = Date.now();
            current.rooms = def.rooms.map(r => ({ ...r, updatedAt: now }));
            current.roomsUpdatedAt = now;
            current.roomsMeta = { updatedAt: now, source: 'admin' };
          }
          if (payload.includeBookings === true) {
            current.bookings = def.bookings;
          }
          normalizeSlideControl(current);
          writeState(current, 'meeting');
          return res.status(200).json({ ok: true, state: current });
        }

        return res.status(400).json({ error: `Unknown or invalid action: ${String(action)}` });
      }

      // Standard full-state POST /api/data
      if (!isAdmin) {
        // Unauthenticated full-state POST cannot alter config, rooms, bookings, remoteDisplay, or wipe departments
        const hasDepartments = Boolean(
          body.departments &&
          typeof body.departments === 'object' &&
          !Array.isArray(body.departments) &&
          Object.keys(body.departments).length > 0
        );
        if (!hasDepartments) {
          requireAdmin();
          return;
        }

        // Check whether departments payload is a legitimate single-department update vs a reset/mass-wipe
        const curDepts = current.departments || {};
        const changedDepts = [];
        let hasResetToPending = false;
        for (const [dept, val] of Object.entries(body.departments)) {
          if (!val || typeof val !== 'object') continue;
          const prev = curDepts[dept] || {};
          if (val.update !== prev.update || val.question !== prev.question) {
            changedDepts.push([dept, val]);
            const prevUpd = typeof prev.update === 'string' ? prev.update.trim() : '';
            const nextUpd = typeof val.update === 'string' ? val.update.trim() : '';
            if (prevUpd && prevUpd !== 'Pending update...' && (!nextUpd || nextUpd === 'Pending update...')) {
              hasResetToPending = true;
            }
          }
        }
        if (hasResetToPending || changedDepts.length > 1) {
          if (!rawToken) {
            return res.status(401).json({
              error: 'Admin authentication required to reset department updates',
              code: 'UNAUTHORIZED'
            });
          }
          requireAdmin();
          return;
        }
        if (changedDepts.length === 0) {
          // If no department actually changed, reject attempts to mutate admin-only sections unauthenticated
          if (body.config || body.rooms || body.bookings || body.remoteDisplay) {
            requireAdmin();
            return;
          }
        }

        if (!requireServiceEnabled('departmentUpdate')) return;

        if (!Array.isArray(current.history)) current.history = [];
        current.departments = current.departments || {};
        for (const [dept, val] of changedDepts) {
          const nextUpdate = typeof val.update === 'string' && val.update.trim()
            ? val.update
            : 'Pending update...';
          const nextQuestion = typeof val.question === 'string' && val.question.trim()
            ? val.question
            : 'N/A';
          current.departments[dept] = {
            update: nextUpdate,
            question: nextQuestion
          };
          current.history.unshift({
            timestamp: Date.now(),
            dateString: new Date().toLocaleString('en-MY'),
            department: dept,
            update: nextUpdate,
            question: nextQuestion
          });
        }
        if (current.history.length > 200) {
          current.history = current.history.slice(0, 200);
        }
        normalizeSlideControl(current);
        writeState(current, 'departments');
        return res.status(200).json({ ok: true, state: withBootId(current) });
      }

      // Authenticated admin full-state save: protect newer rooms, bookings, serviceToggles, and remoteDisplay
      const existingRoomsTs = Math.max(
        Number(current.roomsUpdatedAt) || 0,
        Number(current.roomsMeta && current.roomsMeta.updatedAt) || 0,
        getMaxRoomUpdatedAt(current.rooms)
      );
      const incomingRoomsTs = Math.max(
        Number(body.roomsUpdatedAt) || 0,
        Number(body.roomsMeta && body.roomsMeta.updatedAt) || 0,
        getMaxRoomUpdatedAt(body.rooms)
      );
      const acceptIncomingRooms = Array.isArray(body.rooms) && body.rooms.length > 0 && incomingRoomsTs > existingRoomsTs;

      const acceptIncomingBookings = Array.isArray(body.bookings) && body.__allowBookingsOverwrite === true;

      const existingToggles = normalizeServiceToggles(current.config && current.config.serviceToggles);
      const mergedConfig = body.config && typeof body.config === 'object'
        ? {
            ...(current.config || {}),
            ...body.config,
            serviceToggles: body.config.serviceToggles
              ? normalizeServiceToggles(body.config.serviceToggles, existingToggles)
              : existingToggles
          }
        : {
            ...(current.config || {}),
            serviceToggles: existingToggles
          };

      const incomingRd = (body.remoteDisplay && typeof body.remoteDisplay === 'object') ? body.remoteDisplay : {};
      const existingModeUpdatedAt = rd.modeUpdatedAt || 0;
      const incomingModeUpdatedAt = incomingRd.modeUpdatedAt || 0;

      const existingSc = rd.slideControl || { ...DEFAULT_SLIDE_CONTROL };
      const incomingSc = (incomingRd.slideControl && typeof incomingRd.slideControl === 'object') ? incomingRd.slideControl : null;
      let chosenSc = existingSc;
      if (incomingSc) {
        const iUpdated = Number(incomingSc.updatedAt) || 0;
        const eUpdated = Number(existingSc.updatedAt) || 0;
        const iSeq = Number(incomingSc.commandSeq) || 0;
        const eSeq = Number(existingSc.commandSeq) || 0;
        if (iUpdated > eUpdated || (iUpdated === eUpdated && iSeq > eSeq)) {
          chosenSc = incomingSc;
        }
      }

      const mergedRemoteDisplay = {
        ...rd,
        ...incomingRd,
        activeMode: incomingModeUpdatedAt >= existingModeUpdatedAt ? (incomingRd.activeMode || rd.activeMode) : rd.activeMode,
        activePresenterId: incomingModeUpdatedAt >= existingModeUpdatedAt
          ? (incomingRd.activePresenterId !== undefined ? incomingRd.activePresenterId : rd.activePresenterId)
          : rd.activePresenterId,
        modeUpdatedAt: Math.max(existingModeUpdatedAt, incomingModeUpdatedAt),
        presenters: Array.isArray(incomingRd.presenters) && incomingRd.presenters.length > 0
          ? incomingRd.presenters
          : rd.presenters,
        slideControl: chosenSc
      };

      const merged = {
        ...current,
        ...body,
        config: mergedConfig,
        rooms: acceptIncomingRooms ? body.rooms : current.rooms,
        roomsUpdatedAt: acceptIncomingRooms ? incomingRoomsTs : existingRoomsTs,
        roomsMeta: acceptIncomingRooms
          ? (body.roomsMeta || { updatedAt: incomingRoomsTs, source: 'admin' })
          : (current.roomsMeta || { updatedAt: existingRoomsTs, source: existingRoomsTs > 0 ? 'persisted' : 'seed' }),
        bookings: acceptIncomingBookings ? body.bookings : current.bookings,
        remoteDisplay: mergedRemoteDisplay
      };
      delete merged.__allowBookingsOverwrite;
      delete merged.serverBootId;
      normalizeSlideControl(merged);
      writeState(merged, 'meeting');
      return res.status(200).json({ ok: true, state: withBootId(merged) });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('api/data handler error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
};
