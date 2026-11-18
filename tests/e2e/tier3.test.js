const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { launchBrowser, createIsolatedContext } = require('./helpers/playwright-loader.js');
const { startIsolatedServer } = require('./helpers/server-harness.js');
const {
  ALL_PORTAL_ROUTES,
  loginViaApi,
  injectAdminSession,
  apiGetData,
  apiPostAction,
  assertCleanWhatsAppUrl,
  waitForCondition,
  createRoomViaAdminUi,
  createBookingViaUi,
  getTvMeetingFrame,
  getRemoteSlideControls,
  getFutureIsoDate
} = require('./helpers/auth-api.js');

describe('Tier 3 — Pairwise Cross-Feature Combination Tests (7 tests)', { timeout: 180000 }, () => {
  let browser;

  before(async () => {
    browser = await launchBrowser();
  });

  after(async () => {
    if (browser) await browser.close();
  });

  it('T3-01 (R1 x R4): Disabling screenShare blocks staff casting while remote slide control on TV stays operational', async () => {
    const srv = await startIsolatedServer();
    const auth = await loginViaApi(srv.baseUrl);
    const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl, mockDisplayMedia: true });
    const tvCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl, viewport: { width: 1280, height: 720 } });
    try {
      await apiPostAction(
        srv.baseUrl,
        'UPDATE_SERVICE_TOGGLES',
        { serviceToggles: { screenShare: { enabled: false, notice: 'Screen Share paused for alignment' } } },
        auth.data.token
      );

      // Staff screenShare API blocked
      const regRes = await apiPostAction(srv.baseUrl, 'REGISTER_PRESENTER', {
        presenter: { id: 'p-t3-01', name: 'Staff', department: 'IT', title: 'Blocked' }
      });
      assert.equal(regRes.status, 403);
      assert.equal(regRes.data?.code, 'SERVICE_DISABLED');

      // Staff screenShare UI blocked
      const staffPage = await staffCtx.newPage();
      await staffPage.goto(`${srv.baseUrl}/display/?mode=share`, { waitUntil: 'domcontentloaded' });
      await waitForCondition(async () => {
        const txt = await staffPage.locator('body').innerText();
        return /paused for alignment|disabled|unavailable/i.test(txt);
      }, 4500, 150, 'disabled notice on /display/?mode=share');
      assert.equal(await staffPage.locator('#btnStartShare').isDisabled(), true);

      // Admin controller & TV remote slide control continue working normally
      await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
      const adminPage = await adminCtx.newPage();
      const tvPage = await tvCtx.newPage();

      await tvPage.goto(`${srv.baseUrl}/display/?mode=receiver`, { waitUntil: 'domcontentloaded' });
      await adminPage.goto(`${srv.baseUrl}/display/`, { waitUntil: 'domcontentloaded' });

      const tvFrame = getTvMeetingFrame(tvPage);
      await tvFrame.locator('#slide-indicator').waitFor({ state: 'visible', timeout: 5000 });

      const controls = await getRemoteSlideControls(adminPage);
      await controls.nextBtn.click();
      await waitForCondition(async () => {
        const txt = await tvFrame.locator('#slide-indicator').innerText();
        return /^2\s*\//.test(txt);
      }, 5000, 150, 'TV slide advance while screenShare is disabled');

      await controls.refreshBtn.click();
      await new Promise((r) => setTimeout(r, 2000));
      srv.assertNoUncaughtServerErrors();
    } finally {
      await adminCtx.close();
      await staffCtx.close();
      await tvCtx.close();
      await srv.stop();
    }
  });

  it('T3-02 (R1 x R2): Custom room & toggle state persist across restart; #toolsDropdownMenu reflects disabled services', async () => {
    const srv = await startIsolatedServer();
    const auth = await loginViaApi(srv.baseUrl);
    const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    try {
      await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
      const adminPage = await adminCtx.newPage();

      await createRoomViaAdminUi(adminPage, srv.baseUrl, {
        name: 'Pairwise Synergy Suite',
        floor: 'Level 2 - North',
        capacity: 14,
        amenities: ['4K TV', 'Whiteboard']
      });

      // Disable departmentUpdate and pdfStudio while keeping roomBooking enabled
      await apiPostAction(
        srv.baseUrl,
        'UPDATE_SERVICE_TOGGLES',
        {
          serviceToggles: {
            departmentUpdate: { enabled: false, notice: 'Updates closed' },
            pdfStudio: { enabled: false, notice: 'PDF tools closed' },
            roomBooking: { enabled: true, notice: '' },
            screenShare: { enabled: true, notice: '' }
          }
        },
        auth.data.token
      );

      const staffPage = await staffCtx.newPage();
      await staffPage.goto(`${srv.baseUrl}/booking/`, { waitUntil: 'domcontentloaded' });
      await staffPage.locator('#btnToolsMenu').click();
      await staffPage.locator('#toolsDropdownMenu').waitFor({ state: 'visible', timeout: 4000 });

      const deptItem = staffPage.locator('#toolsDropdownMenu .tool-grid-item').filter({ hasText: /Dept Update/i }).first();
      const pdfItem = staffPage.locator('#toolsDropdownMenu .tool-grid-item').filter({ hasText: /BentoPDF/i }).first();
      await deptItem.waitFor({ state: 'visible', timeout: 3000 });
      await pdfItem.waitFor({ state: 'visible', timeout: 3000 });
      assert.match(await deptItem.innerText(), /disabled|unavailable|closed/i);
      assert.match(await pdfItem.innerText(), /disabled|unavailable|closed/i);

      // Verify clicking disabled dropdown item does not navigate to an active tool
      await pdfItem.click({ timeout: 1000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 300));
      if (!staffPage.url().includes('/booking/')) {
        const bodyText = await staffPage.locator('body').innerText();
        assert.match(bodyText, /disabled|unavailable|closed/i);
        assert.equal(
          await staffPage.locator('#toolWorkspace .dropzone').isVisible().catch(() => false),
          false,
          'Disabled #toolsDropdownMenu item must not navigate to an active PDF tool'
        );
        await staffPage.goto(`${srv.baseUrl}/booking/`, { waitUntil: 'domcontentloaded' });
      }

      // Now disable roomBooking too and restart server
      await apiPostAction(
        srv.baseUrl,
        'UPDATE_SERVICE_TOGGLES',
        { serviceToggles: { roomBooking: { enabled: false, notice: 'Maintenance' } } },
        auth.data.token
      );
      await srv.restart();

      const afterRestart = (await apiGetData(srv.baseUrl)).data;
      assert.equal(afterRestart.config.serviceToggles.roomBooking.enabled, false);
      assert.ok(afterRestart.rooms.some((r) => r.name === 'Pairwise Synergy Suite'));

      // Re-enable roomBooking and verify staff can book the custom room
      await apiPostAction(
        srv.baseUrl,
        'UPDATE_SERVICE_TOGGLES',
        { serviceToggles: { roomBooking: { enabled: true, notice: '' } } },
        auth.data.token
      );
      const customRoom = afterRestart.rooms.find((r) => r.name === 'Pairwise Synergy Suite');
      await staffPage.reload({ waitUntil: 'domcontentloaded' });
      await createBookingViaUi(staffPage, srv.baseUrl, {
        roomId: customRoom.id,
        date: getFutureIsoDate(3),
        startTime: '11:00',
        endTime: '12:00',
        title: 'Synergy Follow-up',
        department: 'OPERATION',
        organizer: 'Nadia',
        phone: '012-4455667',
        autoOutlook: false
      });
      await staffPage.locator('#confirmedModal.open').waitFor({ state: 'visible', timeout: 5000 });
    } finally {
      await adminCtx.close();
      await staffCtx.close();
      await srv.stop();
    }
  });

  it('T3-03 (R1 x R3): Disabling roomBooking blocks new staff bookings while admin retains clean WhatsApp reminders', async () => {
    const srv = await startIsolatedServer();
    const auth = await loginViaApi(srv.baseUrl);
    const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    try {
      const staffPage = await staffCtx.newPage();
      const futureDate = getFutureIsoDate(4);
      await createBookingViaUi(staffPage, srv.baseUrl, {
        roomId: 'boardroom-main',
        date: futureDate,
        startTime: '13:00',
        endTime: '14:00',
        title: 'Pre-Lockout Booking',
        department: 'HR',
        organizer: 'Aina',
        phone: '019-3344556',
        notes: 'Tea & coffee',
        autoOutlook: false
      });
      await staffPage.locator('#confirmedModal.open').waitFor({ state: 'visible', timeout: 5000 });
      assertCleanWhatsAppUrl(await staffPage.locator('#btnModalWhatsApp').getAttribute('href'), {
        title: 'Pre-Lockout Booking',
        department: 'HR',
        notes: 'Tea & coffee'
      });

      // Disable roomBooking
      await apiPostAction(
        srv.baseUrl,
        'UPDATE_SERVICE_TOGGLES',
        { serviceToggles: { roomBooking: { enabled: false, notice: 'Booking frozen' } } },
        auth.data.token
      );

      // Staff new booking fails via API & UI
      const blocked = await apiPostAction(srv.baseUrl, 'ADD_BOOKING', {
        booking: {
          id: 'bk-blocked-after-lock',
          roomId: 'boardroom-main',
          title: 'Blocked',
          department: 'IT',
          organizer: 'Staff',
          date: futureDate,
          startTime: '15:00',
          endTime: '16:00'
        }
      });
      assert.equal(blocked.status, 403);
      assert.equal(blocked.data?.code, 'SERVICE_DISABLED');

      // Admin still sees existing booking in /admin/ with clean WhatsApp reminder link
      await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
      const adminPage = await adminCtx.newPage();
      await adminPage.goto(`${srv.baseUrl}/admin/`, { waitUntil: 'domcontentloaded' });
      const row = adminPage.locator('#adminBookingList .booking-row').filter({ hasText: 'Pre-Lockout Booking' }).first();
      await row.waitFor({ state: 'visible', timeout: 4000 });
      const waHref = await row.locator('a[href*="wa.me"]').getAttribute('href');
      assertCleanWhatsAppUrl(waHref, {
        phone: '60193344556',
        title: 'Pre-Lockout Booking',
        department: 'HR',
        notes: 'Tea & coffee'
      });
    } finally {
      await staffCtx.close();
      await adminCtx.close();
      await srv.stop();
    }
  });

  it('T3-04 (R2 x R3): Custom room survives git update + restart and feeds clean WhatsApp confirmation URL', async () => {
    const srv = await startIsolatedServer();
    const auth = await loginViaApi(srv.baseUrl);
    const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    try {
      await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
      const adminPage = await adminCtx.newPage();
      await createRoomViaAdminUi(adminPage, srv.baseUrl, {
        name: 'Clinical Pod West',
        floor: 'Level 3 - West Wing',
        capacity: 10,
        amenities: ['Telehealth Camera', 'Acoustic Glass']
      });

      srv.simulateGitUpdate({ overwriteSeedData: true });
      await srv.restart();

      const { data } = await apiGetData(srv.baseUrl);
      const customRoom = data.rooms.find((r) => r.name === 'Clinical Pod West');
      assert.ok(customRoom, 'Custom room must survive git update + restart');

      const staffPage = await staffCtx.newPage();
      const futureDate = getFutureIsoDate(6);
      await createBookingViaUi(staffPage, srv.baseUrl, {
        roomId: customRoom.id,
        date: futureDate,
        startTime: '09:30',
        endTime: '10:30',
        title: 'Patient Safety Briefing',
        department: 'CLINICAL GOVERNANCE',
        organizer: 'Dr. Farah',
        phone: '012-7788990',
        notes: 'Check telehealth mic',
        autoOutlook: false
      });

      await staffPage.locator('#confirmedModal.open').waitFor({ state: 'visible', timeout: 5000 });
      const waHref = await staffPage.locator('#btnModalWhatsApp').getAttribute('href');
      assertCleanWhatsAppUrl(waHref, {
        phone: '60127788990',
        roomName: 'Clinical Pod West',
        roomFloor: 'Level 3 - West Wing',
        title: 'Patient Safety Briefing',
        department: 'CLINICAL GOVERNANCE',
        date: futureDate,
        time: '09:30 – 10:30',
        notes: 'Check telehealth mic'
      });
    } finally {
      await adminCtx.close();
      await staffCtx.close();
      await srv.stop();
    }
  });

  it('T3-05 (R2 x R4): Custom room signage + Meeting TV remote slide control both persist across server restart', async () => {
    const srv = await startIsolatedServer();
    const auth = await loginViaApi(srv.baseUrl);
    const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    const tvCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl, viewport: { width: 1280, height: 720 } });
    try {
      await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
      const adminPage = await adminCtx.newPage();
      const tvPage = await tvCtx.newPage();

      await createRoomViaAdminUi(adminPage, srv.baseUrl, {
        name: 'TV Signage Test Suite',
        floor: 'Level 7 - Sky Annex',
        capacity: 40,
        amenities: ['Dual Laser Projectors']
      });
      const customRoom = (await apiGetData(srv.baseUrl)).data.rooms.find((r) => r.name === 'TV Signage Test Suite');

      await tvPage.goto(`${srv.baseUrl}/display/?mode=receiver`, { waitUntil: 'domcontentloaded' });
      await adminPage.goto(`${srv.baseUrl}/display/`, { waitUntil: 'domcontentloaded' });

      // Switch TV to room-signage targeting the custom room
      await adminPage.locator('.mode-btn[data-mode="room-signage"]').click();
      await adminPage.locator('#targetRoomSelect').selectOption(customRoom.id);
      await adminPage.locator('.btn-broadcast').click();
      await tvPage.locator('#receiverViewport').getByText('TV Signage Test Suite').waitFor({ state: 'visible', timeout: 5000 });

      // Switch back to meeting-tv and drive remote slides
      await adminPage.locator('.mode-btn[data-mode="meeting-tv"]').click();
      const tvFrame = getTvMeetingFrame(tvPage);
      await tvFrame.locator('#slide-indicator').waitFor({ state: 'visible', timeout: 5000 });
      const controls = await getRemoteSlideControls(adminPage);
      await controls.nextBtn.click();
      await waitForCondition(async () => {
        const txt = await tvFrame.locator('#slide-indicator').innerText();
        return /^2\s*\//.test(txt);
      }, 5000, 150, 'TV slide at 2 / N');

      await srv.restart();
      const after = (await apiGetData(srv.baseUrl)).data;
      assert.ok(after.rooms.some((r) => r.name === 'TV Signage Test Suite'));
      assert.equal(after.remoteDisplay?.slideControl?.currentSlideIndex, 1);
    } finally {
      await adminCtx.close();
      await tvCtx.close();
      await srv.stop();
    }
  });

  it('T3-06 (R1 x R4): Disabling departmentUpdate blocks staff input while Admin manages /meeting/admin.html & remote slides', async () => {
    const srv = await startIsolatedServer();
    const auth = await loginViaApi(srv.baseUrl);
    const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    const tvCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl, viewport: { width: 1280, height: 720 } });
    try {
      await apiPostAction(
        srv.baseUrl,
        'UPDATE_SERVICE_TOGGLES',
        { serviceToggles: { departmentUpdate: { enabled: false, notice: 'Agenda locked for meeting' } } },
        auth.data.token
      );

      const staffPage = await staffCtx.newPage();
      await staffPage.goto(`${srv.baseUrl}/meeting/input.html`, { waitUntil: 'domcontentloaded' });
      await waitForCondition(async () => {
        const txt = await staffPage.locator('body').innerText();
        return /agenda locked|disabled|unavailable/i.test(txt);
      }, 4500, 150, 'disabled notice on /meeting/input.html');

      const blockedApi = await apiPostAction(srv.baseUrl, 'SUBMIT_DEPARTMENT_UPDATE', {
        department: 'IT',
        updateText: 'Late update',
        questionText: 'N/A'
      });
      assert.equal(blockedApi.status, 403);
      assert.equal(blockedApi.data?.code, 'SERVICE_DISABLED');

      // Admin can still access /meeting/admin.html and /display/ remote slide control
      await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
      const adminPage = await adminCtx.newPage();
      await adminPage.goto(`${srv.baseUrl}/meeting/admin.html`, { waitUntil: 'domcontentloaded' });
      await adminPage.locator('#showQnA').waitFor({ state: 'visible', timeout: 4000 });

      const tvPage = await tvCtx.newPage();
      await tvPage.goto(`${srv.baseUrl}/meeting/`, { waitUntil: 'domcontentloaded' });
      await adminPage.goto(`${srv.baseUrl}/display/`, { waitUntil: 'domcontentloaded' });

      const controls = await getRemoteSlideControls(adminPage);
      await controls.nextBtn.click();
      await waitForCondition(async () => {
        const txt = await tvPage.locator('#slide-indicator').innerText();
        return /^2\s*\//.test(txt);
      }, 5000, 150, 'TV slide advance while departmentUpdate is disabled');
    } finally {
      await staffCtx.close();
      await adminCtx.close();
      await tvCtx.close();
      await srv.stop();
    }
  });

  it('T3-07 (R1-R4 x Stability): All 11 routes remain free of pageerror, console.error, 5xx & server stderr errors', async () => {
    const srv = await startIsolatedServer();
    const auth = await loginViaApi(srv.baseUrl);
    const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    try {
      await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
      const adminPage = await adminCtx.newPage();
      const staffPage = await staffCtx.newPage();

      // Phase A: All services enabled, custom room + remote command
      await apiPostAction(
        srv.baseUrl,
        'SAVE_ROOMS',
        {
          rooms: [
            {
              id: 'stab-room',
              name: 'Stability Conference Room',
              floor: 'Level 1',
              capacity: 12,
              amenities: ['TV'],
              color: '#1863dc',
              status: 'available'
            }
          ]
        },
        auth.data.token
      );
      await apiPostAction(srv.baseUrl, 'SLIDE_COMMAND', { command: 'next' }, auth.data.token);

      for (const r of ALL_PORTAL_ROUTES) {
        const targetPage = ['/admin/', '/meeting/admin.html', '/display/'].includes(r) ? adminPage : staffPage;
        await targetPage.goto(`${srv.baseUrl}${r}`, { waitUntil: 'domcontentloaded' });
        await new Promise((res) => setTimeout(res, 200));
      }

      // Phase B: Services disabled, sweep staff routes again
      await apiPostAction(
        srv.baseUrl,
        'UPDATE_SERVICE_TOGGLES',
        {
          serviceToggles: {
            departmentUpdate: { enabled: false, notice: 'Sweep test' },
            roomBooking: { enabled: false, notice: 'Sweep test' },
            screenShare: { enabled: false, notice: 'Sweep test' },
            pdfStudio: { enabled: false, notice: 'Sweep test' }
          }
        },
        auth.data.token
      );

      for (const r of ['/', '/meeting/input.html', '/booking/', '/display/?mode=share', '/pdf/']) {
        await staffPage.goto(`${srv.baseUrl}${r}`, { waitUntil: 'domcontentloaded' });
        await new Promise((res) => setTimeout(res, 200));
      }

      const adminErrs = adminCtx.getAllStabilityErrors();
      const staffErrs = staffCtx.getAllStabilityErrors();
      assert.deepEqual(adminErrs.pageerrors, [], `Admin pageerrors: ${adminErrs.pageerrors.join('; ')}`);
      assert.deepEqual(adminErrs.consoleErrors, [], `Admin consoleErrors: ${adminErrs.consoleErrors.join('; ')}`);
      assert.deepEqual(adminErrs.server5xx, [], `Admin 5xx: ${adminErrs.server5xx.join('; ')}`);
      assert.deepEqual(staffErrs.pageerrors, [], `Staff pageerrors: ${staffErrs.pageerrors.join('; ')}`);
      assert.deepEqual(staffErrs.consoleErrors, [], `Staff consoleErrors: ${staffErrs.consoleErrors.join('; ')}`);
      assert.deepEqual(staffErrs.server5xx, [], `Staff 5xx: ${staffErrs.server5xx.join('; ')}`);
      srv.assertNoUncaughtServerErrors();
    } finally {
      await adminCtx.close();
      await staffCtx.close();
      await srv.stop();
    }
  });
});
