const http = require('http');
const fs = require('fs');
const path = require('path');
const apiDataHandler = require('./api/data.js');
const apiAuthHandler = require('./api/auth.js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

// Route aliases matching vercel.json rewrites
const ROUTE_ALIASES = {
  '/': '/index.html',
  '/login': '/login.html',
  '/admin': '/admin/index.html',
  '/admin/': '/admin/index.html',
  '/meeting': '/meeting/index.html',
  '/meeting/': '/meeting/index.html',
  '/input.html': '/meeting/input.html',
  '/admin.html': '/meeting/admin.html',
  '/booking': '/booking/index.html',
  '/booking/': '/booking/index.html',
  '/display': '/display/index.html',
  '/display/': '/display/index.html',
  '/pdf': '/pdf/index.html',
  '/pdf/': '/pdf/index.html',
  '/pdf-editor': '/pdf/index.html'
};

function invokeServerlessHandler(handler, req, res) {
  let rawBody = '';
  req.on('data', chunk => { rawBody += chunk; });
  req.on('end', () => {
    try {
      req.body = rawBody ? JSON.parse(rawBody) : {};
    } catch (e) {
      req.body = {};
    }
    res.status = (code) => {
      res.statusCode = code;
      return {
        json: (obj) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(obj));
        },
        end: () => res.end()
      };
    };
    handler(req, res);
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Handle /api/data and /api/auth serverless endpoints locally
  if (pathname === '/api/data') {
    return invokeServerlessHandler(apiDataHandler, req, res);
  }
  if (pathname === '/api/auth') {
    return invokeServerlessHandler(apiAuthHandler, req, res);
  }

  let targetRel = ROUTE_ALIASES[pathname] || pathname;
  let filePath = path.join(PUBLIC_DIR, targetRel);

  // Prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  } else if (!fs.existsSync(filePath) && fs.existsSync(filePath + '.html')) {
    filePath = filePath + '.html';
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<h2>404 Not Found</h2><p>Return to <a href="/">Careclinics HQ Portal</a></p>`);
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=============================================================`);
  console.log(`Careclinics HQ Unified Services Running on http://localhost:${PORT}`);
  console.log(`-------------------------------------------------------------`);
  console.log(`1. Staff Workspace Portal    : http://localhost:${PORT}/`);
  console.log(`2. Admin Login Page          : http://localhost:${PORT}/login.html`);
  console.log(`3. Admin Command Portal      : http://localhost:${PORT}/admin/`);
  console.log(`4. Meeting TV Dashboard      : http://localhost:${PORT}/meeting/`);
  console.log(`   - Staff Input Portal      : http://localhost:${PORT}/meeting/input.html`);
  console.log(`   - Alignment Admin Panel   : http://localhost:${PORT}/meeting/admin.html`);
  console.log(`5. HQ Room Booking System    : http://localhost:${PORT}/booking/`);
  console.log(`6. Remote Display Service    : http://localhost:${PORT}/display/`);
  console.log(`7. BentoPDF Toolkit Suite    : http://localhost:${PORT}/pdf/`);
  console.log(`=============================================================`);
});
