import { API_BASE_URL, readApiJson } from './apiUrl';
export async function api(path, options = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('rf_token') : null;
  const response = await fetch((API_BASE_URL) + path, {
    ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...options.headers },
  });
  // 204 (ví dụ xóa hồ sơ cộng đồng) thành công nhưng không có nội dung để đọc.
  if (response.status === 204) return null;
  const data = await readApiJson(response);
  if (!response.ok) {
    if (response.status === 401) { localStorage.removeItem('rf_token'); localStorage.removeItem('rf_user'); window.dispatchEvent(new Event('rf-auth')); }
    // `data`: cả body lỗi, cho các lỗi mang thêm thông tin (ví dụ 409 CHAT_CONVERSATION_EXISTS kèm conversationId).
    throw Object.assign(new Error(data.message || 'Không thể thực hiện yêu cầu.'), { status: response.status, code: data.code, data });
  }
  return data;
}
export function rememberUser(user, token) {
  if (token) localStorage.setItem('rf_token', token);
  localStorage.setItem('rf_user', JSON.stringify(user));
  window.dispatchEvent(new Event('rf-auth'));
}
export function nextPath(fallback = '/account') {
  const value = new URLSearchParams(window.location.search).get('next');
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  const parsed = new URL(value, window.location.origin);
  return parsed.origin === window.location.origin ? parsed.pathname + parsed.search + parsed.hash : fallback;
}
export const blankProfile = { gender: 'Không chia sẻ', birthday: '', nationality: 'Việt Nam', shirtSize: 'M', club: '', emergencyContact: '', emergencyPhone: '' };
