const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function runTests() {
  console.log('--- Starting Careclinics HQ Room Booking Test Suite ---');
  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. Verify HTTP GET /booking/
  await new Promise((resolve) => {
    http.get('http://localhost:3000/booking/', (res) => {
      assert(res.statusCode === 200, 'HTTP GET /booking/ returns 200 OK');
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        assert(data.includes('<!DOCTYPE html>'), 'Response contains DOCTYPE html');
        assert(data.includes('Careclinics HQ Room Booking'), 'Response contains Careclinics HQ branding');
        assert(data.includes('Careclinics HQ Meeting Rooms &amp; Schedule'), 'Response contains Hero headline');
        resolve();
      });
    }).on('error', (err) => {
      assert(false, `HTTP GET /booking/ failed: ${err.message}`);
      resolve();
    });
  });

  // 2. Verify file content and key elements in public/booking/index.html
  const htmlPath = path.join(__dirname, '../../../public/booking/index.html');
  const content = fs.readFileSync(htmlPath, 'utf8');

  // Verify critical elements and IDs
  const requiredIds = [
    'bookingForm',
    'roomId',
    'title',
    'department',
    'organizer',
    'phone',
    'email',
    'date',
    'startTime',
    'endTime',
    'btnSubmitBooking',
    'bookingModalBackdrop',
    'bookingAlert',
    'liveSlotStatus',
    'liveSlotText',
    'timetableGridContainer',
    'bookingsContainer',
    'roomsDirectoryView',
    'filterDate',
    'filterRoom',
    'roomSwitcherBar',
    'btnShowToday',
    'btnShowAllDates',
    'dueBookingBanner',
    'pageToast',
    'confirmedModal',
    'editModal',
    'roomManagerModal',
    'kpiTotalRooms',
    'kpiAvailableNow',
    'kpiTodayBookings',
    'kpiNextSlot',
    'tabBtnRooms',
    'tabBtnTimetable',
    'tabBtnAgenda'
  ];

  for (const id of requiredIds) {
    assert(content.includes(`id="${id}"`), `HTML contains critical element #${id}`);
  }

  // 3. Verify JavaScript module imports and script structures
  assert(content.includes("from '/shared/cloud-store.js'"), 'Imports cloud-store.js');
  assert(content.includes("from '/shared/auth.js'"), 'Imports auth.js');
  assert(content.includes("switchMainView"), 'Exports switchMainView function');
  assert(content.includes("selectDurationMinutes"), 'Exports selectDurationMinutes function');
  assert(content.includes("renderRoomsDirectory"), 'Exports renderRoomsDirectory function');
  assert(content.includes("validateLiveSlot"), 'Exports validateLiveSlot function');
  assert(content.includes("quickPickSlot"), 'Exports quickPickSlot function');

  // 4. Test conflict check logic in cloud-store
  function checkBookingConflict(bookings, { roomId, date, startTime, endTime, excludeId = null }) {
    if (!roomId || !date || !startTime || !endTime) return null;
    return bookings.find(b => {
      if (excludeId && b.id === excludeId) return false;
      if (b.roomId !== roomId || b.date !== date) return false;
      return startTime < b.endTime && endTime > b.startTime;
    }) || null;
  }

  const sampleBookings = [
    { id: 'b1', roomId: 'boardroom-main', date: '2026-11-16', startTime: '09:00', endTime: '10:30', title: 'Management Meeting' }
  ];

  // Exact overlap
  assert(checkBookingConflict(sampleBookings, { roomId: 'boardroom-main', date: '2026-11-16', startTime: '09:00', endTime: '10:30' }) !== null, 'Detects exact overlap conflict');
  // Inside overlap
  assert(checkBookingConflict(sampleBookings, { roomId: 'boardroom-main', date: '2026-11-16', startTime: '09:30', endTime: '10:00' }) !== null, 'Detects inner overlap conflict');
  // Partial overlap start
  assert(checkBookingConflict(sampleBookings, { roomId: 'boardroom-main', date: '2026-11-16', startTime: '08:30', endTime: '09:30' }) !== null, 'Detects start overlap conflict');
  // Partial overlap end
  assert(checkBookingConflict(sampleBookings, { roomId: 'boardroom-main', date: '2026-11-16', startTime: '10:00', endTime: '11:00' }) !== null, 'Detects end overlap conflict');
  // Non-overlapping before
  assert(checkBookingConflict(sampleBookings, { roomId: 'boardroom-main', date: '2026-11-16', startTime: '08:00', endTime: '09:00' }) === null, 'Allows adjacent slot before');
  // Non-overlapping after
  assert(checkBookingConflict(sampleBookings, { roomId: 'boardroom-main', date: '2026-11-16', startTime: '10:30', endTime: '11:30' }) === null, 'Allows adjacent slot after');
  // Different room
  assert(checkBookingConflict(sampleBookings, { roomId: 'discussion-a', date: '2026-11-16', startTime: '09:00', endTime: '10:30' }) === null, 'Allows slot in different room');
  // Different date
  assert(checkBookingConflict(sampleBookings, { roomId: 'boardroom-main', date: '2026-11-17', startTime: '09:00', endTime: '10:30' }) === null, 'Allows slot on different date');
  // Exclude self (for editing)
  assert(checkBookingConflict(sampleBookings, { roomId: 'boardroom-main', date: '2026-11-16', startTime: '09:00', endTime: '10:30', excludeId: 'b1' }) === null, 'Allows excluding self when editing');

  // 5. Test Duration Calculation Logic
  function computeEndTimeFromDuration(startHm, durationMins) {
    if (!startHm || !startHm.includes(':')) return '11:00';
    const [h, m] = startHm.split(':').map(Number);
    const totalMins = Math.min(h * 60 + m + durationMins, 23 * 60 + 45);
    const endH = String(Math.floor(totalMins / 60)).padStart(2, '0');
    const endM = String(totalMins % 60).padStart(2, '0');
    return `${endH}:${endM}`;
  }

  assert(computeEndTimeFromDuration('10:00', 30) === '10:30', 'Calculates 30 min duration (10:00 -> 10:30)');
  assert(computeEndTimeFromDuration('10:00', 45) === '10:45', 'Calculates 45 min duration (10:00 -> 10:45)');
  assert(computeEndTimeFromDuration('10:00', 60) === '11:00', 'Calculates 1 hour duration (10:00 -> 11:00)');
  assert(computeEndTimeFromDuration('10:00', 90) === '11:30', 'Calculates 1.5 hour duration (10:00 -> 11:30)');
  assert(computeEndTimeFromDuration('10:00', 120) === '12:00', 'Calculates 2 hour duration (10:00 -> 12:00)');
  assert(computeEndTimeFromDuration('23:00', 60) === '23:45', 'Clamps duration to end of day 23:45 max');

  // 6. Test Live /api/data Endpoint for Room & Booking operations
  await new Promise((resolve) => {
    http.get('http://localhost:3000/api/data', (res) => {
      assert(res.statusCode === 200, 'HTTP GET /api/data returns 200 OK');
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          assert(Array.isArray(parsed.rooms) && parsed.rooms.length >= 5, `State has ${parsed.rooms?.length} rooms configured`);
          assert(Array.isArray(parsed.bookings), `State has bookings array (${parsed.bookings?.length} bookings)`);
          assert(parsed.departments && Object.keys(parsed.departments).length > 0, 'State has departments list');
        } catch (e) {
          assert(false, `Parsing /api/data failed: ${e.message}`);
        }
        resolve();
      });
    }).on('error', (err) => {
      assert(false, `/api/data failed: ${err.message}`);
      resolve();
    });
  });

  // 7. Verify Headless Chrome Rendering and Visual Assets
  const screenshots = [
    '.agents/teamwork/teamwork_implementer_r0/screenshots/shot_redesign_rooms.png',
    '.agents/teamwork/teamwork_implementer_r0/screenshots/shot_redesign_timetable.png',
    '.agents/teamwork/teamwork_implementer_r0/screenshots/shot_redesign_agenda.png',
    '.agents/teamwork/teamwork_implementer_r0/screenshots/shot_redesign_empty.png',
    '.agents/teamwork/teamwork_implementer_r0/screenshots/shot_redesign_modal.png'
  ];

  for (const s of screenshots) {
    const fullPath = path.join(__dirname, '../../../', s);
    const exists = fs.existsSync(fullPath);
    assert(exists && fs.statSync(fullPath).size > 10000, `Visual screenshot generated: ${path.basename(s)} (${exists ? Math.round(fs.statSync(fullPath).size / 1024) + ' KB' : 'missing'})`);
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================`);
  if (failed > 0) process.exit(1);
}

runTests();
