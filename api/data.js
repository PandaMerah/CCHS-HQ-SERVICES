const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const SEED_FILE = path.join(process.cwd(), 'CCHSMeetingDashboard', 'data.json');
const TMP_FILE = path.join(os.tmpdir(), 'cchs_hq_state.json');
const FIREBASE_RTDB_URL = process.env.FIREBASE_DATABASE_URL || 'https://cchsmeetingdashboard-default-rtdb.asia-southeast1.firebasedatabase.app';

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

// Non-blocking background sync to Firebase Realtime Database REST API when rules/secret permit
function mirrorNodeToFirebase(nodePath, payload) {
  try {
    const secret = process.env.FIREBASE_DATABASE_SECRET || process.env.FIREBASE_AUTH_TOKEN || '';
    const cleanPath = String(nodePath || '').replace(/^\/+/, '');
    const targetUrl = `${FIREBASE_RTDB_URL}/${cleanPath}.json${secret ? `?auth=${encodeURIComponent(secret)}` : ''}`;
    const parsed = new URL(targetUrl);
    const bodyStr = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: parsed.hostname,
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

function loadDefaultState() {
  let seed = {
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
    departments: {},
    history: [],
    rooms: DEFAULT_ROOMS,
    bookings: getDefaultBookings(),
    remoteDisplay: {
      activeMode: 'meeting-tv',
      activePresenterId: null,
      presenters: [],
      modeUpdatedAt: 0
    }
  };

  try {
    if (fs.existsSync(SEED_FILE)) {
      const diskSeed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
      seed = {
        ...seed,
        ...diskSeed,
        rooms: Array.isArray(diskSeed.rooms) && diskSeed.rooms.length > 0 ? diskSeed.rooms : seed.rooms,
        bookings: Array.isArray(diskSeed.bookings) ? diskSeed.bookings : seed.bookings
      };
    }
  } catch (e) {
    // Use fallback seed
  }

  return seed;
}

let memoryState = null;

function readState() {
  if (memoryState) return memoryState;
  try {
    if (fs.existsSync(TMP_FILE)) {
      const tmp = JSON.parse(fs.readFileSync(TMP_FILE, 'utf8'));
      const def = loadDefaultState();
      memoryState = {
        ...def,
        ...tmp,
        rooms: Array.isArray(tmp.rooms) && tmp.rooms.length > 0 ? tmp.rooms : def.rooms,
        bookings: Array.isArray(tmp.bookings) ? tmp.bookings : def.bookings
      };
      return memoryState;
    }
  } catch (e) {
    // ignore
  }
  memoryState = loadDefaultState();
  return memoryState;
}

function writeState(nextState, changedNode = null) {
  if (!Array.isArray(nextState.rooms) || nextState.rooms.length === 0) {
    nextState.rooms = DEFAULT_ROOMS;
  }
  if (!Array.isArray(nextState.bookings)) {
    nextState.bookings = [];
  }
  memoryState = nextState;
  try {
    fs.writeFileSync(TMP_FILE, JSON.stringify(nextState, null, 2), 'utf8');
  } catch (e) {
    // ignore if /tmp is unavailable
  }
  try {
    // Persist meeting data + rooms + bookings to SEED_FILE when writable
    fs.writeFileSync(SEED_FILE, JSON.stringify({
      config: nextState.config || {},
      departments: nextState.departments || {},
      history: nextState.history || [],
      rooms: nextState.rooms || DEFAULT_ROOMS,
      bookings: nextState.bookings || []
    }, null, 2), 'utf8');
  } catch (e) {
    // Read-only on Vercel production, expected
  }
  if (changedNode === 'rooms') {
    mirrorNodeToFirebase('rooms', nextState.rooms);
  } else if (changedNode === 'bookings') {
    mirrorNodeToFirebase('bookings', nextState.bookings);
  } else if (changedNode === 'remoteDisplay' && nextState.remoteDisplay) {
    mirrorNodeToFirebase('remoteDisplay/activeMode', nextState.remoteDisplay.activeMode);
    mirrorNodeToFirebase('remoteDisplay/activePresenterId', nextState.remoteDisplay.activePresenterId || null);
    mirrorNodeToFirebase('remoteDisplay/modeUpdatedAt', nextState.remoteDisplay.modeUpdatedAt || Date.now());
  }
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
  return state.remoteDisplay;
}

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    const current = readState();
    const rd = ensureRemoteDisplay(current);
    // Clean up disconnected presenters whose heartbeat is older than 60s
    const now = Date.now();
    rd.presenters = rd.presenters.filter(p => !p.lastHeartbeat || (now - p.lastHeartbeat) < 60000);
    return res.status(200).json(current);
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Invalid state payload' });
    }

    const current = readState();
    const rd = ensureRemoteDisplay(current);

    // Handle atomic surgical actions so presenter frame updates NEVER overwrite admin mode switches
    if (body.__action) {
      const action = body.__action;
      const payload = body.payload || {};

      if (action === 'REGISTER_PRESENTER' && payload.presenter) {
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
        const presenterId = payload.presenterId || null;
        rd.activePresenterId = presenterId;
        rd.activeMode = presenterId ? 'screen-share' : (payload.fallbackMode || 'meeting-tv');
        rd.modeUpdatedAt = Date.now();
        rd.updatedAt = Date.now();
        writeState(current, 'remoteDisplay');
        return res.status(200).json({ ok: true, state: current });
      }

      if (action === 'UPDATE_REMOTE_DISPLAY' && payload.patch) {
        const patch = payload.patch;
        const existingPresenters = rd.presenters;
        const existingActivePresenterId = rd.activePresenterId;

        Object.assign(rd, patch);
        // Preserve active presenter queue unless explicitly replaced
        if (!Array.isArray(patch.presenters)) {
          rd.presenters = existingPresenters;
        }
        // If admin switched to 'screen-share' mode and didn't specify activePresenterId, keep existing or pick first available in queue
        if (patch.activeMode === 'screen-share' && patch.activePresenterId === undefined) {
          rd.activePresenterId = existingActivePresenterId || existingPresenters[0]?.id || null;
        }
        rd.modeUpdatedAt = Date.now();
        rd.updatedAt = Date.now();
        writeState(current, 'remoteDisplay');
        return res.status(200).json({ ok: true, state: current });
      }

      if (action === 'ADD_BOOKING' && payload.booking) {
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
        return res.status(200).json({ ok: true, booking: b, state: current });
      }

      if (action === 'UPDATE_BOOKING' && payload.bookingId && payload.updatedFields) {
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
        current.rooms = payload.rooms;
        writeState(current, 'rooms');
        return res.status(200).json({ ok: true, state: current });
      }
    }

    // Standard full-state save: protect newer modeUpdatedAt and presenter queue from stale overwrites
    const incomingRd = body.remoteDisplay || {};
    const existingModeUpdatedAt = rd.modeUpdatedAt || 0;
    const incomingModeUpdatedAt = incomingRd.modeUpdatedAt || 0;

    const mergedRemoteDisplay = {
      ...rd,
      ...incomingRd,
      // Do not let an older snapshot revert a newer admin mode switch
      activeMode: incomingModeUpdatedAt >= existingModeUpdatedAt ? (incomingRd.activeMode || rd.activeMode) : rd.activeMode,
      activePresenterId: incomingModeUpdatedAt >= existingModeUpdatedAt
        ? (incomingRd.activePresenterId !== undefined ? incomingRd.activePresenterId : rd.activePresenterId)
        : rd.activePresenterId,
      modeUpdatedAt: Math.max(existingModeUpdatedAt, incomingModeUpdatedAt),
      presenters: Array.isArray(incomingRd.presenters) && incomingRd.presenters.length > 0
        ? incomingRd.presenters
        : rd.presenters
    };

    const merged = {
      ...current,
      ...body,
      remoteDisplay: mergedRemoteDisplay
    };
    writeState(merged);
    return res.status(200).json({ ok: true, state: merged });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
