// Dependency-free local server. Vercel continues to provide /api/chat in deployment.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.csv':'text/csv; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
const routes = {'/':'dashboard/index.html','/index.html':'dashboard/index.html','/styles.css':'dashboard/styles.css','/script.js':'dashboard/script.js','/hospital_readmission_fhir.csv':'hospital_readmission_fhir.csv','/favicon.ico':null};
http.createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost');
  if (url.pathname === '/api/chat') { res.writeHead(503,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Connected assistant requires the Vercel server. Local dataset answers remain available.'})); return; }
  const route = Object.hasOwn(routes,url.pathname) ? routes[url.pathname] : /^\/dashboard\/(index\.html|styles\.css|script\.js)$/.test(url.pathname) ? url.pathname.slice(1) : undefined;
  if (route === null) { res.writeHead(204); res.end(); return; }
  if (route === undefined) { res.writeHead(404,{'Content-Type':'text/plain'}); res.end('Not found'); return; }
  try { const content = await fs.readFile(path.join(root,route)); res.writeHead(200,{'Content-Type':types[path.extname(route)] || 'application/octet-stream','Cache-Control':'no-store'}); res.end(content); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(Number(process.env.PORT) || 3000,'127.0.0.1',() => console.log(`CareSync is ready at http://localhost:${Number(process.env.PORT) || 3000}`));
