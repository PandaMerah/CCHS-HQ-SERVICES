const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '../../../public/booking/index.html'), 'utf8');
const scriptStart = html.indexOf('<script type="module">');
const script = html.slice(scriptStart);

// Let's inspect event listeners and window attachments
const listeners = [];
const listenerRegex = /\.addEventListener\(['"]([^'"]+)['"]/g;
let m;
while ((m = listenerRegex.exec(script)) !== null) {
  listeners.push(m[1]);
}
console.log('Event listeners attached on types:', [...new Set(listeners)]);

// Let's check keyboard events
const keyListeners = script.match(/keydown|keyup|keypress/g);
console.log('Key events in script:', keyListeners);

// Let's check Escape key handling
const escMatch = script.match(/Escape|keyCode === 27|key === 'Escape'/g);
console.log('Escape key checks:', escMatch);
