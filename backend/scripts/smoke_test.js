const fs = require('fs');
const path = require('path');
const fetch = global.fetch || require('node-fetch');

(async () => {
  const specPath = path.join(__dirname, '..', 'docs', 'openapi_endpoints.json');
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

  const nodeBase = 'http://localhost:3000';
  const pyBase = 'http://localhost:8000';

  const results = [];

  for (const p in spec.paths) {
    const entry = spec.paths[p];
    for (const method in entry) {
      const url = (p.startsWith('/api/v1') ? pyBase : nodeBase) + p;
      const m = method.toUpperCase();

      // Skip multipart heavy uploads — we'll still attempt a simple request
      const opts = { method: m, headers: { 'Accept': 'application/json' } };

      if (m === 'POST' || m === 'PATCH') {
        // send minimal JSON body
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify({});
      }

      let status = null;
      let ok = false;
      let text = '';
      try {
        const res = await fetch(url, opts);
        status = res.status;
        ok = res.ok;
        try { text = await res.text(); } catch (e) { text = '<no body>'; }
      } catch (err) {
        status = 'ERR';
        text = String(err.message || err);
      }

      const record = { path: p, method: m, url, status, ok, bodySnippet: text.slice(0, 200) };
      console.log(record.path, record.method, record.status);
      results.push(record);
    }
  }

  // Save results
  const out = path.join(__dirname, '..', 'logs', 'smoke_results.json');
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log('Smoke test complete. Results saved to', out);
})();
