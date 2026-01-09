import { api } from './axios.config.js';

// Upload multiple files for a given request and document type.
export async function uploadDocuments(requestId, docType, country, files = []) {
  const fd = new FormData();
  fd.append('doc_type', docType || 'misc');
  fd.append('country', country || '');
  for (let i = 0; i < files.length; i++) {
    fd.append('files', files[i]);
  }
  // return response data to the caller
  return api.post(`/documents/${requestId}/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
}

export async function uploadDocument(requestId, file) {
  return uploadDocuments(requestId, 'misc', '', [file]);
}

export async function downloadDocument(id) {
  return api.get(`/documents/${id}/download`, { responseType: 'blob' });
}

export async function getDocument(id) {
  return api.get(`/documents/${id}`).then(r => r.data);
}
