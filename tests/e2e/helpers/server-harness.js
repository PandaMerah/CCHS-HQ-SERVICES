const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { once } = require('events');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const TRACKED_FILES = ['server.js', 'api', 'public', 'CCHSMeetingDashboard'];

const activeChildren = new Set();

function probeFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function copyTrackedWorkspace(repoRoot, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const rel of TRACKED_FILES) {
    const src = path.join(repoRoot, rel);
    const dst = path.join(targetDir, rel);
    if (!fs.existsSync(src)) continue;
    fs.cpSync(src, dst, { recursive: true, force: true });
  }
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const exitPromise = once(child, 'exit').catch(() => {});
  try {
    child.kill('SIGTERM');
  } catch {
    // ignore
  }

  const exitedCleanly = await Promise.race([
    exitPromise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 2500))
  ]);

  if (!exitedCleanly && child.pid) {
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          timeout: 5000
        });
      } catch {
        // ignore if already exited
      }
    } else {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
    await Promise.race([
      exitPromise,
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
  }
}

async function waitForServerReady(baseUrl, child, getStderr, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Server process exited prematurely with code ${child.exitCode}. stderr:\n${getStderr()}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/data`, { signal: AbortSignal.timeout(1000) });
      if (res.status === 200) {
        return;
      }
    } catch {
      // retry until ready
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error(`Timed out waiting for server at ${baseUrl}/api/data after ${timeoutMs}ms. stderr:\n${getStderr()}`);
}

process.on('exit', () => {
  for (const child of activeChildren) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
  }
});

async function startIsolatedServer(options = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cchs-e2e-'));
  const workspaceDir = path.join(tmpDir, 'workspace');
  const runtimeStatePath = options.runtimeStatePath || path.join(tmpDir, 'data', 'runtime-state.json');

  let child = null;
  let port = 0;
  let baseUrl = '';
  let stdoutBuf = '';
  let stderrBuf = '';
  let baseEnv = {
    ...process.env,
    CCHS_RUNTIME_STATE_PATH: runtimeStatePath,
    FIREBASE_DATABASE_URL: options.firebaseDatabaseUrl || 'https://127.0.0.1:1',
    ...(options.env || {})
  };

  async function spawnOnce(extraEnv = {}) {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      port = (port && attempt === 0) ? port : await probeFreePort();
      baseUrl = `http://127.0.0.1:${port}`;
      let sawAddrInUse = false;

      const env = {
        ...baseEnv,
        ...extraEnv,
        PORT: String(port)
      };

      const nextChild = spawn(process.execPath, ['server.js'], {
        cwd: workspaceDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
      activeChildren.add(nextChild);

      nextChild.stdout.on('data', (chunk) => {
        stdoutBuf += chunk.toString();
      });
      nextChild.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderrBuf += text;
        if (/EADDRINUSE/i.test(text)) sawAddrInUse = true;
      });
      nextChild.on('exit', () => {
        activeChildren.delete(nextChild);
      });

      try {
        await waitForServerReady(baseUrl, nextChild, () => stderrBuf, options.startupTimeoutMs || 8000);
        child = nextChild;
        return;
      } catch (err) {
        lastErr = err;
        await terminateChild(nextChild);
        if (!sawAddrInUse) break;
      }
    }
    throw lastErr || new Error('Failed to start isolated server');
  }

  try {
    copyTrackedWorkspace(REPO_ROOT, workspaceDir);
    fs.mkdirSync(path.dirname(runtimeStatePath), { recursive: true });

    if (options.seedData) {
      const seedTarget = path.join(workspaceDir, 'CCHSMeetingDashboard', 'data.json');
      fs.writeFileSync(seedTarget, JSON.stringify(options.seedData, null, 2), 'utf8');
    }

    await spawnOnce();
  } catch (err) {
    if (child) {
      await terminateChild(child).catch(() => {});
      child = null;
    }
    if (fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100
        });
      } catch {
        // ignore cleanup error during startup failure
      }
    }
    throw err;
  }

  const workspaceSeedPath = path.join(workspaceDir, 'CCHSMeetingDashboard', 'data.json');
  const repoSeedPath = path.join(REPO_ROOT, 'CCHSMeetingDashboard', 'data.json');

  return {
    get tmpDir() { return tmpDir; },
    get workspaceDir() { return workspaceDir; },
    get runtimeStatePath() { return runtimeStatePath; },
    get port() { return port; },
    get baseUrl() { return baseUrl; },
    get workspaceSeedPath() { return workspaceSeedPath; },
    get repoSeedPath() { return repoSeedPath; },

    getSeedHash() {
      return sha256File(workspaceSeedPath);
    },

    getRepoSeedHash() {
      return sha256File(repoSeedPath);
    },

    readSeedData() {
      if (!fs.existsSync(workspaceSeedPath)) return null;
      return JSON.parse(fs.readFileSync(workspaceSeedPath, 'utf8'));
    },

    readRuntimeState() {
      if (!fs.existsSync(runtimeStatePath)) return null;
      return JSON.parse(fs.readFileSync(runtimeStatePath, 'utf8'));
    },

    getServerLogs() {
      return {
        stdout: stdoutBuf,
        stderr: stderrBuf
      };
    },

    assertNoUncaughtServerErrors() {
      if (/UnhandledPromiseRejection|uncaughtException|TypeError:|ReferenceError:|SyntaxError:/i.test(stderrBuf)) {
        throw new Error(`Uncaught server stderr error detected:\n${stderrBuf}`);
      }
    },

    async restart(extraEnv = {}) {
      await terminateChild(child);
      child = null;
      if (Object.keys(extraEnv).length > 0) {
        baseEnv = { ...baseEnv, ...extraEnv };
      }
      await spawnOnce();
      return baseUrl;
    },

    simulateGitUpdate({ overwriteSeedData = true, seedData = null } = {}) {
      for (const rel of ['server.js', 'api', 'public']) {
        const src = path.join(REPO_ROOT, rel);
        const dst = path.join(workspaceDir, rel);
        if (fs.existsSync(src)) {
          fs.cpSync(src, dst, { recursive: true, force: true });
        }
      }
      if (overwriteSeedData) {
        if (seedData) {
          fs.writeFileSync(workspaceSeedPath, JSON.stringify(seedData, null, 2), 'utf8');
        } else {
          fs.cpSync(repoSeedPath, workspaceSeedPath, { force: true });
        }
      }
    },

    async stop({ cleanup = true } = {}) {
      await terminateChild(child);
      child = null;
      if (cleanup && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100
        });
      }
    }
  };
}

module.exports = {
  REPO_ROOT,
  startIsolatedServer,
  sha256File
};
