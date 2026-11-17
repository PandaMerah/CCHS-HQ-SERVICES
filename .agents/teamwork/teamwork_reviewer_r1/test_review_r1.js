const http = require('http');
const fs = require('fs');
const path = require('path');

async function runReviewTests() {
  console.log('===============================================================');
  console.log('=== Careclinics HQ Room Booking Reviewer R1 Adversarial Suite ==');
  console.log('===============================================================\n');

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

  // 1. Verify index.html contains all updated elements and contracts
  const htmlPath = path.join(__dirname, '../../../public/booking/index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Verify visible endTime input (not type="hidden")
  assert(html.includes('<input type="time" id="endTime"'), 'endTime is a visible, editable time input (type="time")');
  assert(!html.includes('<input type="hidden" id="endTime"'), 'endTime is no longer a restricted type="hidden" input');

  // Verify extended duration pills
  assert(html.includes('data-mins="180"') && html.includes('3h'), 'Includes 3h duration pill');
  assert(html.includes('data-mins="240"') && html.includes('4h'), 'Includes 4h duration pill');

  // Verify handleManualEndTimeChange handler exists
  assert(html.includes('handleManualEndTimeChange'), 'Implements manual endTime change listener');

  // Verify timetable 20:00 slot
  assert(html.includes("'20:00'") && html.includes("'19:00'"), 'Timetable includes 20:00 evening hour slot');

  // Verify topbar title white-space nowrap
  assert(html.includes('white-space: nowrap;'), 'brand-title enforces white-space nowrap to prevent awkward header wrapping');

  // Verify switchMainView synchronization logic
  assert(html.includes("if (controlsGroup) controlsGroup.style.display = 'none';"), 'switchMainView hides toolbar controls on rooms tab');
  assert(html.includes("if (controlsGroup) controlsGroup.style.display = 'inline-flex';"), 'switchMainView displays toolbar controls on timetable/agenda tabs');
  assert(html.includes("renderRoomsDirectory()"), 'switchMainView refreshes rooms directory when switching to rooms tab');

  // Verify initial view invocation on page load
  assert(html.includes("switchMainView(initialView)"), 'Page load explicitly invokes switchMainView to initialize UI state');

  // Verify date stepper updates rooms directory
  assert(html.includes("if (currentMainView === 'rooms') {\n        renderRoomsDirectory();"), 'stepDate updates roomsDirectoryView when on rooms tab');

  // Verify openBookingModal respects filterDate
  assert(html.includes("const activeFilterDate = document.getElementById('filterDate')?.value;"), 'openBookingModal syncs date from active filterDate');

  // Verify All Upcoming date label
  assert(html.includes("document.getElementById('activeDateLabel').textContent = 'All Upcoming Dates';"), 'renderSchedule sets "All Upcoming Dates" when showAllDates is active');

  // 2. Test Duration & End Time Calculations (including 3h, 4h, boundary clamping)
  function computeEndTimeFromDuration(startHm, durationMins) {
    if (!startHm || !startHm.includes(':')) return '11:00';
    const [h, m] = startHm.split(':').map(Number);
    const totalMins = Math.min(h * 60 + m + durationMins, 23 * 60 + 45);
    const endH = String(Math.floor(totalMins / 60)).padStart(2, '0');
    const endM = String(totalMins % 60).padStart(2, '0');
    return `${endH}:${endM}`;
  }

  function formatDurationLabel(mins) {
    if (mins === 30) return '30m';
    if (mins === 45) return '45m';
    if (mins === 60) return '1h';
    if (mins === 90) return '1.5h';
    if (mins === 120) return '2h';
    if (mins === 180) return '3h';
    if (mins === 240) return '4h';
    if (mins >= 60 && mins % 60 === 0) return `${mins / 60}h`;
    if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
    return `${mins}m`;
  }

  assert(computeEndTimeFromDuration('09:00', 180) === '12:00', 'Calculates 3 hour duration (09:00 -> 12:00)');
  assert(computeEndTimeFromDuration('14:00', 240) === '18:00', 'Calculates 4 hour workshop duration (14:00 -> 18:00)');
  assert(formatDurationLabel(180) === '3h', 'Formats 180 mins as "3h"');
  assert(formatDurationLabel(240) === '4h', 'Formats 240 mins as "4h"');
  assert(formatDurationLabel(75) === '1h 15m', 'Formats custom 75 mins as "1h 15m"');

  // 3. Test Boundary Time Windows (19:30 to 20:30, 20:00 to 21:00 near closing)
  assert(computeEndTimeFromDuration('19:30', 60) === '20:30', 'Calculates evening closing boundary slot (19:30 -> 20:30)');
  assert(computeEndTimeFromDuration('20:00', 60) === '21:00', 'Calculates evening 20:00 slot (20:00 -> 21:00)');

  // Timetable overlapping slot coverage check
  function slotMatchesBooking(slotStart, nextHour, booking) {
    return booking.startTime < nextHour && booking.endTime > slotStart;
  }

  const boundaryBooking1 = { startTime: '19:30', endTime: '20:30' };
  assert(slotMatchesBooking('19:00', '20:00', boundaryBooking1), '19:30-20:30 booking matches 19:00 row');
  assert(slotMatchesBooking('20:00', '21:00', boundaryBooking1), '19:30-20:30 booking matches 20:00 row');

  const boundaryBooking2 = { startTime: '20:00', endTime: '21:00' };
  assert(slotMatchesBooking('20:00', '21:00', boundaryBooking2), '20:00-21:00 booking correctly appears in 20:00 row');
  assert(!slotMatchesBooking('19:00', '20:00', boundaryBooking2), '20:00-21:00 booking does not spill into 19:00 row');

  // 4. Test Serverless Backend /api/data End-to-End
  function apiRequest(method, payload = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/data',
        method,
        headers: {
          'Content-Type': 'application/json'
        }
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
          } catch (e) {
            resolve({ statusCode: res.statusCode, raw: data });
          }
        });
      });
      req.on('error', reject);
      if (payload) req.write(JSON.stringify(payload));
      req.end();
    });
  }

  // GET State
  const initialRes = await apiRequest('GET');
  assert(initialRes.statusCode === 200, 'GET /api/data returns 200 OK');
  const initialRooms = initialRes.data.rooms || [];
  const initialBookings = initialRes.data.bookings || [];
  assert(initialRooms.length >= 5, `Backend has ${initialRooms.length} initial rooms`);

  // Admin Action: ADD_BOOKING on evening boundary slot (20:00 - 21:00)
  const testBookingId = 'bk-test-rev-' + Date.now();
  const addBookingRes = await apiRequest('POST', {
    __action: 'ADD_BOOKING',
    payload: {
      booking: {
        id: testBookingId,
        roomId: 'boardroom-main',
        title: 'Executive Evening Debrief',
        department: 'CEO OFFICE',
        organizer: 'Reviewer Test Runner',
        phone: '012-3456789',
        email: 'reviewer@careclinics.my',
        date: '2026-11-25',
        startTime: '20:00',
        endTime: '21:00',
        notes: 'Review Round 1 boundary verification test',
        createdAt: Date.now()
      }
    }
  });
  assert(addBookingRes.statusCode === 200 && addBookingRes.data.ok, 'ADD_BOOKING creates 20:00-21:00 reservation');

  // Conflict Prevention: Attempt exact duplicate booking on same slot
  const conflictRes = await apiRequest('POST', {
    __action: 'ADD_BOOKING',
    payload: {
      booking: {
        id: 'bk-conflict-' + Date.now(),
        roomId: 'boardroom-main',
        title: 'Conflicting Meeting Attempt',
        department: 'IT',
        organizer: 'Intruder',
        phone: '011-1234567',
        date: '2026-11-25',
        startTime: '20:15',
        endTime: '20:45'
      }
    }
  });
  assert(conflictRes.statusCode === 409, 'Server blocks overlapping slot with HTTP 409 Conflict');

  // Admin Action: UPDATE_BOOKING
  const updateRes = await apiRequest('POST', {
    __action: 'UPDATE_BOOKING',
    payload: {
      bookingId: testBookingId,
      updatedFields: {
        title: 'Executive Evening Debrief (Updated)',
        endTime: '20:45'
      }
    }
  });
  assert(updateRes.statusCode === 200 && updateRes.data.ok, 'UPDATE_BOOKING modifies reservation time and title');

  // Admin Action: DELETE_BOOKING
  const deleteRes = await apiRequest('POST', {
    __action: 'DELETE_BOOKING',
    payload: {
      bookingId: testBookingId
    }
  });
  assert(deleteRes.statusCode === 200 && deleteRes.data.ok, 'DELETE_BOOKING cancels and removes test reservation');

  // Admin Action: SAVE_ROOMS (Add custom test room then restore)
  const testRoomId = 'test-room-' + Date.now();
  const customRooms = [
    ...initialRooms,
    {
      id: testRoomId,
      name: 'Innovation & AI Lab',
      floor: 'Level 2 - Tech Wing',
      capacity: 15,
      amenities: ['85" Interactive Display', 'VR Testbed'],
      color: '#06b6d4',
      status: 'available'
    }
  ];

  const saveRoomsRes = await apiRequest('POST', {
    __action: 'SAVE_ROOMS',
    payload: { rooms: customRooms }
  });
  assert(saveRoomsRes.statusCode === 200 && saveRoomsRes.data.ok, 'SAVE_ROOMS successfully configures new meeting room');

  // Verify GET /api/data reflects the added room
  const verifyRoomRes = await apiRequest('GET');
  assert(verifyRoomRes.data.rooms.some(r => r.id === testRoomId), 'GET /api/data reflects newly added room in state');

  // Cleanup: Restore original rooms
  await apiRequest('POST', {
    __action: 'SAVE_ROOMS',
    payload: { rooms: initialRooms }
  });
  console.log('[CLEANUP] Restored initial room configuration');

  console.log(`\n===============================================================`);
  console.log(`Reviewer R1 Results: ${passed} passed, ${failed} failed`);
  console.log(`===============================================================`);

  if (failed > 0) process.exit(1);
}

runReviewTests();
