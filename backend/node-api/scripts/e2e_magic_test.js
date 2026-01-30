const axios = require('axios');

// Ensure the same secret is used as the running server
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const { JWTUtils } = require('../dist/utils/jwt');

// Start server in-process to avoid managing background processes
process.env.APP_PORT = process.env.APP_PORT || '3000';
require('../dist/main');

async function waitForHealth(url, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = await require('axios').get(url, { timeout: 1000 });
      if (r.status === 200) return true;
    } catch (e) {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Health check timed out');
}

(async () => {
  try {
    const apiBase = 'http://localhost:3000';
    console.log('Waiting for server health...');
    await waitForHealth(`${apiBase}/health`, 10000);
    console.log('Server healthy');

    // Generate a magic token for a test invoice
    const magic = JWTUtils.generateMagicToken({ sub: 'test-user-1', email: 'test@example.com', redirect: '/Facture_.html?invoice_id=TEST123' });
    console.log('MAGIC_TOKEN:', magic);

    // Call consume endpoint but don't follow redirects to capture Location header
    console.log('Calling consume endpoint...');
    const resp = await axios.get(`${apiBase}/auth/magic/redirect?token=${encodeURIComponent(magic)}`, {
      maxRedirects: 0,
      validateStatus: (s) => s === 302 || (s >= 200 && s < 400)
    });

    console.log('Consume status:', resp.status);
    const location = resp.headers.location || resp.headers.Location;
    console.log('Location header:', location);

    // Extract app token from query or hash
    let appToken = null;
    if (location) {
      try {
        const u = new URL(location);
        appToken = u.searchParams.get('token');
        if (!appToken && u.hash) {
          const hs = new URLSearchParams(u.hash.replace(/^#/, ''));
          appToken = hs.get('token');
        }
      } catch (e) {
        // fallback parsing
        const m = location.match(/[?&]token=([^&]+)/);
        if (m) appToken = decodeURIComponent(m[1]);
        else {
          const hm = location.split('#')[1] || '';
          const p = new URLSearchParams(hm);
          appToken = p.get('token');
        }
      }
    }

    console.log('APP_TOKEN:', !!appToken ? appToken.slice(0, 20) + '...' : null);

    // 1) Try to access invoice without auth
    console.log('\n==> Requesting invoice WITHOUT auth');
    try {
      const r1 = await axios.get(`${apiBase}/api/client/invoices/TEST123`, { validateStatus: () => true });
      console.log('Status without auth:', r1.status);
      if (r1.data) console.log('Body:', r1.data);
    } catch (e) {
      console.error('Error fetching invoice without auth:', e.message);
    }

    // 2) Try to access invoice WITH auth (app token)
    console.log('\n==> Requesting invoice WITH auth');
    try {
      const r2 = await axios.get(`${apiBase}/api/client/invoices/TEST123`, {
        headers: { Authorization: `Bearer ${appToken}` },
        validateStatus: () => true
      });
      console.log('Status with auth:', r2.status);
      if (r2.data) console.log('Body:', r2.data);
    } catch (e) {
      console.error('Error fetching invoice with auth:', e.message);
    }

    console.log('\nE2E test completed');
  } catch (err) {
    console.error('E2E script failed', err.response ? err.response.status : err.message, err.response ? err.response.data : '');
    process.exit(1);
  }
})();
