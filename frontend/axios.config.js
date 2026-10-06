import axios from 'https://cdn.jsdelivr.net/npm/axios@1.6.8/+esm';

// Use the local API during development and the configured Render API in production.
const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const configuredApiBase = document.querySelector('meta[name="api-base"]')?.content?.trim();
const API_BASE = (window.__API_BASE__ || (isLocalHost ? 'http://localhost:3000' : configuredApiBase || 'https://mkc-node-api.onrender.com')).replace(/\/+$/, '');
const PYTHON_BASE = 'http://localhost:8000';

export const api = axios.create({
  baseURL: API_BASE,
});

export const pythonApi = axios.create({
  baseURL: PYTHON_BASE,
});

api.interceptors.request.use(config => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
