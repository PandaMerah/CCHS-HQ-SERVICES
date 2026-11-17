// Check how HTMLSelectElement behaves when setting value before options exist
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const dom = new JSDOM('<select id="test"></select>');
const sel = dom.window.document.getElementById('test');
sel.value = 'room-2';
console.log('Value after setting without options:', JSON.stringify(sel.value));

sel.innerHTML = '<option value="room-1">Room 1</option><option value="room-2">Room 2</option>';
console.log('Value after populating options:', JSON.stringify(sel.value));
