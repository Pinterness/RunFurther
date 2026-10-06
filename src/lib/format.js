/**
 * Formats an amount of Vietnamese đồng the way the rest of the site does, e.g. 50000 → "50.000đ".
 * @param {number} amount Amount in VND.
 * @returns {string} Localised amount with the đ sign.
 */
export function formatVnd(amount) {
  return `${Number(amount).toLocaleString('vi-VN')}đ`;
}

/**
 * Formats a date and time in Vietnamese, or returns an empty string when the value is missing.
 * @param {string | number | Date | null | undefined} value Date input.
 * @returns {string} Localised date and time.
 */
export function formatDateTime(value) {
  return value ? new Date(value).toLocaleString('vi-VN') : '';
}
