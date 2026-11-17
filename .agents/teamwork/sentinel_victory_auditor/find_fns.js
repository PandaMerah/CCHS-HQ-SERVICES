const fs = require('fs');
const lines = fs.readFileSync('public/booking/index.html', 'utf8').split('\n');
lines.forEach((line, i) => {
  if (line.includes('addRoomBooking') || line.includes('checkBookingConflict') || line.includes('buildOutlookCalendarUrls')) {
    console.log((i+1) + ': ' + line.trim());
  }
});
