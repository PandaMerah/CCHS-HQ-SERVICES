const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '../../../public/booking/index.html'), 'utf8');
const lines = html.split('\n');

lines.forEach((l, i) => {
  if (l.includes('role=') || l.includes('aria-')) {
    console.log(`${i + 1}: ${l.trim()}`);
  }
});
