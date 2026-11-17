const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outDir = path.resolve(__dirname);

const targets = [
  { name: 'shot_r3_rooms.png', url: 'http://localhost:3000/booking/?view=rooms', width: 1280, height: 800 },
  { name: 'shot_r3_timetable.png', url: 'http://localhost:3000/booking/?view=timetable', width: 1280, height: 800 },
  { name: 'shot_r3_agenda.png', url: 'http://localhost:3000/booking/?view=agenda', width: 1280, height: 800 },
  { name: 'shot_r3_mobile.png', url: 'http://localhost:3000/booking/', width: 375, height: 812 },
  { name: 'shot_r3_modal.png', url: 'http://localhost:3000/booking/?book=true', width: 1280, height: 800 }
];

targets.forEach(t => {
  const dest = path.join(outDir, t.name);
  const cmd = `"${chromePath}" --headless=new --window-size=${t.width},${t.height} --screenshot="${dest}" ${t.url}`;
  try {
    execSync(cmd, { stdio: 'ignore', timeout: 15000 });
    const sz = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    console.log(`[OK] ${t.name} created (${Math.round(sz / 1024)} KB)`);
  } catch (err) {
    console.error(`[ERR] ${t.name}:`, err.message);
  }
});
