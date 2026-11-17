const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '../../../public/booking/index.html'), 'utf8');

console.log('HTML length:', html.length);

// Extract all functions in script
const scriptStart = html.indexOf('<script type="module">');
const scriptEnd = html.lastIndexOf('</script>');
const script = html.slice(scriptStart, scriptEnd);

console.log('Script length:', script.length);

// Find function definitions
const fnRegex = /(?:function\s+([a-zA-Z0-9_$]+)|window\.([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:function|\()|const\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>)/g;
let match;
const functions = new Set();
while ((match = fnRegex.exec(script)) !== null) {
  functions.add(match[1] || match[2] || match[3]);
}

console.log('Total functions found:', functions.size);
console.log('Functions:', Array.from(functions).sort().join(', '));
