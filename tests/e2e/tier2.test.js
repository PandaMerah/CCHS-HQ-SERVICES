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
  assertCleanWhatsAppText,
  assertCleanWhatsAppUrl,
  waitForCondition,
  setServiceToggleViaAdminUi,
  createRoomViaAdminUi,
  createBookingViaUi,
  getTvMeetingFrame,
  getRemoteSlideControls,
  getTodayIsoDate,
  getFutureIsoDate
} = require('./helpers/auth-api.js');

describe('Tier 2 — Boundary, Corner & Single-Feature Browser E2E Tests (28 tests)', { timeout: 180000 }, () => {
  let browser;

  before(async () => {
    browser = await launchBrowser();
  });

  after(async () => {
    if (browser) await browser.close();
  });

  // =========================================================================
  // R1: Admin Service & Tool Toggles (6 tests)
  // =========================================================================
  describe('R1: Admin Service & Tool Toggles UI & Enforcement (6 tests)', () => {
    it('T2-R1-01: Admin logs in via UI, toggles departmentUpdate OFF with custom notice, and persists across reload', async () => {
      const srv = await startIsolatedServer();
      const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        const page = await adminCtx.newPage();
        await loginViaUi(page, srv.baseUrl, 'admin', 'cchs2026', '/admin/');
        await setServiceToggleViaAdminUi(page, srv.baseUrl, 'departmentUpdate', false, 'Weekly submission paused');

        await page.reload({ waitUntil: 'domcontentloaded' });
        const { data } = await apiGetData(srv.baseUrl);
        assert.equal(data?.config?.serviceToggles?.departmentUpdate?.enabled, false);
        assert.match(String(data?.config?.serviceToggles?.departmentUpdate?.notice || ''), /Weekly submission paused/i);
      } finally {
        await adminCtx.close();
        await srv.stop();
      }
    });

    it('T2-R1-02: Staff on / sees disabled service cards, widgets & PDF shortcuts (visible with notice, not hidden) and cannot access them', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        await apiPostAction(
          srv.baseUrl,
          'UPDATE_SERVICE_TOGGLES',
          {
            serviceToggles: {
              roomBooking: { enabled: false, notice: 'Room booking maintenance' },
              departmentUpdate: { enabled: false, notice: 'Dept updates paused' },
              pdfStudio: { enabled: false, notice: 'PDF Studio offline' }
            }
          },
          auth.data.token
        );

        const page = await staffCtx.newPage();
        await page.goto(`${srv.baseUrl}/`, { waitUntil: 'domcontentloaded' });

        // 1. Disabled roomBooking card on / is visible with notice and its card action itself is blocked
        const bookingCard = page.locator('#servicesGrid .service-card').filter({ hasText: /Book HQ Meeting Room/i }).first();
        await bookingCard.waitFor({ state: 'visible', timeout: 4000 });
        await waitForCondition(async () => {
          const txt = await bookingCard.innerText();
          return /disabled|unavailable|maintenance|paused/i.test(txt);
        }, 4500, 150, 'disabled notice on Book HQ Meeting Room card');

        const isCardActionBlocked = await bookingCard.evaluate((card) => {
          const action = card.querySelector('a, button');
          if (!action) return card.getAttribute('aria-disabled') === 'true' || card.classList.contains('disabled');
          const style = window.getComputedStyle(action);
          return (
            Boolean(action.disabled) ||
            action.getAttribute('aria-disabled') === 'true' ||
            style.pointerEvents === 'none' ||
            (action.tagName === 'A' && (!action.getAttribute('href') || action.getAttribute('href') === '#')) ||
            action.classList.contains('disabled')
          );
        });
        const actionEl = bookingCard.locator('a, button').first();
        if ((await actionEl.count()) > 0 && !isCardActionBlocked) {
          await actionEl.click({ timeout: 1500 }).catch(() => {});
          await new Promise((r) => setTimeout(r, 300));
        }
        const stillOnHome = new URL(page.url()).pathname === '/' || page.url().endsWith('/index.html');
        assert.ok(
          isCardActionBlocked || stillOnHome,
          'Disabled roomBooking card on / must block navigation/action directly on the card'
        );
        if (!stillOnHome) {
          await page.goto(`${srv.baseUrl}/`, { waitUntil: 'domcontentloaded' });
        }

        // 2. Department Readiness widget reflects disabled departmentUpdate state
        const deptWidget = page.locator('.widget-card').filter({ has: page.locator('#deptStatusList') }).first();
        await deptWidget.waitFor({ state: 'visible', timeout: 4000 });
        const deptWidgetAction = deptWidget.locator('.widget-action, a, button').first();
        const deptWidgetText = await deptWidget.innerText();
        const deptWidgetBlocked = await deptWidgetAction.evaluate((el) => {
          const style = window.getComputedStyle(el);
          return (
            Boolean(el.disabled) ||
            el.getAttribute('aria-disabled') === 'true' ||
            style.pointerEvents === 'none' ||
            (el.tagName === 'A' && (!el.getAttribute('href') || el.getAttribute('href') === '#')) ||
            el.classList.contains('disabled')
          );
        }).catch(() => false);
        assert.ok(
          deptWidgetBlocked || /disabled|unavailable|paused|maintenance/i.test(deptWidgetText),
          'Department widget on / must reflect disabled departmentUpdate state'
        );

        // 3. Quick BentoPDF shortcuts remain visible (12 tools) and reflect disabled pdfStudio state
        const pdfShortcuts = page.locator('.quick-pdf-grid .pdf-shortcut');
        assert.equal(await pdfShortcuts.count(), 12, 'All 12 quick PDF shortcuts must remain visible (not hidden)');
        const pdfWidget = page.locator('.widget-card').filter({ has: page.locator('.quick-pdf-grid') }).first();
        const pdfWidgetText = await pdfWidget.innerText();
        const firstPdfBlocked = await pdfShortcuts.first().evaluate((el) => {
          const style = window.getComputedStyle(el);
          return (
            Boolean(el.disabled) ||
            el.getAttribute('aria-disabled') === 'true' ||
            style.pointerEvents === 'none' ||
            (el.tagName === 'A' && (!el.getAttribute('href') || el.getAttribute('href') === '#')) ||
            el.classList.contains('disabled')
          );
        });
        assert.ok(
          firstPdfBlocked || /disabled|unavailable|offline|maintenance/i.test(pdfWidgetText),
          'Quick PDF shortcuts widget on / must reflect disabled pdfStudio state'
        );
      } finally {
        await staffCtx.close();
        await srv.stop();
      }
    });

    it('T2-R1-03: Staff navigating directly to /meeting/input.html sees notice and #submitBtn is disabled/blocked', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        await apiPostAction(
          srv.baseUrl,
          'UPDATE_SERVICE_TOGGLES',
          { serviceToggles: { departmentUpdate: { enabled: false, notice: 'Submission window closed' } } },
          auth.data.token
        );

        const page = await staffCtx.newPage();
        await page.goto(`${srv.baseUrl}/meeting/input.html`, { waitUntil: 'domcontentloaded' });
        await waitForCondition(async () => {
          const text = await page.locator('body').innerText();
          return /disabled|unavailable|closed/i.test(text);
        }, 4500, 150, 'disabled notice on /meeting/input.html');

        const btnDisabled = await page.locator('#submitBtn').isDisabled();
        const updateDisabled = await page.locator('#updateText').isDisabled();
        assert.ok(btnDisabled || updateDisabled, 'Expected #submitBtn or #updateText disabled when departmentUpdate is OFF');
      } finally {
        await staffCtx.close();
        await srv.stop();
      }
    });

    it('T2-R1-04: Staff navigating directly to /booking/ while roomBooking is disabled sees notice and cannot submit', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        await apiPostAction(
          srv.baseUrl,
          'UPDATE_SERVICE_TOGGLES',
          { serviceToggles: { roomBooking: { enabled: false, notice: 'Room booking suspended' } } },
          auth.data.token
        );

        const page = await staffCtx.newPage();
        await page.goto(`${srv.baseUrl}/booking/`, { waitUntil: 'domcontentloaded' });
        await waitForCondition(async () => {
          const text = await page.locator('body').innerText();
          return /disabled|unavailable|suspended/i.test(text);
        }, 4500, 150, 'disabled notice on /booking/');

        const ctaDisabled = await page.locator('button.nav-btn.primary-cta').isDisabled().catch(() => false);
        const submitDisabled = await page.locator('#btnSubmitBooking').isDisabled().catch(() => false);
        assert.ok(ctaDisabled || submitDisabled, 'Expected booking CTA or #btnSubmitBooking disabled when roomBooking is OFF');
      } finally {
        await staffCtx.close();
        await srv.stop();
      }
    });

    it('T2-R1-05: Staff navigating to /pdf/ and /pdf/?tool=merge while pdfStudio is disabled is blocked with notice', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        await apiPostAction(
          srv.baseUrl,
          'UPDATE_SERVICE_TOGGLES',
          { serviceToggles: { pdfStudio: { enabled: false, notice: 'PDF Studio offline for maintenance' } } },
          auth.data.token
        );

        const isWorkspaceActive = async (pg) => pg.evaluate(() => {
          const ws = document.getElementById('toolWorkspace');
          if (!ws) return false;
          const wsStyle = window.getComputedStyle(ws);
          if (
            wsStyle.display === 'none' ||
            wsStyle.visibility === 'hidden' ||
            wsStyle.pointerEvents === 'none' ||
            ws.hasAttribute('inert')
          ) {
            return false;
          }
          const dz = ws.querySelector('.dropzone');
          if (!dz) return false;
          const dzStyle = window.getComputedStyle(dz);
          if (
            dzStyle.display === 'none' ||
            dzStyle.visibility === 'hidden' ||
            dzStyle.pointerEvents === 'none' ||
            dz.getAttribute('aria-disabled') === 'true'
          ) {
            return false;
          }
          const inp = document.getElementById('mergeInput');
          if (inp && inp.disabled) return false;
          const rect = dz.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          if (hit && !dz.contains(hit)) return false;
          return true;
        });

        // (a) Deep-linked /pdf/?tool=merge must show disabled notice and NOT render an active/usable #toolWorkspace/.dropzone
        const page = await staffCtx.newPage();
        await page.goto(`${srv.baseUrl}/pdf/?tool=merge`, { waitUntil: 'domcontentloaded' });
        await waitForCondition(async () => {
          const text = await page.locator('body').innerText();
          return /disabled|unavailable|offline|maintenance/i.test(text);
        }, 4500, 150, 'disabled notice on /pdf/?tool=merge');

        assert.equal(
          await isWorkspaceActive(page),
          false,
          'Deep-linked #toolWorkspace/.dropzone must NOT be active or usable when pdfStudio is disabled'
        );

        // (b) /pdf/ grid view must show disabled notice, keep tool cards visible, and block opening #toolWorkspace/.dropzone
        await page.goto(`${srv.baseUrl}/pdf/`, { waitUntil: 'domcontentloaded' });
        await waitForCondition(async () => {
          const text = await page.locator('body').innerText();
          return /disabled|unavailable|offline|maintenance/i.test(text);
        }, 4500, 150, 'disabled notice on /pdf/');

        const mergeCard = page.locator('#toolGrid .tool-card, .tool-card').filter({ hasText: /Merge PDF/i }).first();
        await mergeCard.waitFor({ state: 'visible', timeout: 4000 });
        await mergeCard.click({ timeout: 1500 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 250));
        assert.equal(
          await isWorkspaceActive(page),
          false,
          'Clicking Merge PDF card on /pdf/ must NOT open an active #toolWorkspace/.dropzone while pdfStudio is disabled'
        );
      } finally {
        await staffCtx.close();
        await srv.stop();
      }
    });

    it('T2-R1-06: Staff on /display/?mode=share is blocked while screenShare is disabled and resumes when re-enabled', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl, mockDisplayMedia: true });
      try {
        await apiPostAction(
          srv.baseUrl,
          'UPDATE_SERVICE_TOGGLES',
          { serviceToggles: { screenShare: { enabled: false, notice: 'Casting disabled for board session' } } },
          auth.data.token
        );

        const page = await staffCtx.newPage();
        await page.goto(`${srv.baseUrl}/display/?mode=share`, { waitUntil: 'domcontentloaded' });
        await waitForCondition(async () => {
          const text = await page.locator('body').innerText();
          return /disabled|unavailable|board session/i.test(text);
        }, 4500, 150, 'disabled notice on /display/?mode=share');

        const startDisabled = await page.locator('#btnStartShare').isDisabled();
        assert.equal(startDisabled, true, '#btnStartShare must be disabled when screenShare is OFF');

        // Re-enable screenShare
        await apiPostAction(
          srv.baseUrl,
          'UPDATE_SERVICE_TOGGLES',
          { serviceToggles: { screenShare: { enabled: true, notice: '' } } },
          auth.data.token
        );

        await waitForCondition(async () => {
          return (await page.locator('#btnStartShare').isDisabled()) === false;
        }, 5000, 150, '#btnStartShare re-enabled after toggle restored');
      } finally {
        await staffCtx.close();
        await srv.stop();
      }
    });
  });

  // =========================================================================
  // R2: HQ Meeting Rooms Persistence (5 tests)
  // =========================================================================
  describe('R2: HQ Meeting Rooms Management & Persistence (5 tests)', () => {
    it('T2-R2-01: Admin adds custom room via /admin/ and it renders in #adminRoomsList and /booking/', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
        const adminPage = await adminCtx.newPage();
        await createRoomViaAdminUi(adminPage, srv.baseUrl, {
          name: 'Innovation War Room',
          floor: 'Level 3 - Digital Wing',
          capacity: 16,
          amenities: ['86" Interactive TV', 'Dual Mic']
        });

        await adminPage.locator('#adminRoomsList').getByText('Innovation War Room').waitFor({ state: 'visible', timeout: 4000 });

        const staffPage = await staffCtx.newPage();
        await staffPage.goto(`${srv.baseUrl}/booking/`, { waitUntil: 'domcontentloaded' });
        await staffPage.locator('#roomsDirectoryView').getByText('Innovation War Room').waitFor({ state: 'visible', timeout: 8000 });
        const optionsText = await staffPage.locator('#roomId').innerText();
        assert.ok(optionsText.includes('Innovation War Room'));
      } finally {
        await adminCtx.close();
        await staffCtx.close();
        await srv.stop();
      }
    });

    it('T2-R2-02: Admin edits room via /booking/ #roomManagerModal and updates appear on / and /booking/', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
        const adminPage = await adminCtx.newPage();
        await adminPage.goto(`${srv.baseUrl}/booking/`, { waitUntil: 'domcontentloaded' });
        await adminPage.locator('button:has-text("Manage Rooms")').first().click();
        await adminPage.locator('#roomManagerModal.open').waitFor({ state: 'visible', timeout: 4000 });

        // Click Edit on first room
        await adminPage.locator('#roomManagerList .btn-edit').first().click();
        await adminPage.locator('#cfgRoomName').fill('Boardroom Premier 75');
        await adminPage.locator('#cfgRoomFloor').fill('Level 2 - VIP Suite');
        await adminPage.locator('#cfgRoomCapacity').fill('26');
        await adminPage.locator('#cfgRoomAmenities').fill('98" Laser TV, Polycom Studio');
        await adminPage.locator('#btnSaveRoomConfig').click();

        await waitForCondition(async () => {
          const { data } = await apiGetData(srv.baseUrl);
          return (data.rooms || []).some((r) => r.name === 'Boardroom Premier 75' && r.capacity === 26);
        }, 5000, 150, 'updated room to persist');

        const staffPage = await staffCtx.newPage();
        await staffPage.goto(`${srv.baseUrl}/`, { waitUntil: 'domcontentloaded' });
        await staffPage.locator('#roomWidgetList').getByText('Boardroom Premier 75').waitFor({ state: 'visible', timeout: 8000 });
      } finally {
        await adminCtx.close();
        await staffCtx.close();
        await srv.stop();
      }
    });

    it('T2-R2-03: Maintenance room disables staff booking card button and shows maintenance conflict', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        const current = (await apiGetData(srv.baseUrl)).data;
        const rooms = current.rooms.map((r, idx) => (idx === 0 ? { ...r, status: 'maintenance' } : r));
        await apiPostAction(srv.baseUrl, 'SAVE_ROOMS', { rooms }, auth.data.token);

        const staffPage = await staffCtx.newPage();
        await staffPage.goto(`${srv.baseUrl}/booking/`, { waitUntil: 'domcontentloaded' });

        const firstCard = staffPage.locator('#roomsDirectoryView .room-card-item').first();
        await firstCard.waitFor({ state: 'visible', timeout: 8000 });
        await firstCard.getByText(/Under Maintenance/i).waitFor({ state: 'visible', timeout: 8000 });
        const bookBtn = firstCard.locator('.btn-card-book');
        assert.equal(await bookBtn.isDisabled(), true, 'Maintenance room Book button must be disabled');
      } finally {
        await staffCtx.close();
        await srv.stop();
      }
    });

    it('T2-R2-04: Admin removes custom room while system enforces >= 1 room minimum', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
        const page = await adminCtx.newPage();
        await page.goto(`${srv.baseUrl}/admin/`, { waitUntil: 'domcontentloaded' });

        // Accept confirm dialogs automatically
        page.on('dialog', (d) => d.accept());

        const initialCount = (await apiGetData(srv.baseUrl)).data.rooms.length;
        assert.ok(initialCount >= 2);

        // Remove rooms down to 1
        for (let i = 0; i < initialCount - 1; i++) {
          await page.locator('#adminRoomsList .btn-del').last().click();
          await waitForCondition(async () => {
            const { data } = await apiGetData(srv.baseUrl);
            return data.rooms.length === initialCount - 1 - i;
          }, 4500, 150, `rooms count to drop to ${initialCount - 1 - i}`);
        }

        // Try removing the very last room -> must stay at 1
        await page.locator('#adminRoomsList .btn-del').first().click();
        await new Promise((r) => setTimeout(r, 600));
        const after = (await apiGetData(srv.baseUrl)).data;
        assert.equal(after.rooms.length, 1, 'At least 1 meeting room must always remain');
      } finally {
        await adminCtx.close();
        await srv.stop();
      }
    });

    it('T2-R2-05: Custom room edits survive simulated git update of CCHSMeetingDashboard/data.json and server restart', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
        const adminPage = await adminCtx.newPage();
        await createRoomViaAdminUi(adminPage, srv.baseUrl, {
          name: 'Git-Resilient Clinical Hub',
          floor: 'Level 6 - West',
          capacity: 32,
          amenities: ['Dual 4K Screens', 'Zoom Room']
        });

        // Simulate git pull overwriting CCHSMeetingDashboard/data.json with default template
        srv.simulateGitUpdate({ overwriteSeedData: true });
        await srv.restart();

        const staffPage = await staffCtx.newPage();
        await staffPage.goto(`${srv.baseUrl}/booking/`, { waitUntil: 'domcontentloaded' });
        await staffPage.locator('#roomsDirectoryView').getByText('Git-Resilient Clinical Hub').waitFor({
          state: 'visible',
          timeout: 8000
        });
      } finally {
        await adminCtx.close();
        await staffCtx.close();
        await srv.stop();
      }
    });
  });

  // =========================================================================
  // R3: WhatsApp Confirmation UI & Encoding (5 tests)
  // =========================================================================
  describe('R3: WhatsApp Confirmation UI & Encoding (5 tests)', () => {
    it('T2-R3-01: Booking form #confirmedModal WhatsApp button has clean URL & zero U+FFFD', async () => {
      const srv = await startIsolatedServer();
      const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        const page = await staffCtx.newPage();
        const futureDate = getFutureIsoDate(3);
        await createBookingViaUi(page, srv.baseUrl, {
          roomId: 'boardroom-main',
          date: futureDate,
          startTime: '10:00',
          endTime: '11:00',
          title: 'Q4 Clinical Audit',
          department: 'CLINICAL GOVERNANCE',
          notes: 'Projector + HDMI',
          organizer: 'Dr. Lim',
          phone: '012-9876543',
          autoOutlook: false
        });

        await page.locator('#confirmedModal.open').waitFor({ state: 'visible', timeout: 5000 });
        const waHref = await page.locator('#btnModalWhatsApp').getAttribute('href');
        assertCleanWhatsAppUrl(waHref, {
          phone: '60129876543',
          roomName: 'HQ Main Boardroom',
          title: 'Q4 Clinical Audit',
          department: 'CLINICAL GOVERNANCE',
          date: futureDate,
          time: '10:00 – 11:00',
          notes: 'Projector + HDMI'
        });
      } finally {
        await staffCtx.close();
        await srv.stop();
      }
    });

    it('T2-R3-02: Agenda view and Booking Detail Popover WhatsApp links contain zero U+FFFD', async () => {
      const srv = await startIsolatedServer();
      const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        const futureDate = getFutureIsoDate(2);
        await apiPostAction(srv.baseUrl, 'ADD_BOOKING', {
          booking: {
            id: 'bk-agenda-wa-test',
            roomId: 'discussion-a',
            title: 'HR Onboarding Sync',
            department: 'HR',
            organizer: 'Siti',
            phone: '013-1122334',
            date: futureDate,
            startTime: '14:00',
            endTime: '15:00',
            notes: 'Welcome pack ready'
          }
        });

        const page = await staffCtx.newPage();
        await page.goto(`${srv.baseUrl}/booking/?view=agenda&date=${futureDate}`, { waitUntil: 'domcontentloaded' });
        const agendaWa = page.locator('#bookingsContainer .mini-action-btn.wa').first();
        await agendaWa.waitFor({ state: 'visible', timeout: 8500 });
        assertCleanWhatsAppUrl(await agendaWa.getAttribute('href'), {
          phone: '60131122334',
          title: 'HR Onboarding Sync',
          department: 'HR'
        });

        // Switch to timetable and click booked slot to verify popover WA link
        await page.locator('#tabBtnTimetable').click();
        await page.locator('.slot-booked-card', { hasText: 'HR Onboarding Sync' }).first().click();
        await page.locator('#bookingDetailPopover.open').waitFor({ state: 'visible', timeout: 4000 });
        const popoverWa = await page.locator('#bookingPopoverContent .mini-action-btn.wa').getAttribute('href');
        assertCleanWhatsAppUrl(popoverWa, {
          phone: '60131122334',
          title: 'HR Onboarding Sync'
        });
      } finally {
        await staffCtx.close();
        await srv.stop();
      }
    });

    it('T2-R3-03: Admin booking list (#adminBookingList) WhatsApp reminder link contains zero U+FFFD', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
        const page = await adminCtx.newPage();
        await page.goto(`${srv.baseUrl}/admin/`, { waitUntil: 'domcontentloaded' });

        const adminWa = page.locator('#adminBookingList a[href*="wa.me"]').first();
        await adminWa.waitFor({ state: 'visible', timeout: 4000 });
        const href = await adminWa.getAttribute('href');
        assertCleanWhatsAppUrl(href);
      } finally {
        await adminCtx.close();
        await srv.stop();
      }
    });

    it('T2-R3-04: Live due booking banner (#dueBookingBanner) WhatsApp link contains zero U+FFFD', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        const now = new Date();
        const totalMins = now.getHours() * 60 + now.getMinutes();
        const startM = Math.max(0, totalMins - 10);
        const endM = Math.min(23 * 60 + 59, Math.max(startM + 10, totalMins + 20));
        const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        const today = getTodayIsoDate();

        // Remove any seed bookings overlapping current time so our live test booking is deterministic
        const initial = (await apiGetData(srv.baseUrl)).data;
        for (const b of initial.bookings || []) {
          await apiPostAction(srv.baseUrl, 'DELETE_BOOKING', { bookingId: b.id }, auth.data.token);
        }

        await apiPostAction(srv.baseUrl, 'ADD_BOOKING', {
          booking: {
            id: 'bk-live-due-now',
            roomId: 'pod-telehealth',
            title: 'Live Telehealth Consult',
            department: 'PMI TEAM',
            organizer: 'Dr. Tan',
            phone: '017-2233445',
            date: today,
            startTime: fmt(startM),
            endTime: fmt(endM),
            notes: 'Urgent call'
          }
        });

        const page = await staffCtx.newPage();
        await page.goto(`${srv.baseUrl}/booking/`, { waitUntil: 'domcontentloaded' });
        await waitForCondition(async () => {
          const desc = await page.locator('#dueBannerDesc').innerText().catch(() => '');
          return desc.includes('Live Telehealth Consult');
        }, 8500, 150, '#dueBookingBanner for Live Telehealth Consult');
        const bannerWaHref = await page.locator('#dueBannerActions a[href*="wa.me"]').getAttribute('href');
        assertCleanWhatsAppUrl(bannerWaHref, {
          phone: '60172233445',
          title: 'Live Telehealth Consult',
          department: 'PMI TEAM'
        });
      } finally {
        await staffCtx.close();
        await srv.stop();
      }
    });

    it('T2-R3-05: Confirmation modal copy-message/WhatsApp & Outlook .ics/365 actions remain functional and U+FFFD-free', async () => {
      const srv = await startIsolatedServer();
      const staffCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        const page = await staffCtx.newPage();
        const futureDate = getFutureIsoDate(5);
        await createBookingViaUi(page, srv.baseUrl, {
          roomId: 'discussion-b',
          date: futureDate,
          startTime: '15:00',
          endTime: '16:00',
          title: 'Finance Budget Signoff',
          department: 'FINANCE',
          organizer: 'Hafiz',
          phone: '014-5566778',
          autoOutlook: false
        });

        await page.locator('#confirmedModal.open').waitFor({ state: 'visible', timeout: 5000 });
        const outlookHref = await page.locator('#btnModalOutlook365').getAttribute('href');
        assert.ok(outlookHref && outlookHref.includes('outlook.office.com'), 'Expected Outlook 365 deeplink');

        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 4000 }),
          page.locator('#btnModalOutlookIcs').click()
        ]);
        assert.match(download.suggestedFilename(), /\.ics$/i);

        // Verify clean message text via Copy button if rendered, or buildWhatsAppBookingMessage
        const copyBtn = page.locator('#confirmedModal button, #confirmedModal a').filter({ hasText: /copy/i }).first();
        if ((await copyBtn.count()) > 0) {
          await copyBtn.click().catch(() => {});
        }
        const msg = await page.evaluate(async (d) => {
          const mod = await import('/shared/cloud-store.js');
          return typeof mod.buildWhatsAppBookingMessage === 'function'
            ? mod.buildWhatsAppBookingMessage(
                {
                  roomId: 'discussion-b',
                  title: 'Finance Budget Signoff',
                  department: 'FINANCE',
                  date: d,
                  startTime: '15:00',
                  endTime: '16:00'
                },
                { id: 'discussion-b', name: 'Discussion Room B (Clinical)', floor: 'Level 1' },
                'confirmed'
              )
            : null;
        }, futureDate);
        assert.ok(msg, 'Expected buildWhatsAppBookingMessage helper');
        assertCleanWhatsAppText(msg, { title: 'Finance Budget Signoff', department: 'FINANCE' });
      } finally {
        await staffCtx.close();
        await srv.stop();
      }
    });
  });

  // =========================================================================
  // R4: TV Display Remote Slide Control Boundary & Edge Cases (7 tests)
  // =========================================================================
  describe('R4: TV Display Remote Slide Control Boundary & Edge Cases (7 tests)', () => {
    it('T2-R4-01: Clamps prev at slide 0 and next at last slide (N - 1) without wrap or overflow', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      const tvCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl, viewport: { width: 1280, height: 720 } });
      try {
        await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
        const adminPage = await adminCtx.newPage();
        const tvPage = await tvCtx.newPage();

        await tvPage.goto(`${srv.baseUrl}/meeting/`, { waitUntil: 'domcontentloaded' });
        await adminPage.goto(`${srv.baseUrl}/display/`, { waitUntil: 'domcontentloaded' });
        await tvPage.locator('#slide-indicator').waitFor({ state: 'visible', timeout: 5000 });

        const controls = await getRemoteSlideControls(adminPage);
        const seqBeforePrev = Number((await apiGetData(srv.baseUrl)).data?.remoteDisplay?.slideControl?.commandSeq || 0);
        await controls.prevBtn.click();
        await waitForCondition(async () => {
          const sc = (await apiGetData(srv.baseUrl)).data?.remoteDisplay?.slideControl;
          return sc && Number(sc.commandSeq || 0) > seqBeforePrev;
        }, 5000, 150, 'commandSeq to increment on prevBtn at slide 0');
        await new Promise((r) => setTimeout(r, 1800));
        const afterPrevSc = (await apiGetData(srv.baseUrl)).data?.remoteDisplay?.slideControl;
        assert.equal(afterPrevSc?.currentSlideIndex, 0, 'currentSlideIndex must stay clamped at 0');
        const atZero = await tvPage.locator('#slide-indicator').innerText();
        assert.match(atZero, /^1\s*\/\s*\d+$/);

        const totalOptions = await controls.slideSelect.locator('option').count();
        assert.ok(totalOptions >= 5, `Expected >= 5 slide options, got ${totalOptions}`);
        const lastVal = await controls.slideSelect.locator('option').nth(totalOptions - 1).getAttribute('value');
        await controls.slideSelect.selectOption(lastVal);

        await waitForCondition(async () => {
          const txt = await tvPage.locator('#slide-indicator').innerText();
          return txt.startsWith(`${totalOptions} /`);
        }, 5000, 150, 'TV to reach last slide');

        const seqBeforeNext = Number((await apiGetData(srv.baseUrl)).data?.remoteDisplay?.slideControl?.commandSeq || 0);
        await controls.nextBtn.click();
        await waitForCondition(async () => {
          const sc = (await apiGetData(srv.baseUrl)).data?.remoteDisplay?.slideControl;
          return sc && Number(sc.commandSeq || 0) > seqBeforeNext;
        }, 5000, 150, 'commandSeq to increment on nextBtn at last slide');
        await new Promise((r) => setTimeout(r, 1800));
        const afterNextSc = (await apiGetData(srv.baseUrl)).data?.remoteDisplay?.slideControl;
        assert.equal(afterNextSc?.currentSlideIndex, totalOptions - 1, `currentSlideIndex must stay clamped at ${totalOptions - 1}`);
        const stillLast = await tvPage.locator('#slide-indicator').innerText();
        assert.equal(stillLast, `${totalOptions} / ${totalOptions}`);
      } finally {
        await adminCtx.close();
        await tvCtx.close();
        await srv.stop();
      }
    });

    it('T2-R4-02: Out-of-range and malformed goto indices never return 500 and clamp within [0, totalSlides - 1]', async () => {
      const srv = await startIsolatedServer();
      try {
        const auth = await loginViaApi(srv.baseUrl);
        const token = auth.data.token;

        const neg = await apiPostAction(srv.baseUrl, 'SLIDE_COMMAND', { command: 'goto', slideIndex: -10 }, token);
        assert.ok([200, 400].includes(neg.status), `Expected 200 or 400, got ${neg.status}`);
        if (neg.status === 200) {
          assert.equal(neg.data?.state?.remoteDisplay?.slideControl?.currentSlideIndex, 0);
        }

        const huge = await apiPostAction(srv.baseUrl, 'SLIDE_COMMAND', { command: 'goto', slideIndex: 9999 }, token);
        assert.ok([200, 400].includes(huge.status), `Expected 200 or 400, got ${huge.status}`);
        if (huge.status === 200) {
          const sc = huge.data?.state?.remoteDisplay?.slideControl;
          assert.ok(sc.currentSlideIndex >= 0 && sc.currentSlideIndex < sc.totalSlides);
        }

        const strIdx = await apiPostAction(srv.baseUrl, 'SLIDE_COMMAND', { command: 'goto', slideIndex: 'abc' }, token);
        assert.ok(strIdx.status !== 500, 'Malformed slideIndex must never cause HTTP 500');
        const check = (await apiGetData(srv.baseUrl)).data?.remoteDisplay?.slideControl;
        assert.ok(check && Number.isInteger(check.currentSlideIndex), 'slideControl.currentSlideIndex must remain a valid integer');
      } finally {
        await srv.stop();
      }
    });

    it('T2-R4-03: Unauthenticated and tampered-token SLIDE_COMMAND are rejected with 401/403', async () => {
      const srv = await startIsolatedServer();
      try {
        const before = (await apiGetData(srv.baseUrl)).data?.remoteDisplay?.slideControl;
        assert.ok(before, 'Expected slideControl in initial /api/data');

        const noAuth = await apiPostAction(srv.baseUrl, 'SLIDE_COMMAND', { command: 'next' });
        assert.ok([401, 403].includes(noAuth.status), `Expected 401/403 without auth, got ${noAuth.status}`);

        const badAuth = await apiPostAction(
          srv.baseUrl,
          'SLIDE_COMMAND',
          { command: 'next' },
          `${Buffer.from('admin').toString('base64')}.badsignature`
        );
        assert.ok([401, 403].includes(badAuth.status), `Expected 401/403 with tampered token, got ${badAuth.status}`);

        const after = (await apiGetData(srv.baseUrl)).data?.remoteDisplay?.slideControl;
        assert.equal(after.currentSlideIndex, before.currentSlideIndex);
        assert.equal(after.commandSeq, before.commandSeq);
      } finally {
        await srv.stop();
      }
    });

    it('T2-R4-04: Rapid burst SLIDE_COMMAND sequence converges monotonically and resists stale polls', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const tvCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl, viewport: { width: 1280, height: 720 } });
      try {
        const tvPage = await tvCtx.newPage();
        await tvPage.goto(`${srv.baseUrl}/meeting/`, { waitUntil: 'domcontentloaded' });
        await tvPage.locator('#slide-indicator').waitFor({ state: 'visible', timeout: 5000 });

        const token = auth.data.token;
        const cmds = [
          { command: 'next' },
          { command: 'next' },
          { command: 'goto', slideIndex: 5 },
          { command: 'next' },
          { command: 'pause' },
          { command: 'goto', slideIndex: 3 }
        ];
        let prevSeq = 0;
        for (const c of cmds) {
          const r = await apiPostAction(srv.baseUrl, 'SLIDE_COMMAND', c, token);
          assert.equal(r.status, 200);
          const seq = r.data?.state?.remoteDisplay?.slideControl?.commandSeq;
          assert.ok(seq > prevSeq, `Expected monotonic commandSeq (${seq} > ${prevSeq})`);
          prevSeq = seq;
        }

        await waitForCondition(async () => {
          const txt = await tvPage.locator('#slide-indicator').innerText();
          return /^4\s*\//.test(txt);
        }, 5000, 150, 'TV to converge to slide index 3 (4 / N)');

        // Wait through a subsequent poll cycle to ensure it doesn't revert
        await new Promise((r) => setTimeout(r, 2000));
        const settled = await tvPage.locator('#slide-indicator').innerText();
        assert.match(settled, /^4\s*\//);
      } finally {
        await tvCtx.close();
        await srv.stop();
      }
    });

    it('T2-R4-05: 1.5s polling does NOT wipe #slides-container DOM when unchanged, and ?preview=1 is passive', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const tvCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl, viewport: { width: 1280, height: 720 } });
      const previewCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        const tvPage = await tvCtx.newPage();
        await tvPage.goto(`${srv.baseUrl}/meeting/`, { waitUntil: 'domcontentloaded' });
        await tvPage.locator('#slides-container .slide').first().waitFor({ state: 'visible', timeout: 5000 });

        // Attach a DOM marker attribute inside #slides-container
        await tvPage.locator('#slides-container .slide').first().evaluate((el) => {
          el.setAttribute('data-e2e-dom-stable', 'yes');
        });

        // Wait across >2 poll cycles (3.5s) with no state changes
        await new Promise((r) => setTimeout(r, 3500));
        const markerAfterPolls = await tvPage
          .locator('#slides-container .slide')
          .first()
          .getAttribute('data-e2e-dom-stable');
        assert.equal(markerAfterPolls, 'yes', '1.5s poll must NOT wipe #slides-container DOM when state is unchanged');

        // Verify ?preview=1 follows remote slide commands passively without triggering reload on refresh
        const previewPage = await previewCtx.newPage();
        await previewPage.goto(`${srv.baseUrl}/meeting/index.html?preview=1`, { waitUntil: 'domcontentloaded' });
        await previewPage.locator('#slide-indicator').waitFor({ state: 'visible', timeout: 5000 });
        await previewPage.evaluate(() => { window.__previewAlive = true; });

        await apiPostAction(srv.baseUrl, 'SLIDE_COMMAND', { command: 'goto', slideIndex: 2 }, auth.data.token);
        await waitForCondition(async () => {
          const txt = await previewPage.locator('#slide-indicator').innerText();
          return /^3\s*\//.test(txt);
        }, 5000, 150, '?preview=1 to follow goto(2)');

        await apiPostAction(srv.baseUrl, 'SLIDE_COMMAND', { command: 'refresh' }, auth.data.token);
        await new Promise((r) => setTimeout(r, 2500));
        assert.equal(
          await previewPage.evaluate(() => window.__previewAlive),
          true,
          '?preview=1 must ignore refresh commands and never reload'
        );
      } finally {
        await tvCtx.close();
        await previewCtx.close();
        await srv.stop();
      }
    });

    it('T2-R4-06: Dynamic slide count change clamps shrinking last-slide index cleanly without blank viewport', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      const tvCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl, viewport: { width: 1280, height: 720 } });
      try {
        await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
        const adminPage = await adminCtx.newPage();
        const tvPage = await tvCtx.newPage();

        await tvPage.goto(`${srv.baseUrl}/meeting/`, { waitUntil: 'domcontentloaded' });
        await adminPage.goto(`${srv.baseUrl}/meeting/admin.html`, { waitUntil: 'domcontentloaded' });
        await tvPage.locator('#slide-indicator').waitFor({ state: 'visible', timeout: 5000 });

        // Enable Q&A slides to expand deck
        await adminPage.locator('#showQnA').check();
        await adminPage.locator('button:has-text("Save")').first().click();

        let expandedTotal = 0;
        await waitForCondition(async () => {
          const txt = await tvPage.locator('#slide-indicator').innerText();
          const m = txt.match(/\/\s*(\d+)$/);
          if (m && Number(m[1]) > 25) {
            expandedTotal = Number(m[1]);
            return true;
          }
          return false;
        }, 5000, 150, 'deck to expand with Q&A slides');

        // Jump TV to last slide
        await apiPostAction(
          srv.baseUrl,
          'SLIDE_COMMAND',
          { command: 'goto', slideIndex: expandedTotal - 1 },
          auth.data.token
        );
        await waitForCondition(async () => {
          const txt = await tvPage.locator('#slide-indicator').innerText();
          return txt === `${expandedTotal} / ${expandedTotal}`;
        }, 5000, 150, 'TV to jump to last expanded slide');

        // Disable Q&A slides to shrink deck
        await adminPage.locator('#showQnA').uncheck();
        await adminPage.locator('button:has-text("Save")').first().click();

        await waitForCondition(async () => {
          const txt = await tvPage.locator('#slide-indicator').innerText();
          const m = txt.match(/^(\d+)\s*\/\s*(\d+)$/);
          if (!m) return false;
          const cur = Number(m[1]);
          const tot = Number(m[2]);
          return tot < expandedTotal && cur >= 1 && cur <= tot;
        }, 5000, 150, 'TV currentSlideIndex to clamp cleanly when deck shrinks');
      } finally {
        await adminCtx.close();
        await tvCtx.close();
        await srv.stop();
      }
    });

    it('T2-R4-07: Channel switch round-trip (meeting-tv -> welcome-board -> meeting-tv) restores slide index', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      const tvCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl, viewport: { width: 1280, height: 720 } });
      try {
        await apiPostAction(srv.baseUrl, 'SLIDE_COMMAND', { command: 'goto', slideIndex: 4 }, auth.data.token);

        await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
        const adminPage = await adminCtx.newPage();
        const tvPage = await tvCtx.newPage();

        await tvPage.goto(`${srv.baseUrl}/display/?mode=receiver`, { waitUntil: 'domcontentloaded' });
        await adminPage.goto(`${srv.baseUrl}/display/`, { waitUntil: 'domcontentloaded' });

        const tvFrame = getTvMeetingFrame(tvPage);
        await waitForCondition(async () => {
          const txt = await tvFrame.locator('#slide-indicator').innerText().catch(() => '');
          return /^5\s*\//.test(txt);
        }, 5000, 150, 'TV initially at slide 5');

        await adminPage.locator('.mode-btn[data-mode="welcome-board"]').click();
        await tvPage.locator('#receiverViewport').getByText(/WELCOME TO HQ/i).waitFor({ state: 'visible', timeout: 5000 });

        await adminPage.locator('.mode-btn[data-mode="meeting-tv"]').click();
        await waitForCondition(async () => {
          const txt = await tvFrame.locator('#slide-indicator').innerText().catch(() => '');
          return /^5\s*\//.test(txt);
        }, 5000, 150, 'TV restored to slide 5 after channel round-trip');
      } finally {
        await adminCtx.close();
        await tvCtx.close();
        await srv.stop();
      }
    });
  });

  // =========================================================================
  // Portal Stability (5 tests)
  // =========================================================================
  describe('Portal Stability & Error Handling (5 tests)', () => {
    it('T2-STAB-01: Unauthenticated /admin/ redirects cleanly to /login.html with zero pageerror/console.error', async () => {
      const srv = await startIsolatedServer();
      const ctx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        const page = await ctx.newPage();
        await page.goto(`${srv.baseUrl}/admin/`, { waitUntil: 'domcontentloaded' });
        await page.waitForURL((u) => u.pathname.endsWith('/login.html'), { timeout: 5000 });
        assert.ok(page.url().includes('redirect=%2Fadmin%2F'));
        const errs = ctx.getAllStabilityErrors();
        assert.deepEqual(errs.pageerrors, [], `Unexpected pageerrors: ${errs.pageerrors.join('; ')}`);
        assert.deepEqual(errs.consoleErrors, [], `Unexpected console.errors: ${errs.consoleErrors.join('; ')}`);
      } finally {
        await ctx.close();
        await srv.stop();
      }
    });

    it('T2-STAB-02: Unauthenticated /meeting/admin.html redirects cleanly to /login.html with zero pageerror/console.error', async () => {
      const srv = await startIsolatedServer();
      const ctx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        const page = await ctx.newPage();
        await page.goto(`${srv.baseUrl}/meeting/admin.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForURL((u) => u.pathname.endsWith('/login.html'), { timeout: 5000 });
        assert.ok(page.url().includes('redirect=%2Fmeeting%2Fadmin.html'));
        const errs = ctx.getAllStabilityErrors();
        assert.deepEqual(errs.pageerrors, [], `Unexpected pageerrors: ${errs.pageerrors.join('; ')}`);
        assert.deepEqual(errs.consoleErrors, [], `Unexpected console.errors: ${errs.consoleErrors.join('; ')}`);
      } finally {
        await ctx.close();
        await srv.stop();
      }
    });

    it('T2-STAB-03: Unauthenticated /display/ redirects cleanly to /login.html with zero pageerror/console.error', async () => {
      const srv = await startIsolatedServer();
      const ctx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        const page = await ctx.newPage();
        await page.goto(`${srv.baseUrl}/display/`, { waitUntil: 'domcontentloaded' });
        await page.waitForURL((u) => u.pathname.endsWith('/login.html'), { timeout: 5000 });
        assert.ok(page.url().includes('redirect=%2Fdisplay%2F'));
        const errs = ctx.getAllStabilityErrors();
        assert.deepEqual(errs.pageerrors, [], `Unexpected pageerrors: ${errs.pageerrors.join('; ')}`);
        assert.deepEqual(errs.consoleErrors, [], `Unexpected console.errors: ${errs.consoleErrors.join('; ')}`);
      } finally {
        await ctx.close();
        await srv.stop();
      }
    });

    it('T2-STAB-04: Public/staff portal routes load with zero pageerror, zero console.error, and zero 5xx', async () => {
      const srv = await startIsolatedServer();
      const ctx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        const page = await ctx.newPage();
        const staffRoutes = [
          '/',
          '/login.html',
          '/meeting/',
          '/meeting/input.html',
          '/booking/',
          '/display/?mode=share',
          '/display/?mode=receiver',
          '/pdf/'
        ];
        for (const r of staffRoutes) {
          await page.goto(`${srv.baseUrl}${r}`, { waitUntil: 'networkidle' }).catch(async () => {
            await page.goto(`${srv.baseUrl}${r}`, { waitUntil: 'domcontentloaded' });
          });
          await new Promise((res) => setTimeout(res, 250));
        }
        const errs = ctx.getAllStabilityErrors();
        assert.deepEqual(errs.pageerrors, [], `Unexpected pageerrors: ${errs.pageerrors.join('; ')}`);
        assert.deepEqual(errs.consoleErrors, [], `Unexpected consoleErrors: ${errs.consoleErrors.join('; ')}`);
        assert.deepEqual(errs.server5xx, [], `Unexpected 5xx responses: ${errs.server5xx.join('; ')}`);
      } finally {
        await ctx.close();
        await srv.stop();
      }
    });

    it('T2-STAB-05: BentoPDF handles corrupt/invalid PDF bytes cleanly in #toolStatus with zero uncaught pageerror', async () => {
      const srv = await startIsolatedServer();
      const ctx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        const page = await ctx.newPage();
        const corruptFile = {
          name: 'corrupt-input.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4\nINVALID_CORRUPT_PAYLOAD_FOR_E2E', 'utf8')
        };

        const cases = [
          { tool: 'rotate', input: '#rotInput', btn: '#btnRunRot' },
          { tool: 'watermark', input: '#wmInput', btn: '#btnRunWm' },
          { tool: 'pagenumbers', input: '#pnInput', btn: '#btnRunPn' },
          { tool: 'compress', input: '#cmpInput', btn: '#btnRunCmp' },
          { tool: 'metadata', input: '#metaInput', btn: '#btnRunMeta' }
        ];

        for (const tc of cases) {
          await page.goto(`${srv.baseUrl}/pdf/?tool=${tc.tool}`, { waitUntil: 'domcontentloaded' });
          await page.locator(tc.input).setInputFiles(corruptFile);
          await new Promise((r) => setTimeout(r, 250));
          const btn = page.locator(tc.btn);
          if ((await btn.isVisible()) && !(await btn.isDisabled())) {
            await btn.click();
          }
          await page.locator('#toolStatus').waitFor({ state: 'visible', timeout: 4000 });
          const statusText = await page.locator('#toolStatus').innerText();
          assert.ok(statusText.trim().length > 0, `Expected non-empty error banner in #toolStatus for ${tc.tool}`);
        }

        const errs = ctx.getAllStabilityErrors();
        assert.deepEqual(errs.pageerrors, [], `Expected zero uncaught pageerrors in BentoPDF, got: ${errs.pageerrors.join('; ')}`);
      } finally {
        await ctx.close();
        await srv.stop();
      }
    });
  });
});
