const crypto = require('crypto');

const DEFAULT_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'cchs2026';
const TOKEN_TTL_MS = Number(process.env.ADMIN_TOKEN_TTL_MS) || 7 * 24 * 60 * 60 * 1000;

let runtimeAdminCreds = {
  username: DEFAULT_USERNAME,
  password: DEFAULT_PASSWORD
};

function getSecret() {
  return process.env.SECRET_ENCRYPTION_KEY || 'cchs-hq-secret-2026';
}

function makeToken(username) {
  const now = Date.now();
  const payload = {
    username: String(username || '').trim(),
    role: 'admin',
    iat: now,
    exp: now + TOKEN_TTL_MS
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(payloadB64).digest('hex');
  return `${payloadB64}.${sig}`;
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token.trim()) return null;
  const parts = token.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const [payloadB64, sig] = parts;
  if (!/^[0-9a-f]+$/i.test(sig)) return null;

  const expectedSig = crypto.createHmac('sha256', getSecret()).update(payloadB64).digest('hex');
  if (sig.length !== expectedSig.length) return null;

  try {
    const sigBuf = Buffer.from(sig, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (
      !payload ||
      payload.role !== 'admin' ||
      typeof payload.username !== 'string' ||
      payload.username.trim().length === 0 ||
      typeof payload.exp !== 'number' ||
      !Number.isFinite(payload.exp) ||
      Date.now() > payload.exp
    ) {
      return null;
    }
    return {
      username: payload.username,
      role: 'admin',
      iat: payload.iat,
      exp: payload.exp
    };
  } catch (e) {
    return null;
  }
}

function extractTokenFromRequest(req) {
  if (!req) return null;
  const headers = req.headers || {};
  const authHeader = headers.authorization || headers.Authorization;
  if (typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match && match[1] && match[1].trim()) {
      return match[1].trim();
    }
  }
  const xToken = headers['x-admin-token'] || headers['X-Admin-Token'];
  if (typeof xToken === 'string' && xToken.trim()) {
    return xToken.trim();
  }
  if (req.body && typeof req.body === 'object' && typeof req.body.adminToken === 'string' && req.body.adminToken.trim()) {
    return req.body.adminToken.trim();
  }
  return null;
}

const handler = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = {};
  if (typeof req.body === 'string') {
    try {
      body = JSON.parse(req.body || '{}');
    } catch (e) {
      return res.status(400).json({ ok: false, error: 'Invalid JSON payload' });
    }
  } else if (req.body && typeof req.body === 'object') {
    body = req.body;
  }

  const { action, username, password, newUsername, newPassword } = body;

  if (action === 'update_credentials') {
    const cleanUser = String(username || '').trim();
    const cleanNewUser = String(newUsername || '').trim();
    const cleanNewPass = String(newPassword || '');
    if (
      cleanUser.toLowerCase() === runtimeAdminCreds.username.toLowerCase() &&
      String(password || '') === runtimeAdminCreds.password &&
      cleanNewUser &&
      cleanNewPass
    ) {
      runtimeAdminCreds = {
        username: cleanNewUser,
        password: cleanNewPass
      };
      return res.status(200).json({
        ok: true,
        username: runtimeAdminCreds.username,
        role: 'admin',
        token: makeToken(runtimeAdminCreds.username),
        loginAt: Date.now()
      });
    }
    return res.status(401).json({ ok: false, error: 'Current credentials invalid' });
  }

  // Standard login check
  const cleanUser = String(username || '').trim();
  const cleanPass = String(password || '');

  if (
    cleanUser.toLowerCase() === runtimeAdminCreds.username.toLowerCase() &&
    cleanPass === runtimeAdminCreds.password
  ) {
    return res.status(200).json({
      ok: true,
      username: runtimeAdminCreds.username,
      role: 'admin',
      token: makeToken(runtimeAdminCreds.username),
      loginAt: Date.now()
    });
  }

  return res.status(401).json({
    ok: false,
    error: 'Invalid admin username or password'
  });
};

module.exports = handler;
module.exports.verifyToken = verifyToken;
module.exports.extractTokenFromRequest = extractTokenFromRequest;
