const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '../../../public/booking/index.html'), 'utf8');

// Find all elements with class modal or backdrop
const matches = html.match(/<div[^>]*?(?:class="[^"]*modal[^"]*"|id="[^"]*Modal[^"]*")[^>]*>/gi);
console.log('Modals found:', matches);

// Check click outside listeners
console.log('\n--- Checking click listeners on modals/backdrops ---');
const clickListeners = html.match(/addEventListener\(['"]click['"],[\s\S]*?\);/g) || [];
clickListeners.forEach((cl, i) => {
  console.log(`Click listener ${i + 1}:`, cl.slice(0, 120).replace(/\n/g, ' '));
});
