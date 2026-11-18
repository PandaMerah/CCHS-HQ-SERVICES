const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let cachedPlaywright = null;

function findNpxPlaywrightCandidates() {
  const candidates = [];
  const roots = [];

  if (process.env.LOCALAPPDATA) {
    roots.push(path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx'));
  }
  const homeDir = os.homedir();
  if (homeDir) {
    roots.push(path.join(homeDir, '.npm', '_npx'));
    roots.push(path.join(homeDir, 'AppData', 'Local', 'npm-cache', '_npx'));
  }

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pwDir = path.join(root, entry.name, 'node_modules', 'playwright');
      const pwCoreDir = path.join(root, entry.name, 'node_modules', 'playwright-core');
      if (fs.existsSync(pwDir)) candidates.push(pwDir);
      else if (fs.existsSync(pwCoreDir)) candidates.push(pwCoreDir);
    }
  }
  return candidates;
}

function getGlobalNpmRoot() {
  try {
    const out = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function installFallbackPlaywrightToTmp() {
  const prefixDir = path.join(os.tmpdir(), 'cchs-e2e-pw');
  const pwPath = path.join(prefixDir, 'node_modules', 'playwright');
  if (fs.existsSync(pwPath)) return pwPath;

  fs.mkdirSync(prefixDir, { recursive: true });
  execFileSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['--prefix', prefixDir, 'install', '--no-save', '--no-audit', '--no-fund', 'playwright'],
    { stdio: 'pipe', timeout: 120000 }
  );
  if (fs.existsSync(pwPath)) return pwPath;
  throw new Error(`Failed to install fallback Playwright into ${prefixDir}`);
}

function loadPlaywright() {
  if (cachedPlaywright) return cachedPlaywright;

  // 1. Explicit PLAYWRIGHT_PATH override
  if (process.env.PLAYWRIGHT_PATH && fs.existsSync(process.env.PLAYWRIGHT_PATH)) {
    cachedPlaywright = require(process.env.PLAYWRIGHT_PATH);
    return cachedPlaywright;
  }

  // 2. Standard Node resolution (outside repo node_modules)
  const repoNodeModulesPrefix = path.normalize(`${path.resolve(__dirname, '..', '..', '..')}${path.sep}node_modules${path.sep}`).toLowerCase();
  for (const pkg of ['playwright', 'playwright-core']) {
    try {
      const resolved = require.resolve(pkg);
      if (!path.normalize(resolved).toLowerCase().startsWith(repoNodeModulesPrefix)) {
        cachedPlaywright = require(resolved);
        return cachedPlaywright;
      }
    } catch {
      // continue
    }
  }

  // 3. Scan local npm _npx caches
  for (const candidate of findNpxPlaywrightCandidates()) {
    try {
      cachedPlaywright = require(candidate);
      return cachedPlaywright;
    } catch {
      // continue
    }
  }

  // 4. Global npm root
  const globalRoot = getGlobalNpmRoot();
  if (globalRoot) {
    for (const pkg of ['playwright', 'playwright-core']) {
      const target = path.join(globalRoot, pkg);
      if (fs.existsSync(target)) {
        cachedPlaywright = require(target);
        return cachedPlaywright;
      }
    }
  }

  // 5. Temp directory fallback (never inside repo)
  const fallbackPath = installFallbackPlaywrightToTmp();
  cachedPlaywright = require(fallbackPath);
  return cachedPlaywright;
}

async function launchBrowser(options = {}) {
  const pw = loadPlaywright();
  const headless = options.headless !== undefined ? options.headless : process.env.E2E_HEADED !== '1';
  const channels = options.channels || ['msedge', 'chrome', undefined];
  const extraArgs = options.args || [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'
  ];

  let lastErr = null;
  for (const channel of channels) {
    try {
      const launchOpts = { headless, args: extraArgs };
      if (channel) launchOpts.channel = channel;
      const browser = await pw.chromium.launch(launchOpts);
      return browser;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Unable to launch Chromium/Edge/Chrome browser: ${lastErr?.message || lastErr}`);
}

function attachStabilityCollectors(page, options = {}) {
  const baseUrl = options.baseUrl || '';
  const errors = {
    pageerrors: [],
    consoleErrors: [],
    server5xx: []
  };

  const onPageError = (err) => {
    errors.pageerrors.push(err?.message || String(err));
  };

  const onConsole = (msg) => {
    if (msg.type() === 'error') {
      errors.consoleErrors.push(msg.text());
    }
  };

  const onResponse = (res) => {
    const url = res.url();
    if ((!baseUrl || url.startsWith(baseUrl)) && res.status() >= 500) {
      errors.server5xx.push(`${res.status()} ${url}`);
    }
  };

  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  page.on('response', onResponse);

  return {
    errors,
    clear() {
      errors.pageerrors.length = 0;
      errors.consoleErrors.length = 0;
      errors.server5xx.length = 0;
    },
    getSummary() {
      return {
        pageerrors: [...errors.pageerrors],
        consoleErrors: [...errors.consoleErrors],
        server5xx: [...errors.server5xx]
      };
    },
    hasErrors() {
      return errors.pageerrors.length > 0 || errors.consoleErrors.length > 0 || errors.server5xx.length > 0;
    },
    detach() {
      page.off('pageerror', onPageError);
      page.off('console', onConsole);
      page.off('response', onResponse);
    }
  };
}

async function installFirebaseIsolation(context) {
  await context.routeWebSocket(/firebasedatabase\.app|firebaseio\.com/i, (ws) => {
    // Respond with Firebase RTDB wire-protocol handshake + permission_denied for DB ops
    // so SDK calls (set/get/onValue) settle immediately in <50ms and fall back cleanly to /api/data.
    try {
      ws.send(JSON.stringify({
        t: 'c',
        d: { t: 'h', d: { ts: Date.now(), v: '5', h: 'e2e-isolated.firebaseio.com', s: 'e2e-isolated' } }
      }));
    } catch {
      // ignore if closed
    }
    ws.onMessage((raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg && msg.t === 'd' && msg.d && typeof msg.d.r === 'number') {
          const action = msg.d.a;
          if (action === 's' || action === 'auth' || action === 'gauth') {
            ws.send(JSON.stringify({ t: 'd', d: { r: msg.d.r, b: { s: 'ok', d: {} } } }));
          } else {
            ws.send(JSON.stringify({ t: 'd', d: { r: msg.d.r, b: { s: 'permission_denied', d: 'Permission denied' } } }));
          }
        }
      } catch {
        // ignore non-JSON keepalive frames
      }
    });
  });

  await context.route(/https:\/\/[^/]*(firebasedatabase\.app|firebaseio\.com)\/.*/i, async (route) => {
    // Fulfill HTTPS long-poll / REST fallbacks with 200 no-op payloads instead of 401 so Chromium
    // does not emit spurious "401 (Unauthorized)" console.error noise during rapid route navigation,
    // while WebSocket isolation above returns permission_denied so cloud-store falls back to /api/data.
    const resourceType = route.request().resourceType();
    if (resourceType === 'script') {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: '/* e2e-isolated */'
      });
    } else if (resourceType === 'document') {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html><body></body></html>'
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: 'null'
      });
    }
  });

  await context.route(/https:\/\/identitytoolkit\.googleapis\.com\/.*/i, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        kind: 'identitytoolkit#SignupNewUserResponse',
        idToken: 'e2e-mock-firebase-id-token',
        refreshToken: 'e2e-mock-firebase-refresh-token',
        expiresIn: '3600',
        localId: 'e2e-anon-user'
      })
    });
  });

  await context.route(/https:\/\/securetoken\.googleapis\.com\/.*/i, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'e2e-mock-access-token',
        expires_in: '3600',
        token_type: 'Bearer',
        refresh_token: 'e2e-mock-firebase-refresh-token',
        id_token: 'e2e-mock-firebase-id-token',
        user_id: 'e2e-anon-user',
        project_id: 'cchsmeetingdashboard'
      })
    });
  });
}

async function installMockDisplayMedia(contextOrPage) {
  await contextOrPage.addInitScript(() => {
    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {},
        configurable: true
      });
    }
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#1863dc';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText('E2E Synthetic Screen Share', 60, 180);
      const stream = canvas.captureStream ? canvas.captureStream(15) : new MediaStream();
      return stream;
    };
  });
}

async function createIsolatedContext(browser, opts = {}) {
  const {
    viewport = { width: 1280, height: 800 },
    isolateFirebase = true,
    mockDisplayMedia = false,
    baseUrl = '',
    acceptDownloads = true,
    ...rest
  } = opts;

  const context = await browser.newContext({
    viewport,
    acceptDownloads,
    ...rest
  });

  if (isolateFirebase) {
    await installFirebaseIsolation(context);
  }
  if (mockDisplayMedia) {
    await installMockDisplayMedia(context);
  }

  const collectors = [];
  const origNewPage = context.newPage.bind(context);
  context.newPage = async () => {
    const page = await origNewPage();
    page.setDefaultTimeout(5000);
    page.setDefaultNavigationTimeout(10000);
    const collector = attachStabilityCollectors(page, { baseUrl });
    page.__stability = collector;
    collectors.push(collector);
    return page;
  };

  context.getAllStabilityErrors = () => {
    const merged = { pageerrors: [], consoleErrors: [], server5xx: [] };
    for (const c of collectors) {
      const s = c.getSummary();
      merged.pageerrors.push(...s.pageerrors);
      merged.consoleErrors.push(...s.consoleErrors);
      merged.server5xx.push(...s.server5xx);
    }
    return merged;
  };

  context.clearStabilityErrors = () => {
    for (const c of collectors) c.clear();
  };

  return context;
}

module.exports = {
  loadPlaywright,
  launchBrowser,
  createIsolatedContext,
  attachStabilityCollectors,
  installFirebaseIsolation,
  installMockDisplayMedia
};
