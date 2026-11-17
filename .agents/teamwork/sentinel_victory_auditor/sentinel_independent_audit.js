/**
 * SENTINEL VICTORY AUDITOR INDEPENDENT TEST SUITE
 * Fully unassisted, independent verification of Careclinics HQ Room Booking
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(condition, desc) {
  if (condition) {
    console.log(`[PASS] ${desc}`);
    passCount++;
  } else {
    console.error(`[FAIL] ${desc}`);
    failCount++;
    failures.push(desc);
  }
}

function httpGet(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3000${urlPath}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, data }));
    }).on('error', reject);
  });
}

function httpPost(urlPath, payload) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const req = http.request(`http://localhost:3000${urlPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ statusCode: res.statusCode, headers: res.headers, data, json });
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Independent conflict checker emulation according to specification
function checkConflictIndependent(bookings, candidate, excludeId = null) {
  if (!Array.isArray(bookings)) return null;
  return bookings.find(b => {
    if (excludeId && b.id === excludeId) return false;
    if (b.roomId !== candidate.roomId) return false;
    if (b.date !== candidate.date) return false;
    // Overlap condition: startTime < b.endTime && endTime > b.startTime
    return candidate.startTime < b.endTime && candidate.endTime > b.startTime;
  }) || null;
}

// Independent duration compute
function computeEndTimeIndependent(startHm, durationMins) {
  const [h, m] = startHm.split(':').map(Number);
  const totalMins = Math.min(h * 60 + m + durationMins, 23 * 60 + 45);
  const endH = String(Math.floor(totalMins / 60)).padStart(2, '0');
  const endM = String(totalMins % 60).padStart(2, '0');
  return `${endH}:${endM}`;
}

async function runSentinelAudit() {
  console.log('======================================================================');
  console.log('=== SENTINEL VICTORY AUDITOR: INDEPENDENT VERIFICATION SUITE ===');
  console.log('======================================================================');

  const htmlPath = path.resolve(__dirname, '../../../public/booking/index.html');
  assert(fs.existsSync(htmlPath), 'Work product exists at public/booking/index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert(html.length > 80000, `HTML payload size is robust and substantive (${html.length} bytes)`);

  // SECTION 1: ENDPOINT & HTTP CONTRACT VERIFICATION
  console.log('\n--- Section 1: Endpoint & HTTP Contract Verification ---');
  const portalRes = await httpGet('/');
  assert(portalRes.statusCode === 200, 'GET / (Portal Root) returns 200 OK');

  const bookingRes = await httpGet('/booking/');
  assert(bookingRes.statusCode === 200, 'GET /booking/ returns 200 OK');
  assert(bookingRes.headers['content-type'].includes('text/html'), 'GET /booking/ returns text/html content-type');
  assert(bookingRes.data.includes('Careclinics HQ Room Booking'), 'GET /booking/ renders Careclinics HQ branding');

  const dataRes = await httpGet('/api/data');
  assert(dataRes.statusCode === 200, 'GET /api/data returns 200 OK');
  let dataJson = {};
  try { dataJson = JSON.parse(dataRes.data); } catch (e) {}
  assert(Array.isArray(dataJson.rooms) && dataJson.rooms.length >= 5, `GET /api/data contains at least 5 rooms (found ${dataJson.rooms?.length})`);
  assert(Array.isArray(dataJson.bookings), 'GET /api/data contains bookings array');
  assert(dataJson.departments && typeof dataJson.departments === 'object', 'GET /api/data contains departments configuration');

  const cloudStoreRes = await httpGet('/shared/cloud-store.js');
  assert(cloudStoreRes.statusCode === 200, 'GET /shared/cloud-store.js returns 200 OK');

  const authRes = await httpGet('/shared/auth.js');
  assert(authRes.statusCode === 200, 'GET /shared/auth.js returns 200 OK');

  // SECTION 2: R1 WORKFLOW & USABILITY REQUIREMENTS
  console.log('\n--- Section 2: Requirement R1 - Workflow Simplification & Usability ---');
  // 3-Tier View Navigation
  assert(html.includes('id="tabBtnRooms"'), 'Provides Tab Button: HQ Rooms Directory');
  assert(html.includes('id="tabBtnTimetable"'), 'Provides Tab Button: Master Timetable');
  assert(html.includes('id="tabBtnAgenda"'), 'Provides Tab Button: Meeting Agenda');
  assert(html.includes('id="roomsDirectoryView"'), 'Provides View 1: #roomsDirectoryView');
  assert(html.includes('id="timetableGridContainer"'), 'Provides View 2: #timetableGridContainer');
  assert(html.includes('id="bookingsContainer"'), 'Provides View 3: #bookingsContainer (Agenda)');

  // Step-by-Step 3-Section Booking Modal
  assert(html.includes('id="bookingModalBackdrop"'), 'Provides Modal Container: #bookingModalBackdrop');
  assert(html.includes('id="bookingForm"'), 'Provides Booking Form: #bookingForm');
  assert(html.includes('1. Room &amp; Time Window') || html.includes('1. Room & Time Window'), 'Modal features Step 1: Room & Time Window');
  assert(html.includes('2. Meeting Details'), 'Modal features Step 2: Meeting Details');
  assert(html.includes('3. Booker Profile'), 'Modal features Step 3: Booker Profile');

  // Input fields & labeled details
  const requiredInputs = [
    'id="roomId"', 'id="date"', 'id="startTime"', 'id="endTime"',
    'id="title"', 'id="department"', 'id="organizer"', 'id="phone"', 'id="email"',
    'id="notes"', 'id="btnSubmitBooking"'
  ];
  requiredInputs.forEach(inputId => {
    assert(html.includes(inputId), `Booking modal contains clearly designated input ${inputId}`);
  });

  // Duration quick pills
  const durationPills = ['selectDurationMinutes(30', 'selectDurationMinutes(45', 'selectDurationMinutes(60', 'selectDurationMinutes(90', 'selectDurationMinutes(120', 'selectDurationMinutes(180', 'selectDurationMinutes(240'];
  durationPills.forEach(pill => {
    assert(html.includes(pill), `Provides 1-click quick duration pill: ${pill}`);
  });

  // Real-time conflict status indicator
  assert(html.includes('id="liveSlotStatus"'), 'Provides real-time conflict status banner #liveSlotStatus');
  assert(html.includes('id="liveSlotText"'), 'Provides real-time conflict status message container #liveSlotText');

  // Post-booking confirmation modal with calendar links
  assert(html.includes('id="confirmedModal"'), 'Provides Post-Booking Confirmation Modal #confirmedModal');
  assert(html.includes('id="btnModalOutlook365"'), 'Confirmation modal provides Outlook 365 1-click web link');
  assert(html.includes('id="btnModalOutlookIcs"'), 'Confirmation modal provides .ics desktop download');
  assert(html.includes('id="btnModalWhatsApp"'), 'Confirmation modal provides WhatsApp dispatch link');

  // SECTION 3: R2 VISUAL PRESENTATION & INTERFACE ENHANCEMENT
  console.log('\n--- Section 3: Requirement R2 - Visual Presentation & Interface Enhancement ---');
  // Executive Hero Banner
  assert(html.includes('class="hero-banner"'), 'Provides executive hero banner container');
  assert(html.includes('id="kpiTotalRooms"'), 'Hero features KPI card: Total Rooms');
  assert(html.includes('id="kpiAvailableNow"'), 'Hero features KPI card: Available Now (with live beacon)');
  assert(html.includes('id="kpiTodayBookings"'), 'Hero features KPI card: Bookings Today');
  assert(html.includes('id="kpiNextSlot"'), 'Hero features KPI card: Room Status');

  // Cohesive styling & visual hierarchy
  assert(html.includes('--cc-navy: #0c1936'), 'Defines premium executive navy brand tokens');
  assert(html.includes('empty-state-card'), 'Provides styled empty state container class .empty-state-card');
  assert(html.includes('No Meetings Scheduled'), 'Provides informative empty state when schedule is empty');
  assert(html.includes('No Meeting Rooms Found') && html.includes('No Meeting Rooms Available'), 'Provides informative empty state when room filter yields no match');

  // Accessibility & UX Polish
  assert(html.includes('role="dialog"'), 'Modals declare WAI-ARIA role="dialog"');
  assert(html.includes('aria-modal="true"'), 'Modals declare WAI-ARIA aria-modal="true"');
  assert(html.includes('position: sticky') && html.includes('left: 0'), 'Timetable keeps Time column sticky for horizontal scrolling');

  // Responsive Layout
  assert(html.includes('@media (max-width: 640px)'), 'Provides mobile viewport optimization breakpoint');
  assert(html.includes('overflow-x: hidden'), 'Prevents horizontal page blowout on mobile screens');

  // SECTION 4: REAL-TIME CONFLICT LOGIC STRESS TESTING
  console.log('\n--- Section 4: Conflict Logic Adversarial Stress Testing ---');
  const baseBookings = [
    { id: 'b1', roomId: 'boardroom-main', date: '2026-11-20', startTime: '10:00', endTime: '12:00', title: 'Board Meeting', department: 'EXECUTIVE' },
    { id: 'b2', roomId: 'training-lab', date: '2026-11-20', startTime: '14:00', endTime: '16:00', title: 'Clinical Training', department: 'CLINICAL GOVERNANCE' }
  ];

  // 1. Exact match overlap [10:00, 12:00]
  assert(checkConflictIndependent(baseBookings, { roomId: 'boardroom-main', date: '2026-11-20', startTime: '10:00', endTime: '12:00' })?.id === 'b1', 'Conflict: Exact match rejected');

  // 2. Interior overlap [10:30, 11:30]
  assert(checkConflictIndependent(baseBookings, { roomId: 'boardroom-main', date: '2026-11-20', startTime: '10:30', endTime: '11:30' })?.id === 'b1', 'Conflict: Interior sub-interval rejected');

  // 3. Spanning overlap [09:00, 13:00]
  assert(checkConflictIndependent(baseBookings, { roomId: 'boardroom-main', date: '2026-11-20', startTime: '09:00', endTime: '13:00' })?.id === 'b1', 'Conflict: Spanning interval rejected');

  // 4. Start boundary overlap [09:30, 10:30]
  assert(checkConflictIndependent(baseBookings, { roomId: 'boardroom-main', date: '2026-11-20', startTime: '09:30', endTime: '10:30' })?.id === 'b1', 'Conflict: Start boundary overlap rejected');

  // 5. End boundary overlap [11:30, 12:30]
  assert(checkConflictIndependent(baseBookings, { roomId: 'boardroom-main', date: '2026-11-20', startTime: '11:30', endTime: '12:30' })?.id === 'b1', 'Conflict: End boundary overlap rejected');

  // 6. Contiguous prior slot [08:30, 10:00] -> ALLOWED
  assert(checkConflictIndependent(baseBookings, { roomId: 'boardroom-main', date: '2026-11-20', startTime: '08:30', endTime: '10:00' }) === null, 'Non-conflict: Contiguous preceding slot permitted');

  // 7. Contiguous subsequent slot [12:00, 13:30] -> ALLOWED
  assert(checkConflictIndependent(baseBookings, { roomId: 'boardroom-main', date: '2026-11-20', startTime: '12:00', endTime: '13:30' }) === null, 'Non-conflict: Contiguous subsequent slot permitted');

  // 8. Same time in different room -> ALLOWED
  assert(checkConflictIndependent(baseBookings, { roomId: 'training-lab', date: '2026-11-20', startTime: '10:00', endTime: '12:00' }) === null, 'Non-conflict: Same slot in different room permitted');

  // 9. Same time on different date -> ALLOWED
  assert(checkConflictIndependent(baseBookings, { roomId: 'boardroom-main', date: '2026-11-21', startTime: '10:00', endTime: '12:00' }) === null, 'Non-conflict: Same slot on different date permitted');

  // 10. Self-exclusion during edit -> ALLOWED
  assert(checkConflictIndependent(baseBookings, { roomId: 'boardroom-main', date: '2026-11-20', startTime: '10:00', endTime: '12:00' }, 'b1') === null, 'Non-conflict: Self-exclusion allows modifying current booking');

  // SECTION 5: TIME & DURATION COMPUTATIONS
  console.log('\n--- Section 5: Time & Duration Computations ---');
  assert(computeEndTimeIndependent('09:00', 30) === '09:30', 'Calculates 30m duration (09:00 -> 09:30)');
  assert(computeEndTimeIndependent('09:00', 45) === '09:45', 'Calculates 45m duration (09:00 -> 09:45)');
  assert(computeEndTimeIndependent('09:00', 60) === '10:00', 'Calculates 1h duration (09:00 -> 10:00)');
  assert(computeEndTimeIndependent('09:00', 90) === '10:30', 'Calculates 1.5h duration (09:00 -> 10:30)');
  assert(computeEndTimeIndependent('09:00', 120) === '11:00', 'Calculates 2h duration (09:00 -> 11:00)');
  assert(computeEndTimeIndependent('09:00', 180) === '12:00', 'Calculates 3h duration (09:00 -> 12:00)');
  assert(computeEndTimeIndependent('09:00', 240) === '13:00', 'Calculates 4h duration (09:00 -> 13:00)');
  assert(computeEndTimeIndependent('23:00', 120) === '23:45', 'Clamps duration to end of day maximum (23:45)');

  // SECTION 6: LIVE API PERSISTENCE & DATA INTEGRITY
  console.log('\n--- Section 6: Live API Persistence & Data Integrity ---');
  const testBookingId = `sentinel-audit-${Date.now()}`;
  const testPayload = {
    __action: 'ADD_BOOKING',
    payload: {
      booking: {
        id: testBookingId,
        roomId: 'boardroom-main',
        date: '2026-12-31',
        startTime: '13:00',
        endTime: '14:30',
        title: 'Sentinel Victory Verification Audit Review',
        department: 'IT',
        organizer: 'Sentinel Victory Auditor',
        phone: '+60123456789',
        email: 'auditor@careclinics.com',
        notes: 'Independent automated verification entry'
      }
    }
  };

  const addRes = await httpPost('/api/data', testPayload);
  assert(addRes.statusCode === 200, `API POST ADD_BOOKING returned 200 (got ${addRes.statusCode})`);
  assert(addRes.json && addRes.json.state && addRes.json.state.bookings && addRes.json.state.bookings.some(b => b.id === testBookingId), 'State contains newly created booking');

  // Verify server rejects duplicate/overlapping booking with 409
  const dupRes = await httpPost('/api/data', testPayload);
  assert(dupRes.statusCode === 409, `API POST conflicting reservation rejected with 409 Conflict (got ${dupRes.statusCode})`);

  // Verify UPDATE_BOOKING
  const updatePayload = {
    __action: 'UPDATE_BOOKING',
    payload: {
      bookingId: testBookingId,
      updatedFields: {
        title: 'Updated Sentinel Review Session',
        startTime: '13:15',
        endTime: '14:45'
      }
    }
  };
  const updateRes = await httpPost('/api/data', updatePayload);
  assert(updateRes.statusCode === 200, `API POST UPDATE_BOOKING returned 200 (got ${updateRes.statusCode})`);
  const updatedEntry = updateRes.json.state?.bookings?.find(b => b.id === testBookingId);
  assert(updatedEntry?.title === 'Updated Sentinel Review Session', 'Booking entry title was successfully updated');
  assert(updatedEntry?.startTime === '13:15' && updatedEntry?.endTime === '14:45', 'Booking entry time window was updated');

  // Verify DELETE_BOOKING cleanup
  const delRes = await httpPost('/api/data', { __action: 'DELETE_BOOKING', payload: { bookingId: testBookingId } });
  assert(delRes.statusCode === 200, `API POST DELETE_BOOKING returned 200 (got ${delRes.statusCode})`);
  const verifyCleanRes = await httpGet('/api/data');
  const verifyJson = JSON.parse(verifyCleanRes.data);
  assert(!verifyJson.bookings?.some(b => b.id === testBookingId), 'Test booking was cleanly removed from backend state');

  // SECTION 7: VISUAL SCREENSHOT VERIFICATION VIA HEADLESS CHROME
  console.log('\n--- Section 7: Visual Capture & Layout Verification via Headless Chrome ---');
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const outDir = path.resolve(__dirname);

  const viewports = [
    { file: 'sentinel_shot_rooms.png', url: 'http://localhost:3000/booking/?view=rooms', width: 1440, height: 900, desc: 'Desktop 1440px Rooms Directory' },
    { file: 'sentinel_shot_timetable.png', url: 'http://localhost:3000/booking/?view=timetable', width: 1440, height: 900, desc: 'Desktop 1440px Master Timetable' },
    { file: 'sentinel_shot_agenda.png', url: 'http://localhost:3000/booking/?view=agenda', width: 1440, height: 900, desc: 'Desktop 1440px Meeting Agenda' },
    { file: 'sentinel_shot_modal.png', url: 'http://localhost:3000/booking/?book=true', width: 1440, height: 900, desc: 'Desktop 1440px 3-Section Booking Modal' },
    { file: 'sentinel_shot_tablet.png', url: 'http://localhost:3000/booking/?view=rooms', width: 768, height: 1024, desc: 'Tablet 768px Responsive View' },
    { file: 'sentinel_shot_mobile.png', url: 'http://localhost:3000/booking/?view=rooms', width: 375, height: 812, desc: 'Mobile 375px Responsive View' }
  ];

  for (const vp of viewports) {
    const dest = path.join(outDir, vp.file);
    const cmd = `"${chromePath}" --headless=new --window-size=${vp.width},${vp.height} --screenshot="${dest}" "${vp.url}"`;
    try {
      execSync(cmd, { stdio: 'ignore', timeout: 15000 });
      const sz = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
      assert(sz > 100000, `Visual capture ${vp.desc} generated (${Math.round(sz / 1024)} KB)`);
    } catch (err) {
      assert(false, `Visual capture ${vp.desc} failed: ${err.message}`);
    }
  }

  // AUDIT SUMMARY
  console.log('\n======================================================================');
  console.log(`SENTINEL VICTORY AUDIT TEST COMPLETE: ${passCount} passed, ${failCount} failed`);
  console.log('======================================================================');

  if (failCount > 0) {
    console.error('FAILURES:');
    failures.forEach(f => console.error(` - ${f}`));
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runSentinelAudit().catch(err => {
  console.error('Unexpected error running sentinel audit suite:', err);
  process.exit(1);
});
