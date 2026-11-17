const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '../../../public/booking/index.html'), 'utf8');

// Find editModal HTML
const editModalMatch = html.match(/<div[^>]*id="editModal"[\s\S]*?<\/form>\s*<\/div>\s*<\/div>/);
if (editModalMatch) {
  console.log('Edit Modal HTML:\n', editModalMatch[0].slice(0, 1500));
}

// Find edit modal script functions
const editFns = ['openEditBooking', 'closeEditBooking'];
editFns.forEach(fn => {
  const m = html.match(new RegExp(`(?:window\\.)?${fn}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*\\{[\\s\\S]*?\\n\\s*\\};?`));
  if (m) console.log(`\n--- ${fn} ---\n`, m[0]);
});

// Find editBookingForm submit listener
const submitMatch = html.match(/document\.getElementById\('editBookingForm'\)\.addEventListener[\s\S]*?\n\s*\}\);/);
if (submitMatch) {
  console.log('\n--- editBookingForm submit listener ---\n', submitMatch[0]);
}
