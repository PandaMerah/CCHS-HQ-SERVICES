const crypto = require('crypto');

const DEFAULT_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'cchs2026';

let runtimeAdminCreds = {
  username: DEFAULT_USERNAME,
  password: DEFAULT_PASSWORD
};

function makeToken(username) {
  const secret = process.env.SECRET_ENCRYPTION_KEY || 'cchs-hq-secret-2026';
  const sig = crypto.createHmac('sha256', secret).update(username + ':admin').digest('hex');
  return `${Buffer.from(username).toString('base64')}.${sig}`;
}

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { action, username, password, newUsername, newPassword } = body;

  if (action === 'update_credentials') {
    if (
      username === runtimeAdminCreds.username &&
      password === runtimeAdminCreds.password &&
      newUsername &&
      newPassword
    ) {
      runtimeAdminCreds = {
        username: String(newUsername).trim(),
        password: String(newPassword)
      };
      return res.status(200).json({
        ok: true,
        username: runtimeAdminCreds.username,
        token: makeToken(runtimeAdminCreds.username)
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
