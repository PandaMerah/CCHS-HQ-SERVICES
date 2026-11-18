const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { launchBrowser, createIsolatedContext } = require('./helpers/playwright-loader.js');
const { startIsolatedServer } = require('./helpers/server-harness.js');
const {
  loginViaApi,
  loginViaUi,
  injectAdminSession,
  apiGetData,
  apiPostAction,
  assertCleanWhatsAppUrl,
  waitForCondition,
  setServiceToggleViaAdminUi,
  createBookingViaUi,
  getTvMeetingFrame,
  getRemoteSlideControls,
  buildMinimalPdfBuffer,
  getTodayIsoDate,
  getFutureIsoDate
} = require('./helpers/auth-api.js');

describe('Tier 4 — Real-World Multi-Step End-to-End Scenarios (6 scenarios)', { timeout: 240000 }, () => {
  let browser;

  before(async () => {
    browser = await launchBrowser();
  });

  after(async () => {
    if (browser) await browser.close();
  });

  it('T4-01: Full HQ Morning Meeting Setup, git Update Resilience & Live Alignment Execution', async () => {
    const srv = await startIsolatedServer();
    const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    const staffACtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    const staffBCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    const tvCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl, viewport: { width: 1280, height: 720 } });
    try {
      // 1. Admin logs in via UI and customizes HQ Main Boardroom -> Executive Boardroom 75 (24 pax)
      const adminPage = await adminCtx.newPage();
      await loginViaUi(adminPage, srv.baseUrl, 'admin', 'cchs2026', '/admin/');

      const togglesCheck = (await apiGetData(srv.baseUrl)).data?.config?.serviceToggles;
      assert.ok(togglesCheck && togglesCheck.roomBooking?.enabled === true, 'Expected serviceToggles enabled by default');

      await adminPage.locator('#adminRoomsList .btn-edit').first().click();
      await adminPage.locator('#admCfgRoomName').fill('Executive Boardroom 75');
      await adminPage.locator('#admCfgRoomCapacity').fill('24');
      await adminPage.locator('#admBtnSaveRoom').click();

      await waitForCondition(async () => {
        const { data } = await apiGetData(srv.baseUrl);
        return (data.rooms || []).some((r) => r.name === 'Executive Boardroom 75' && r.capacity === 24);
      }, 5000, 150, 'Executive Boardroom 75 customization to persist');

      // 2. Simulate git update resetting CCHSMeetingDashboard/data.json + server restart
      srv.simulateGitUpdate({ overwriteSeedData: true });
      await srv.restart();

      const afterGit = (await apiGetData(srv.baseUrl)).data;
      const execRoom = afterGit.rooms.find((r) => r.name === 'Executive Boardroom 75');
      assert.ok(execRoom, 'Custom room Executive Boardroom 75 must survive simulated git update & restart');

      // 3. Staff A submits IT department update in /meeting/input.html
      const staffAPage = await staffACtx.newPage();
      await staffAPage.goto(`${srv.baseUrl}/meeting/input.html`, { waitUntil: 'domcontentloaded' });
      await staffAPage.locator('#department').selectOption('IT');
      const uniqueUpdate = 'E2E Morning Update: Fiber uplink & TV sync verified.';
      await staffAPage.locator('#updateText').fill(uniqueUpdate);
      await staffAPage.locator('#questionText').fill('Any clinics need POS upgrade?');
      await staffAPage.locator('#submitBtn').click();
      await staffAPage.locator('#status').waitFor({ state: 'visible', timeout: 5000 });

      // 4. Staff B books Executive Boardroom 75 in /booking/ and verifies clean WhatsApp confirmation
      const staffBPage = await staffBCtx.newPage();
      const futureDate = getFutureIsoDate(2);
      await createBookingViaUi(staffBPage, srv.baseUrl, {
        roomId: execRoom.id,
        date: futureDate,
        startTime: '09:00',
        endTime: '10:30',
        title: 'Morning Executive Alignment',
        department: 'CEO OFFICE',
        organizer: 'Dr. Azlan',
        phone: '012-3334445',
        notes: 'Coffee served',
        autoOutlook: false
      });
      await staffBPage.locator('#confirmedModal.open').waitFor({ state: 'visible', timeout: 5000 });
      const waHref = await staffBPage.locator('#btnModalWhatsApp').getAttribute('href');
      assertCleanWhatsAppUrl(waHref, {
        phone: '60123334445',
        roomName: 'Executive Boardroom 75',
        title: 'Morning Executive Alignment',
        department: 'CEO OFFICE',
        notes: 'Coffee served'
      });

      // 5. Zero-input TV opens /display/?mode=receiver; Admin drives /display/ controller
      const tvPage = await tvCtx.newPage();
      await tvPage.goto(`${srv.baseUrl}/display/?mode=receiver`, { waitUntil: 'domcontentloaded' });
      await adminPage.goto(`${srv.baseUrl}/display/`, { waitUntil: 'domcontentloaded' });

      const tvFrame = getTvMeetingFrame(tvPage);
      await tvFrame.locator('#slide-indicator').waitFor({ state: 'visible', timeout: 5000 });

      const controls = await getRemoteSlideControls(adminPage);
      const itOpt = await controls.slideSelect.evaluate((sel) => {
        const opt = Array.from(sel.options).find((o) => /(?:^\d+\.\s*)?IT\s*Update/i.test(o.text));
        return opt ? opt.value : null;
      });
      assert.ok(itOpt, 'Expected IT Update option in remote slide selector');
      await controls.slideSelect.selectOption(itOpt);

      await waitForCondition(async () => {
        const bodyTxt = await tvFrame.locator('#slides-container').innerText().catch(() => '');
        return bodyTxt.includes(uniqueUpdate);
      }, 5000, 150, 'TV to display Staff A IT update text');

      await controls.nextBtn.click();
      await waitForCondition(async () => {
        const active = await tvFrame.locator('.dept-pill.active').innerText().catch(() => '');
        return !/^IT\s*Update/i.test(active);
      }, 5000, 150, 'TV to advance next slide');

      // Pause/Resume check + single-shot refresh
      const togglePlay = (await controls.resumeBtn.count()) > 0 ? controls.resumeBtn : controls.pauseResumeBtn;
      await togglePlay.click();
      await new Promise((r) => setTimeout(r, 400));
      const togglePause = (await controls.pauseBtn.count()) > 0 ? controls.pauseBtn : controls.pauseResumeBtn;
      await togglePause.click();

      let tvLoads = 0;
      tvPage.on('framenavigated', (f) => {
        if (f.url().includes('/meeting/')) tvLoads++;
      });
      await controls.refreshBtn.click();
      await waitForCondition(() => tvLoads >= 1, 5000, 150, 'TV frame refresh');
      await new Promise((r) => setTimeout(r, 2500));
      assert.equal(tvLoads, 1, 'Expected single-shot refresh');

      for (const c of [adminCtx, staffACtx, staffBCtx, tvCtx]) {
        const errs = c.getAllStabilityErrors();
        assert.deepEqual(errs.pageerrors, []);
        assert.deepEqual(errs.consoleErrors, []);
      }
      srv.assertNoUncaughtServerErrors();
    } finally {
      await adminCtx.close();
      await staffACtx.close();
      await staffBCtx.close();
      await tvCtx.close();
      await srv.stop();
    }
  });

  it('T4-02: Scheduled Maintenance Lockout & Recovery Lifecycle', async () => {
    const srv = await startIsolatedServer();
    const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    try {
      const staffPage = await staffCtx.newPage();
      const futureDate = getFutureIsoDate(3);

      // 1. Staff books normally before maintenance
      await createBookingViaUi(staffPage, srv.baseUrl, {
        roomId: 'discussion-a',
        date: futureDate,
        startTime: '11:00',
        endTime: '12:00',
        title: 'Pre-Maintenance Sync',
        department: 'ADMIN',
        organizer: 'Farah',
        phone: '012-1112223',
        autoOutlook: false
      });
      await staffPage.locator('#confirmedModal.open').waitFor({ state: 'visible', timeout: 5000 });

      // 2. Admin disables roomBooking & pdfStudio via /admin/ UI
      const adminPage = await adminCtx.newPage();
      await loginViaUi(adminPage, srv.baseUrl, 'admin', 'cchs2026', '/admin/');
      await setServiceToggleViaAdminUi(adminPage, srv.baseUrl, 'roomBooking', false, 'Room booking maintenance');
      await setServiceToggleViaAdminUi(adminPage, srv.baseUrl, 'pdfStudio', false, 'PDF Studio maintenance');

      // 3. Staff verifies /, #toolsDropdownMenu, /booking/, /pdf/ show notices & block usage
      await staffPage.goto(`${srv.baseUrl}/`, { waitUntil: 'domcontentloaded' });
      const bookingCard = staffPage.locator('#servicesGrid .service-card').filter({ hasText: /Book HQ Meeting Room/i }).first();
      await bookingCard.waitFor({ state: 'visible', timeout: 4000 });
      assert.match(await bookingCard.innerText(), /disabled|unavailable|maintenance/i);

      await staffPage.goto(`${srv.baseUrl}/pdf/`, { waitUntil: 'domcontentloaded' });
      await waitForCondition(async () => {
        const txt = await staffPage.locator('body').innerText();
        return /disabled|unavailable|maintenance/i.test(txt);
      }, 4500, 150, 'disabled notice on /pdf/');

      const blockedApi = await apiPostAction(srv.baseUrl, 'ADD_BOOKING', {
        booking: {
          id: 'bk-during-maint',
          roomId: 'discussion-a',
          title: 'Blocked',
          department: 'IT',
          organizer: 'Staff',
          date: futureDate,
          startTime: '14:00',
          endTime: '15:00'
        }
      });
      assert.equal(blockedApi.status, 403);
      assert.equal(blockedApi.data?.code, 'SERVICE_DISABLED');

      // 4. Admin verifies existing booking WhatsApp link still clean on /admin/
      await adminPage.locator('#adminBookingList a[href*="wa.me"]').first().waitFor({ state: 'visible', timeout: 4000 });
      const adminWaHref = await adminPage.locator('#adminBookingList a[href*="wa.me"]').first().getAttribute('href');
      assertCleanWhatsAppUrl(adminWaHref);

      // 5. Admin re-enables services -> staff books again cleanly
      await setServiceToggleViaAdminUi(adminPage, srv.baseUrl, 'roomBooking', true, '');
      await setServiceToggleViaAdminUi(adminPage, srv.baseUrl, 'pdfStudio', true, '');

      await createBookingViaUi(staffPage, srv.baseUrl, {
        roomId: 'discussion-a',
        date: futureDate,
        startTime: '14:00',
        endTime: '15:00',
        title: 'Post-Maintenance Sync',
        department: 'ADMIN',
        organizer: 'Farah',
        phone: '012-1112223',
        autoOutlook: false
      });
      await staffPage.locator('#confirmedModal.open').waitFor({ state: 'visible', timeout: 5000 });

      assert.deepEqual(staffCtx.getAllStabilityErrors().pageerrors, []);
      assert.deepEqual(adminCtx.getAllStabilityErrors().pageerrors, []);
    } finally {
      await adminCtx.close();
      await staffCtx.close();
      await srv.stop();
    }
  });

  it('T4-03: Live Presentation Handover — Meeting Deck <-> Staff Screen Share <-> Standby Notice', async () => {
    const srv = await startIsolatedServer();
    const auth = await loginViaApi(srv.baseUrl);
    const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl, mockDisplayMedia: true });
    const tvCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl, viewport: { width: 1280, height: 720 } });
    try {
      await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
      const adminPage = await adminCtx.newPage();
      const staffPage = await staffCtx.newPage();
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
      }, 5000, 150, 'TV deck at slide 2');

      // Staff joins screen share queue using mocked getDisplayMedia
      await staffPage.goto(`${srv.baseUrl}/display/?mode=share`, { waitUntil: 'domcontentloaded' });
      await staffPage.locator('#presName').fill('Amri Presenter');
      await staffPage.locator('#presTitle').fill('Clinical KPI Deck');
      await staffPage.locator('#btnStartShare').click();

      await waitForCondition(async () => {
        const { data } = await apiGetData(srv.baseUrl);
        return (data?.remoteDisplay?.presenters || []).some((p) => p.name === 'Amri Presenter');
      }, 5000, 150, 'presenter registered in queue');

      // Admin selects presenter to output to TV
      const castBtn = adminPage.locator('#presenterQueueList button', { hasText: /Output This Screen/i }).first();
      await castBtn.waitFor({ state: 'visible', timeout: 5000 });
      await castBtn.click();
      await tvPage.locator('#receiverViewport [data-presenter-id]').waitFor({ state: 'visible', timeout: 5000 });

      // Admin switches TV to announcement & triggers single-shot refresh
      await adminPage.locator('.mode-btn[data-mode="announcement"]').click();
      await tvPage.locator('#receiverViewport').getByText('HQ NOTICE', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });

      let tvLoads = 0;
      tvPage.on('load', () => { tvLoads++; });
      await controls.refreshBtn.click();
      await waitForCondition(() => tvLoads >= 1, 5000, 150, 'announcement mode reload');
      await new Promise((r) => setTimeout(r, 2000));
      assert.equal(tvLoads, 1);

      // Admin switches back to meeting-tv and drives remote slide control
      await adminPage.locator('.mode-btn[data-mode="meeting-tv"]').click();
      await tvFrame.locator('#slide-indicator').waitFor({ state: 'visible', timeout: 5000 });
      await controls.nextBtn.click();
      await waitForCondition(async () => {
        const txt = await tvFrame.locator('#slide-indicator').innerText();
        return /^3\s*\//.test(txt);
      }, 5000, 150, 'TV deck resumed & advanced to slide 3');
    } finally {
      await adminCtx.close();
      await staffCtx.close();
      await tvCtx.close();
      await srv.stop();
    }
  });

  it('T4-04: Admin Credential Rotation, Unauthenticated Boundary & Session Recovery', async () => {
    const srv = await startIsolatedServer();
    const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    const unauthCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    try {
      const adminPage = await adminCtx.newPage();
      await loginViaUi(adminPage, srv.baseUrl, 'admin', 'cchs2026', '/admin/');

      // Rotate admin credentials via #credForm
      await adminPage.locator('#newAdminUser').fill('hqsupervisor');
      await adminPage.locator('#curAdminPass').fill('cchs2026');
      await adminPage.locator('#newAdminPass').fill('NewSecure2026!');
      await adminPage.locator('#credForm button[type="submit"]').click();
      await adminPage.locator('#credToast').waitFor({ state: 'visible', timeout: 4000 });

      // Logout
      await adminPage.locator('#logoutBtn').click();
      await adminPage.waitForURL((u) => !u.pathname.includes('/admin/'), { timeout: 5000 });

      // Unauthenticated visits to protected routes must redirect cleanly with zero pageerror/console.error
      const unauthPage = await unauthCtx.newPage();
      for (const protectedRoute of ['/admin/', '/meeting/admin.html', '/display/']) {
        await unauthPage.goto(`${srv.baseUrl}${protectedRoute}`, { waitUntil: 'domcontentloaded' });
        await unauthPage.waitForURL((u) => u.pathname.endsWith('/login.html'), { timeout: 5000 });
      }
      const unauthErrs = unauthCtx.getAllStabilityErrors();
      assert.deepEqual(unauthErrs.pageerrors, [], `Unauth redirect pageerrors: ${unauthErrs.pageerrors.join('; ')}`);
      assert.deepEqual(unauthErrs.consoleErrors, [], `Unauth redirect consoleErrors: ${unauthErrs.consoleErrors.join('; ')}`);

      // Unauthenticated API actions rejected
      const unauthSlide = await apiPostAction(srv.baseUrl, 'SLIDE_COMMAND', { command: 'next' });
      assert.ok([401, 403].includes(unauthSlide.status));
      const unauthToggle = await apiPostAction(srv.baseUrl, 'UPDATE_SERVICE_TOGGLES', {
        serviceToggles: { pdfStudio: { enabled: false } }
      });
      assert.ok([401, 403].includes(unauthToggle.status));

      // Log back in with NEW rotated credentials and drive /display/
      await loginViaUi(adminPage, srv.baseUrl, 'hqsupervisor', 'NewSecure2026!', '/display/');
      const controls = await getRemoteSlideControls(adminPage);
      await controls.nextBtn.click();
      await waitForCondition(async () => {
        const { data } = await apiGetData(srv.baseUrl);
        return data?.remoteDisplay?.slideControl?.currentSlideIndex === 1;
      }, 5000, 150, 'SLIDE_COMMAND accepted with rotated admin session');
    } finally {
      await adminCtx.close();
      await unauthCtx.close();
      await srv.stop();
    }
  });

  it('T4-05: Staff Document Prep & Portal-Wide Navigation Journey', async () => {
    const srv = await startIsolatedServer();
    const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    try {
      const page = await staffCtx.newPage();
      await page.goto(`${srv.baseUrl}/`, { waitUntil: 'domcontentloaded' });

      // Use Ctrl+K search to filter to BentoPDF
      await page.keyboard.press('Control+k');
      await page.locator('#serviceSearch').fill('BentoPDF');
      const pdfCard = page.locator('#servicesGrid .service-card').filter({ hasText: /BentoPDF Studio/i }).first();
      await pdfCard.waitFor({ state: 'visible', timeout: 4000 });

      // Open /pdf/?tool=rotate -> test valid minimal PDF AND invalid PDF error handling
      await page.goto(`${srv.baseUrl}/pdf/?tool=rotate`, { waitUntil: 'domcontentloaded' });
      const validPdf = {
        name: 'valid-sample.pdf',
        mimeType: 'application/pdf',
        buffer: buildMinimalPdfBuffer('Careclinics HQ')
      };
      await page.locator('#rotInput').setInputFiles(validPdf);
      await waitForCondition(async () => (await page.locator('#btnRunRot').isDisabled()) === false, 4000, 100);
      await page.locator('#btnRunRot').click();
      await page.locator('#toolStatus').waitFor({ state: 'visible', timeout: 5000 });
      assert.match(await page.locator('#toolStatus').innerText(), /Rotated/i);

      // Corrupt PDF test -> clean status error, zero pageerror
      await page.locator('#rotInput').setInputFiles({
        name: 'broken.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('CORRUPT_DATA', 'utf8')
      });
      await page.locator('#btnRunRot').click();
      await page.locator('#toolStatus').waitFor({ state: 'visible', timeout: 4000 });

      // Navigate across portal via navbar links
      await page.locator('a[href="/booking/"]').first().click();
      await page.waitForURL((u) => u.pathname.includes('/booking'), { timeout: 5000 });
      await page.goto(`${srv.baseUrl}/meeting/input.html`, { waitUntil: 'domcontentloaded' });
      await page.goto(`${srv.baseUrl}/display/?mode=share`, { waitUntil: 'domcontentloaded' });

      const errs = staffCtx.getAllStabilityErrors();
      assert.deepEqual(errs.pageerrors, [], `Staff journey pageerrors: ${errs.pageerrors.join('; ')}`);
      assert.deepEqual(errs.consoleErrors, [], `Staff journey consoleErrors: ${errs.consoleErrors.join('; ')}`);
      assert.deepEqual(errs.server5xx, [], `Staff journey 5xx: ${errs.server5xx.join('; ')}`);
    } finally {
      await staffCtx.close();
      await srv.stop();
    }
  });

  it('T4-06: Multi-Staff Room Booking Contention & Admin Reschedule Broadcast', async () => {
    const srv = await startIsolatedServer();
    const auth = await loginViaApi(srv.baseUrl);
    const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    const staff1Ctx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    const staff2Ctx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
    const tvCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl, viewport: { width: 1280, height: 720 } });
    try {
      // Admin persists a custom room
      const saveRes = await apiPostAction(
        srv.baseUrl,
        'SAVE_ROOMS',
        {
          rooms: [
            {
              id: 'contention-room',
              name: 'Clinical Strategy Room',
              floor: 'Level 2',
              capacity: 12,
              amenities: ['TV'],
              color: '#1863dc',
              status: 'available'
            }
          ]
        },
        auth.data.token
      );
      assert.equal(saveRes.status, 200);

      const today = getTodayIsoDate();

      // Staff 1 books 10:00 - 11:30 via UI
      const staff1Page = await staff1Ctx.newPage();
      await createBookingViaUi(staff1Page, srv.baseUrl, {
        roomId: 'contention-room',
        date: today,
        startTime: '10:00',
        endTime: '11:30',
        title: 'Strategy Session One',
        department: 'OPERATION',
        organizer: 'Azim',
        phone: '012-6677889',
        notes: 'First booking',
        autoOutlook: false
      });
      await staff1Page.locator('#confirmedModal.open').waitFor({ state: 'visible', timeout: 5000 });
      assertCleanWhatsAppUrl(await staff1Page.locator('#btnModalWhatsApp').getAttribute('href'), {
        roomName: 'Clinical Strategy Room',
        title: 'Strategy Session One'
      });

      // Staff 2 attempts overlapping reservation 10:30 - 12:00 -> rejected (409 on API & conflict in UI)
      const conflictRes = await apiPostAction(srv.baseUrl, 'ADD_BOOKING', {
        booking: {
          id: 'bk-overlap-attempt',
          roomId: 'contention-room',
          title: 'Overlapping Attempt',
          department: 'HR',
          organizer: 'Zaki',
          date: today,
          startTime: '10:30',
          endTime: '12:00'
        }
      });
      assert.equal(conflictRes.status, 409);

      const staff2Page = await staff2Ctx.newPage();
      await staff2Page.goto(`${srv.baseUrl}/booking/`, { waitUntil: 'domcontentloaded' });
      await staff2Page.locator('#roomId option[value="contention-room"]').waitFor({ state: 'attached', timeout: 8000 });
      await staff2Page.locator('button.nav-btn.primary-cta').click();
      await staff2Page.locator('#roomId').selectOption('contention-room');
      await staff2Page.locator('#date').fill(today);
      await staff2Page.locator('#startTime').fill('10:30');
      await staff2Page.locator('#endTime').fill('12:00');
      await waitForCondition(async () => {
        const statusTxt = await staff2Page.locator('#liveSlotText').innerText();
        return /conflict/i.test(statusTxt) && (await staff2Page.locator('#btnSubmitBooking').isDisabled());
      }, 6000, 150, 'UI slot conflict detection for Staff 2');

      // Admin reschedules Staff 1's booking in /admin/ to 13:00 - 14:30
      await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
      const adminPage = await adminCtx.newPage();
      await adminPage.goto(`${srv.baseUrl}/admin/`, { waitUntil: 'domcontentloaded' });
      const row = adminPage.locator('#adminBookingList .booking-row').filter({ hasText: 'Strategy Session One' }).first();
      await row.waitFor({ state: 'visible', timeout: 4000 });
      await row.locator('button', { hasText: /Edit/i }).click();
      await adminPage.locator('#editBookingModal').waitFor({ state: 'visible', timeout: 4000 });
      await adminPage.locator('#editStartTime').fill('13:00');
      await adminPage.locator('#editEndTime').fill('14:30');
      await adminPage.locator('#editBookingForm button[type="submit"]').click();

      await waitForCondition(async () => {
        const { data } = await apiGetData(srv.baseUrl);
        const bk = (data.bookings || []).find((b) => b.title === 'Strategy Session One');
        return bk && bk.startTime === '13:00' && bk.endTime === '14:30';
      }, 5000, 150, 'booking rescheduled to 13:00 - 14:30');

      // Admin switches TV Receiver to room-signage for Clinical Strategy Room
      const tvPage = await tvCtx.newPage();
      await tvPage.goto(`${srv.baseUrl}/display/?mode=receiver`, { waitUntil: 'domcontentloaded' });
      await adminPage.goto(`${srv.baseUrl}/display/`, { waitUntil: 'domcontentloaded' });
      await adminPage.locator('.mode-btn[data-mode="room-signage"]').click();
      await adminPage.locator('#targetRoomSelect').selectOption('contention-room');
      await adminPage.locator('.btn-broadcast').click();

      await waitForCondition(async () => {
        const txt = await tvPage.locator('#receiverViewport').innerText().catch(() => '');
        return txt.includes('Clinical Strategy Room') && txt.includes('13:00') && txt.includes('Strategy Session One');
      }, 5000, 150, 'TV room-signage to show rescheduled 13:00 booking');
    } finally {
      await adminCtx.close();
      await staff1Ctx.close();
      await staff2Ctx.close();
      await tvCtx.close();
      await srv.stop();
    }
  });
});
