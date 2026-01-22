import { api } from './axios.config.js';

export async function getMe() {
  return api.get('/users/me').then(r => r.data);
}

export async function createRequest(data) {
  return api.post('/requests', data).then(r => r.data);
}

export async function submitRequest(requestId) {
  return api.post(`/requests/${requestId}/submit`).then(r => r.data);
}
