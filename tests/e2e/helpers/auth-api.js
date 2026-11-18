const assert = require('node:assert/strict');

const SERVICE_KEYS = ['departmentUpdate', 'roomBooking', 'screenShare', 'pdfStudio'];

const SERVICE_LABELS = {
  departmentUpdate: /department\s*update|submit\s*department/i,
  roomBooking: /room\s*booking|book\s*hq\s*meeting\s*room/i,
  screenShare: /screen\s*share|share\s*screen/i,
  pdfStudio: /bentopdf|pdf\s*studio/i
};

const ALL_PORTAL_ROUTES = [
  '/',
  '/login.html',
  '/admin/',
  '/meeting/',
  '/meeting/input.html',
  '/meeting/admin.html',
  '/booking/',
  '/display/',
  '/display/?mode=share',
  '/display/?mode=receiver',
  '/pdf/'
];

async function loginViaApi(baseUrl, username = 'admin', password = 'cchs2026') {
  const res = await fetch(`${baseUrl}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

async function apiGetData(baseUrl) {
  const res = await fetch(`${baseUrl}/api/data`, { cache: 'no-store' });
  const data = await res.json();
  return { status: res.status, ok: res.ok, data };
}

async function apiPostAction(baseUrl, action, payload = {}, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${baseUrl}/api/data`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ __action: action, payload })
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

async function apiPostRaw(baseUrl, body, token = null, rawString = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${baseUrl}/api/data`, {
    method: 'POST',
    headers,
    body: rawString ? body : JSON.stringify(body)
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

async function loginViaUi(page, baseUrl, username = 'admin', password = 'cchs2026', redirect = '/admin/') {
  const target = `${baseUrl}/login.html${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`;
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#submitBtn').click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login.html'), { timeout: 6000 });
  const sessionRaw = await page.evaluate(() => localStorage.getItem('cchs_hq_admin_auth_v1'));
  assert.ok(sessionRaw, 'Expected cchs_hq_admin_auth_v1 in localStorage after UI login');
  const session = JSON.parse(sessionRaw);
  assert.equal(session.role, 'admin');
  assert.ok(session.token, 'Expected token in stored admin session');
  return session;
}

async function injectAdminSession(contextOrPage, baseUrl, authResult) {
  const session = {
    username: authResult.username || 'admin',
    role: 'admin',
    token: authResult.token,
    loginAt: Date.now()
  };
  await contextOrPage.addInitScript((s) => {
    localStorage.setItem('cchs_hq_admin_auth_v1', JSON.stringify(s));
  }, session);
  return session;
}

function assertCleanWhatsAppText(text, expected = {}) {
  assert.equal(typeof text, 'string', 'WhatsApp text must be a string');
  assert.ok(text.length > 0, 'WhatsApp text must not be empty');
  assert.ok(!text.includes('\uFFFD'), `WhatsApp text must not contain U+FFFD replacement characters:\n${text}`);
  assert.ok(!/[\uD800-\uDFFF]/.test(text), `WhatsApp text must not contain supplementary-plane emojis (surrogate pairs) that wa.me corrupts:\n${text}`);
  assert.ok(
    !/(?:âœ|ðŸ|â€|ï¿½|\u00C3[\u0080-\u00BF]|\u00C2[\u0080-\u00BF\s])/.test(text),
    `WhatsApp text must not contain UTF-8-as-Latin1 mojibake sequences:\n${text}`
  );

  const requiredLabels = ['*Room:*', '*Meeting:*', '*Department:*', '*Date:*', '*Time:*'];
  for (const label of requiredLabels) {
    assert.ok(text.includes(label), `WhatsApp text missing required label "${label}":\n${text}`);
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    assert.ok(!/^\s*[\uFFFD?]/.test(trimmed), `Line starts with broken replacement character: ${trimmed}`);
    assert.ok(
      !/^[^\w*]{0,4}\s*[\uFFFD?]+\s*\*/.test(trimmed),
      `Line has broken replacement character before bold label: ${trimmed}`
    );
    assert.ok(
      !/(?:^|\s)\?\s+\*(?:Room|Meeting|Department|Date|Time|Notes):?\*/.test(trimmed),
      `Line has broken "?" before WhatsApp field label: ${trimmed}`
    );
  }

  if (expected.roomName) {
    assert.ok(text.includes(expected.roomName), `Expected room name "${expected.roomName}" in WhatsApp text:\n${text}`);
  }
  if (expected.roomFloor) {
    assert.ok(text.includes(expected.roomFloor), `Expected room floor "${expected.roomFloor}" in WhatsApp text:\n${text}`);
  }
  if (expected.title) {
    assert.ok(text.includes(expected.title), `Expected meeting title "${expected.title}" in WhatsApp text:\n${text}`);
  }
  if (expected.department) {
    assert.ok(text.includes(expected.department), `Expected department "${expected.department}" in WhatsApp text:\n${text}`);
  }
  if (expected.date) {
    assert.ok(text.includes(expected.date), `Expected date "${expected.date}" in WhatsApp text:\n${text}`);
  }
  if (expected.time) {
    assert.ok(text.includes(expected.time), `Expected time "${expected.time}" in WhatsApp text:\n${text}`);
  }
  if (expected.notes) {
    assert.ok(text.includes('*Notes:*'), `Expected *Notes:* label when notes are present:\n${text}`);
    assert.ok(text.includes(expected.notes), `Expected notes "${expected.notes}" in WhatsApp text:\n${text}`);
  }
}

function assertCleanWhatsAppUrl(rawUrl, expected = {}) {
  assert.equal(typeof rawUrl, 'string', 'WhatsApp URL must be a string');
  assert.ok(!/%EF%BF%BD/i.test(rawUrl), `Raw WhatsApp URL contains %EF%BF%BD replacement bytes: ${rawUrl}`);
  assert.ok(!/%25EF%25BF%25BD/i.test(rawUrl), `Raw WhatsApp URL contains double-encoded %25EF%25BF%25BD replacement bytes: ${rawUrl}`);

  const parsed = new URL(rawUrl);
  assert.ok(
    parsed.hostname === 'wa.me' || parsed.hostname === 'api.whatsapp.com',
    `Expected wa.me or api.whatsapp.com URL, got: ${rawUrl}`
  );

  if (expected.phone) {
    if (parsed.hostname === 'wa.me') {
      assert.ok(parsed.pathname.includes(expected.phone), `Expected phone ${expected.phone} in wa.me path: ${rawUrl}`);
    } else {
      assert.equal(parsed.searchParams.get('phone'), expected.phone);
    }
  }

  const decodedText = parsed.searchParams.get('text');
  assert.ok(decodedText, `WhatsApp URL missing ?text= parameter: ${rawUrl}`);
  assertCleanWhatsAppText(decodedText, expected);
  return decodedText;
}

async function waitForCondition(fn, timeoutMs = 5000, intervalMs = 150, description = 'condition') {
  const deadline = Date.now() + timeoutMs;
  let lastVal = null;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      lastVal = await fn();
      if (lastVal) return lastVal;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}${lastErr ? `: ${lastErr.message}` : ''}`);
}

async function setServiceToggleViaAdminUi(page, baseUrl, serviceKey, enabled, notice = null) {
  if (!page.url().includes('/admin/')) {
    await page.goto(`${baseUrl}/admin/`, { waitUntil: 'domcontentloaded' });
  }

  const resolveToggleSection = async () => {
    const explicitSection = page.locator('#serviceTogglesSection').first();
    if ((await explicitSection.count()) > 0) return explicitSection;
    const adminPanel = page.locator('.admin-panel').filter({
      hasText: /service\s*(&|and)?\s*tool\s*toggle|staff\s*service\s*toggle|feature\s*toggle/i
    }).first();
    if ((await adminPanel.count()) > 0) return adminPanel;
    return page.locator('section').filter({
      hasText: /service\s*(&|and)?\s*tool\s*toggle|staff\s*service\s*toggle|feature\s*toggle/i
    }).first();
  };

  // Locate toggle row/card via explicit data-service, id, or semantic label
  const specific = page.locator(`[data-service="${serviceKey}"], [data-service-key="${serviceKey}"]`).first();
  let container = specific;
  const toggleSection = await resolveToggleSection();
  if ((await specific.count()) === 0) {
    const labelRegex = SERVICE_LABELS[serviceKey];
    assert.ok(
      (await toggleSection.count()) > 0,
      `Admin Service & Tool Toggles section not found on /admin/ (looking for "${serviceKey}")`
    );
    container = toggleSection.locator('div, tr, label, li').filter({ hasText: labelRegex }).filter({
      has: page.locator('input[type="checkbox"], [role="switch"]')
    }).last();
  }

  await container.waitFor({ state: 'visible', timeout: 4000 });

  const checkbox = container.locator('input[type="checkbox"], [role="switch"]').first();
  await checkbox.waitFor({ state: 'attached', timeout: 3000 });

  if (notice !== null && notice !== undefined) {
    const noticeInput = container.locator('input[type="text"], textarea').first();
    if ((await noticeInput.count()) > 0) {
      await noticeInput.fill(notice);
    }
  }

  const currentChecked = await checkbox.isChecked().catch(async () => {
    const aria = await checkbox.getAttribute('aria-checked');
    return aria === 'true';
  });
  if (currentChecked !== enabled) {
    if (await checkbox.isVisible().catch(() => false)) {
      await checkbox.click();
    } else {
      const enclosingLabel = checkbox.locator('xpath=ancestor::label[1]');
      if ((await enclosingLabel.count()) > 0 && (await enclosingLabel.isVisible().catch(() => false))) {
        await enclosingLabel.click();
      } else {
        await checkbox.click({ force: true });
      }
    }
  }

  // Click Save button inside toggle card/section if present
  const cardSaveBtn = container.locator('button').filter({ hasText: /save|apply|update/i }).first();
  if ((await cardSaveBtn.count()) > 0 && (await cardSaveBtn.isVisible())) {
    await cardSaveBtn.click();
  } else if ((await toggleSection.count()) > 0) {
    const sectionSaveBtn = toggleSection.locator('button').filter({ hasText: /save|apply|update/i }).first();
    if ((await sectionSaveBtn.count()) > 0 && (await sectionSaveBtn.isVisible())) {
      await sectionSaveBtn.click();
    }
  }

  await waitForCondition(async () => {
    const { data } = await apiGetData(baseUrl);
    const toggle = data?.config?.serviceToggles?.[serviceKey];
    if (!toggle) return false;
    const okEnabled = toggle.enabled === enabled;
    const okNotice = notice ? String(toggle.notice || '').includes(notice) : true;
    return okEnabled && okNotice;
  }, 5000, 150, `serviceToggles.${serviceKey}.enabled=${enabled} in /api/data`);
}

async function createRoomViaAdminUi(page, baseUrl, room) {
  if (!page.url().includes('/admin/')) {
    await page.goto(`${baseUrl}/admin/`, { waitUntil: 'domcontentloaded' });
  }
  await page.locator('#admCfgRoomName').waitFor({ state: 'visible', timeout: 4000 });
  await page.locator('#admCfgRoomName').fill(room.name);
  await page.locator('#admCfgRoomFloor').fill(room.floor || 'Level 2 - East Wing');
  await page.locator('#admCfgRoomCapacity').fill(String(room.capacity || 12));
  if (room.status) {
    await page.locator('#admCfgRoomStatus').selectOption(room.status);
  }
  await page.locator('#admCfgRoomAmenities').fill(
    Array.isArray(room.amenities) ? room.amenities.join(', ') : (room.amenities || '4K TV, Whiteboard')
  );
  await page.locator('#admBtnSaveRoom').click();
  await waitForCondition(async () => {
    const { data } = await apiGetData(baseUrl);
    return (data.rooms || []).find((r) => r.name === room.name) || null;
  }, 5000, 150, `room "${room.name}" to persist in /api/data`);
}

async function createBookingViaUi(page, baseUrl, booking) {
  if (!page.url().includes('/booking/')) {
    await page.goto(`${baseUrl}/booking/`, { waitUntil: 'domcontentloaded' });
  }
  await waitForCondition(
    async () => (await page.locator('#department option').count()) > 0,
    5000,
    100,
    '/booking/ module initialization'
  );
  if (booking.roomId) {
    const serverState = await apiGetData(baseUrl).catch(() => null);
    const serverRoom = serverState?.data?.rooms?.find((r) => r.id === booking.roomId);
    await waitForCondition(async () => {
      const opt = page.locator(`#roomId option[value="${booking.roomId}"]`).first();
      if ((await opt.count()) === 0) return false;
      if (serverRoom?.name) {
        const txt = await opt.textContent().catch(() => '');
        return String(txt || '').includes(serverRoom.name);
      }
      return true;
    }, 8500, 150, `room "${booking.roomId}" (${serverRoom?.name || ''}) to sync in #roomId`);
  }
  await page.locator('button.nav-btn.primary-cta, button.hero-cta-btn').first().click();
  await page.locator('#bookingModalBackdrop.open').waitFor({ state: 'visible', timeout: 4000 });

  if (booking.roomId) {
    await page.locator('#roomId').selectOption(booking.roomId);
  }
  if (booking.date) {
    await page.locator('#date').fill(booking.date);
  }
  if (booking.startTime) {
    await page.locator('#startTime').fill(booking.startTime);
  }
  if (booking.endTime) {
    await page.locator('#endTime').fill(booking.endTime);
  }
  await page.locator('#title').fill(booking.title);
  if (booking.department) {
    await page.locator('#department').selectOption(booking.department);
  }
  if (booking.notes !== undefined) {
    await page.locator('#notes').fill(booking.notes);
  }
  await page.locator('#organizer').fill(booking.organizer || 'Staff Tester');
  await page.locator('#phone').fill(booking.phone || '012-3456789');
  if (booking.email) {
    await page.locator('#email').fill(booking.email);
  }

  // Uncheck auto-download .ics unless caller explicitly wants it
  const autoOutlook = page.locator('#chkAutoOutlook');
  if (booking.autoOutlook === false && (await autoOutlook.isChecked())) {
    await autoOutlook.uncheck();
  }

  await page.locator('#btnSubmitBooking').click();
}

function getTvMeetingFrame(tvPage) {
  return tvPage.frameLocator('#receiverViewport iframe[src*="/meeting/index.html"]');
}

async function getRemoteSlideControls(displayPage) {
  // Resolve explicit panel selectors before falling back to .card then section
  // (Playwright evaluates comma-selectors in DOM order, not selector priority order).
  let panel = displayPage.locator('#remoteSlideControls, [data-remote-slide-controls]').first();
  if ((await panel.count()) === 0) {
    const cardPanel = displayPage.locator('.card').filter({
      hasText: /remote\s*slide\s*control|meeting\s*tv\s*remote|slide\s*control/i
    }).first();
    if ((await cardPanel.count()) > 0) {
      panel = cardPanel;
    } else {
      panel = displayPage.locator('section').filter({
        hasText: /remote\s*slide\s*control|meeting\s*tv\s*remote|slide\s*control/i
      }).first();
    }
  }

  const count = await panel.count();
  assert.ok(count > 0, 'Remote slide control panel not found on /display/');
  await panel.waitFor({ state: 'visible', timeout: 4000 });

  const resolveCmdBtn = async (cmd, fallbackRegex) => {
    const explicit = panel.locator(`[data-slide-cmd="${cmd}"]`).first();
    if ((await explicit.count()) > 0) {
      return explicit;
    }
    return panel.locator('button').filter({ hasText: fallbackRegex }).first();
  };

  const prevBtn = await resolveCmdBtn('prev', /prev|previous|❮|◀/i);
  const nextBtn = await resolveCmdBtn('next', /next|❯|▶/i);
  const pauseBtn = await resolveCmdBtn('pause', /pause/i);
  const resumeBtn = await resolveCmdBtn('resume', /resume|play/i);
  const explicitPauseOrResume = panel.locator('[data-slide-cmd="pause"], [data-slide-cmd="resume"]').first();
  const pauseResumeBtn = (await explicitPauseOrResume.count()) > 0
    ? explicitPauseOrResume
    : panel.locator('button').filter({ hasText: /pause|resume|play|auto/i }).first();
  const refreshBtn = await resolveCmdBtn('refresh', /refresh|reload/i);
  const slideSelect = panel.locator('select').first();

  return {
    panel,
    prevBtn,
    nextBtn,
    pauseResumeBtn,
    pauseBtn,
    resumeBtn,
    refreshBtn,
    slideSelect
  };
}

function buildMinimalPdfBuffer(text = 'Careclinics E2E Test PDF') {
  const safeText = String(text).replace(/[()\\]/g, '');
  const streamContent = `BT /F1 18 Tf 50 700 Td (${safeText}) Tj ET`;
  const objs = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(streamContent, 'utf8')} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objs) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefPos = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objs.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objs.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

function getTodayIsoDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getFutureIsoDate(daysAhead = 2) {
  const d = new Date(Date.now() + daysAhead * 86400000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

module.exports = {
  SERVICE_KEYS,
  SERVICE_LABELS,
  ALL_PORTAL_ROUTES,
  loginViaApi,
  loginViaUi,
  injectAdminSession,
  apiGetData,
  apiPostAction,
  apiPostRaw,
  assertCleanWhatsAppText,
  assertCleanWhatsAppUrl,
  waitForCondition,
  setServiceToggleViaAdminUi,
  createRoomViaAdminUi,
  createBookingViaUi,
  getTvMeetingFrame,
  getRemoteSlideControls,
  buildMinimalPdfBuffer,
  getTodayIsoDate,
  getFutureIsoDate
};
