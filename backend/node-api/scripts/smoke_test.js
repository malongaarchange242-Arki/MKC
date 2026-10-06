const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000/health';
const PYTHON_URL = process.env.PYTHON_URL || 'http://localhost:8000/health';
const RETRIES = Number(process.env.SMOKE_RETRIES || 10);
const RETRY_DELAY_MS = Number(process.env.SMOKE_RETRY_DELAY_MS || 500);

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkHealth(url, label) {
  let lastError = null;

  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      if (!globalThis.fetch) {
        throw new Error('fetch is not available in this runtime');
      }

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
        },
      });

      const text = await response.text();
      let payload = text;

      try {
        payload = JSON.parse(text);
      } catch (error) {
        // keep raw text if body is not JSON
      }

      if (!response.ok) {
        throw new Error(`${label} health check failed: ${response.status} ${JSON.stringify(payload)}`);
      }

      console.log(`[OK] ${label}: ${response.status} ${JSON.stringify(payload)}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) {
        console.warn(`[WAIT] ${label} not ready yet (attempt ${attempt}/${RETRIES})`);
        await wait(RETRY_DELAY_MS);
      }
    }
  }

  throw lastError || new Error(`${label} health check failed`);
}

async function main() {
  await checkHealth(BACKEND_URL, 'Backend');
  await checkHealth(PYTHON_URL, 'Python');
  console.log('Smoke test passed.');
}

main().catch((error) => {
  console.error('Smoke test failed.');
  console.error(error.message || error);
  process.exit(1);
});
