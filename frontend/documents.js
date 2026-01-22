import { api } from './axios.config.js';

// Centralized allowed document type constants (frontend source of truth)
export const DOCUMENT_TYPES = {
  BILL_OF_LADING: 'BILL_OF_LADING',
  FREIGHT_INVOICE: 'FREIGHT_INVOICE',
  COMMERCIAL_INVOICE: 'COMMERCIAL_INVOICE',
  EXPORT_DECLARATION: 'EXPORT_DECLARATION',
  // AD-specific
  CUSTOMS_DECLARATION: 'CUSTOMS_DECLARATION',
  ROAD_CARRIER: 'ROAD_CARRIER',
  VEHICLE_REGISTRATION: 'VEHICLE_REGISTRATION',
  ROAD_FREIGHT_INVOICE: 'ROAD_FREIGHT_INVOICE',
  RIVER_FREIGHT_INVOICE: 'RIVER_FREIGHT_INVOICE',
  MISC: 'MISC'
};

// Upload multiple files for a given request and document type.
// `docType` must be one of DOCUMENT_TYPES values.
export async function uploadDocuments(requestId, docType, country, files = []) {
  const fd = new FormData();
  fd.append('doc_type', docType || DOCUMENT_TYPES.MISC);
  fd.append('country', country || '');
  for (let i = 0; i < files.length; i++) {
    fd.append('files', files[i]);
  }
  // return response data to the caller
  return api.post(`/documents/${requestId}/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
}

export async function uploadDocument(requestId, file) {
  return uploadDocuments(requestId, DOCUMENT_TYPES.MISC, '', [file]);
}

export async function downloadDocument(id) {
  return api.get(`/documents/${id}/download`, { responseType: 'blob' });
}

export async function getDocument(id) {
  return api.get(`/documents/${id}`).then(r => r.data);
}
