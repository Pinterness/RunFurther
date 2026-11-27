// Lớp realtime của chat bằng Socket.IO (ADR realtime mục 3, spec 4.8).
// Socket chỉ báo tín hiệu "có tin mới": phát `chat:message { conversationId, seq }` vào phòng user:<id> sau khi tin đã
// lưu (chatService gọi chatNotifier.notify sau khi transaction commit). Client nhận tín hiệu thì tự lấy tin qua REST
// (afterSeq), nên MongoDB luôn là nguồn sự thật và socket hỏng chỉ làm tin tới chậm, không làm mất tin.
// Ba cổng khi bắt tay:
//   1. allowRequest: công tắc realtime đang bật, và Origin rỗng hoặc thuộc CLIENT_ORIGIN (tùy chọn `cors` một mình
//      không chặn được WebSocket từ website lạ, spike 16-11 đã đo);
//   2. JWT trong handshake.auth.token, cùng luật với verifyUserToken (chữ ký, hạn);
//   3. senderEligible: tài khoản ACTIVE, đủ 16 tuổi, đã đồng ý chat, không bị khóa.
// Mỗi người chỉ vào phòng của chính mình, với id lấy từ token, nên không nghe được tín hiệu của người khác.
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { readHttpConfig } = require('../config/deployment');
const { senderEligible } = require('../services/chatGate');
const { isRealtimeOn, onRealtimeChange } = require('../services/chatRealtimeSetting');
const chatNotifier = require('../services/chatNotifier');

const EVENT = 'chat:message';
// setTimeout chỉ nhận tối đa 2^31 − 1 ms (khoảng 24,8 ngày); lớn hơn thì Node chạy ngay lập tức.
const MAX_TIMER_MS = 2 ** 31 - 1;
const room = userId => 'user:' + userId;

function rejection(code, message) {
  return Object.assign(new Error(message), { data: { code } });
}

/**
 * Kiểm token và quyền nhắn tin của người đang bắt tay.
 * @returns {Promise<{ userId: string, exp?: number }>}
 */
async function authenticate(token, { env, now }) {
  if (typeof token !== 'string' || !token) throw rejection('AUTH_REQUIRED', 'Cần đăng nhập để nhận tin tức thì.');
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { clockTimestamp: Math.floor(now() / 1000) });
  } catch {
    throw rejection('AUTH_INVALID', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
  }
  const userId = String(payload.sub ?? '');
  let eligible;
  try {
    eligible = await senderEligible(userId, { now: new Date(now()) });
  } catch {
    // sub không phải ObjectId hợp lệ thì Mongoose ném lỗi ép kiểu: coi như token sai.
    throw rejection('AUTH_INVALID', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
  }
  if (!eligible.ok) throw rejection('CHAT_UNAVAILABLE', 'Tài khoản này chưa nhắn tin được.');
  return { userId, exp: payload.exp };
}

/**
 * Gắn Socket.IO vào http.Server mà startServer() (hoặc harness test) tạo ra.
 * @param {import('http').Server} httpServer
 * @param {{ env?: object, now?: () => number }} [options]
 * @returns {{ io: import('socket.io').Server, close: () => Promise<void> }}
 */
function attachRealtime(httpServer, { env = process.env, now = () => Date.now() } = {}) {
  const { origins } = readHttpConfig(env);
  const io = new Server(httpServer, {
    // Chỉ WebSocket, không long-polling: khi Render deploy có hai instance chồng nhau, phiên polling dễ rơi vào
    // instance khác và lỗi (ADR 3.5).
    transports: ['websocket'],
    serveClient: false,
    allowRequest(req, callback) {
      const origin = req.headers.origin;
      // Không có Origin (công cụ dòng lệnh) thì cho qua như REST; JWT ở bước sau mới là cổng thật.
      if (origin && !origins.has(origin)) return callback('ORIGIN_NOT_ALLOWED', false);
      isRealtimeOn({ env, now: now() }).then(
        on => callback(on ? null : 'REALTIME_OFF', on),
        () => callback('REALTIME_OFF', false),
      );
    },
  });

  io.use((socket, next) => {
    authenticate(socket.handshake.auth?.token, { env, now }).then(
      identity => { socket.data.userId = identity.userId; socket.data.exp = identity.exp; next(); },
      next,
    );
  });

  io.on('connection', socket => {
    socket.join(room(socket.data.userId));
    // Ngắt đúng lúc JWT hết hạn, để token cũ không nghe tín hiệu mãi. Client nối lại bằng token mới hoặc về polling.
    if (Number.isFinite(socket.data.exp)) {
      const timer = setTimeout(() => socket.disconnect(true), Math.min(Math.max(socket.data.exp * 1000 - now(), 0), MAX_TIMER_MS));
      socket.once('disconnect', () => clearTimeout(timer));
    }
  });

  chatNotifier.register({
    notify: (userIds, payload) => { io.to(userIds.map(room)).emit(EVENT, payload); },
    disconnectUser: userId => { io.in(room(userId)).disconnectSockets(true); },
  });
  // Super Admin tắt công tắc: ngắt mọi socket ngay; bắt tay mới bị allowRequest từ chối.
  const stopListening = onRealtimeChange(enabled => { if (!enabled) io.disconnectSockets(true); });

  let closing = null;
  function close() {
    if (!closing) {
      stopListening();
      chatNotifier.reset();
      closing = io.close();
    }
    return closing;
  }
  return { io, close };
}

module.exports = { attachRealtime };
