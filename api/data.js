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
    history: []
  };

  try {
    if (fs.existsSync(SEED_FILE)) {
      seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
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
    // Also persist to SEED_FILE when writable (e.g. local dev)
    fs.writeFileSync(SEED_FILE, JSON.stringify({
      config: nextState.config || {},
      departments: nextState.departments || {},
      history: nextState.history || []
    }, null, 2), 'utf8');
  } catch (e) {
    // Read-only on Vercel production, expected
  }
}

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json(readState());
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (body && typeof body === 'object') {
      const current = readState();
      const merged = { ...current, ...body };
      writeState(merged);
      return res.status(200).json({ ok: true, state: merged });
    }
    return res.status(400).json({ error: 'Invalid state payload' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
