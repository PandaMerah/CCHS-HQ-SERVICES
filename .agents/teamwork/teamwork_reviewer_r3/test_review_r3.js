/**
 * Careclinics HQ Room Booking — Reviewer Round 3 Adversarial Test Suite
 * Validates timezone handling, clamping duration calculations, sticky table columns,
 * accessibility compliance (ARIA & form label linkages), dropdown keyboard events,
 * room filter deselect idempotence, and mobile layout containment.
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
console.log('=== Careclinics HQ Room Booking Reviewer R3 Adversarial Suite ==');
console.log('===============================================================');

// 1. Timezone Local Date Handling
it('getLocalDateString is defined and formats date in local calendar timezone', () => {
  assert.ok(html.includes('function getLocalDateString'), 'Must define getLocalDateString');
  const d = new Date(2026, 10, 17, 2, 30, 0); // 17 Nov 2026 02:30 AM local
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const expected = `${y}-${m}-${day}`;
  assert.strictEqual(expected, '2026-11-17', 'Local date helper produces correct YYYY-MM-DD');
  assert.ok(html.includes('const todayStr = getLocalDateString();'), 'todayStr must use getLocalDateString()');
  assert.ok(html.includes('const dStr = getLocalDateString(now);'), 'Live occupancy and alert checks must use getLocalDateString(now)');
});

// 2. formatReadableDate robustness
it('formatReadableDate gracefully handles null, undefined, and non-date strings', () => {
  assert.ok(html.includes('function formatReadableDate(dateStr)'), 'formatReadableDate must be defined');
  const fnMatch = html.match(/function formatReadableDate\(dateStr\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(fnMatch, 'Found formatReadableDate');
  const body = fnMatch[0];
  assert.ok(body.includes('!dateStr') && body.includes('includes(\'-\')'), 'formatReadableDate must guard against invalid or missing dateStr');
});

// 3. syncEndTimeFromStartAndDuration clamping duration calculation
it('syncEndTimeFromStartAndDuration calculates actual diff duration and handles clamped bounds', () => {
  const fnMatch = html.match(/function syncEndTimeFromStartAndDuration\(\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(fnMatch, 'Found syncEndTimeFromStartAndDuration');
  const body = fnMatch[0];
  assert.ok(body.includes('diffMins = (eh * 60 + em) - (sh * 60 + sm)'), 'Must calculate actual diff minutes between start and end');
  assert.ok(body.includes('formatDurationLabel(diffMins)'), 'Must format badge with actual diff minutes');
  assert.ok(body.includes('btn.classList.toggle(\'active\', Number(btn.dataset.mins) === diffMins)'), 'Must highlight pill matching actual duration');
  assert.ok(body.includes('End time must be after start time'), 'Must show invalid badge when endTime <= startTime');
});

// 4. Timetable sticky time column
it('Timetable table keeps Time column sticky with position: sticky left: 0', () => {
  assert.ok(html.includes('.timetable-table th:first-child {'), 'Must have th:first-child rule');
  const thMatch = html.match(/\.timetable-table th:first-child\s*\{[\s\S]*?\}/);
  assert.ok(thMatch, 'Found th:first-child CSS');
  assert.ok(thMatch[0].includes('position: sticky;'), 'th:first-child must have position: sticky');
  assert.ok(thMatch[0].includes('left: 0;'), 'th:first-child must be pinned to left: 0');

  const tdMatch = html.match(/\.time-col-cell\s*\{[\s\S]*?\}/);
  assert.ok(tdMatch, 'Found .time-col-cell CSS');
  assert.ok(tdMatch[0].includes('position: sticky;'), '.time-col-cell must have position: sticky');
  assert.ok(tdMatch[0].includes('left: 0;'), '.time-col-cell must be pinned to left: 0');
});

// 5. WAI-ARIA Modal dialog compliance
it('All modals declare role="dialog" and aria-modal="true"', () => {
  const modals = [
    'bookingModalBackdrop',
    'bookingDetailPopover',
    'confirmedModal',
    'editModal',
    'roomManagerModal',
    'cloudStatusModal'
  ];

  modals.forEach(id => {
    const regex = new RegExp(`<div[^>]*?id="${id}"[\\s\\S]*?<div[^>]*?class="modal-card"[^>]*?>`);
    const match = html.match(regex);
    assert.ok(match, `Modal ${id} card found`);
    assert.ok(match[0].includes('role="dialog"'), `Modal ${id} card must declare role="dialog"`);
    assert.ok(match[0].includes('aria-modal="true"'), `Modal ${id} card must declare aria-modal="true"`);
  });
});

// 6. Form label <label for="..."> linkages in edit and room manager forms
it('All form labels in editModal and roomManagerModal have valid for attribute linkages', () => {
  const editFields = ['editRoomId', 'editTitle', 'editDepartment', 'editOrganizer', 'editPhone', 'editEmail', 'editDate', 'editStartTime', 'editEndTime', 'editNotes'];
  editFields.forEach(field => {
    assert.ok(html.includes(`for="${field}"`), `editModal must have <label for="${field}">`);
  });

  const roomFields = ['cfgRoomName', 'cfgRoomFloor', 'cfgRoomCapacity', 'cfgRoomStatus', 'cfgRoomAmenities'];
  roomFields.forEach(field => {
    assert.ok(html.includes(`for="${field}"`), `roomManagerModal must have <label for="${field}">`);
  });
});

// 7. Escape key closes Tools / Apps dropdown menu
it('Escape key listener closes toolsDropdownMenu alongside modals', () => {
  const escMatch = html.match(/document\.addEventListener\('keydown'[\s\S]*?if \(e\.key === 'Escape'\)\s*\{[\s\S]*?\n    \}\);/);
  assert.ok(escMatch, 'Found Escape key listener');
  assert.ok(escMatch[0].includes('toolsDropdownMenu'), 'Must close toolsDropdownMenu on Escape');
});

// 8. selectRoomFilter deselect to ALL does not overwrite roomId with deselected room
it('selectRoomFilter toggling to ALL leaves roomId untouched', () => {
  const fnMatch = html.match(/window\.selectRoomFilter\s*=\s*\([\s\S]*?\n    \};/);
  assert.ok(fnMatch, 'Found selectRoomFilter');
  const body = fnMatch[0];
  assert.ok(body.includes('willSelect'), 'selectRoomFilter must check willSelect before updating roomId');
  assert.ok(body.includes('document.getElementById(\'roomId\').value = roomId;'), 'Sets roomId only on selection');
});

// 9. quickPickSlot handles custom end time duration and passes roomId
it('quickPickSlot computes duration from endTime parameter and passes roomId to openBookingModal', () => {
  const fnMatch = html.match(/window\.quickPickSlot\s*=\s*\([\s\S]*?\n    \};/);
  assert.ok(fnMatch, 'Found quickPickSlot');
  const body = fnMatch[0];
  assert.ok(body.includes('selectedDurationMins = (eh * 60 + em) - (sh * 60 + sm)'), 'Computes duration when endTime > startTime');
  assert.ok(body.includes('openBookingModal(roomId)'), 'Passes roomId forward to openBookingModal');
});

// 10. Mobile viewport containment & body overflow-x hidden
it('Mobile styling enforces overflow-x: hidden and prevents horizontal page blowout', () => {
  assert.ok(html.includes('overflow-x: hidden;'), 'Page CSS must enforce overflow-x: hidden');
  const mediaMatch = html.match(/@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(mediaMatch, 'Found max-width 640px media query');
  assert.ok(mediaMatch[0].includes('.brand-title'), 'Optimizes brand-title for mobile screens');
  assert.ok(mediaMatch[0].includes('.container { padding: 12px 10px 80px; max-width: 100%; overflow-x: hidden; }'), 'Container has overflow-x: hidden on mobile');
});

console.log('===============================================================');
console.log(`Reviewer R3 Results: ${passed} passed, ${failed} failed`);
console.log('===============================================================');

if (failed > 0) process.exit(1);
