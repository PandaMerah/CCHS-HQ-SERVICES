const http = require('http');

// Let's inspect the HTML of the topbar
const fs = require('fs');
const html = fs.readFileSync('public/booking/index.html', 'utf8');

const topbarHtml = html.match(/<header class="topbar">[\s\S]*?<\/header>/)[0];
console.log('Topbar HTML:\n', topbarHtml);
