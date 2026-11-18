// Unified Cloud & Local Realtime Store for Careclinics HQ Services
// Supports Firebase Realtime Database (cchsmeetingdashboard) + Vercel Serverless API + BroadcastChannel fallback

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  get,
  update
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getAdminAuthHeaders } from "./auth.js";

export const firebaseConfig = {
  apiKey: "AIzaSyAqu7Wz8f1ZGcsqTyn3AzzkOk3jvTRReDg",
  authDomain: "cchsmeetingdashboard.firebaseapp.com",
  databaseURL: "https://cchsmeetingdashboard-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "cchsmeetingdashboard",
  storageBucket: "cchsmeetingdashboard.firebasestorage.app",
  messagingSenderId: "652664574963",
  appId: "1:652664574963:web:cb0920af5cf74b2229f886",
  measurementId: "G-8QH9KJKQ8D"
};

const SERVICE_KEYS = ["departmentUpdate", "roomBooking", "screenShare", "pdfStudio"];
const DEFAULT_SERVICE_TOGGLES = {
  departmentUpdate: { enabled: true, notice: "", updatedAt: 0 },
  roomBooking: { enabled: true, notice: "", updatedAt: 0 },
  screenShare: { enabled: true, notice: "", updatedAt: 0 },
  pdfStudio: { enabled: true, notice: "", updatedAt: 0 }
};

const DEFAULT_SLIDE_CONTROL = {
  currentSlideIndex: 0,
  totalSlides: 0,
  currentSlideLabel: "Overview",
  autoPlay: false,
  autoPlayIntervalMs: 8000,
  commandSeq: 0,
  lastCommand: null,
  refreshNonce: 0,
  updatedAt: 0
};

function normalizeServiceToggles(rawToggles, fallbackToggles = DEFAULT_SERVICE_TOGGLES) {
  const src = rawToggles && typeof rawToggles === "object" ? rawToggles : {};
  const fb = fallbackToggles && typeof fallbackToggles === "object" ? fallbackToggles : DEFAULT_SERVICE_TOGGLES;
  const out = {};
  for (const key of SERVICE_KEYS) {
    const baseEntry = fb[key] && typeof fb[key] === "object" ? fb[key] : DEFAULT_SERVICE_TOGGLES[key];
    const entry = src[key];
    if (entry === undefined) {
      out[key] = {
        enabled: baseEntry.enabled !== false,
        notice: typeof baseEntry.notice === "string" ? baseEntry.notice : "",
        updatedAt: Number.isFinite(Number(baseEntry.updatedAt)) ? Number(baseEntry.updatedAt) : 0
      };
    } else if (typeof entry === "boolean") {
      out[key] = {
        enabled: entry,
        notice: typeof baseEntry.notice === "string" ? baseEntry.notice : "",
        updatedAt: Number.isFinite(Number(baseEntry.updatedAt)) ? Number(baseEntry.updatedAt) : 0
      };
    } else if (entry && typeof entry === "object") {
      out[key] = {
        enabled: entry.enabled !== false,
        notice: typeof entry.notice === "string" ? entry.notice : "",
        updatedAt: Number.isFinite(Number(entry.updatedAt)) ? Number(entry.updatedAt) : (Number(baseEntry.updatedAt) || 0)
      };
    } else {
      out[key] = { ...DEFAULT_SERVICE_TOGGLES[key] };
    }
  }
  return out;
}

export function computeMeetingSlides(state) {
  const departments = Object.keys((state && state.departments) || {});
  const config = (state && state.config) || {};
  const slides = [{ index: 0, label: "Overview", type: "overview", icon: "❯" }];

  for (const dept of departments) {
    slides.push({
      index: slides.length,
      label: `${dept} Update`,
      type: "department-update",
      department: dept,
      icon: "❯"
    });
    if (config.showQnA !== false) {
      slides.push({
        index: slides.length,
        label: `${dept} Q&A`,
        type: "department-qna",
        department: dept,
        icon: "🎲"
      });
    }
  }

  if (config.showVisionMission !== false) {
    slides.push({
      index: slides.length,
      label: "Vision & Mission",
      type: "vision-mission",
      icon: "❯"
    });
  }

  slides.push({
    index: slides.length,
    label: "Tagline",
    type: "tagline",
    icon: "❯"
  });

  if (config.showDailyPhrases !== false) {
    slides.push({
      index: slides.length,
      label: "Care Quality Phrases",
      type: "phrases",
      icon: "❯"
    });
  }

  if (config.showLastMinuteSpeech === true) {
    slides.push({
      index: slides.length,
      label: "C-Suite Closing Remarks",
      type: "closing-remarks",
      icon: "❯"
    });
  }

  return slides;
}

function normalizeSlideControl(state) {
  if (!state.remoteDisplay || typeof state.remoteDisplay !== "object") {
    state.remoteDisplay = {
      activeMode: "meeting-tv",
      activePresenterId: null,
      presenters: [],
      modeUpdatedAt: 0
    };
  }
  const slides = computeMeetingSlides(state);
  const totalSlides = slides.length;
  const rawSc = state.remoteDisplay.slideControl && typeof state.remoteDisplay.slideControl === "object"
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
    currentSlideLabel: (slides[idx] && slides[idx].label) || "Overview",
    autoPlay: Boolean(rawSc.autoPlay),
    autoPlayIntervalMs,
    commandSeq,
    lastCommand: typeof rawSc.lastCommand === "string" ? rawSc.lastCommand : null,
    refreshNonce,
    updatedAt
  };
  return state.remoteDisplay.slideControl;
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

// Seeded fallback matching read-only CCHSMeetingDashboard/data.json + HQ Room Booking & Remote Display defaults
export const INITIAL_SEED_DATA = {
  config: {
    showQnA: false,
    showDailyPhrases: true,
    showVisionMission: true,
    showLastMinuteSpeech: true,
    visionText: "Empower patients with the freedom to access quality healthcare services through digital integration anytime, anywhere.",
    missionText: "Deliver quality personalised care by merging of best medical practises with modern technology. ",
    phrases: ["Humanising Care."],
    lastMinuteSpeechText: "Good afternoon, everyone. Thank you for being here today.As we look back at where we started this year, I want to begin with a simple thank you. We faced real shifts and unexpected hurdles. Because of your hard work, your creativity, and your care for one another, we did not just get through it—we adapted and grew. Every milestone we reached belongs to this team.",
    serviceToggles: normalizeServiceToggles(DEFAULT_SERVICE_TOGGLES)
  },
  departments: {
    "IT": {
      update: "- This month will start to do inventory asset update for all HQ staff (laptop, monitor)\n- ⁠and the same time we will do IT audit for each laptop user..",
      question: "What will be going for this month activity for IT department"
    },
    "CEO OFFICE": { update: "Pending update...", question: "N/A" },
    "ADMIN": { update: "Pending update...", question: "N/A" },
    "BUSINESS LEGAL": { update: "Pending update...", question: "N/A" },
    "PMI TEAM": { update: "Pending update...", question: "N/A" },
    "BUSINESS DEVELOPMENT": { update: "Pending update...", question: "N/A" },
    "CORPORATE HEALTH": { update: "Pending update...", question: "N/A" },
    "FINANCE": { update: "Pending update...", question: "N/A" },
    "ACCOUNT": { update: "Pending update...", question: "N/A" },
    "PROCUREMENT": { update: "Pending update...", question: "N/A" },
    "TALENT DEVELOPMENT": { update: "Pending update...", question: "N/A" },
    "CLINICAL GOVERNANCE": { update: "Pending update...", question: "N/A" },
    "OPERATION": { update: "Pending update...", question: "N/A" },
    "HR": { update: "Pending update...", question: "N/A" },
    "TPP SYSTMONE": { update: "Pending update...", question: "N/A" }
  },
  history: [
    {
      timestamp: 1786411858134,
      dateString: "11/08/2026, 1:30:58 am",
      department: "IT",
      update: "- Abu test",
      question: "Test Abu"
    },
    {
      timestamp: 1786352693447,
      dateString: "10/08/2026, 9:04:53 am",
      department: "IT",
      update: "- This month will start to do inventory asset update for all HQ staff (laptop, monitor)\n- ⁠and the same time we will do IT audit for each laptop user..",
      question: "What will be going for this month activity for IT department"
    },
    {
      timestamp: 1786347064704,
      dateString: "10/08/2026, 3:31:04 pm",
      department: "IT",
      update: "- This month will start to do inventory asset update for all HQ staff (laptop, monitor)\n- ⁠and the same time we will do IT audit for each laptop user..",
      question: "What will be going for this month activity for IT department"
    },
    {
      timestamp: 1786346705193,
      dateString: "10/08/2026, 3:25:05 pm",
      department: "IT",
      update: "- This month will start to do inventory asset update for all HQ staff (laptop, monitor)\n- ⁠and the same time we will do IT audit for each laptop user..",
      question: "What will be going for this month activity for IT department"
    },
    {
      timestamp: 1786346690858,
      dateString: "10/08/2026, 3:24:50 pm",
      department: "IT",
      update: "- This month will start to do inventory asset update ",
      question: "What will be going for this month activity for IT department"
    },
    {
      timestamp: 1786346613247,
      dateString: "10/08/2026, 3:23:33 pm",
      department: "IT",
      update: "- This month will start to do inventory asset update for all HQ staff (laptop, monitor)\n- ⁠and the same time we will do IT audit for each laptop user..",
      question: "What will be going for this month activity for IT department"
    }
  ],
  rooms: [
    {
      id: "boardroom-main",
      name: "HQ Main Boardroom",
      floor: "Level 1 - Executive Wing",
      capacity: 20,
      amenities: ["75\" 4K Smart TV", "Video Conferencing", "Glass Whiteboard", "HDMI / Wireless Cast"],
      color: "#1863dc"
    },
    {
      id: "discussion-a",
      name: "Discussion Room A (CareHub)",
      floor: "Level 1 - Central Zone",
      capacity: 8,
      amenities: ["55\" TV Display", "Whiteboard", "Speakerphone"],
      color: "#00b894"
    },
    {
      id: "discussion-b",
      name: "Discussion Room B (Clinical)",
      floor: "Level 1 - Operations Wing",
      capacity: 6,
      amenities: ["50\" Monitor", "Whiteboard"],
      color: "#6c5ce7"
    },
    {
      id: "townhall-hub",
      name: "Townhall & Training Suite",
      floor: "Level 2 - Training Center",
      capacity: 50,
      amenities: ["Dual Projector / TV", "Wireless Mic System", "Livestream Setup"],
      color: "#e17055"
    },
    {
      id: "pod-telehealth",
      name: "Focus Pod 1 (Telehealth / PMI)",
      floor: "Level 1 - Quiet Zone",
      capacity: 4,
      amenities: ["Acoustic Soundproofing", "Ring Light & Webcam"],
      color: "#0984e3"
    }
  ],
  roomsUpdatedAt: 0,
  roomsMeta: { updatedAt: 0, source: "seed" },
  bookings: [
    {
      id: "bk-seed-1",
      roomId: "boardroom-main",
      title: "Weekly HQ Management Alignment",
      department: "CEO OFFICE",
      organizer: "HQ Management",
      date: new Date().toISOString().slice(0, 10),
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
      date: new Date().toISOString().slice(0, 10),
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
      date: new Date().toISOString().slice(0, 10),
      startTime: "14:00",
      endTime: "16:00",
      notes: "Training session for clinic operations and digital integration.",
      createdAt: Date.now() - 900000
    }
  ],
  remoteDisplay: {
    activeMode: "meeting-tv", // 'screen-share' | 'meeting-tv' | 'room-signage' | 'announcement' | 'welcome-board'
    activePresenterId: null,
    presenters: [],
    modeUpdatedAt: 0,
    targetRoomId: "boardroom-main",
    autoRotateSeconds: 15,
    announcement: {
      badge: "HQ NOTICE",
      title: "IT Asset & Laptop Audit in Progress",
      message: "Kindly ensure your company laptop and monitor asset tags are accessible for the monthly IT inventory check. Thank you for your cooperation.",
      footer: "Careclinics Healthcare Services — IT Department",
      theme: "navy"
    },
    welcomeBoard: {
      headline: "Welcome to Careclinics Healthcare Services HQ",
      subheadline: "Humanising Care — Merging Best Medical Practices with Modern Technology",
      guestList: [
        "All HQ Department Leads — Weekly Alignment (Main Boardroom, 9:00 AM)",
        "Clinical Operations & TPP SystmOne Training (Level 2 Suite, 2:00 PM)"
      ]
    },
    customUrl: "/meeting/index.html",
    screens: [
      { id: "scr-lobby", name: "HQ Reception Lobby TV", location: "Level 1 Lobby", assignedMode: "follow-master", lastSeen: Date.now() },
      { id: "scr-boardroom", name: "Main Boardroom 75\" TV", location: "Level 1 Boardroom", assignedMode: "meeting-tv", lastSeen: Date.now() },
      { id: "scr-door-boardroom", name: "Boardroom Door Tablet", location: "Outside Main Boardroom", assignedMode: "room-signage", roomId: "boardroom-main", lastSeen: Date.now() },
      { id: "scr-townhall", name: "Townhall Projector Display", location: "Level 2 Training Center", assignedMode: "follow-master", lastSeen: Date.now() }
    ],
    slideControl: { ...DEFAULT_SLIDE_CONTROL },
    updatedAt: Date.now()
  }
};

const STORAGE_KEY = "cchs_hq_unified_state_v1";
const BOOT_ID_STORAGE_KEY = "cchs_hq_server_boot_id_v1";
const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("cchs_hq_sync_channel") : null;

let app = null;
let db = null;
let auth = null;
try {
  app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  auth = getAuth(app);
} catch (err) {
  console.warn("Firebase initialization warning:", err);
}

let syncMode = "connecting"; // 'firebase' | 'cloud-api' | 'local'
let syncDetail = "Connecting to Firebase Realtime DB...";
let firebaseConnected = false;
let lastLocalModeChangeAt = 0;
let lastLocalMutationAt = 0;
let lastLocalSlideCommandAt = 0;
let hasCompletedInitialApiSync = false;
let lastKnownServerBootId = (() => {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(BOOT_ID_STORAGE_KEY) : null;
  } catch (_) {
    return null;
  }
})();
function setLastKnownServerBootId(bootId) {
  if (typeof bootId !== "string" || !bootId) return;
  lastKnownServerBootId = bootId;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(BOOT_ID_STORAGE_KEY, bootId);
    }
  } catch (_) {}
}
let currentState = loadLocalState();
const listeners = new Set();
const statusListeners = new Set();

function normalizeFirebaseArray(val) {
  if (!val) return null;
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === "object") return Object.values(val).filter(Boolean);
  return null;
}

function deepMergeSeed(raw) {
  const base = JSON.parse(JSON.stringify(INITIAL_SEED_DATA));
  if (!raw || typeof raw !== "object") {
    normalizeSlideControl(base);
    return base;
  }
  const normRooms = normalizeFirebaseArray(raw.rooms);
  const normBookings = normalizeFirebaseArray(raw.bookings);
  const normHistory = normalizeFirebaseArray(raw.history);
  const rooms = Array.isArray(normRooms) && normRooms.length > 0 ? normRooms : base.rooms;
  const rawRoomsTs = Math.max(
    Number(raw.roomsUpdatedAt) || 0,
    Number(raw.roomsMeta?.updatedAt) || 0,
    getMaxRoomUpdatedAt(rooms)
  );
  const rawConfig = raw.config && typeof raw.config === "object" ? raw.config : {};

  const merged = {
    config: {
      ...base.config,
      ...rawConfig,
      serviceToggles: normalizeServiceToggles(rawConfig.serviceToggles, base.config.serviceToggles)
    },
    departments: raw.departments && Object.keys(raw.departments).length > 0 ? raw.departments : base.departments,
    history: Array.isArray(normHistory) ? normHistory : base.history,
    rooms,
    roomsUpdatedAt: rawRoomsTs,
    roomsMeta: raw.roomsMeta && typeof raw.roomsMeta === "object"
      ? {
          updatedAt: Math.max(rawRoomsTs, Number(raw.roomsMeta.updatedAt) || 0),
          source: raw.roomsMeta.source || (rawRoomsTs > 0 ? "persisted" : "seed")
        }
      : { updatedAt: rawRoomsTs, source: rawRoomsTs > 0 ? "persisted" : "seed" },
    bookings: Array.isArray(normBookings) ? normBookings : base.bookings,
    remoteDisplay: {
      ...base.remoteDisplay,
      ...(raw.remoteDisplay || {}),
      presenters: Array.isArray(raw.remoteDisplay?.presenters) ? raw.remoteDisplay.presenters : base.remoteDisplay.presenters,
      announcement: { ...base.remoteDisplay.announcement, ...(raw.remoteDisplay?.announcement || {}) },
      welcomeBoard: { ...base.remoteDisplay.welcomeBoard, ...(raw.remoteDisplay?.welcomeBoard || {}) },
      screens: Array.isArray(raw.remoteDisplay?.screens) ? raw.remoteDisplay.screens : base.remoteDisplay.screens,
      slideControl: raw.remoteDisplay?.slideControl && typeof raw.remoteDisplay.slideControl === "object"
        ? { ...base.remoteDisplay.slideControl, ...raw.remoteDisplay.slideControl }
        : { ...base.remoteDisplay.slideControl }
    }
  };
  normalizeSlideControl(merged);
  return merged;
}

// Merge incoming state while protecting newer mode switches, slide commands, service toggles & room/booking writes
function mergeIncomingState(incomingRaw, options = {}) {
  const next = deepMergeSeed(incomingRaw);
  const localRd = currentState?.remoteDisplay || {};
  const nextRd = next.remoteDisplay || {};
  const localModeTime = Math.max(localRd.modeUpdatedAt || 0, lastLocalModeChangeAt);
  const incomingModeTime = nextRd.modeUpdatedAt || 0;
  const recentMutation = (Date.now() - lastLocalMutationAt) < 5000;

  // Always preserve whichever state has the newer modeUpdatedAt timestamp
  if (localModeTime > incomingModeTime) {
    next.remoteDisplay.activeMode = localRd.activeMode;
    next.remoteDisplay.activePresenterId = localRd.activePresenterId;
    next.remoteDisplay.modeUpdatedAt = localModeTime;
    if (localRd.targetRoomId) next.remoteDisplay.targetRoomId = localRd.targetRoomId;
    if (localRd.announcement) next.remoteDisplay.announcement = localRd.announcement;
    if (localRd.welcomeBoard) next.remoteDisplay.welcomeBoard = localRd.welcomeBoard;
  }

  // Preserve newer presenter list if incoming snapshot has older updatedAt
  const localRdUpdated = localRd.updatedAt || 0;
  const incomingRdUpdated = nextRd.updatedAt || 0;
  if (localRdUpdated > incomingRdUpdated && Array.isArray(localRd.presenters)) {
    next.remoteDisplay.presenters = localRd.presenters;
    next.remoteDisplay.updatedAt = localRdUpdated;
  }

  // Reconcile remoteDisplay.slideControl by updatedAt / commandSeq while allowing fresh load after server restart
  const localSc = localRd.slideControl || {};
  const incomingSc = nextRd.slideControl || {};
  const localScUpdated = Number(localSc.updatedAt) || 0;
  const incomingScUpdated = Number(incomingSc.updatedAt) || 0;
  const localSeq = Number(localSc.commandSeq) || 0;
  const incomingSeq = Number(incomingSc.commandSeq) || 0;
  const recentSlideCommand = (Date.now() - lastLocalSlideCommandAt) < 5000;
  const allowZeroSlideReset = Boolean(options && options.allowZeroSlideReset === true);

  if (localScUpdated > 0) {
    const incomingIsOlder =
      (!allowZeroSlideReset && recentSlideCommand && incomingScUpdated <= localScUpdated) ||
      (incomingScUpdated > 0 && (localScUpdated > incomingScUpdated || (localScUpdated === incomingScUpdated && localSeq > incomingSeq))) ||
      (incomingScUpdated === 0 && !allowZeroSlideReset);
    if (incomingIsOlder) {
      next.remoteDisplay.slideControl = { ...localSc };
    }
  }

  // Reconcile serviceToggles per key by updatedAt and recent local mutation window
  const localToggles = normalizeServiceToggles(currentState?.config?.serviceToggles);
  const incomingToggles = normalizeServiceToggles(next.config?.serviceToggles);
  const mergedToggles = {};
  for (const key of SERVICE_KEYS) {
    const lt = localToggles[key];
    const it = incomingToggles[key];
    if ((recentMutation && lt.updatedAt > 0 && it.updatedAt <= lt.updatedAt) || lt.updatedAt > it.updatedAt) {
      mergedToggles[key] = { ...lt };
    } else {
      mergedToggles[key] = { ...it };
    }
  }
  next.config.serviceToggles = mergedToggles;

  // Monotonic room timestamp protection against stale poll/seed snapshots
  const localRoomsTs = Math.max(
    Number(currentState?.roomsUpdatedAt) || 0,
    Number(currentState?.roomsMeta?.updatedAt) || 0,
    getMaxRoomUpdatedAt(currentState?.rooms)
  );
  const incomingRoomsTs = Math.max(
    Number(next.roomsUpdatedAt) || 0,
    Number(next.roomsMeta?.updatedAt) || 0,
    getMaxRoomUpdatedAt(next.rooms)
  );
  if ((recentMutation || localRoomsTs > incomingRoomsTs) && Array.isArray(currentState?.rooms) && currentState.rooms.length > 0) {
    next.rooms = currentState.rooms;
    next.roomsUpdatedAt = localRoomsTs;
    next.roomsMeta = currentState.roomsMeta || { updatedAt: localRoomsTs, source: localRoomsTs > 0 ? "persisted" : "seed" };
  }

  // Protect recent booking mutations from stale poll snapshots
  if (recentMutation && currentState && Array.isArray(currentState.bookings)) {
    next.bookings = currentState.bookings;
  }

  normalizeSlideControl(next);
  return next;
}

function loadLocalState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return deepMergeSeed(JSON.parse(saved));
    }
  } catch (e) {
    console.warn("Local storage read failed:", e);
  }
  return deepMergeSeed(null);
}

function saveLocalState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // If previewFrame base64 exceeds localStorage quota, save lightweight state without previewFrame so activeMode always persists
    try {
      const slim = {
        ...state,
        remoteDisplay: {
          ...(state.remoteDisplay || {}),
          presenters: ((state.remoteDisplay && state.remoteDisplay.presenters) || []).map(p => ({
            ...p,
            previewFrame: null
          }))
        }
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    } catch (e2) {
      console.warn("Local storage write failed:", e2);
    }
  }
}

function notifyListeners() {
  for (const cb of listeners) {
    try {
      cb(currentState);
    } catch (e) {
      console.error("Listener error:", e);
    }
  }
}

function setSyncStatus(mode, detail = "") {
  syncMode = mode;
  syncDetail = detail || syncDetail;
  for (const cb of statusListeners) {
    try {
      cb({ mode: syncMode, detail: syncDetail, firebaseConnected, databaseURL: firebaseConfig.databaseURL, projectId: firebaseConfig.projectId });
    } catch (e) {
      console.error("Status listener error:", e);
    }
  }
}

// Listen to cross-tab BroadcastChannel updates immediately
if (bc) {
  bc.onmessage = (event) => {
    const msg = event.data;
    if (!msg) return;
    if (msg.type === "PRESENTERS_ONLY_UPDATED" && Array.isArray(msg.presenters)) {
      if (!currentState.remoteDisplay) currentState.remoteDisplay = {};
      currentState.remoteDisplay.presenters = msg.presenters;
      saveLocalState(currentState);
      notifyListeners();
      return;
    }
    if (msg.type === "STATE_UPDATED" && msg.state) {
      currentState = mergeIncomingState(msg.state);
      saveLocalState(currentState);
      notifyListeners();
    }
  };
}

// Listen to cross-tab localStorage 'storage' events so TV Receiver reacts immediately on same browser
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY && event.newValue) {
      try {
        const parsed = JSON.parse(event.newValue);
        currentState = mergeIncomingState(parsed);
        notifyListeners();
      } catch (e) {}
    }
  });
}

// Fetch from Vercel Serverless API (/api/data) to stay synced even if Firebase RTDB rules are locked
async function fetchApiState() {
  const fetchStartedAt = Date.now();
  try {
    const res = await fetch("/api/data", { cache: "no-store" });
    if (res.ok) {
      // Ignore poll responses that started before our latest local mode, slide command, or room/booking mutation
      if (
        fetchStartedAt < lastLocalModeChangeAt ||
        fetchStartedAt < lastLocalMutationAt ||
        fetchStartedAt < lastLocalSlideCommandAt
      ) {
        return true;
      }
      const apiData = await res.json();
      if (apiData && typeof apiData === "object") {
        const nextBootId = typeof apiData.serverBootId === "string" && apiData.serverBootId
          ? apiData.serverBootId
          : null;
        const bootIdChanged = Boolean(nextBootId && lastKnownServerBootId && nextBootId !== lastKnownServerBootId);
        const initialServerSyncWithBootId = Boolean(!hasCompletedInitialApiSync && nextBootId);
        if (nextBootId) {
          setLastKnownServerBootId(nextBootId);
        }
        hasCompletedInitialApiSync = true;
        currentState = mergeIncomingState(apiData, {
          allowZeroSlideReset: bootIdChanged || initialServerSyncWithBootId
        });
        saveLocalState(currentState);
        notifyListeners();
        if (!firebaseConnected) {
          setSyncStatus("cloud-api", "Firebase Rules Locked (401) • Persisted on HQ Cloud Server");
        }
        return true;
      }
    }
  } catch (e) {
    // Ignore network error if running purely static
  }
  return false;
}

async function pushApiState(newState, { throwOnError = false } = {}) {
  try {
    const res = await fetch("/api/data", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAdminAuthHeaders()
      },
      body: JSON.stringify(newState)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.code = data && data.code;
      err.service = data && data.service;
      err.notice = data && data.notice;
      if (err.code === "SERVICE_DISABLED") {
        fetchApiState();
      }
      if (throwOnError) throw err;
      return { ok: false, error: err.message, status: res.status, code: err.code, service: err.service, notice: err.notice };
    }
    if (data && data.state) {
      if (typeof data.state.serverBootId === "string" && data.state.serverBootId) {
        setLastKnownServerBootId(data.state.serverBootId);
      }
      hasCompletedInitialApiSync = true;
      currentState = mergeIncomingState(data.state);
      saveLocalState(currentState);
      notifyListeners();
    }
    return { ok: true, data };
  } catch (e) {
    if (e && e.status) {
      if (throwOnError) throw e;
      return { ok: false, error: e.message, status: e.status, code: e.code, service: e.service, notice: e.notice };
    }
    if (throwOnError) throw e;
    return { ok: false, offline: true };
  }
}

async function pushApiAction(action, payload, { throwOnError = false } = {}) {
  try {
    const res = await fetch("/api/data", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAdminAuthHeaders()
      },
      body: JSON.stringify({ __action: action, payload })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.code = data && data.code;
      err.service = data && data.service;
      err.notice = data && data.notice;
      if (err.code === "SERVICE_DISABLED") {
        fetchApiState();
      }
      if (throwOnError) throw err;
      return { ok: false, error: err.message, status: res.status, code: err.code, service: err.service, notice: err.notice };
    }
    if (data && data.state) {
      if (typeof data.state.serverBootId === "string" && data.state.serverBootId) {
        setLastKnownServerBootId(data.state.serverBootId);
      }
      hasCompletedInitialApiSync = true;
      currentState = mergeIncomingState(data.state);
      saveLocalState(currentState);
      notifyListeners();
    }
    return { ok: true, data };
  } catch (e) {
    if (e && e.status) {
      if (throwOnError) throw e;
      return { ok: false, error: e.message, status: e.status, code: e.code, service: e.service, notice: e.notice };
    }
    if (throwOnError && (action === "UPDATE_SERVICE_TOGGLES" || action === "SLIDE_COMMAND")) {
      throw e;
    }
    return { ok: false, offline: true };
  }
}

// Push specific node (`rooms`, `bookings`, `config`, etc.) directly to Firebase Realtime Database
async function pushFirebaseNode(nodePath, data) {
  if (!db) return false;
  try {
    await set(ref(db, nodePath), data);
    firebaseConnected = true;
    setSyncStatus("firebase", `Saved to Firebase (${firebaseConfig.projectId}/${nodePath})`);
    return true;
  } catch (err) {
    console.info(`Firebase write to /${nodePath} blocked by security rules:`, err.message);
    return false;
  }
}

// Initialize Firebase Realtime Listener (including dedicated /rooms and /bookings listeners)
async function initRealtimeSync() {
  if (!db) {
    setSyncStatus("cloud-api", "Using HQ Cloud API Sync");
    fetchApiState();
    return;
  }

  // Attempt Firebase Auth sign-in if custom token is configured or anonymous auth is enabled
  if (auth) {
    try {
      const customToken = typeof localStorage !== "undefined" ? localStorage.getItem("cchs_firebase_custom_token") : null;
      if (customToken) {
        await signInWithCustomToken(auth, customToken);
      } else {
        await signInAnonymously(auth);
      }
    } catch (authErr) {
      // Anonymous auth not enabled or custom token not set; proceed with standard RTDB connection
    }
  }

  const rootRef = ref(db, "/");
  const roomsRef = ref(db, "rooms");
  const bookingsRef = ref(db, "bookings");
  const remoteDisplayRef = ref(db, "remoteDisplay");
  const configRef = ref(db, "config");
  const departmentsRef = ref(db, "departments");

  // Always fetch latest server state on init so TV channel & screen share queue are immediately current
  fetchApiState();

  // Dedicated listener on /remoteDisplay in Firebase Realtime Database for instant TV channel & presenter switching
  onValue(
    remoteDisplayRef,
    async (snapshot) => {
      const val = snapshot.val();
      if (val && typeof val === "object") {
        const normalizedPresenters = normalizeFirebaseArray(val.presenters);
        const localSc = currentState.remoteDisplay?.slideControl;
        const incomingSc = val.slideControl && typeof val.slideControl === "object" ? val.slideControl : null;
        const incomingScUpdated = Number(incomingSc?.updatedAt) || 0;
        const incomingScSeq = Number(incomingSc?.commandSeq) || 0;
        const localScUpdated = Number(localSc?.updatedAt) || 0;
        const preserveLocalSc = Boolean(
          localSc && localScUpdated > 0 && (!incomingSc || (incomingScUpdated === 0 && incomingScSeq === 0))
        );
        const incomingRd = {
          ...val,
          presenters: Array.isArray(normalizedPresenters) ? normalizedPresenters : (currentState.remoteDisplay?.presenters || []),
          ...(preserveLocalSc ? { slideControl: localSc } : {})
        };
        currentState = mergeIncomingState(
          {
            ...currentState,
            remoteDisplay: incomingRd
          },
          { authoritativeSource: false }
        );
        saveLocalState(currentState);
        notifyListeners();
      }
    },
    () => {}
  );

  // Dedicated listener on /config in Firebase Realtime Database
  onValue(
    configRef,
    (snapshot) => {
      const val = snapshot.val();
      if (val && typeof val === "object") {
        const recentMutation = (Date.now() - lastLocalMutationAt) < 5000;
        const localToggles = normalizeServiceToggles(currentState?.config?.serviceToggles);
        const incomingToggles = normalizeServiceToggles(val.serviceToggles, localToggles);
        const mergedToggles = {};
        for (const key of SERVICE_KEYS) {
          const lt = localToggles[key];
          const it = incomingToggles[key];
          if ((recentMutation && lt.updatedAt > 0 && it.updatedAt <= lt.updatedAt) || lt.updatedAt > it.updatedAt) {
            mergedToggles[key] = { ...lt };
          } else {
            mergedToggles[key] = { ...it };
          }
        }
        currentState = {
          ...currentState,
          config: {
            ...currentState.config,
            ...val,
            serviceToggles: mergedToggles
          }
        };
        normalizeSlideControl(currentState);
        saveLocalState(currentState);
        notifyListeners();
      }
    },
    () => {}
  );

  // Dedicated listener on /departments in Firebase Realtime Database
  onValue(
    departmentsRef,
    (snapshot) => {
      const val = snapshot.val();
      if (val && typeof val === "object" && Object.keys(val).length > 0) {
        currentState = { ...currentState, departments: val };
        normalizeSlideControl(currentState);
        saveLocalState(currentState);
        notifyListeners();
      }
    },
    () => {}
  );

  // Dedicated listener on /rooms in Firebase Realtime Database
  onValue(
    roomsRef,
    async (snapshot) => {
      firebaseConnected = true;
      const val = normalizeFirebaseArray(snapshot.val());
      const localRoomsTs = Math.max(
        Number(currentState?.roomsUpdatedAt) || 0,
        Number(currentState?.roomsMeta?.updatedAt) || 0,
        getMaxRoomUpdatedAt(currentState?.rooms)
      );
      if (val && val.length > 0) {
        const fbRoomsTs = getMaxRoomUpdatedAt(val) || 1;
        if ((Date.now() - lastLocalMutationAt) >= 5000 && (localRoomsTs === 0 || fbRoomsTs >= localRoomsTs)) {
          currentState = {
            ...currentState,
            rooms: val,
            roomsUpdatedAt: fbRoomsTs,
            roomsMeta: { updatedAt: fbRoomsTs, source: "firebase" }
          };
          saveLocalState(currentState);
          notifyListeners();
        }
      } else if (localRoomsTs > 0 && Array.isArray(currentState.rooms) && currentState.rooms.length > 0) {
        try {
          await set(roomsRef, currentState.rooms);
        } catch (e) {}
      }
      setSyncStatus("firebase", `Firebase RTDB Live (${firebaseConfig.projectId})`);
    },
    () => {}
  );

  // Dedicated listener on /bookings in Firebase Realtime Database
  onValue(
    bookingsRef,
    async (snapshot) => {
      firebaseConnected = true;
      const val = normalizeFirebaseArray(snapshot.val());
      if (val) {
        if ((Date.now() - lastLocalMutationAt) >= 5000) {
          currentState = { ...currentState, bookings: val };
          saveLocalState(currentState);
          notifyListeners();
        }
      } else if (Array.isArray(currentState.bookings) && currentState.bookings.length > 0) {
        try {
          await set(bookingsRef, currentState.bookings);
        } catch (e) {}
      }
      setSyncStatus("firebase", `Firebase RTDB Live (${firebaseConfig.projectId})`);
    },
    () => {}
  );

  // Root state listener (read-only merge when rules allow; never blindly overwrites root with seed)
  onValue(
    rootRef,
    async (snapshot) => {
      firebaseConnected = true;
      const val = snapshot.val();
      if (val && (val.departments || val.config || val.rooms || val.bookings || val.remoteDisplay)) {
        const nextVal = { ...val };
        const localSc = currentState.remoteDisplay?.slideControl;
        const incomingSc = nextVal.remoteDisplay?.slideControl && typeof nextVal.remoteDisplay.slideControl === "object"
          ? nextVal.remoteDisplay.slideControl
          : null;
        const incomingScUpdated = Number(incomingSc?.updatedAt) || 0;
        const incomingScSeq = Number(incomingSc?.commandSeq) || 0;
        const localScUpdated = Number(localSc?.updatedAt) || 0;
        if (localSc && localScUpdated > 0 && (!incomingSc || (incomingScUpdated === 0 && incomingScSeq === 0))) {
          nextVal.remoteDisplay = {
            ...(nextVal.remoteDisplay || currentState.remoteDisplay || {}),
            slideControl: localSc
          };
        }
        currentState = mergeIncomingState(nextVal, { authoritativeSource: false });
        saveLocalState(currentState);
      }
      setSyncStatus("firebase", `Firebase RTDB Live (${firebaseConfig.projectId})`);
      notifyListeners();
    },
    async (error) => {
      console.info("Firebase RTDB root notice (using per-node RTDB + API/Server store):", error.message);
      const ok = await fetchApiState();
      if (!firebaseConnected) {
        if (!ok) {
          setSyncStatus("local", "Firebase Rules Locked (permission_denied) • Offline Cache");
        } else {
          setSyncStatus("cloud-api", "Firebase Rules Locked (permission_denied) • Saved on HQ Cloud Server");
        }
      }
      notifyListeners();
    }
  );
}

initRealtimeSync();

// Always poll API every 1.5 seconds so TV displays & channel switches react automatically even when only partial Firebase nodes are unlocked
setInterval(() => {
  fetchApiState();
}, 1500);

export function subscribeState(callback) {
  listeners.add(callback);
  callback(currentState);
  return () => listeners.delete(callback);
}

export function subscribeSyncStatus(callback) {
  statusListeners.add(callback);
  callback({ mode: syncMode, detail: syncDetail, firebaseConnected, databaseURL: firebaseConfig.databaseURL, projectId: firebaseConfig.projectId });
  return () => statusListeners.delete(callback);
}

export function getState() {
  return currentState;
}

export function getServiceStatus(stateOrKey, maybeKey) {
  const serviceKey = typeof stateOrKey === "string" ? stateOrKey : maybeKey;
  const targetState = typeof stateOrKey === "string" ? currentState : (stateOrKey || currentState);
  const toggles = normalizeServiceToggles(targetState?.config?.serviceToggles);
  const entry = toggles[serviceKey];
  if (!entry) {
    return { enabled: true, notice: "", updatedAt: 0 };
  }
  return {
    enabled: entry.enabled !== false,
    notice: typeof entry.notice === "string" ? entry.notice : "",
    updatedAt: Number(entry.updatedAt) || 0
  };
}

export async function updateServiceToggles(toggles) {
  const now = Date.now();
  lastLocalMutationAt = now;
  const existing = normalizeServiceToggles(currentState?.config?.serviceToggles);
  const incoming = toggles && typeof toggles === "object" ? toggles : {};
  const nextToggles = { ...existing };
  for (const key of SERVICE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(incoming, key)) {
      const rawEntry = incoming[key];
      if (typeof rawEntry === "boolean") {
        nextToggles[key] = {
          enabled: rawEntry,
          notice: existing[key].notice || "",
          updatedAt: now
        };
      } else if (rawEntry && typeof rawEntry === "object") {
        nextToggles[key] = {
          enabled: rawEntry.enabled !== false,
          notice: typeof rawEntry.notice === "string" ? rawEntry.notice : (existing[key].notice || ""),
          updatedAt: now
        };
      }
    }
  }

  await pushApiAction("UPDATE_SERVICE_TOGGLES", { serviceToggles: nextToggles }, { throwOnError: true });

  currentState = deepMergeSeed({
    ...currentState,
    config: {
      ...(currentState.config || {}),
      serviceToggles: nextToggles
    }
  });
  saveLocalState(currentState);
  if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
  notifyListeners();

  await pushFirebaseNode("config", currentState.config);
  return currentState.config.serviceToggles;
}

export async function saveFullState(nextState, options = {}) {
  const prevState = currentState;
  lastLocalMutationAt = Date.now();
  const merged = deepMergeSeed(nextState);

  if (options.includeRooms !== true && Array.isArray(prevState?.rooms) && prevState.rooms.length > 0) {
    merged.rooms = prevState.rooms;
    merged.roomsUpdatedAt = prevState.roomsUpdatedAt || 0;
    merged.roomsMeta = prevState.roomsMeta || { updatedAt: merged.roomsUpdatedAt, source: merged.roomsUpdatedAt > 0 ? "persisted" : "seed" };
  }
  if (options.includeBookings !== true && Array.isArray(prevState?.bookings)) {
    merged.bookings = prevState.bookings;
  }
  if (options.preserveServiceToggles !== false && prevState?.config?.serviceToggles) {
    merged.config.serviceToggles = normalizeServiceToggles(prevState.config.serviceToggles);
  }

  currentState = merged;
  saveLocalState(currentState);
  if (bc) {
    bc.postMessage({ type: "STATE_UPDATED", state: currentState });
  }
  notifyListeners();

  const apiPayload = {
    config: merged.config,
    departments: merged.departments,
    history: merged.history,
    remoteDisplay: merged.remoteDisplay
  };
  if (options.includeRooms === true) {
    apiPayload.rooms = merged.rooms;
    apiPayload.roomsUpdatedAt = merged.roomsUpdatedAt;
    apiPayload.roomsMeta = merged.roomsMeta;
  }
  if (options.includeBookings === true) {
    apiPayload.bookings = merged.bookings;
    apiPayload.__allowBookingsOverwrite = true;
  }

  try {
    const apiRes = await pushApiState(apiPayload, { throwOnError: Boolean(options.throwOnError) });
    if (!apiRes.ok && !apiRes.offline) {
      throw new Error(apiRes.error || "Failed to save state");
    }
  } catch (err) {
    currentState = prevState;
    saveLocalState(currentState);
    if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
    notifyListeners();
    throw err;
  }

  // Targeted Firebase RTDB node writes (never overwrite root '/')
  await pushFirebaseNode("config", currentState.config);
  await pushFirebaseNode("departments", currentState.departments);
  await pushFirebaseNode("history", currentState.history);
  if (options.includeRooms === true) {
    await pushFirebaseNode("rooms", currentState.rooms);
  }
  if (options.includeBookings === true) {
    await pushFirebaseNode("bookings", currentState.bookings);
  }
  return currentState;
}

export async function submitDepartmentUpdate({ department, updateText, questionText }) {
  const prevState = currentState;
  lastLocalMutationAt = Date.now();
  const state = JSON.parse(JSON.stringify(currentState));
  if (!state.departments) state.departments = {};
  const qText = questionText || "N/A";
  state.departments[department] = {
    update: updateText,
    question: qText
  };

  if (!Array.isArray(state.history)) state.history = [];
  const entry = {
    timestamp: Date.now(),
    dateString: new Date().toLocaleString("en-MY"),
    department,
    update: updateText,
    question: qText
  };
  state.history.unshift(entry);

  currentState = deepMergeSeed(state);
  saveLocalState(currentState);
  if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
  notifyListeners();

  try {
    await pushApiAction("SUBMIT_DEPARTMENT_UPDATE", { department, updateText, questionText: qText, entry }, { throwOnError: true });
  } catch (err) {
    currentState = prevState;
    saveLocalState(currentState);
    if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
    notifyListeners();
    throw err;
  }

  await pushFirebaseNode("departments", currentState.departments);
  await pushFirebaseNode("history", currentState.history);
  return currentState;
}

export async function saveAdminConfig({ config, departments }) {
  const prevState = currentState;
  lastLocalMutationAt = Date.now();
  const state = JSON.parse(JSON.stringify(currentState));
  const preservedToggles = normalizeServiceToggles(state.config?.serviceToggles);
  if (config) {
    state.config = {
      ...state.config,
      ...config,
      serviceToggles: config.serviceToggles
        ? normalizeServiceToggles(config.serviceToggles, preservedToggles)
        : preservedToggles
    };
  }
  if (departments) {
    state.departments = departments;
  }

  currentState = deepMergeSeed(state);
  saveLocalState(currentState);
  if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
  notifyListeners();

  try {
    await pushApiAction("SAVE_ADMIN_CONFIG", { config: currentState.config, departments: currentState.departments }, { throwOnError: true });
  } catch (err) {
    currentState = prevState;
    saveLocalState(currentState);
    if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
    notifyListeners();
    throw err;
  }

  await pushFirebaseNode("config", currentState.config);
  await pushFirebaseNode("departments", currentState.departments);
  return currentState;
}

export async function resetMeetingSession() {
  const prevState = currentState;
  lastLocalMutationAt = Date.now();
  const state = JSON.parse(JSON.stringify(currentState));
  for (const dept of Object.keys(state.departments || {})) {
    state.departments[dept] = { update: "Pending update...", question: "N/A" };
  }

  currentState = deepMergeSeed(state);
  saveLocalState(currentState);
  if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
  notifyListeners();

  try {
    await pushApiAction("RESET_MEETING_SESSION", {}, { throwOnError: true });
  } catch (err) {
    currentState = prevState;
    saveLocalState(currentState);
    if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
    notifyListeners();
    throw err;
  }

  await pushFirebaseNode("departments", currentState.departments);
  return currentState;
}

export async function resetToInitialSeed(options = {}) {
  const prevState = currentState;
  lastLocalMutationAt = Date.now();
  const fresh = JSON.parse(JSON.stringify(INITIAL_SEED_DATA));
  const preservedToggles = normalizeServiceToggles(prevState?.config?.serviceToggles);
  fresh.config.serviceToggles = options.resetServiceToggles === true
    ? normalizeServiceToggles(DEFAULT_SERVICE_TOGGLES)
    : preservedToggles;

  if (options.includeRooms !== true && Array.isArray(prevState?.rooms) && prevState.rooms.length > 0) {
    fresh.rooms = prevState.rooms;
    fresh.roomsUpdatedAt = prevState.roomsUpdatedAt || 0;
    fresh.roomsMeta = prevState.roomsMeta || { updatedAt: fresh.roomsUpdatedAt, source: fresh.roomsUpdatedAt > 0 ? "persisted" : "seed" };
  }
  if (options.includeBookings !== true && Array.isArray(prevState?.bookings)) {
    fresh.bookings = prevState.bookings;
  }

  currentState = deepMergeSeed(fresh);
  saveLocalState(currentState);
  if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
  notifyListeners();

  try {
    await pushApiAction("RESET_TO_INITIAL_SEED", {
      resetServiceToggles: options.resetServiceToggles === true,
      includeRooms: options.includeRooms === true,
      includeBookings: options.includeBookings === true
    }, { throwOnError: true });
  } catch (err) {
    currentState = prevState;
    saveLocalState(currentState);
    if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
    notifyListeners();
    throw err;
  }

  await pushFirebaseNode("config", currentState.config);
  await pushFirebaseNode("departments", currentState.departments);
  await pushFirebaseNode("history", currentState.history);
  return currentState;
}

export function checkBookingConflict(bookings, { roomId, date, startTime, endTime, excludeId = null }) {
  if (!Array.isArray(bookings)) return null;
  return bookings.find(
    (b) =>
      b.id !== excludeId &&
      b.roomId === roomId &&
      b.date === date &&
      startTime < b.endTime &&
      endTime > b.startTime
  ) || null;
}

export async function addRoomBooking(booking) {
  const prevState = currentState;
  lastLocalMutationAt = Date.now();
  const state = JSON.parse(JSON.stringify(currentState));
  if (!Array.isArray(state.bookings)) state.bookings = [];

  if (!booking.startTime || !booking.endTime || booking.endTime <= booking.startTime) {
    throw new Error("End time must be after start time.");
  }

  const roomObj = (state.rooms || []).find((r) => r.id === booking.roomId);
  if (roomObj && roomObj.status === "maintenance") {
    throw new Error(`"${roomObj.name}" is currently marked as Under Maintenance by Administrator.`);
  }

  const conflict = checkBookingConflict(state.bookings, {
    roomId: booking.roomId,
    date: booking.date,
    startTime: booking.startTime,
    endTime: booking.endTime
  });

  if (conflict) {
    throw new Error(
      `Redundant booking not allowed: This room is already booked from ${conflict.startTime} to ${conflict.endTime} for "${conflict.title}" (${conflict.department}).`
    );
  }

  const newBooking = {
    id: "bk-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
    createdAt: Date.now(),
    whatsappNotified: false,
    ...booking
  };
  state.bookings.push(newBooking);

  currentState = deepMergeSeed(state);
  saveLocalState(currentState);
  if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
  notifyListeners();

  // 1. Persist to HQ Cloud Server (/api/data -> data/runtime-state.json) first; rollback if rejected
  try {
    await pushApiAction("ADD_BOOKING", { booking: newBooking }, { throwOnError: true });
  } catch (err) {
    currentState = prevState;
    saveLocalState(currentState);
    if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
    notifyListeners();
    throw err;
  }

  // 2. Write directly to Firebase Realtime Database (/bookings)
  await pushFirebaseNode("bookings", currentState.bookings);

  return newBooking;
}

export async function updateRoomBooking(bookingId, updatedFields) {
  const prevState = currentState;
  lastLocalMutationAt = Date.now();
  const state = JSON.parse(JSON.stringify(currentState));
  if (!Array.isArray(state.bookings)) state.bookings = [];
  const idx = state.bookings.findIndex((b) => b.id === bookingId);
  if (idx === -1) {
    throw new Error("Booking not found");
  }

  const candidate = {
    ...state.bookings[idx],
    ...updatedFields,
    id: bookingId,
    updatedAt: Date.now()
  };

  if (candidate.endTime <= candidate.startTime) {
    throw new Error("End time must be after start time.");
  }

  const conflict = checkBookingConflict(state.bookings, {
    roomId: candidate.roomId,
    date: candidate.date,
    startTime: candidate.startTime,
    endTime: candidate.endTime,
    excludeId: bookingId
  });

  if (conflict) {
    throw new Error(
      `Redundant booking not allowed: This room is already booked from ${conflict.startTime} to ${conflict.endTime} for "${conflict.title}" (${conflict.department}).`
    );
  }

  state.bookings[idx] = candidate;
  currentState = deepMergeSeed(state);
  saveLocalState(currentState);
  if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
  notifyListeners();

  // 1. Persist to HQ Cloud Server (/api/data -> data/runtime-state.json) first; rollback if rejected
  try {
    await pushApiAction("UPDATE_BOOKING", { bookingId, updatedFields }, { throwOnError: true });
  } catch (err) {
    currentState = prevState;
    saveLocalState(currentState);
    if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
    notifyListeners();
    throw err;
  }

  // 2. Write directly to Firebase Realtime Database (/bookings)
  await pushFirebaseNode("bookings", currentState.bookings);

  return currentState.bookings.find((b) => b.id === bookingId) || candidate;
}

export async function deleteRoomBooking(bookingId) {
  const prevState = currentState;
  lastLocalMutationAt = Date.now();
  const state = JSON.parse(JSON.stringify(currentState));
  state.bookings = (state.bookings || []).filter((b) => b.id !== bookingId);
  currentState = deepMergeSeed(state);
  saveLocalState(currentState);
  if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
  notifyListeners();

  // 1. Persist to HQ Cloud Server (/api/data -> data/runtime-state.json) first; rollback if rejected
  try {
    await pushApiAction("DELETE_BOOKING", { bookingId }, { throwOnError: true });
  } catch (err) {
    currentState = prevState;
    saveLocalState(currentState);
    if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
    notifyListeners();
    throw err;
  }

  // 2. Write directly to Firebase Realtime Database (/bookings)
  await pushFirebaseNode("bookings", currentState.bookings);

  return currentState;
}

export async function markBookingNotified(bookingId) {
  lastLocalMutationAt = Date.now();
  if (!Array.isArray(currentState.bookings)) return currentState;
  const idx = currentState.bookings.findIndex((b) => b.id === bookingId);
  if (idx === -1) return currentState;
  currentState.bookings[idx].whatsappNotified = true;
  currentState.bookings[idx].notifiedAt = Date.now();
  saveLocalState(currentState);
  if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
  notifyListeners();

  await pushFirebaseNode("bookings", currentState.bookings);
  await pushApiAction("MARK_BOOKING_NOTIFIED", { bookingId });

  return currentState;
}

// ============================================================================
// ADMIN MEETING ROOM CUSTOMIZATION (Quantity, Name, Floor, Capacity, Details)
// ============================================================================
export async function saveMeetingRooms(roomsList) {
  const prevState = currentState;
  const now = Math.max(Date.now(), (currentState?.roomsUpdatedAt || 0) + 1);
  lastLocalMutationAt = now;
  const state = JSON.parse(JSON.stringify(currentState));
  const stampedRooms = (Array.isArray(roomsList) ? roomsList : []).map((r) => ({ ...r, updatedAt: now }));
  state.rooms = stampedRooms;
  state.roomsUpdatedAt = now;
  state.roomsMeta = { updatedAt: now, source: "admin" };

  currentState = deepMergeSeed(state);
  saveLocalState(currentState);
  if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
  notifyListeners();

  // 1. Persist to HQ Cloud Server (/api/data -> data/runtime-state.json) first; rollback if rejected
  try {
    await pushApiAction("SAVE_ROOMS", { rooms: stampedRooms, roomsUpdatedAt: now }, { throwOnError: true });
  } catch (err) {
    currentState = prevState;
    saveLocalState(currentState);
    if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
    notifyListeners();
    throw err;
  }

  // 2. Write directly to Firebase Realtime Database (/rooms)
  await pushFirebaseNode("rooms", currentState.rooms);

  return currentState.rooms;
}

export async function addMeetingRoom(roomData) {
  const rooms = JSON.parse(JSON.stringify(currentState.rooms || []));
  const newRoom = {
    id: roomData.id || ("room-" + Date.now() + "-" + Math.random().toString(36).slice(2, 5)),
    name: roomData.name || "New HQ Meeting Room",
    floor: roomData.floor || "Level 1",
    capacity: Number(roomData.capacity) || 10,
    amenities: Array.isArray(roomData.amenities)
      ? roomData.amenities
      : String(roomData.amenities || "TV Display, Whiteboard").split(",").map((s) => s.trim()).filter(Boolean),
    color: roomData.color || "#1863dc",
    status: roomData.status || "available"
  };
  rooms.push(newRoom);
  await saveMeetingRooms(rooms);
  return newRoom;
}

export async function updateMeetingRoom(roomId, updatedFields) {
  const rooms = JSON.parse(JSON.stringify(currentState.rooms || []));
  const idx = rooms.findIndex((r) => r.id === roomId);
  if (idx === -1) throw new Error("Meeting room not found");
  rooms[idx] = {
    ...rooms[idx],
    ...updatedFields,
    id: roomId,
    capacity: Number(updatedFields.capacity ?? rooms[idx].capacity) || 10,
    amenities: Array.isArray(updatedFields.amenities)
      ? updatedFields.amenities
      : typeof updatedFields.amenities === "string"
        ? updatedFields.amenities.split(",").map((s) => s.trim()).filter(Boolean)
        : rooms[idx].amenities
  };
  await saveMeetingRooms(rooms);
  return rooms[idx];
}

export async function deleteMeetingRoom(roomId) {
  const rooms = (currentState.rooms || []).filter((r) => r.id !== roomId);
  if (rooms.length === 0) {
    throw new Error("At least 1 meeting room must remain in the system.");
  }
  await saveMeetingRooms(rooms);
  return rooms;
}

// ============================================================================
// WHATSAPP NOTIFICATION & OUTLOOK CALENDAR INTEGRATION HELPERS
// ============================================================================
export function formatWhatsAppPhone(rawPhone) {
  if (!rawPhone) return "";
  let digits = String(rawPhone).replace(/[^0-9]/g, "");
  // Automatically convert Malaysian local numbers starting with '01' to '601'
  if (digits.startsWith("01")) {
    digits = "6" + digits;
  } else if (digits.startsWith("1") && digits.length >= 9 && digits.length <= 10) {
    digits = "60" + digits;
  }
  return digits;
}

export function buildWhatsAppBookingMessage(booking, room, type = "starting") {
  const b = booking || {};
  const roomName = room?.name || b.roomId || "HQ Meeting Room";
  const roomFloor = room?.floor ? ` (${room.floor})` : "";
  const header = type === "starting"
    ? "▸ *CARECLINICS HQ — YOUR ROOM BOOKING IS STARTING NOW*"
    : "✓ *CARECLINICS HQ — ROOM BOOKING CONFIRMED*";

  const statusLine = type === "starting"
    ? `Hi *${b.organizer || "Staff"}*, your reserved meeting room is ready and your session time has arrived!`
    : `Hi *${b.organizer || "Staff"}*, your meeting room reservation at Careclinics HQ has been scheduled.`;

  const bullet = type === "starting" ? "-" : "•";
  const lines = [
    header,
    "",
    statusLine,
    "",
    `${bullet} *Room:* ${roomName}${roomFloor}`,
    `${bullet} *Meeting:* ${b.title || "Meeting"}`,
    `${bullet} *Department:* ${b.department || "HQ"}`,
    `${bullet} *Date:* ${b.date || ""}`,
    `${bullet} *Time:* ${b.startTime || ""} – ${b.endTime || ""}`,
    b.notes ? `${bullet} *Notes:* ${b.notes}` : "",
    "",
    "_Careclinics Healthcare Services HQ Portal_"
  ].filter(Boolean);

  return lines.join("\n");
}

export function buildWhatsAppBookingUrl(booking, room, type = "starting") {
  const phone = formatWhatsAppPhone(booking?.phone || "");
  const text = encodeURIComponent(buildWhatsAppBookingMessage(booking, room, type));
  return phone
    ? `https://wa.me/${phone}?text=${text}`
    : `https://wa.me/?text=${text}`;
}

export function buildOutlookCalendarUrls(booking, room) {
  const roomName = room ? `${room.name} (${room.floor || "Careclinics HQ"})` : (booking.roomId || "Careclinics HQ");
  const startIso = `${booking.date}T${booking.startTime}:00`;
  const endIso = `${booking.date}T${booking.endTime}:00`;
  const subject = `[Careclinics HQ] ${booking.title} — ${room?.name || booking.roomId}`;
  const bodyLines = [
    `Careclinics Healthcare Services HQ Room Reservation`,
    `Room: ${roomName}`,
    `Department: ${booking.department || "HQ"}`,
    `Booked By: ${booking.organizer || "Staff"}${booking.phone ? " (" + booking.phone + ")" : ""}`,
    `Time: ${booking.date} | ${booking.startTime} - ${booking.endTime}`,
    booking.notes ? `Notes: ${booking.notes}` : ""
  ].filter(Boolean).join("\n");

  const query = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject,
    startdt: startIso,
    enddt: endIso,
    location: roomName,
    body: bodyLines
  }).toString();

  return {
    office365Url: `https://outlook.office.com/calendar/0/deeplink/compose?${query}`,
    outlookLiveUrl: `https://outlook.live.com/calendar/0/deeplink/compose?${query}`
  };
}

export function downloadOutlookIcs(booking, room) {
  const roomName = room ? `${room.name} (${room.floor || "Careclinics HQ"})` : (booking.roomId || "Careclinics HQ");
  const dtStart = `${booking.date.replace(/-/g, "")}T${booking.startTime.replace(":", "")}00`;
  const dtEnd = `${booking.date.replace(/-/g, "")}T${booking.endTime.replace(":", "")}00`;
  const dtStamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const uid = `${booking.id || "bk-" + Date.now()}@careclinics-hq.local`;
  const summary = `[Careclinics HQ] ${booking.title} (${room?.name || booking.roomId})`;
  const desc = `Room: ${roomName}\\nDepartment: ${booking.department || "HQ"}\\nBooked By: ${booking.organizer || "Staff"}${booking.phone ? " (" + booking.phone + ")" : ""}${booking.notes ? "\\nNotes: " + booking.notes : ""}`;

  const icsContent = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Careclinics Healthcare Services HQ//Room Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `LOCATION:${roomName}`,
    `DESCRIPTION:${desc}`,
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "TRIGGER:-PT10M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Careclinics HQ Room Booking Reminder",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");

  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Careclinics-Room-${booking.date}-${booking.startTime.replace(":", "")}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function sendSlideCommand(command, payload = {}) {
  lastLocalSlideCommandAt = Date.now();
  const res = await pushApiAction("SLIDE_COMMAND", { command, ...payload }, { throwOnError: true });
  if (!res || !res.ok) {
    throw new Error((res && res.error) || "Slide command failed");
  }
  if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
  await pushFirebaseNode("remoteDisplay/slideControl", currentState.remoteDisplay.slideControl);
  return currentState.remoteDisplay.slideControl;
}

export async function updateRemoteDisplay(remoteDisplayPatch) {
  const now = Date.now();
  lastLocalModeChangeAt = now;
  const state = JSON.parse(JSON.stringify(currentState));
  const existingPresenters = Array.isArray(state.remoteDisplay?.presenters) ? state.remoteDisplay.presenters : [];
  const existingActivePresenterId = state.remoteDisplay?.activePresenterId || null;

  state.remoteDisplay = {
    ...state.remoteDisplay,
    ...remoteDisplayPatch,
    presenters: Array.isArray(remoteDisplayPatch.presenters) ? remoteDisplayPatch.presenters : existingPresenters,
    modeUpdatedAt: now,
    updatedAt: now
  };

  if (remoteDisplayPatch.activeMode === "screen-share" && remoteDisplayPatch.activePresenterId === undefined) {
    state.remoteDisplay.activePresenterId = existingActivePresenterId || existingPresenters[0]?.id || null;
  }

  currentState = deepMergeSeed(state);
  saveLocalState(currentState);
  if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
  notifyListeners();

  pushApiAction("UPDATE_REMOTE_DISPLAY", { patch: state.remoteDisplay });

  if (db) {
    try {
      await set(ref(db, "remoteDisplay/activeMode"), state.remoteDisplay.activeMode);
      await set(ref(db, "remoteDisplay/activePresenterId"), state.remoteDisplay.activePresenterId || null);
      await set(ref(db, "remoteDisplay/modeUpdatedAt"), now);
      if (remoteDisplayPatch.targetRoomId) await set(ref(db, "remoteDisplay/targetRoomId"), remoteDisplayPatch.targetRoomId);
      if (remoteDisplayPatch.announcement) await set(ref(db, "remoteDisplay/announcement"), remoteDisplayPatch.announcement);
      if (remoteDisplayPatch.welcomeBoard) await set(ref(db, "remoteDisplay/welcomeBoard"), remoteDisplayPatch.welcomeBoard);
    } catch (e) {}
  }
  return currentState;
}

export async function registerPresenter(presenter) {
  const now = Date.now();
  if (!currentState.remoteDisplay) currentState.remoteDisplay = {};
  const list = Array.isArray(currentState.remoteDisplay.presenters) ? currentState.remoteDisplay.presenters : [];
  const filtered = list.filter((p) => p.id !== presenter.id);
  const fullPresenter = {
    ...presenter,
    startedAt: presenter.startedAt || now,
    lastHeartbeat: now
  };
  filtered.push(fullPresenter);
  currentState.remoteDisplay.presenters = filtered;
  saveLocalState(currentState);
  if (bc) bc.postMessage({ type: "PRESENTERS_ONLY_UPDATED", presenters: filtered });
  notifyListeners();

  pushApiAction("REGISTER_PRESENTER", { presenter: fullPresenter });

  if (db) {
    try {
      await set(ref(db, "remoteDisplay/presenters"), filtered);
    } catch (e) {}
  }
  return currentState;
}

export async function updatePresenterStreamData(presenterId, patch) {
  if (!currentState.remoteDisplay || !Array.isArray(currentState.remoteDisplay.presenters)) return currentState;
  const idx = currentState.remoteDisplay.presenters.findIndex((p) => p.id === presenterId);
  if (idx === -1) return currentState;
  currentState.remoteDisplay.presenters[idx] = {
    ...currentState.remoteDisplay.presenters[idx],
    ...patch,
    lastHeartbeat: Date.now()
  };
  saveLocalState(currentState);
  if (bc) bc.postMessage({ type: "PRESENTERS_ONLY_UPDATED", presenters: currentState.remoteDisplay.presenters });
  notifyListeners();

  // Surgical update: only updates this presenter's stream data on the server, NEVER touching activeMode or activePresenterId
  pushApiAction("UPDATE_PRESENTER", { presenterId, patch });

  if (db) {
    try {
      await set(ref(db, "remoteDisplay/presenters"), currentState.remoteDisplay.presenters);
    } catch (e) {}
  }
  return currentState;
}

export async function removePresenter(presenterId) {
  if (!currentState.remoteDisplay) return currentState;
  const list = Array.isArray(currentState.remoteDisplay.presenters) ? currentState.remoteDisplay.presenters : [];
  const nextList = list.filter((p) => p.id !== presenterId);
  currentState.remoteDisplay.presenters = nextList;

  if (currentState.remoteDisplay.activePresenterId === presenterId) {
    currentState.remoteDisplay.activePresenterId = nextList[0]?.id || null;
    if (!currentState.remoteDisplay.activePresenterId && currentState.remoteDisplay.activeMode === "screen-share") {
      currentState.remoteDisplay.activeMode = "meeting-tv";
      currentState.remoteDisplay.modeUpdatedAt = Date.now();
    }
  }

  saveLocalState(currentState);
  if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
  notifyListeners();

  pushApiAction("REMOVE_PRESENTER", { presenterId });

  if (db) {
    try {
      await set(ref(db, "remoteDisplay/presenters"), nextList);
      await set(ref(db, "remoteDisplay/activePresenterId"), currentState.remoteDisplay.activePresenterId);
      await set(ref(db, "remoteDisplay/activeMode"), currentState.remoteDisplay.activeMode);
    } catch (e) {}
  }
  return currentState;
}

export async function selectActivePresenter(presenterId) {
  const now = Date.now();
  lastLocalModeChangeAt = now;
  if (!currentState.remoteDisplay) currentState.remoteDisplay = {};
  currentState.remoteDisplay.activePresenterId = presenterId || null;
  currentState.remoteDisplay.activeMode = presenterId ? "screen-share" : "meeting-tv";
  currentState.remoteDisplay.modeUpdatedAt = now;
  currentState.remoteDisplay.updatedAt = now;

  saveLocalState(currentState);
  if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
  notifyListeners();

  pushApiAction("SELECT_PRESENTER", { presenterId: presenterId || null });

  if (db) {
    try {
      await set(ref(db, "remoteDisplay/activePresenterId"), currentState.remoteDisplay.activePresenterId);
      await set(ref(db, "remoteDisplay/activeMode"), currentState.remoteDisplay.activeMode);
      await set(ref(db, "remoteDisplay/modeUpdatedAt"), now);
    } catch (e) {}
  }
  return currentState;
}
