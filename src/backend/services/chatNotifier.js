// Chỗ cắm tín hiệu "có tin mới" (spec 4.8, ADR). Tới P14 chưa có socket nên mặc định không làm gì; P14 gọi register()
// để cắm hàm phát thật qua Socket.IO. Tín hiệu chỉ mang { conversationId, seq }, không mang nội dung tin: client nhận
// tín hiệu rồi tự lấy tin qua REST (afterSeq), nên MongoDB luôn là nguồn sự thật.
// Service chỉ gọi notify sau khi transaction ghi tin đã commit, và không chờ (await) nó: socket hỏng không được làm
// hỏng việc gửi tin.
const noop = () => {};
let current = { notify: noop, disconnectUser: noop };

function report(error) {
  console.error('chatNotifier:', error?.message ?? error);
}

/**
 * Cắm hàm phát thật (P14) hoặc hàm theo dõi trong test.
 * @param {{ notify?: Function, disconnectUser?: Function }} implementation
 */
function register({ notify = noop, disconnectUser = noop } = {}) {
  current = { notify, disconnectUser };
}

// Trở về mặc định không làm gì (test dọn dẹp sau mỗi lần register).
function reset() {
  current = { notify: noop, disconnectUser: noop };
}

/**
 * Báo những người này rằng cuộc trò chuyện có tin mới tới seq này. Lỗi của hàm phát (kể cả promise bị từ chối) chỉ
 * được ghi log, không ném ra.
 * @param {Array<unknown>} userIds
 * @param {{ conversationId: unknown, seq: number }} payload
 * @returns {void}
 */
function notify(userIds, { conversationId, seq }) {
  try {
    const result = current.notify(userIds.map(String), { conversationId: String(conversationId), seq });
    if (result && typeof result.catch === 'function') result.catch(report);
  } catch (error) {
    report(error);
  }
}

/**
 * Ngắt mọi kết nối realtime của một người (P15 dùng khi khóa nhắn tin).
 * @param {unknown} userId
 * @returns {void}
 */
function disconnectUser(userId) {
  try {
    current.disconnectUser(String(userId));
  } catch (error) {
    report(error);
  }
}

module.exports = { register, reset, notify, disconnectUser };
