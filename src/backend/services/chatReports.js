// Báo cáo vi phạm và khóa nhắn tin (spec D10, T12, T13, mục 4.3 phần P15; plan Task 15.1).
// - Người tham gia báo cáo một tin của người kia, kể cả khi chính mình bị khóa hay đã rút đồng ý (T13).
// - Super Admin xem hàng chờ (bản chụp tin, tên hai bên; không email, không id người dùng: T2) rồi "Bỏ qua" hay
//   "Khóa nhắn tin". Khóa chỉ đặt trên ChatMember, không đụng User.status, nên người bị khóa vẫn đặt vé và dùng ví (T12).
// - Bỏ khóa đi qua chính báo cáo đã khóa, nên API admin không cần nhận id người dùng nào.
const mongoose = require('mongoose');
const Report = require('../models/Report');
const { REASONS, NOTE_MAX } = require('../models/Report');
const Message = require('../models/Message');
const ChatMember = require('../models/ChatMember');
const { findMine, otherOf, loadPeople } = require('./chatService');
const chatNotifier = require('./chatNotifier');
const transaction = require('./transaction');
const { httpError } = require('../lib/errors');
const errorCodes = require('../lib/errorCodes');

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const LIST_LIMIT = 50;
const invalid = message => httpError(400, message, errorCodes.CHAT_REPORT_INVALID);
const missing = () => httpError(404, 'Không tìm thấy báo cáo.', errorCodes.CHAT_REPORT_NOT_FOUND);
const handled = () => httpError(409, 'Báo cáo này đã được xử lý.', errorCodes.CHAT_REPORT_HANDLED);
const same = (x, y) => String(x) === String(y);

/**
 * Báo cáo một tin (POST /conversations/:id/reports). Người ngoài cuộc nhận cùng 404 như mọi chỗ khác. Báo cáo lại cùng
 * tin thì trả báo cáo cũ (200), kể cả khi nhiều request tới cùng lúc (index unique bắt trùng).
 * @param {string} userId Người báo cáo (từ token).
 * @param {string} rawId Id cuộc trò chuyện (từ URL).
 * @param {{ seq: unknown, reason: unknown, note?: unknown }} body
 * @returns {Promise<{ status: 200 | 201, report: { id: string, status: string, reason: string } }>}
 */
async function createReport(userId, rawId, body) {
  const conversation = await findMine(userId, rawId);
  const { seq, reason } = body ?? {};
  const note = body?.note ?? '';
  if (!Number.isSafeInteger(seq) || seq < 1) throw invalid('Chọn đúng tin cần báo cáo.');
  if (!REASONS.includes(reason)) throw invalid('Chọn một lý do báo cáo.');
  if (typeof note !== 'string' || note.length > NOTE_MAX) throw invalid(`Ghi chú tối đa ${NOTE_MAX} ký tự.`);
  const message = await Message.findOne({ conversationId: conversation._id, seq }).lean();
  // Chỉ báo cáo được tin của người kia: tin của chính mình hay tin không có đều là dữ liệu sai.
  if (!message || same(message.senderId, userId)) throw invalid('Chỉ báo cáo được tin của người kia.');
  const present = report => ({ id: String(report._id), status: report.status, reason: report.reason });
  const key = { reporterId: userId, conversationId: conversation._id, 'message.seq': seq };
  try {
    const created = await Report.create({
      reporterId: userId, reportedUserId: otherOf(conversation, userId), conversationId: conversation._id,
      message: { seq, text: message.text, sentAt: message.createdAt }, reason, note: note.trim(),
    });
    return { status: 201, report: present(created) };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return { status: 200, report: present(await Report.findOne(key).lean()) };
  }
}

/**
 * Hàng chờ báo cáo cho Super Admin (GET /admin/reports?status=OPEN|DISMISSED|LOCKED), 50 báo cáo mới nhất. Mỗi báo
 * cáo chỉ có bản chụp tin, lý do, ghi chú và tên, màu avatar của hai bên; `reported.locked` cho biết người bị báo cáo
 * còn đang bị khóa bởi chính báo cáo này hay không (để hiện nút "Bỏ khóa").
 * @returns {Promise<{ reports: object[] }>}
 */
async function listReports({ status = 'OPEN' } = {}) {
  if (!['OPEN', 'DISMISSED', 'LOCKED'].includes(status)) throw httpError(400, 'status không hợp lệ.', errorCodes.INVALID_QUERY);
  const rows = await Report.find({ status }).sort({ createdAt: -1 }).limit(LIST_LIMIT).lean();
  const userIds = [...new Set(rows.flatMap(row => [String(row.reporterId), String(row.reportedUserId)]))];
  const [people, locks] = await Promise.all([
    loadPeople(userIds),
    ChatMember.find({ lockReportId: { $in: rows.map(row => row._id) }, lockedAt: { $ne: null } }).select({ lockReportId: 1 }).lean(),
  ]);
  const lockedBy = new Set(locks.map(lock => String(lock.lockReportId)));
  const person = id => { const found = people.get(String(id)); return { displayName: found?.displayName ?? 'Người dùng RunFurther', avatarTheme: found?.avatarTheme ?? 'forest' }; };
  return {
    reports: rows.map(row => ({
      id: String(row._id),
      reason: row.reason,
      note: row.note,
      status: row.status,
      createdAt: row.createdAt,
      handledAt: row.handledAt,
      message: { seq: row.message.seq, text: row.message.text, sentAt: row.message.sentAt },
      reporter: person(row.reporterId),
      reported: { ...person(row.reportedUserId), locked: lockedBy.has(String(row._id)) },
    })),
  };
}

function readReportId(raw) {
  if (typeof raw !== 'string' || !OBJECT_ID.test(raw)) throw missing();
  return raw;
}

/**
 * Xử lý một báo cáo đang mở (POST /admin/reports/:id/resolve). DISMISS: đóng báo cáo. LOCK: đóng báo cáo và khóa nhắn
 * tin người bị báo cáo trong cùng transaction, rồi (sau commit) ngắt socket của người đó. Báo cáo đã xử lý thì 409.
 * @returns {Promise<{ report: { id: string, status: string } }>}
 */
async function resolveReport(adminId, rawId, body) {
  const id = readReportId(rawId);
  const action = body?.action;
  if (action !== 'DISMISS' && action !== 'LOCK') throw invalid('Chọn "Bỏ qua" hoặc "Khóa nhắn tin".');
  const now = new Date();
  const updated = await transaction(async session => {
    const report = await Report.findOneAndUpdate(
      { _id: id, status: 'OPEN' },
      { $set: { status: action === 'LOCK' ? 'LOCKED' : 'DISMISSED', handledBy: adminId, handledAt: now } },
      { new: true, session },
    ).lean();
    if (!report) throw (await Report.exists({ _id: id }).session(session)) ? handled() : missing();
    if (action === 'LOCK') {
      await ChatMember.updateOne(
        { userId: report.reportedUserId },
        { $set: { lockedAt: now, lockedBy: new mongoose.Types.ObjectId(String(adminId)), lockReportId: report._id } },
        { upsert: true, session },
      );
    }
    return report;
  });
  if (action === 'LOCK') chatNotifier.disconnectUser(updated.reportedUserId);
  return { report: { id: String(updated._id), status: updated.status } };
}

/**
 * Bỏ khóa người đã bị khóa từ báo cáo này (POST /admin/members/:reportId/unlock). Chỉ gỡ khi khóa hiện tại đúng là
 * của báo cáo này; đã gỡ rồi hay khóa đến từ báo cáo khác thì 409.
 * @returns {Promise<void>}
 */
async function unlockFromReport(rawId) {
  const id = readReportId(rawId);
  const report = await Report.findById(id).select({ reportedUserId: 1, status: 1 }).lean();
  if (!report) throw missing();
  const { modifiedCount } = await ChatMember.updateOne(
    { userId: report.reportedUserId, lockReportId: report._id, lockedAt: { $ne: null } },
    { $set: { lockedAt: null, lockedBy: null, lockReportId: null } },
  );
  if (!modifiedCount) throw httpError(409, 'Người này không còn bị khóa bởi báo cáo này.', errorCodes.CHAT_REPORT_HANDLED);
}

module.exports = { createReport, listReports, resolveReport, unlockFromReport };
