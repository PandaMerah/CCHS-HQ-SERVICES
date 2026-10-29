const fs = require('fs');
const path = require('path');

const SEED_FILE = path.join(process.cwd(), 'CCHSMeetingDashboard', 'data.json');
const TMP_FILE = '/tmp/cchs_hq_state.json';

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
      seed = { ...seed, ...diskSeed };
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
      memoryState = JSON.parse(fs.readFileSync(TMP_FILE, 'utf8'));
      return memoryState;
    }
  } catch (e) {
    // ignore
  }
  memoryState = loadDefaultState();
  return memoryState;
}

function writeState(nextState) {
  memoryState = nextState;
  try {
    fs.writeFileSync(TMP_FILE, JSON.stringify(nextState, null, 2), 'utf8');
  } catch (e) {
    // ignore if /tmp is unavailable
  }
  try {
    // Persist core meeting data to SEED_FILE when writable (e.g. local dev)
    fs.writeFileSync(SEED_FILE, JSON.stringify({
      config: nextState.config || {},
      departments: nextState.departments || {},
      history: nextState.history || []
    }, null, 2), 'utf8');
  } catch (e) {
    // Read-only on Vercel production, expected
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
        writeState(current);
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
        writeState(current);
        return res.status(200).json({ ok: true, state: current });
      }

      if (action === 'SELECT_PRESENTER') {
        const presenterId = payload.presenterId || null;
        rd.activePresenterId = presenterId;
        rd.activeMode = presenterId ? 'screen-share' : (payload.fallbackMode || 'meeting-tv');
        rd.modeUpdatedAt = Date.now();
        rd.updatedAt = Date.now();
        writeState(current);
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
        writeState(current);
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
