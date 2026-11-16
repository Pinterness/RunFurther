// Sinh handle cho hồ sơ cộng đồng từ họ tên (spec D1): "Nguyễn Đức Anh" → "nguyen-duc-anh". Trùng thì thêm "-2",
// "-3"…; tên của hệ thống (admin, hotro…) không bao giờ được cấp nguyên dạng, để không ai mạo danh ban quản trị.
const CommunityProfile = require('../models/CommunityProfile');
const { HANDLE_PATTERN } = require('../models/CommunityProfile');
const { httpError, escapeRegex } = require('../lib/errors');
const errorCodes = require('../lib/errorCodes');

const MAX_LENGTH = 30;
const FALLBACK = 'runner';
const MAX_ATTEMPTS = 50;
const RESERVED = new Set([
  'admin', 'administrator', 'superadmin', 'runfurther', 'support', 'hotro', 'ho-tro', 'btc', 'bantochuc',
  'ban-to-chuc', 'staff', 'moderator', 'system', 'root', 'api', 'community', 'messages', 'null', 'undefined',
]);

const trimDashes = text => text.replace(/^-+|-+$/g, '');

/**
 * Đổi họ tên thành phần gốc của handle: bỏ dấu tiếng Việt, "đ" thành "d", chữ thường, mỗi cụm ký tự lạ thành một
 * dấu gạch, cắt 30 ký tự. Không còn ký tự nào thì dùng "runner"; còn dưới 3 ký tự thì thêm "-runner" cho đủ mẫu.
 * @param {string} fullName Họ tên trong tài khoản.
 * @returns {string} Phần gốc của handle, luôn khớp HANDLE_PATTERN.
 */
function slugifyName(fullName) {
  const ascii = String(fullName ?? '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  const slug = trimDashes(trimDashes(ascii.replace(/[^a-z0-9]+/g, '-')).slice(0, MAX_LENGTH));
  if (!slug) return FALLBACK;
  return slug.length < 3 ? `${slug}-${FALLBACK}` : slug;
}

/**
 * Handle có phải tên dành cho hệ thống không, so cả dạng có tiền tố hay hậu tố số ("2-admin", "hotro-2") và không
 * phân biệt hoa thường.
 * @param {string} handle Handle cần kiểm.
 * @returns {boolean} true khi bị cấm.
 */
function isReservedHandle(handle) {
  return RESERVED.has(String(handle).toLowerCase().replace(/^\d+-/, '').replace(/-\d+$/, ''));
}

// Gắn hậu tố số mà vẫn giữ tổng độ dài ≤ 30: cắt bớt phần gốc rồi bỏ dấu gạch thừa ở cuối.
const withNumber = (root, n) => `${trimDashes(root.slice(0, MAX_LENGTH - String(n).length - 1))}-${n}`;

const duplicateOn = (error, field) => error?.code === 11000 && Boolean(error.keyPattern?.[field]);

// Số bắt đầu thử: lớn hơn hậu tố lớn nhất đang dùng, để người thứ 60 cùng tên không phải thử 59 lần. Với tên dài,
// hậu tố làm phần gốc bị cắt bớt, nên chỉ tìm theo 26 ký tự đầu (chung cho mọi hậu tố tới 3 chữ số) rồi kiểm lại
// từng handle bằng chính withNumber.
async function firstNumber(root) {
  const shared = root.slice(0, MAX_LENGTH - 4);
  const rows = await CommunityProfile.find({ handle: new RegExp(`^${escapeRegex(shared)}`) }).select('handle').lean();
  let used = 0;
  for (const { handle } of rows) {
    const n = handle === root ? 1 : Number(/-(\d+)$/.exec(handle)?.[1]);
    if (n === 1 || (n > 1 && withNumber(root, n) === handle)) used = Math.max(used, n);
  }
  return used + 1;
}

/**
 * Tạo hồ sơ cộng đồng kèm handle sinh từ họ tên. Hai người cùng tên tạo cùng lúc thì unique index trên handle chặn
 * người đến sau, và người đó thử số kế tiếp.
 * @param {{ userId: unknown }} doc Các trường của hồ sơ (trừ handle).
 * @param {string} fullName Họ tên trong tài khoản.
 * @returns {Promise<import('mongoose').Document>} Hồ sơ đã lưu.
 */
async function createProfileWithHandle(doc, fullName) {
  const root = slugifyName(fullName);
  // Gốc bị cấm thì không bao giờ cấp nguyên dạng, bắt đầu từ "-2" (spec D1: "bị cấm thì thêm -2").
  let n = isReservedHandle(root) ? Math.max(2, await firstNumber(root)) : await firstNumber(root);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1, n += 1) {
    const handle = n === 1 ? root : withNumber(root, n);
    try {
      return await CommunityProfile.create({ ...doc, handle });
    } catch (error) {
      if (duplicateOn(error, 'userId')) throw httpError(409, 'Tài khoản này đã có hồ sơ cộng đồng.', errorCodes.COMMUNITY_INVALID);
      if (!duplicateOn(error, 'handle')) throw error;
    }
  }
  throw httpError(409, 'Chưa tạo được tên hồ sơ vì đang có nhiều người trùng tên. Bạn thử lại sau ít phút.', errorCodes.COMMUNITY_HANDLE_TAKEN);
}

module.exports = { slugifyName, isReservedHandle, HANDLE_PATTERN, createProfileWithHandle };
