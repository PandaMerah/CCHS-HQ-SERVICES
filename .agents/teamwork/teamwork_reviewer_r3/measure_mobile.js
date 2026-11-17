const { execSync } = require('child_process');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const script = `
const topbar = document.querySelector('.topbar');
const brand = document.querySelector('.brand-left');
const nav = document.querySelector('.nav-links');
const items = Array.from(nav.children).map(c => ({ tag: c.tagName, id: c.id, width: c.getBoundingClientRect().width }));
console.log(JSON.stringify({
  topbarWidth: topbar.getBoundingClientRect().width,
  brandWidth: brand.getBoundingClientRect().width,
  navWidth: nav.getBoundingClientRect().width,
  items
}));
`;

const b64 = Buffer.from(script).toString('base64');
const cmd = `"${chromePath}" --headless=new --window-size=375,812 --dump-dom http://localhost:3000/booking/`;
console.log('Running dump-dom...');
try {
  const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  console.log('DOM length:', out.length);
} catch (e) {
  console.error(e.message);
}
