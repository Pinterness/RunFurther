const snapshot = require('../data/banks.json');
const { assert } = require('../lib/errors');
let banks = snapshot.banks, refreshedAt = 0, pending;
async function listBanks() {
  if (Date.now() - refreshedAt < 86400000) return banks;
  if (!pending) pending = (async () => {
    try {
      const response = await fetch('https://api.vietqr.io/v2/banks', { signal: AbortSignal.timeout(5000) });
      assert(response.ok, 503, 'Bank directory unavailable.');
      const result = await response.json();
      const items = result.data?.filter(b => b.transferSupported === 1 && /^\d{6}$/.test(b.bin) && b.shortName && b.name && b.code).map(({ bin, code, name, shortName }) => ({ bin, code, name, shortName }));
      if (result.code === '00' && items?.length) { banks = items; refreshedAt = Date.now(); }
      else throw new Error('Invalid bank directory');
    } catch { refreshedAt = Date.now() - 86400000 + 300000; /* Retry in five minutes; retain known bank codes. */ }
    finally { pending = null; }
    return banks;
  })();
  return pending;
}
function normalizeBank(input, { optional = true } = {}) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 400, 'Thông tin ngân hàng không hợp lệ.');
  const fields = ['bankBin', 'bankName', 'accountNo', 'accountName'];
  assert(fields.every(k => input[k] === undefined || typeof input[k] === 'string'), 400, 'Thông tin ngân hàng phải là văn bản.');
  if (fields.every(k => !input[k]?.trim()) && optional) return { bankBin: '', bankName: '', accountNo: '', accountName: '' };
  const key = (input.bankBin || input.bankName || '').trim().toLowerCase();
  const bank = banks.find(b => [b.bin, b.code, b.shortName, b.name].some(value => value.toLowerCase() === key));
  assert(bank, 400, 'Chọn ngân hàng từ danh sách hỗ trợ VietQR.');
  const accountNo = (input.accountNo || '').trim(), accountName = (input.accountName || '').trim();
  assert(/^[a-zA-Z0-9]{1,19}$/.test(accountNo), 400, 'Số tài khoản gồm 1–19 chữ hoặc số, không chứa khoảng trắng.');
  assert(accountName.length >= 2 && accountName.length <= 100 && !/[\u0000-\u001f<>]/.test(accountName), 400, 'Nhập tên chủ tài khoản từ 2–100 ký tự.');
  return { bankBin: bank.bin, bankName: bank.shortName, accountNo, accountName };
}
function paymentInstructions(bank, amount, orderCode) {
  let bankInfo;
  try { bankInfo = normalizeBank(bank || {}, { optional: false }); } catch { return { bankInfo: null, vietQrUrl: null }; }
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 9999999999999) return { bankInfo, vietQrUrl: null };
  const query = new URLSearchParams({ amount: String(amount), addInfo: orderCode, accountName: bankInfo.accountName });
  return { bankInfo, vietQrUrl: `https://img.vietqr.io/image/${bankInfo.bankBin}-${bankInfo.accountNo}-compact2.png?${query}` };
}
module.exports = { listBanks, normalizeBank, paymentInstructions };
