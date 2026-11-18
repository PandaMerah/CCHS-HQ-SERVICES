const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { launchBrowser, createIsolatedContext } = require('./helpers/playwright-loader.js');
const { REPO_ROOT, startIsolatedServer } = require('./helpers/server-harness.js');
const {
  SERVICE_KEYS,
  loginViaApi,
  injectAdminSession,
  apiGetData,
  apiPostAction,
  apiPostRaw,
  assertCleanWhatsAppText,
  assertCleanWhatsAppUrl,
  waitForCondition,
  getTvMeetingFrame,
  getRemoteSlideControls,
  getFutureIsoDate
} = require('./helpers/auth-api.js');

describe('Tier 1 — Core Feature Coverage (26 tests)', { timeout: 120000 }, () => {
  let browser;

  before(async () => {
    browser = await launchBrowser();
  });

  after(async () => {
    if (browser) await browser.close();
  });

  // =========================================================================
  // R1: Admin Service & Tool Toggles (5 tests)
  // =========================================================================
  describe('R1: Admin Service & Tool Toggles (5 tests)', () => {
    it('T1-R1-01: GET /api/data returns default serviceToggles with all 4 services enabled', async () => {
      const srv = await startIsolatedServer();
      try {
        const { status, data } = await apiGetData(srv.baseUrl);
        assert.equal(status, 200);
        const toggles = data?.config?.serviceToggles;
        assert.ok(toggles && typeof toggles === 'object', 'Expected state.config.serviceToggles object');
        for (const key of SERVICE_KEYS) {
          assert.ok(toggles[key] && typeof toggles[key] === 'object', `Missing serviceToggles.${key}`);
          assert.equal(toggles[key].enabled, true, `Expected ${key} enabled by default`);
        }
        srv.assertNoUncaughtServerErrors();
      } finally {
        await srv.stop();
      }
    });

    it('T1-R1-02: UPDATE_SERVICE_TOGGLES rejects unauthenticated and forged tokens with 401/403', async () => {
      const srv = await startIsolatedServer();
      try {
        const noAuth = await apiPostAction(srv.baseUrl, 'UPDATE_SERVICE_TOGGLES', {
          serviceToggles: { roomBooking: { enabled: false, notice: 'Maintenance' } }
        });
        assert.ok([401, 403].includes(noAuth.status), `Expected 401/403 without token, got ${noAuth.status}`);

        const forgedToken = `${Buffer.from('admin').toString('base64')}.deadbeefdeadbeef`;
        const badAuth = await apiPostAction(
          srv.baseUrl,
          'UPDATE_SERVICE_TOGGLES',
          { serviceToggles: { roomBooking: { enabled: false, notice: 'Maintenance' } } },
          forgedToken
        );
        assert.ok([401, 403].includes(badAuth.status), `Expected 401/403 with forged token, got ${badAuth.status}`);

        const { data } = await apiGetData(srv.baseUrl);
        if (data?.config?.serviceToggles?.roomBooking) {
          assert.equal(data.config.serviceToggles.roomBooking.enabled, true);
        }
      } finally {
        await srv.stop();
      }
    });

    it('T1-R1-03: Authenticated UPDATE_SERVICE_TOGGLES persists to runtime state across server restart', async () => {
      const srv = await startIsolatedServer();
      try {
        const auth = await loginViaApi(srv.baseUrl);
        assert.equal(auth.status, 200);
        assert.ok(auth.data?.token);

        const res = await apiPostAction(
          srv.baseUrl,
          'UPDATE_SERVICE_TOGGLES',
          {
            serviceToggles: {
              departmentUpdate: { enabled: false, notice: 'Closed for review' },
              roomBooking: { enabled: true, notice: '' },
              screenShare: { enabled: false, notice: 'Upgrade in progress' },
              pdfStudio: { enabled: true, notice: '' }
            }
          },
          auth.data.token
        );
        assert.equal(res.status, 200);
        assert.equal(res.data?.state?.config?.serviceToggles?.departmentUpdate?.enabled, false);
        assert.equal(res.data?.state?.config?.serviceToggles?.screenShare?.enabled, false);

        const onDisk = srv.readRuntimeState();
        assert.ok(onDisk, 'Expected CCHS_RUNTIME_STATE_PATH file on disk');
        assert.equal(onDisk?.config?.serviceToggles?.departmentUpdate?.enabled, false);

        await srv.restart();
        const afterRestart = await apiGetData(srv.baseUrl);
        assert.equal(afterRestart.data?.config?.serviceToggles?.departmentUpdate?.enabled, false);
        assert.equal(afterRestart.data?.config?.serviceToggles?.departmentUpdate?.notice, 'Closed for review');
        assert.equal(afterRestart.data?.config?.serviceToggles?.screenShare?.enabled, false);
        assert.equal(afterRestart.data?.config?.serviceToggles?.roomBooking?.enabled, true);
      } finally {
        await srv.stop();
      }
    });

    it('T1-R1-04: Non-admin writes return HTTP 403 SERVICE_DISABLED when service toggle is false', async () => {
      const srv = await startIsolatedServer();
      try {
        const auth = await loginViaApi(srv.baseUrl);
        const toggleRes = await apiPostAction(
          srv.baseUrl,
          'UPDATE_SERVICE_TOGGLES',
          {
            serviceToggles: {
              departmentUpdate: { enabled: false, notice: 'Dept updates paused' },
              roomBooking: { enabled: false, notice: 'Bookings paused' },
              screenShare: { enabled: false, notice: 'Screen share paused' },
              pdfStudio: { enabled: false, notice: 'PDF paused' }
            }
          },
          auth.data.token
        );
        assert.equal(toggleRes.status, 200);

        const futureDate = getFutureIsoDate(3);
        const bookRes = await apiPostAction(srv.baseUrl, 'ADD_BOOKING', {
          booking: {
            id: 'bk-disabled-test',
            roomId: 'boardroom-main',
            title: 'Should Be Blocked',
            department: 'IT',
            organizer: 'Staff',
            date: futureDate,
            startTime: '10:00',
            endTime: '11:00'
          }
        });
        assert.equal(bookRes.status, 403);
        assert.equal(bookRes.data?.code, 'SERVICE_DISABLED');
        assert.equal(bookRes.data?.service, 'roomBooking');

        const shareRes = await apiPostAction(srv.baseUrl, 'REGISTER_PRESENTER', {
          presenter: { id: 'pres-blocked', name: 'Staff', department: 'IT', title: 'Blocked' }
        });
        assert.equal(shareRes.status, 403);
        assert.equal(shareRes.data?.code, 'SERVICE_DISABLED');
        assert.equal(shareRes.data?.service, 'screenShare');

        const updatePresRes = await apiPostAction(srv.baseUrl, 'UPDATE_PRESENTER', {
          presenterId: 'pres-blocked',
          patch: { previewFrame: 'data:image/png;base64,AA==' }
        });
        assert.equal(updatePresRes.status, 403);
        assert.equal(updatePresRes.data?.code, 'SERVICE_DISABLED');
        assert.equal(updatePresRes.data?.service, 'screenShare');

        const deptRes = await apiPostAction(srv.baseUrl, 'SUBMIT_DEPARTMENT_UPDATE', {
          department: 'IT',
          updateText: 'Blocked dept update',
          questionText: 'Blocked question'
        });
        assert.equal(deptRes.status, 403);
        assert.equal(deptRes.data?.code, 'SERVICE_DISABLED');
      } finally {
        await srv.stop();
      }
    });

    it('T1-R1-05: Admin retains access when disabled and re-enabling restores non-admin writes', async () => {
      const srv = await startIsolatedServer();
      try {
        const auth = await loginViaApi(srv.baseUrl);
        const token = auth.data.token;
        const futureDate = getFutureIsoDate(4);

        await apiPostAction(
          srv.baseUrl,
          'UPDATE_SERVICE_TOGGLES',
          {
            serviceToggles: {
              departmentUpdate: { enabled: false },
              roomBooking: { enabled: false },
              screenShare: { enabled: false },
              pdfStudio: { enabled: false }
            }
          },
          token
        );

        // Admin booking succeeds even while disabled for staff
        const adminBook = await apiPostAction(
          srv.baseUrl,
          'ADD_BOOKING',
          {
            booking: {
              id: 'bk-admin-bypass',
              roomId: 'boardroom-main',
              title: 'Admin Emergency Meeting',
              department: 'CEO OFFICE',
              organizer: 'Admin',
              date: futureDate,
              startTime: '09:00',
              endTime: '10:00'
            }
          },
          token
        );
        assert.equal(adminBook.status, 200);

        // Re-enable roomBooking
        const reenable = await apiPostAction(
          srv.baseUrl,
          'UPDATE_SERVICE_TOGGLES',
          {
            serviceToggles: {
              departmentUpdate: { enabled: true },
              roomBooking: { enabled: true },
              screenShare: { enabled: true },
              pdfStudio: { enabled: true }
            }
          },
          token
        );
        assert.equal(reenable.status, 200);

        // Staff booking now succeeds
        const staffBook = await apiPostAction(srv.baseUrl, 'ADD_BOOKING', {
          booking: {
            id: 'bk-staff-restored',
            roomId: 'boardroom-main',
            title: 'Staff Sync After Re-enable',
            department: 'IT',
            organizer: 'Staff User',
            date: futureDate,
            startTime: '11:00',
            endTime: '12:00'
          }
        });
        assert.equal(staffBook.status, 200);
      } finally {
        await srv.stop();
      }
    });
  });

  // =========================================================================
  // R2: HQ Meeting Rooms Persistence (5 tests)
  // =========================================================================
  describe('R2: HQ Meeting Rooms Persistence (5 tests)', () => {
    it('T1-R2-01: SAVE_ROOMS with valid admin token persists custom rooms to CCHS_RUNTIME_STATE_PATH', async () => {
      const srv = await startIsolatedServer();
      try {
        const auth = await loginViaApi(srv.baseUrl);
        const customRooms = [
          {
            id: 'exec-suite-75',
            name: 'Executive Suite 75',
            floor: 'Level 3 - Penthouse',
            capacity: 28,
            amenities: ['85" 4K Display', 'Teams Room'],
            color: '#1863dc',
            status: 'available'
          }
        ];

        const res = await apiPostAction(srv.baseUrl, 'SAVE_ROOMS', { rooms: customRooms }, auth.data.token);
        assert.equal(res.status, 200);
        assert.equal(res.data?.state?.rooms?.length, 1);
        assert.equal(res.data?.state?.rooms?.[0]?.name, 'Executive Suite 75');

        const runtime = srv.readRuntimeState();
        assert.ok(runtime, 'Expected runtime-state.json to be written');
        assert.equal(runtime.rooms?.[0]?.name, 'Executive Suite 75');
      } finally {
        await srv.stop();
      }
    });

    it('T1-R2-02: SAVE_ROOMS without valid admin token is rejected with 401/403', async () => {
      const srv = await startIsolatedServer();
      try {
        const res = await apiPostAction(srv.baseUrl, 'SAVE_ROOMS', {
          rooms: [{ id: 'hacked', name: 'Hacked Room', floor: 'X', capacity: 1, amenities: [] }]
        });
        assert.ok([401, 403].includes(res.status), `Expected 401/403 for unauthenticated SAVE_ROOMS, got ${res.status}`);

        const { data } = await apiGetData(srv.baseUrl);
        assert.ok(!data.rooms.some((r) => r.id === 'hacked'));
      } finally {
        await srv.stop();
      }
    });

    it('T1-R2-03: CCHSMeetingDashboard/data.json is NEVER mutated at runtime after SAVE_ROOMS and ADD_BOOKING', async () => {
      const srv = await startIsolatedServer();
      try {
        const beforeWsHash = srv.getSeedHash();
        const beforeRepoHash = srv.getRepoSeedHash();
        const auth = await loginViaApi(srv.baseUrl);

        const saveRes = await apiPostAction(
          srv.baseUrl,
          'SAVE_ROOMS',
          {
            rooms: [
              {
                id: 'boardroom-main',
                name: 'Renamed Boardroom Alpha',
                floor: 'Level 5',
                capacity: 30,
                amenities: ['LED Wall'],
                color: '#1863dc',
                status: 'available'
              }
            ]
          },
          auth.data.token
        );
        assert.equal(saveRes.status, 200);

        const bookRes = await apiPostAction(srv.baseUrl, 'ADD_BOOKING', {
          booking: {
            id: 'bk-seed-immutability',
            roomId: 'boardroom-main',
            title: 'Immutability Check',
            department: 'IT',
            organizer: 'Tester',
            date: getFutureIsoDate(2),
            startTime: '10:00',
            endTime: '11:00'
          }
        });
        assert.equal(bookRes.status, 200);

        assert.equal(srv.getSeedHash(), beforeWsHash, 'Workspace CCHSMeetingDashboard/data.json must NEVER be mutated at runtime');
        assert.equal(srv.getRepoSeedHash(), beforeRepoHash, 'Repo CCHSMeetingDashboard/data.json must NEVER be mutated');
      } finally {
        await srv.stop();
      }
    });

    it('T1-R2-04: Restarting server preserves custom rooms from CCHS_RUNTIME_STATE_PATH without reverting to seed', async () => {
      const srv = await startIsolatedServer();
      try {
        const auth = await loginViaApi(srv.baseUrl);
        const res = await apiPostAction(
          srv.baseUrl,
          'SAVE_ROOMS',
          {
            rooms: [
              {
                id: 'clinical-innovation-lab',
                name: 'Clinical Innovation Lab',
                floor: 'Level 4 - Wing B',
                capacity: 18,
                amenities: ['Interactive Board', 'Telehealth Rig'],
                color: '#00b894',
                status: 'available'
              }
            ]
          },
          auth.data.token
        );
        assert.equal(res.status, 200);

        await srv.restart();
        const after = await apiGetData(srv.baseUrl);
        assert.equal(after.data.rooms.length, 1);
        assert.equal(after.data.rooms[0].name, 'Clinical Innovation Lab');
        assert.equal(after.data.rooms[0].floor, 'Level 4 - Wing B');
        assert.equal(after.data.rooms[0].capacity, 18);
      } finally {
        await srv.stop();
      }
    });

    it('T1-R2-05: Stale full-state snapshot cannot clobber newer custom rooms and empty rooms list is rejected', async () => {
      const srv = await startIsolatedServer();
      try {
        const auth = await loginViaApi(srv.baseUrl);
        const token = auth.data.token;
        const initial = (await apiGetData(srv.baseUrl)).data;

        const saveRes = await apiPostAction(
          srv.baseUrl,
          'SAVE_ROOMS',
          {
            rooms: [
              {
                id: 'room-newer-custom',
                name: 'Newer Custom Room',
                floor: 'Level 9',
                capacity: 14,
                amenities: ['TV'],
                color: '#1863dc',
                status: 'available'
              }
            ]
          },
          token
        );
        assert.equal(saveRes.status, 200);

        // Attempt empty rooms save -> should fail or not leave 0 rooms
        const emptySave = await apiPostAction(srv.baseUrl, 'SAVE_ROOMS', { rooms: [] }, token);
        const afterEmpty = (await apiGetData(srv.baseUrl)).data;
        assert.ok(afterEmpty.rooms.length >= 1, 'System must never persist 0 rooms');
        if (emptySave.status === 200) {
          assert.equal(afterEmpty.rooms[0].name, 'Newer Custom Room');
        }

        // Attempt stale full-state overwrite with old rooms & stale/zero roomsUpdatedAt
        await apiPostRaw(
          srv.baseUrl,
          {
            ...initial,
            roomsUpdatedAt: 1,
            departments: {
              ...initial.departments,
              IT: { update: 'Fresh IT update', question: 'Q' }
            }
          },
          token
        );

        const afterStale = (await apiGetData(srv.baseUrl)).data;
        assert.equal(
          afterStale.rooms[0].name,
          'Newer Custom Room',
          'Stale full-state snapshot must not overwrite newer custom rooms'
        );
      } finally {
        await srv.stop();
      }
    });
  });

  // =========================================================================
  // R3: WhatsApp Booking Confirmation & Automation Report (5 tests)
  // =========================================================================
  describe('R3: WhatsApp Booking Confirmation & Automation Report (5 tests)', () => {
    it('T1-R3-01: buildWhatsAppBookingUrl ("confirmed") preserves fields and contains zero U+FFFD or surrogate emojis', async () => {
      const srv = await startIsolatedServer();
      const ctx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        const page = await ctx.newPage();
        await page.goto(`${srv.baseUrl}/booking/`, { waitUntil: 'domcontentloaded' });
        const url = await page.evaluate(async () => {
          const mod = await import('/shared/cloud-store.js');
          return mod.buildWhatsAppBookingUrl(
            {
              roomId: 'boardroom-main',
              title: 'Clinical Quality Review',
              department: 'CLINICAL GOVERNANCE',
              organizer: 'Dr. Aisyah',
              phone: '012-3456789',
              date: '2026-11-20',
              startTime: '10:00',
              endTime: '11:30',
              notes: 'Bring Q4 slides'
            },
            { id: 'boardroom-main', name: 'HQ Main Boardroom', floor: 'Level 1 - Executive Wing' },
            'confirmed'
          );
        });

        assertCleanWhatsAppUrl(url, {
          phone: '60123456789',
          roomName: 'HQ Main Boardroom',
          roomFloor: 'Level 1 - Executive Wing',
          title: 'Clinical Quality Review',
          department: 'CLINICAL GOVERNANCE',
          date: '2026-11-20',
          time: '10:00 – 11:30',
          notes: 'Bring Q4 slides'
        });
      } finally {
        await ctx.close();
        await srv.stop();
      }
    });

    it('T1-R3-02: buildWhatsAppBookingUrl ("starting") preserves starting-now style and zero U+FFFD', async () => {
      const srv = await startIsolatedServer();
      const ctx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        const page = await ctx.newPage();
        await page.goto(`${srv.baseUrl}/booking/`, { waitUntil: 'domcontentloaded' });
        const url = await page.evaluate(async () => {
          const mod = await import('/shared/cloud-store.js');
          return mod.buildWhatsAppBookingUrl(
            {
              roomId: 'discussion-a',
              title: 'IT Morning Standup',
              department: 'IT',
              organizer: 'Amri',
              phone: '019-8765432',
              date: '2026-11-20',
              startTime: '09:00',
              endTime: '09:30'
            },
            { id: 'discussion-a', name: 'Discussion Room A', floor: 'Level 1 - Central Zone' },
            'starting'
          );
        });

        const text = assertCleanWhatsAppUrl(url, {
          phone: '60198765432',
          roomName: 'Discussion Room A',
          title: 'IT Morning Standup',
          department: 'IT',
          date: '2026-11-20',
          time: '09:00 – 09:30'
        });
        assert.match(text, /STARTING NOW/i);
      } finally {
        await ctx.close();
        await srv.stop();
      }
    });

    it('T1-R3-03: buildWhatsAppBookingMessage matches URL text and handles optional notes & missing phone', async () => {
      const srv = await startIsolatedServer();
      const ctx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        const page = await ctx.newPage();
        await page.goto(`${srv.baseUrl}/booking/`, { waitUntil: 'domcontentloaded' });
        const result = await page.evaluate(async () => {
          const mod = await import('/shared/cloud-store.js');
          if (typeof mod.buildWhatsAppBookingMessage !== 'function') {
            return { missing: true };
          }
          const booking = {
            roomId: 'pod-telehealth',
            title: 'Vendor Sync',
            department: 'PROCUREMENT',
            organizer: 'Farah',
            phone: '',
            date: '2026-11-21',
            startTime: '14:00',
            endTime: '15:00',
            notes: ''
          };
          const room = { id: 'pod-telehealth', name: 'Focus Pod 1', floor: 'Level 1' };
          return {
            missing: false,
            msg: mod.buildWhatsAppBookingMessage(booking, room, 'confirmed'),
            url: mod.buildWhatsAppBookingUrl(booking, room, 'confirmed')
          };
        });

        assert.equal(result.missing, false, 'Expected buildWhatsAppBookingMessage export in cloud-store.js');
        assertCleanWhatsAppText(result.msg, {
          roomName: 'Focus Pod 1',
          title: 'Vendor Sync',
          department: 'PROCUREMENT',
          date: '2026-11-21',
          time: '14:00 – 15:00'
        });
        assert.ok(!result.msg.includes('*Notes:*'), 'Empty notes should omit *Notes:* line');
        const decoded = assertCleanWhatsAppUrl(result.url);
        assert.equal(decoded, result.msg);
        assert.ok(result.url.startsWith('https://wa.me/?text='), 'Missing phone should omit phone segment');
      } finally {
        await ctx.close();
        await srv.stop();
      }
    });

    it('T1-R3-04: formatWhatsAppPhone normalizes Malaysian phone numbers accurately', async () => {
      const srv = await startIsolatedServer();
      const ctx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      try {
        const page = await ctx.newPage();
        await page.goto(`${srv.baseUrl}/booking/`, { waitUntil: 'domcontentloaded' });
        const phones = await page.evaluate(async () => {
          const mod = await import('/shared/cloud-store.js');
          return {
            localZero: mod.formatWhatsAppPhone('012-345 6789'),
            noZero: mod.formatWhatsAppPhone('123456789'),
            intlPlus: mod.formatWhatsAppPhone('+60 12-345 6789'),
            empty: mod.formatWhatsAppPhone('')
          };
        });
        assert.equal(phones.localZero, '60123456789');
        assert.equal(phones.noZero, '60123456789');
        assert.equal(phones.intlPlus, '60123456789');
        assert.equal(phones.empty, '');
      } finally {
        await ctx.close();
        await srv.stop();
      }
    });

    it('T1-R3-05: docs/WHATSAPP_AUTOMATION_REPORT.md exists and documents limitations & viable options', async () => {
      const reportPath = path.join(REPO_ROOT, 'docs', 'WHATSAPP_AUTOMATION_REPORT.md');
      assert.ok(fs.existsSync(reportPath), `Expected report at ${reportPath}`);
      const content = fs.readFileSync(reportPath, 'utf8');
      assert.ok(content.trim().length > 200, 'Expected substantive technical feasibility report');
      assert.match(content, /normal phone|personal|wa\.me|whatsapp/i);
      assert.match(content, /limitation|vercel|serverless|headless|session|ban/i);
      assert.match(content, /option|cloud api|webhook|relay|baileys|whatsapp-web\.js/i);
    });
  });

  // =========================================================================
  // R4: TV Display Remote Slide Control (6 tests)
  // =========================================================================
  describe('R4: TV Display Remote Slide Control (6 tests)', () => {
    it('T1-R4-01: Remote next & prev from /display/ controller updates zero-input TV receiver', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      const tvCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl, viewport: { width: 1280, height: 720 } });
      try {
        await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
        const adminPage = await adminCtx.newPage();
        const tvPage = await tvCtx.newPage();

        await tvPage.goto(`${srv.baseUrl}/display/?mode=receiver`, { waitUntil: 'domcontentloaded' });
        await adminPage.goto(`${srv.baseUrl}/display/`, { waitUntil: 'domcontentloaded' });

        const tvFrame = getTvMeetingFrame(tvPage);
        await tvFrame.locator('#slide-indicator').waitFor({ state: 'visible', timeout: 5000 });
        const initialIndicator = await tvFrame.locator('#slide-indicator').innerText();
        assert.match(initialIndicator, /^1\s*\/\s*\d+$/);

        const controls = await getRemoteSlideControls(adminPage);
        await controls.nextBtn.click();
        await waitForCondition(async () => {
          const txt = await tvFrame.locator('#slide-indicator').innerText();
          return /^2\s*\/\s*\d+$/.test(txt);
        }, 5000, 150, 'TV slide indicator to reach 2 / N');

        await controls.nextBtn.click();
        await waitForCondition(async () => {
          const txt = await tvFrame.locator('#slide-indicator').innerText();
          return /^3\s*\/\s*\d+$/.test(txt);
        }, 5000, 150, 'TV slide indicator to reach 3 / N');

        const transform2 = await tvFrame.locator('#slides-container').evaluate((el) => el.style.transform);
        assert.ok(transform2.includes('-200%'), `Expected translateX(-200%), got ${transform2}`);

        await controls.prevBtn.click();
        await waitForCondition(async () => {
          const txt = await tvFrame.locator('#slide-indicator').innerText();
          return /^2\s*\/\s*\d+$/.test(txt);
        }, 5000, 150, 'TV slide indicator to return to 2 / N');
      } finally {
        await adminCtx.close();
        await tvCtx.close();
        await srv.stop();
      }
    });

    it('T1-R4-02: Remote goto (select slide) jumps zero-input TV receiver directly to target slide', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      const tvCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl, viewport: { width: 1280, height: 720 } });
      try {
        await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
        const adminPage = await adminCtx.newPage();
        const tvPage = await tvCtx.newPage();

        await tvPage.goto(`${srv.baseUrl}/display/?mode=receiver`, { waitUntil: 'domcontentloaded' });
        await adminPage.goto(`${srv.baseUrl}/display/`, { waitUntil: 'domcontentloaded' });

        const tvFrame = getTvMeetingFrame(tvPage);
        await tvFrame.locator('#slide-indicator').waitFor({ state: 'visible', timeout: 5000 });

        const controls = await getRemoteSlideControls(adminPage);
        assert.ok((await controls.slideSelect.count()) > 0, 'Expected slide <select> in remote slide controls');

        const visionOption = await controls.slideSelect.evaluate((sel) => {
          const opt = Array.from(sel.options).find((o) => /vision\s*(&|and)?\s*mission/i.test(o.text));
          return opt ? { value: opt.value, text: opt.text } : null;
        });
        assert.ok(visionOption, 'Expected Vision & Mission option in remote slide selector');

        await controls.slideSelect.selectOption(visionOption.value);

        await waitForCondition(async () => {
          const activePill = await tvFrame.locator('.dept-pill.active').innerText().catch(() => '');
          return /vision\s*(&|and)?\s*mission/i.test(activePill);
        }, 5000, 150, 'TV receiver to jump to Vision & Mission');
      } finally {
        await adminCtx.close();
        await tvCtx.close();
        await srv.stop();
      }
    });

    it('T1-R4-03: Remote resume & pause controls autoplay on zero-input TV /meeting/', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      const tvCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl, viewport: { width: 1280, height: 720 } });
      try {
        // Set a brisk autoplay interval via SLIDE_COMMAND or seed so test completes fast
        await apiPostAction(
          srv.baseUrl,
          'SLIDE_COMMAND',
          { command: 'pause', autoPlayIntervalMs: 1200 },
          auth.data.token
        );

        await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
        const adminPage = await adminCtx.newPage();
        const tvPage = await tvCtx.newPage();

        await tvPage.goto(`${srv.baseUrl}/meeting/`, { waitUntil: 'domcontentloaded' });
        await adminPage.goto(`${srv.baseUrl}/display/`, { waitUntil: 'domcontentloaded' });
        await tvPage.locator('#slide-indicator').waitFor({ state: 'visible', timeout: 5000 });

        const controls = await getRemoteSlideControls(adminPage);
        const resumeTrigger = (await controls.resumeBtn.count()) > 0 ? controls.resumeBtn : controls.pauseResumeBtn;
        await resumeTrigger.click();

        await waitForCondition(async () => {
          const { data } = await apiGetData(srv.baseUrl);
          return data?.remoteDisplay?.slideControl?.autoPlay === true;
        }, 5000, 150, 'slideControl.autoPlay === true');

        // Wait for TV slide to advance automatically from slide 1
        await waitForCondition(async () => {
          const txt = await tvPage.locator('#slide-indicator').innerText();
          const m = txt.match(/^(\d+)\s*\//);
          return m && Number(m[1]) >= 2;
        }, 6000, 200, 'TV slide to auto-advance while playing');

        const pauseTrigger = (await controls.pauseBtn.count()) > 0 ? controls.pauseBtn : controls.pauseResumeBtn;
        await pauseTrigger.click();

        await waitForCondition(async () => {
          const { data } = await apiGetData(srv.baseUrl);
          return data?.remoteDisplay?.slideControl?.autoPlay === false;
        }, 5000, 150, 'slideControl.autoPlay === false');

        const settledIndicator = await tvPage.locator('#slide-indicator').innerText();
        await new Promise((r) => setTimeout(r, 2800));
        const afterPauseIndicator = await tvPage.locator('#slide-indicator').innerText();
        assert.equal(afterPauseIndicator, settledIndicator, 'Slide must remain stationary after pause');
      } finally {
        await adminCtx.close();
        await tvCtx.close();
        await srv.stop();
      }
    });

    it('T1-R4-04: Remote refresh triggers single-shot non-looping reload on TV while keeping controller & ?preview=1 intact', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      const tvCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl, viewport: { width: 1280, height: 720 } });
      try {
        await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
        const adminPage = await adminCtx.newPage();
        const tvPage = await tvCtx.newPage();

        await tvPage.goto(`${srv.baseUrl}/display/?mode=receiver`, { waitUntil: 'domcontentloaded' });
        await adminPage.goto(`${srv.baseUrl}/display/`, { waitUntil: 'domcontentloaded' });

        const tvFrame = getTvMeetingFrame(tvPage);
        await tvFrame.locator('#slide-indicator').waitFor({ state: 'visible', timeout: 5000 });

        let tvFrameLoads = 0;
        let previewLoads = 0;
        tvPage.on('framenavigated', (frame) => {
          if (frame.url().includes('/meeting/')) tvFrameLoads++;
        });
        adminPage.on('framenavigated', (frame) => {
          if (frame !== adminPage.mainFrame() && frame.url().includes('/meeting/')) previewLoads++;
        });

        // Mark TV meeting frame before refresh
        await tvFrame.locator('body').evaluate(() => {
          window.__e2eTvMarker = 'before-refresh';
        });
        const adminMarker = await adminPage.evaluate(() => {
          window.__e2eAdminMarker = 'alive';
          return window.__e2eAdminMarker;
        });
        assert.equal(adminMarker, 'alive');

        // Reset counter right before clicking Refresh
        tvFrameLoads = 0;
        previewLoads = 0;

        const controls = await getRemoteSlideControls(adminPage);
        await controls.refreshBtn.click();

        await waitForCondition(async () => {
          const marker = await tvFrame.locator('body').evaluate(() => window.__e2eTvMarker).catch(() => null);
          return marker === undefined && tvFrameLoads >= 1;
        }, 5000, 150, 'TV frame single reload on refresh command');

        // Wait across 2+ poll cycles (3.5s) to prove no reload loop
        await new Promise((r) => setTimeout(r, 3500));
        assert.equal(tvFrameLoads, 1, `Expected single-shot TV reload, observed ${tvFrameLoads} navigations`);
        assert.equal(previewLoads, 0, 'Controller ?preview=1 iframe must not reload on TV refresh');
        assert.equal(
          await adminPage.evaluate(() => window.__e2eAdminMarker),
          'alive',
          'Admin controller must not reload on TV refresh'
        );
      } finally {
        await adminCtx.close();
        await tvCtx.close();
        await srv.stop();
      }
    });

    it('T1-R4-05: Remote refresh triggers single-shot reload across standby receiver mode (announcement)', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const adminCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl });
      const tvCtx = await createIsolatedContext(browser, { baseUrl: srv.baseUrl, viewport: { width: 1280, height: 720 } });
      try {
        await apiPostAction(
          srv.baseUrl,
          'UPDATE_REMOTE_DISPLAY',
          { patch: { activeMode: 'announcement' } },
          auth.data.token
        );

        await injectAdminSession(adminCtx, srv.baseUrl, auth.data);
        const adminPage = await adminCtx.newPage();
        const tvPage = await tvCtx.newPage();

        await tvPage.goto(`${srv.baseUrl}/display/?mode=receiver`, { waitUntil: 'domcontentloaded' });
        await adminPage.goto(`${srv.baseUrl}/display/`, { waitUntil: 'domcontentloaded' });

        await tvPage.locator('#receiverViewport').getByText('HQ NOTICE', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });
        await tvPage.evaluate(() => { window.__standbyMarker = 'before-refresh'; });

        let tvLoads = 0;
        tvPage.on('load', () => { tvLoads++; });

        const controls = await getRemoteSlideControls(adminPage);
        await controls.refreshBtn.click();

        await waitForCondition(async () => {
          const marker = await tvPage.evaluate(() => window.__standbyMarker).catch(() => null);
          return marker === undefined && tvLoads >= 1;
        }, 5000, 150, 'standby receiver single reload');

        await new Promise((r) => setTimeout(r, 3500));
        assert.equal(tvLoads, 1, `Expected single reload in announcement mode, got ${tvLoads}`);
        await tvPage.locator('#receiverViewport').getByText('HQ NOTICE', { exact: true }).waitFor({ state: 'visible', timeout: 4000 });
      } finally {
        await adminCtx.close();
        await tvCtx.close();
        await srv.stop();
      }
    });

    it('T1-R4-06: Mobile viewport (390x844) remote slide controller fits cleanly and drives TV', async () => {
      const srv = await startIsolatedServer();
      const auth = await loginViaApi(srv.baseUrl);
      const mobileAdminCtx = await createIsolatedContext(browser, {
        baseUrl: srv.baseUrl,
        viewport: { width: 390, height: 844 }
      });
      const tvCtx = await createIsolatedContext(browser, {
        baseUrl: srv.baseUrl,
        viewport: { width: 1280, height: 720 }
      });
      try {
        await injectAdminSession(mobileAdminCtx, srv.baseUrl, auth.data);
        const mobilePage = await mobileAdminCtx.newPage();
        const tvPage = await tvCtx.newPage();

        await tvPage.goto(`${srv.baseUrl}/meeting/`, { waitUntil: 'domcontentloaded' });
        await mobilePage.goto(`${srv.baseUrl}/display/`, { waitUntil: 'domcontentloaded' });

        await tvPage.locator('#slide-indicator').waitFor({ state: 'visible', timeout: 5000 });
        const controls = await getRemoteSlideControls(mobilePage);

        await controls.nextBtn.scrollIntoViewIfNeeded();
        assert.equal(await controls.nextBtn.isVisible(), true);
        assert.equal(await controls.prevBtn.isVisible(), true);
        assert.equal(await controls.refreshBtn.isVisible(), true);

        const noHorizontalOverflow = await mobilePage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 2
        );
        assert.equal(noHorizontalOverflow, true, 'Mobile controller should fit within 390px viewport width');

        await controls.nextBtn.click();
        await waitForCondition(async () => {
          const txt = await tvPage.locator('#slide-indicator').innerText();
          return /^2\s*\//.test(txt);
        }, 5000, 150, 'TV to advance to slide 2 from mobile controller');
      } finally {
        await mobileAdminCtx.close();
        await tvCtx.close();
        await srv.stop();
      }
    });
  });

  // =========================================================================
  // Portal Stability (5 tests)
  // =========================================================================
  describe('Portal Stability (5 tests)', () => {
    it('T1-STAB-01: Isolated server starts cleanly with zero stderr errors and serves / and /api/data', async () => {
      const srv = await startIsolatedServer();
      try {
        const homeRes = await fetch(`${srv.baseUrl}/`);
        assert.equal(homeRes.status, 200);
        const apiRes = await fetch(`${srv.baseUrl}/api/data`);
        assert.equal(apiRes.status, 200);
        const data = await apiRes.json();
        assert.ok(data && data.config && Array.isArray(data.rooms));
        srv.assertNoUncaughtServerErrors();
      } finally {
        await srv.stop();
      }
    });

    it('T1-STAB-02: All primary HTML routes respond HTTP 200 with text/html', async () => {
      const srv = await startIsolatedServer();
      try {
        const routes = [
          '/',
          '/login.html',
          '/admin/',
          '/meeting/',
          '/meeting/input.html',
          '/meeting/admin.html',
          '/booking/',
          '/display/',
          '/pdf/'
        ];
        for (const r of routes) {
          const res = await fetch(`${srv.baseUrl}${r}`);
          assert.equal(res.status, 200, `Expected 200 on ${r}, got ${res.status}`);
          const ct = res.headers.get('content-type') || '';
          assert.match(ct, /text\/html/i, `Expected text/html on ${r}, got ${ct}`);
        }
      } finally {
        await srv.stop();
      }
    });

    it('T1-STAB-03: POST /api/auth returns 200 + HMAC token on valid creds and 401 on invalid creds', async () => {
      const srv = await startIsolatedServer();
      try {
        const valid = await loginViaApi(srv.baseUrl, 'admin', 'cchs2026');
        assert.equal(valid.status, 200);
        assert.equal(valid.data?.ok, true);
        assert.equal(valid.data?.role, 'admin');
        assert.match(String(valid.data?.token || ''), /^[A-Za-z0-9+/=]+\.[0-9a-f]{64}$/);

        const invalid = await loginViaApi(srv.baseUrl, 'admin', 'wrong-password');
        assert.equal(invalid.status, 401);
        assert.equal(invalid.data?.ok, false);
      } finally {
        await srv.stop();
      }
    });

    it('T1-STAB-04: POST /api/data rejects malformed or non-object payloads cleanly without crashing server', async () => {
      const srv = await startIsolatedServer();
      try {
        const badJson = await apiPostRaw(srv.baseUrl, '{not-valid-json', null, true);
        assert.ok([400, 401, 403].includes(badJson.status), `Expected 4xx on malformed JSON, got ${badJson.status}`);

        const nullPayload = await apiPostRaw(srv.baseUrl, 'null', null, true);
        assert.equal(nullPayload.status, 400);

        // Server remains healthy
        const health = await apiGetData(srv.baseUrl);
        assert.equal(health.status, 200);
        srv.assertNoUncaughtServerErrors();
      } finally {
        await srv.stop();
      }
    });

    it('T1-STAB-05: GET /nonexistent-route returns 404 cleanly without crashing server', async () => {
      const srv = await startIsolatedServer();
      try {
        const res = await fetch(`${srv.baseUrl}/this-route-does-not-exist-e2e`);
        assert.equal(res.status, 404);
        const health = await apiGetData(srv.baseUrl);
        assert.equal(health.status, 200);
        srv.assertNoUncaughtServerErrors();
      } finally {
        await srv.stop();
      }
    });
  });
});
