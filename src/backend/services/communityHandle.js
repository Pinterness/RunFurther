// Sinh handle cho hồ sơ cộng đồng từ họ tên (spec D1): "Nguyễn Đức Anh" → "nguyen-duc-anh". Trùng thì thêm "-2",
// "-3"…; tên của hệ thống (admin, hotro…) không bao giờ được cấp, kể cả kèm số, để không ai mạo danh ban quản trị.
const CommunityProfile = require('../models/CommunityProfile');
const { HANDLE_PATTERN } = require('../models/CommunityProfile');
const { httpError, escapeRegex } = require('../lib/errors');
const errorCodes = require('../lib/errorCodes');

const MAX_LENGTH = 30;
const FALLBACK = 'runner';
const MAX_ATTEMPTS = 50;
// Từ mang nghĩa ban quản trị: có mặt ở bất kỳ đâu trong handle là cấm.
const STAFF_WORDS = new Set(['admin', 'administrator', 'superadmin', 'runfurther', 'support', 'hotro', 'btc', 'bantochuc', 'staff', 'moderator']);
// Cụm nhiều từ cũng mang nghĩa đó; từng từ riêng ("ho", "ban") là họ tên bình thường nên chỉ cấm cả cụm.
const STAFF_PHRASES = ['ho-tro', 'ban-to-chuc'];
// Tên cấm khi đứng một mình (bỏ hết cụm số): gồm tên route và từ hệ thống.
const RESERVED = new Set([
  'admin', 'administrator', 'superadmin', 'runfurther', 'support', 'hotro', 'ho-tro', 'btc', 'bantochuc',
  'ban-to-chuc', 'staff', 'moderator', 'system', 'root', 'api', 'community', 'messages', 'null', 'undefined',
]);

const trimDashes = text => text.replace(/^-+|-+$/g, '');
// Bỏ dấu tiếng Việt và đổi về chữ thường: "Nguyễn Đức" → "nguyen duc".
const stripMarks = text => String(text ?? '').toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/\p{M}/gu, '');

/**
 * Chuẩn hóa chữ để so khi tìm theo tên: bỏ dấu, chữ thường, mỗi cụm ký tự lạ thành một khoảng trắng.
 * @param {string} text Họ tên, handle hay từ khóa.
 * @returns {string} Ví dụ "  NGUYỄN   Thị-B " → "nguyen thi b".
 */
function foldName(text) {
  return stripMarks(text).replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Đổi họ tên thành phần gốc của handle: bỏ dấu tiếng Việt, "đ" thành "d", chữ thường, mỗi cụm ký tự lạ thành một
 * dấu gạch, cắt 30 ký tự. Không còn ký tự nào thì dùng "runner"; còn dưới 3 ký tự thì thêm "-runner" cho đủ mẫu.
 * @param {string} fullName Họ tên trong tài khoản.
 * @returns {string} Phần gốc của handle, luôn khớp HANDLE_PATTERN.
 */
function slugifyName(fullName) {
  const slug = trimDashes(trimDashes(stripMarks(fullName).replace(/[^a-z0-9]+/g, '-')).slice(0, MAX_LENGTH));
  if (!slug) return FALLBACK;
  return slug.length < 3 ? `${slug}-${FALLBACK}` : slug;
}

/**
 * Handle có phải tên dành cho hệ thống không (không phân biệt hoa thường). Bị cấm khi:
 *   - bỏ hết các cụm số ("2-admin", "admin-2-3", "hotro-9") thì còn đúng một tên trong RESERVED; hoặc
 *   - có một từ mang nghĩa ban quản trị ở bất kỳ vị trí nào ("admin-nguyen", "runfurther-official", "nguyen-ho-tro").
 * Họ "Hồ" hay chữ "api" trong tên người vẫn dùng được, vì chỉ cấm khi chúng đứng một mình hoặc đúng cụm "ho-tro".
 * @param {string} handle Handle cần kiểm.
 * @returns {boolean} true khi bị cấm.
 */
function isReservedHandle(handle) {
  const words = String(handle).toLowerCase().split('-').filter(word => word && !/^\d+$/.test(word));
  const core = words.join('-');
  if (RESERVED.has(core) || words.some(word => STAFF_WORDS.has(word))) return true;
  return STAFF_PHRASES.some(phrase => `-${core}-`.includes(`-${phrase}-`));
}

// Gắn hậu tố số mà vẫn giữ tổng độ dài ≤ 30: cắt bớt phần gốc rồi bỏ dấu gạch thừa ở cuối.
const withNumber = (root, n) => `${trimDashes(root.slice(0, MAX_LENGTH - String(n).length - 1))}-${n}`;

const duplicateOn = (error, field) => error?.code === 11000 && Boolean(error.keyPattern?.[field]);

// Số bắt đầu thử. Gốc còn trống thì dùng gốc. Nếu không, lấy hậu tố lớn nhất đang dùng cộng 1, để người thứ 60 cùng
// tên không phải thử 59 lần. Chỉ đọc hậu tố tới 4 chữ số: nếu không, một người tự đặt "le-van-c-9007199254740992"
// (2^53, cộng 1 vẫn ra chính nó) sẽ làm mọi "Lê Văn C" về sau thử mãi một số. Với tên dài, hậu tố làm phần gốc bị cắt
// bớt, nên chỉ tìm theo 25 ký tự đầu (chung cho mọi hậu tố tới 4 chữ số) rồi kiểm lại từng handle bằng withNumber.
async function firstNumber(root) {
  const shared = root.slice(0, MAX_LENGTH - 5);
  const rows = await CommunityProfile.find({ handle: new RegExp(`^${escapeRegex(shared)}`) }).select('handle').lean();
  const taken = new Set(rows.map(row => row.handle));
  if (!taken.has(root)) return 1;
  let used = 1;
  for (const handle of taken) {
    const n = Number(/-(\d{1,4})$/.exec(handle)?.[1]);
    if (n > 1 && withNumber(root, n) === handle) used = Math.max(used, n);
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
  // Gốc bị cấm ("Admin", "Hỗ Trợ") thì dùng "runner": thêm số như "admin-2" vẫn là mạo danh ban quản trị.
  const slug = slugifyName(fullName);
  const root = isReservedHandle(slug) ? FALLBACK : slug;
  let n = await firstNumber(root);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1, n += 1) {
    const handle = n === 1 ? root : withNumber(root, n);
    // Cắt bớt tên dài để gắn số có thể vô tình để lại một từ bị cấm ở cuối; bỏ qua số đó.
    if (isReservedHandle(handle)) continue;
    try {
      return await CommunityProfile.create({ ...doc, handle });
    } catch (error) {
      if (duplicateOn(error, 'userId')) throw httpError(409, 'Tài khoản này đã có hồ sơ cộng đồng.', errorCodes.COMMUNITY_INVALID);
      if (!duplicateOn(error, 'handle')) throw error;
    }
  }
  throw httpError(409, 'Chưa tạo được tên hồ sơ vì đang có nhiều người trùng tên. Bạn thử lại sau ít phút.', errorCodes.COMMUNITY_HANDLE_TAKEN);
}

module.exports = { slugifyName, foldName, isReservedHandle, HANDLE_PATTERN, createProfileWithHandle };
