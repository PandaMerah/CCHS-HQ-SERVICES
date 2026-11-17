const fs = require('fs');
const bookingHtml = fs.readFileSync('public/booking/index.html', 'utf8');
const scriptTags = [...bookingHtml.matchAll(/<script[^>]*src=["']([^"']+)["']/g)].map(m => m[1]);
console.log('External scripts loaded in booking/index.html:', scriptTags);
