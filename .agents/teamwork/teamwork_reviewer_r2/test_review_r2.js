/**
 * Careclinics HQ Room Booking — Reviewer Round 2 Adversarial Test Suite
 * Validates UX edge cases, view state synchronization, error boundaries,
 * mobile responsiveness, and slot duration handling.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passed = 0;
let failed = 0;

function it(description, fn) {
  try {
    fn();
    console.log(`[PASS] ${description}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${description}`);
    console.error(err.message);
    failed++;
  }
}

const htmlPath = path.resolve(__dirname, '../../../public/booking/index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

console.log('===============================================================');
console.log('=== Careclinics HQ Room Booking Reviewer R2 Adversarial Suite ==');
console.log('===============================================================');

// 1. handleManualEndTimeChange validation & badge handling
it('handleManualEndTimeChange handles invalid end times with else branch', () => {
  assert.ok(html.includes('handleManualEndTimeChange'), 'Must define handleManualEndTimeChange');
  const fnMatch = html.match(/function handleManualEndTimeChange\(\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(fnMatch, 'Found handleManualEndTimeChange body');
  const fnBody = fnMatch[0];
  assert.ok(fnBody.includes('btn.classList.remove(\'active\')'), 'Must clear active duration pill when endTime <= startTime');
  assert.ok(fnBody.includes('End time must be after start time'), 'Must display informative error message in computedTimeBadge');
});

// 2. Toolbar & View State Synchronization
it('syncToolbarViewControls helper function is defined and handles all 3 toolbar states', () => {
  assert.ok(html.includes('function syncToolbarViewControls()'), 'syncToolbarViewControls must be defined');
  const fnMatch = html.match(/function syncToolbarViewControls\(\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(fnMatch, 'Found syncToolbarViewControls');
  const fnBody = fnMatch[0];
  assert.ok(fnBody.includes('btnViewGrid'), 'Must sync btnViewGrid');
  assert.ok(fnBody.includes('btnViewList'), 'Must sync btnViewList');
  assert.ok(fnBody.includes('btnShowAllDates'), 'Must sync btnShowAllDates');
  assert.ok(fnBody.includes('btnShowToday'), 'Must sync btnShowToday');
});

it('switchMainView resets showAllDates to false when switching to timetable or rooms', () => {
  const fnMatch = html.match(/window\.switchMainView\s*=\s*\([\s\S]*?\n    \};/);
  assert.ok(fnMatch, 'Found switchMainView');
  const fnBody = fnMatch[0];
  // Rooms branch resets showAllDates
  assert.ok(fnBody.includes("viewName === 'rooms'") && fnBody.includes('showAllDates = false;'), 'Rooms switch must reset showAllDates');
  // Timetable branch resets showAllDates
  assert.ok(fnBody.includes("viewName === 'timetable'") && fnBody.includes('showAllDates = false;'), 'Timetable switch must reset showAllDates');
});

it('setScheduleViewMode resets showAllDates to false when switching views', () => {
  const fnMatch = html.match(/window\.setScheduleViewMode\s*=\s*\([\s\S]*?\n    \};/);
  assert.ok(fnMatch, 'Found setScheduleViewMode');
  assert.ok(fnMatch[0].includes('showAllDates = false;'), 'setScheduleViewMode must reset showAllDates to allow exiting All Upcoming');
});

// 3. Room Filter & Card Schedule Button
it('selectRoomFilter supports forceSelect parameter to prevent accidental toggling to ALL', () => {
  const fnMatch = html.match(/window\.selectRoomFilter\s*=\s*\([\s\S]*?\n    \};/);
  assert.ok(fnMatch, 'Found selectRoomFilter');
  assert.ok(fnMatch[0].includes('forceSelect = false'), 'Must accept forceSelect parameter');
  assert.ok(fnMatch[0].includes('!forceSelect && filterRoom.value === roomId'), 'Must check !forceSelect before toggling to ALL');
});

it('Room card timetable button uses forceSelect=true so clicking Timetable never deselects the room', () => {
  assert.ok(html.includes("selectRoomFilter('${room.id}', true)"), 'btn-card-schedule must pass forceSelect=true');
});

// 4. View-aware scheduleSubtitle
it('renderSchedule only sets subtitle for timetable and agenda, not clobbering roomsDirectoryView', () => {
  const fnMatch = html.match(/function renderSchedule\(\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(fnMatch, 'Found renderSchedule');
  const fnBody = fnMatch[0];
  assert.ok(fnBody.includes("currentMainView === 'timetable'"), 'Must check for timetable view');
  assert.ok(fnBody.includes("currentMainView === 'agenda'"), 'Must check for agenda view');
  assert.ok(!fnBody.includes("if (currentMainView === 'rooms')"), 'renderSchedule should not set subtitle for rooms');
});

it('renderRoomsDirectory sets appropriate subtitle for rooms directory view', () => {
  const fnMatch = html.match(/function renderRoomsDirectory\(\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(fnMatch, 'Found renderRoomsDirectory');
  assert.ok(fnMatch[0].includes('scheduleSubtitle'), 'Must update scheduleSubtitle for rooms directory');
});

// 5. Timetable Empty State
it('renderSchedule renders clean empty-state-card when visibleRooms is empty', () => {
  const fnMatch = html.match(/function renderSchedule\(\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(fnMatch, 'Found renderSchedule');
  const fnBody = fnMatch[0];
  assert.ok(fnBody.includes('visibleRooms.length === 0'), 'Must check for empty visibleRooms');
  assert.ok(fnBody.includes('No Meeting Rooms Available'), 'Must show helpful empty state headline');
});

// 6. openBookingModal Maintenance Room Fallback
it('openBookingModal falls back to first available room if currently selected room is in maintenance', () => {
  const fnMatch = html.match(/window\.openBookingModal\s*=\s*\([\s\S]*?\n    \};/);
  assert.ok(fnMatch, 'Found openBookingModal');
  const fnBody = fnMatch[0];
  assert.ok(fnBody.includes('status === \'maintenance\''), 'Must check if current room is in maintenance');
  assert.ok(fnBody.includes('status !== \'maintenance\''), 'Must find available room as fallback');
});

// 7. Booking Submission & Toolbar State Sync
it('bookingForm submit listener syncs toolbar view controls after creating reservation', () => {
  const fnMatch = html.match(/document\.getElementById\('bookingForm'\)\.addEventListener\('submit'[\s\S]*?\n    \}\);/);
  assert.ok(fnMatch, 'Found submit listener');
  assert.ok(fnMatch[0].includes('syncToolbarViewControls()'), 'Must call syncToolbarViewControls() in submit listener');
});

// 8. Error handling in cancelBooking
it('cancelBooking wraps deleteRoomBooking in try-catch to prevent unhandled rejections', () => {
  const fnMatch = html.match(/window\.cancelBooking\s*=\s*async\s*\([\s\S]*?\n    \};/);
  assert.ok(fnMatch, 'Found cancelBooking');
  const fnBody = fnMatch[0];
  assert.ok(fnBody.includes('try {'), 'Must have try block');
  assert.ok(fnBody.includes('catch (err) {'), 'Must catch errors');
});

// 9. Mobile Responsive Polish
it('view-mode-tabs has horizontal scrollability on narrow viewports', () => {
  assert.ok(html.includes('.view-mode-tabs {'), 'Has .view-mode-tabs rule');
  assert.ok(html.includes('overflow-x: auto;'), 'Must have overflow-x: auto on tabs');
  assert.ok(html.includes('-webkit-overflow-scrolling: touch;'), 'Must have touch scrolling for mobile devices');
});

it('@media (max-width: 640px) optimizes topbar, date navigation, and badges for mobile', () => {
  const mediaMatch = html.match(/@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(mediaMatch, 'Found max-width 640px media query');
  const mediaBody = mediaMatch[0];
  assert.ok(mediaBody.includes('.date-nav-group { flex-wrap: wrap; }'), 'Date nav group must wrap on small screens');
  assert.ok(mediaBody.includes('#cloudSyncLabel { display: none; }'), 'Cloud sync label hidden on mobile to prevent topbar overflow');
  assert.ok(mediaBody.includes('.nav-btn.primary-cta { display: none; }'), 'Topbar CTA hidden on mobile in favor of floating action button');
});

console.log('===============================================================');
console.log(`Reviewer R2 Results: ${passed} passed, ${failed} failed`);
console.log('===============================================================');

if (failed > 0) process.exit(1);
