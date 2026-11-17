const fs = require('fs');
const html = fs.readFileSync('public/booking/index.html', 'utf8');

// Agenda container
const agendaMatches = html.match(/id="[^"]*agenda[^"]*"/gi);
console.log('Agenda element IDs:', agendaMatches);

// Modal container
const modalMatches = html.match(/id="[^"]*modal[^"]*"/gi);
console.log('Modal element IDs:', modalMatches);

// Empty state text
const lines = html.split('\n');
lines.forEach((l, i) => {
  if (l.includes('empty-state') || l.includes('No Rooms') || l.includes('No Meetings')) {
    console.log((i+1) + ': ' + l.trim());
  }
});
