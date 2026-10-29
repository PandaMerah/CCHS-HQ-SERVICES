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

// Seeded directly from CCHSMeetingDashboard/data.json + HQ Room Booking & Remote Display defaults
export const INITIAL_SEED_DATA = {
  config: {
    showQnA: false,
    showDailyPhrases: true,
    showVisionMission: true,
    showLastMinuteSpeech: true,
    visionText: "Empower patients with the freedom to access quality healthcare services through digital integration anytime, anywhere.",
    missionText: "Deliver quality personalised care by merging of best medical practises with modern technology. ",
    phrases: ["Humanising Care."],
    lastMinuteSpeechText: "Good afternoon, everyone. Thank you for being here today.As we look back at where we started this year, I want to begin with a simple thank you. We faced real shifts and unexpected hurdles. Because of your hard work, your creativity, and your care for one another, we did not just get through it—we adapted and grew. Every milestone we reached belongs to this team."
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
    updatedAt: Date.now()
  }
};

const STORAGE_KEY = "cchs_hq_unified_state_v1";
const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("cchs_hq_sync_channel") : null;

let app = null;
let db = null;
try {
  app = initializeApp(firebaseConfig);
  db = getDatabase(app);
} catch (err) {
  console.warn("Firebase initialization warning:", err);
}

let syncMode = "connecting"; // 'firebase' | 'cloud-api' | 'local'
let firebaseConnected = false;
let lastLocalModeChangeAt = 0;
let currentState = loadLocalState();
const listeners = new Set();
const statusListeners = new Set();

function deepMergeSeed(raw) {
  const base = JSON.parse(JSON.stringify(INITIAL_SEED_DATA));
  if (!raw || typeof raw !== "object") return base;
  return {
    config: { ...base.config, ...(raw.config || {}) },
    departments: raw.departments && Object.keys(raw.departments).length > 0 ? raw.departments : base.departments,
    history: Array.isArray(raw.history) ? raw.history : base.history,
    rooms: Array.isArray(raw.rooms) && raw.rooms.length > 0 ? raw.rooms : base.rooms,
    bookings: Array.isArray(raw.bookings) ? raw.bookings : base.bookings,
    remoteDisplay: {
      ...base.remoteDisplay,
      ...(raw.remoteDisplay || {}),
      presenters: Array.isArray(raw.remoteDisplay?.presenters) ? raw.remoteDisplay.presenters : base.remoteDisplay.presenters,
      announcement: { ...base.remoteDisplay.announcement, ...(raw.remoteDisplay?.announcement || {}) },
      welcomeBoard: { ...base.remoteDisplay.welcomeBoard, ...(raw.remoteDisplay?.welcomeBoard || {}) },
      screens: Array.isArray(raw.remoteDisplay?.screens) ? raw.remoteDisplay.screens : base.remoteDisplay.screens
    }
  };
}

// Merge incoming state while protecting newer local mode switches from stale poll snapshots
function mergeIncomingState(incomingRaw) {
  const next = deepMergeSeed(incomingRaw);
  const localRd = currentState?.remoteDisplay || {};
  const nextRd = next.remoteDisplay || {};
  const localModeTime = Math.max(localRd.modeUpdatedAt || 0, lastLocalModeChangeAt);
  const incomingModeTime = nextRd.modeUpdatedAt || 0;

  // If this client performed a more recent mode switch (within the last 8s or higher timestamp), preserve its mode & presenter choice
  if (localModeTime > incomingModeTime && (Date.now() - lastLocalModeChangeAt) < 8000) {
    next.remoteDisplay.activeMode = localRd.activeMode;
    next.remoteDisplay.activePresenterId = localRd.activePresenterId;
    next.remoteDisplay.modeUpdatedAt = localModeTime;
  }
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
    console.warn("Local storage write failed:", e);
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
  for (const cb of statusListeners) {
    try {
      cb({ mode: syncMode, detail, firebaseConnected });
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

// Fetch from Vercel Serverless API (/api/data) to stay synced even if Firebase RTDB rules are locked
async function fetchApiState() {
  const fetchStartedAt = Date.now();
  try {
    const res = await fetch("/api/data", { cache: "no-store" });
    if (res.ok) {
      // Ignore poll responses that started before our latest local mode mutation
      if (fetchStartedAt < lastLocalModeChangeAt) {
        return true;
      }
      const apiData = await res.json();
      if (apiData && typeof apiData === "object") {
        currentState = mergeIncomingState(apiData);
        saveLocalState(currentState);
        notifyListeners();
        if (!firebaseConnected) {
          setSyncStatus("cloud-api", "Synced via Vercel API + Local Store");
        }
        return true;
      }
    }
  } catch (e) {
    // Ignore network error if running purely static
  }
  return false;
}

async function pushApiState(newState) {
  try {
    const res = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newState)
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.state) {
        currentState = mergeIncomingState(data.state);
        saveLocalState(currentState);
        notifyListeners();
      }
    }
  } catch (e) {
    // Non-fatal
  }
}

async function pushApiAction(action, payload) {
  try {
    const res = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ __action: action, payload })
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.state) {
        currentState = mergeIncomingState(data.state);
        saveLocalState(currentState);
        notifyListeners();
      }
    }
  } catch (e) {
    // Non-fatal
  }
}

// Initialize Firebase Realtime Listener with graceful fallback
function initRealtimeSync() {
  if (!db) {
    setSyncStatus("cloud-api", "Using Vercel API Sync");
    fetchApiState();
    return;
  }

  const rootRef = ref(db, "/");
  onValue(
    rootRef,
    async (snapshot) => {
      firebaseConnected = true;
      const val = snapshot.val();
      if (!val || (!val.departments && !val.config)) {
        // Seed Firebase automatically with our initial data.json state!
        try {
          await set(rootRef, currentState);
        } catch (seedErr) {
          console.warn("Auto-seed Firebase warning:", seedErr);
        }
      } else {
        currentState = mergeIncomingState(val);
        saveLocalState(currentState);
      }
      setSyncStatus("firebase", "Firebase Realtime DB Live");
      notifyListeners();
    },
    async (error) => {
      firebaseConnected = false;
      console.info("Firebase RTDB notice (using API/Local fallback):", error.message);
      const ok = await fetchApiState();
      if (!ok) {
        setSyncStatus("local", "Local Realtime Sync (Firebase rules locked)");
      } else {
        setSyncStatus("cloud-api", "Vercel Cloud API Sync Active");
      }
      notifyListeners();
    }
  );
}

initRealtimeSync();

// Poll API every 2.0 seconds when in cloud-api fallback mode so TV displays & screen share signaling update rapidly
setInterval(() => {
  if (!firebaseConnected) {
    fetchApiState();
  }
}, 2000);

export function subscribeState(callback) {
  listeners.add(callback);
  callback(currentState);
  return () => listeners.delete(callback);
}

export function subscribeSyncStatus(callback) {
  statusListeners.add(callback);
  callback({ mode: syncMode, firebaseConnected });
  return () => statusListeners.delete(callback);
}

export function getState() {
  return currentState;
}

export async function saveFullState(nextState) {
  currentState = deepMergeSeed(nextState);
  saveLocalState(currentState);
  if (bc) {
    bc.postMessage({ type: "STATE_UPDATED", state: currentState });
  }
  notifyListeners();

  // Push to Vercel Serverless API
  pushApiState(currentState);

  // Push to Firebase if available
  if (db) {
    try {
      await set(ref(db, "/"), currentState);
      firebaseConnected = true;
      setSyncStatus("firebase", "Firebase Realtime DB Live");
    } catch (err) {
      // Fallback already persisted locally & via API
      console.info("Saved to API/local store (Firebase write skipped):", err.message);
    }
  }
  return currentState;
}

export async function submitDepartmentUpdate({ department, updateText, questionText }) {
  const state = JSON.parse(JSON.stringify(currentState));
  if (!state.departments) state.departments = {};
  state.departments[department] = {
    update: updateText,
    question: questionText || "N/A"
  };

  if (!Array.isArray(state.history)) state.history = [];
  state.history.unshift({
    timestamp: Date.now(),
    dateString: new Date().toLocaleString("en-MY"),
    department,
    update: updateText,
    question: questionText || "N/A"
  });

  return saveFullState(state);
}

export async function saveAdminConfig({ config, departments }) {
  const state = JSON.parse(JSON.stringify(currentState));
  if (config) {
    state.config = { ...state.config, ...config };
  }
  if (departments) {
    state.departments = departments;
  }
  return saveFullState(state);
}

export async function resetMeetingSession() {
  const state = JSON.parse(JSON.stringify(currentState));
  for (const dept of Object.keys(state.departments || {})) {
    state.departments[dept] = { update: "Pending update...", question: "N/A" };
  }
  return saveFullState(state);
}

export async function resetToInitialSeed() {
  const fresh = JSON.parse(JSON.stringify(INITIAL_SEED_DATA));
  return saveFullState(fresh);
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

  await pushApiAction("ADD_BOOKING", { booking: newBooking });

  if (db) {
    try {
      await set(ref(db, "bookings"), currentState.bookings);
    } catch (e) {}
  }
  return newBooking;
}

export async function updateRoomBooking(bookingId, updatedFields) {
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

  await pushApiAction("UPDATE_BOOKING", { bookingId, updatedFields });

  if (db) {
    try {
      await set(ref(db, "bookings"), currentState.bookings);
    } catch (e) {}
  }
  return state.bookings[idx];
}

export async function deleteRoomBooking(bookingId) {
  const state = JSON.parse(JSON.stringify(currentState));
  state.bookings = (state.bookings || []).filter((b) => b.id !== bookingId);
  currentState = deepMergeSeed(state);
  saveLocalState(currentState);
  if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
  notifyListeners();

  await pushApiAction("DELETE_BOOKING", { bookingId });

  if (db) {
    try {
      await set(ref(db, "bookings"), currentState.bookings);
    } catch (e) {}
  }
  return currentState;
}

export async function markBookingNotified(bookingId) {
  if (!Array.isArray(currentState.bookings)) return currentState;
  const idx = currentState.bookings.findIndex((b) => b.id === bookingId);
  if (idx === -1) return currentState;
  currentState.bookings[idx].whatsappNotified = true;
  currentState.bookings[idx].notifiedAt = Date.now();
  saveLocalState(currentState);
  if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
  notifyListeners();

  await pushApiAction("MARK_BOOKING_NOTIFIED", { bookingId });

  if (db) {
    try {
      await set(ref(db, "bookings"), currentState.bookings);
    } catch (e) {}
  }
  return currentState;
}

// ============================================================================
// ADMIN MEETING ROOM CUSTOMIZATION (Quantity, Name, Floor, Capacity, Details)
// ============================================================================
export async function saveMeetingRooms(roomsList) {
  const state = JSON.parse(JSON.stringify(currentState));
  state.rooms = Array.isArray(roomsList) ? roomsList : [];
  currentState = deepMergeSeed(state);
  saveLocalState(currentState);
  if (bc) bc.postMessage({ type: "STATE_UPDATED", state: currentState });
  notifyListeners();

  await pushApiAction("SAVE_ROOMS", { rooms: state.rooms });

  if (db) {
    try {
      await set(ref(db, "rooms"), state.rooms);
    } catch (e) {}
  }
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

export function buildWhatsAppBookingUrl(booking, room, type = "starting") {
  const phone = formatWhatsAppPhone(booking.phone || "");
  const roomName = room?.name || booking.roomId || "HQ Meeting Room";
  const roomFloor = room?.floor ? ` (${room.floor})` : "";
  const header = type === "starting"
    ? "🔔 *CARECLINICS HQ — YOUR ROOM BOOKING IS STARTING NOW*"
    : "✅ *CARECLINICS HQ — ROOM BOOKING CONFIRMED*";

  const statusLine = type === "starting"
    ? `Hi *${booking.organizer || "Staff"}*, your reserved meeting room is ready and your session time has arrived!`
    : `Hi *${booking.organizer || "Staff"}*, your meeting room reservation at Careclinics HQ has been scheduled.`;

  const lines = [
    header,
    "",
    statusLine,
    "",
    `📍 *Room:* ${roomName}${roomFloor}`,
    `📋 *Meeting:* ${booking.title || "Meeting"}`,
    `🏢 *Department:* ${booking.department || "HQ"}`,
    `📅 *Date:* ${booking.date}`,
    `⏰ *Time:* ${booking.startTime} – ${booking.endTime}`,
    booking.notes ? `💬 *Notes:* ${booking.notes}` : "",
    "",
    "_Careclinics Healthcare Services HQ Portal_"
  ].filter(Boolean);

  const text = encodeURIComponent(lines.join("\n"));
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
