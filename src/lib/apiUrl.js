import { normalizeApiBase } from './apiConfig.mjs';

// Next inlines this explicit NEXT_PUBLIC reference at build time.
export const API_BASE_URL = normalizeApiBase(process.env.NEXT_PUBLIC_API_URL, {
  required: process.env.NODE_ENV === 'production',
});

export async function readApiJson(response) {
  try {
    return await response.json();
  } catch {
    // A sleeping/restarting host may return an HTML gateway page, including HTTP 200.
    throw Object.assign(new Error('Máy chủ chưa sẵn sàng hoặc kết nối bị gián đoạn. Vui lòng chờ khoảng một phút rồi thử lại.'), {
      status: response.status >= 400 ? response.status : 503,
      code: 'API_UNAVAILABLE',
    });
  }
}
