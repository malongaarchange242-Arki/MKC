import axios from 'https://cdn.jsdelivr.net/npm/axios@1.6.8/+esm';

// Local development configuration.
// The browser should call the local Node backend, and the backend should proxy to the local Python service.
const API_BASE = 'http://localhost:3000';
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
