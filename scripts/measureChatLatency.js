// Đo độ trễ tin nhắn trên web thật (P14, Task 14.4). Không chạy trong CI.
// A gửi 20 tin qua REST; B mở /messages trong Chrome thật; đo từ lúc A bắt đầu gửi tới lúc tin hiện trên màn hình B.
// Mốc thời gian lấy từ cùng đồng hồ của máy (Node và trang ghi Date.now()), nên không lệch giờ.
// Hai tài khoản phải đã có một cuộc trò chuyện ACTIVE với nhau. Script không tạo hay sửa dữ liệu gì ngoài 20 tin này.
//
// Chạy (cmd):
//   set A_EMAIL=...& set A_PASSWORD=...& set B_EMAIL=...& set B_PASSWORD=...& node scripts\measureChatLatency.js
// Biến tùy chọn: WEB_URL (mặc định https://run-further.vercel.app), API_URL (mặc định https://runfurther.onrender.com),
// COUNT (mặc định 20), CHROME_PATH nếu không có Chrome cài sẵn.
// Muốn đo chế độ polling: tắt "Tin nhắn tức thì" trong /admin/messages rồi chạy lại.
const { chromium } = require('@playwright/test');

const WEB = (process.env.WEB_URL || 'https://run-further.vercel.app').replace(/\/$/, '');
const API = (process.env.API_URL || 'https://runfurther.onrender.com').replace(/\/$/, '');
const COUNT = Number(process.env.COUNT) || 20;
// Giới hạn của server là 20 tin mỗi phút cho một người, nên mỗi tin cách nhau 3,5 giây.
const GAP_MS = 3500;
const WAIT_MS = 20000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function need(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Thiếu biến môi trường ${name}.`);
  return value;
}

async function call(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(API + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${data?.message || ''}`);
  return data;
}

// Render Free ngủ sau 15 phút: gọi /health tới khi máy chủ trả ok (tối đa khoảng 2 phút).
async function wake() {
  for (let i = 0; i < 24; i++) {
    try {
      const response = await fetch(API + '/health');
      if (response.ok) return;
    } catch { /* máy chủ còn đang thức dậy */ }
    await sleep(5000);
  }
  throw new Error('Máy chủ API không trả /health sau 2 phút.');
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

(async () => {
  await wake();
  const a = await call('/auth/login', { method: 'POST', body: { email: need('A_EMAIL'), password: need('A_PASSWORD') } });
  const b = await call('/auth/login', { method: 'POST', body: { email: need('B_EMAIL'), password: need('B_PASSWORD') } });
  const { conversations } = await call('/chat/conversations?box=chats', { token: a.token });
  const conversation = conversations.find(c => c.status === 'ACTIVE' && c.other.displayName === b.user.fullName);
  if (!conversation) throw new Error('A và B chưa có cuộc trò chuyện ACTIVE với nhau (tìm theo họ tên của B).');
  const { realtime } = await call('/chat/me', { token: b.token });

  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(WEB + '/login');
    await page.evaluate(({ token, user }) => { localStorage.setItem('rf_token', token); localStorage.setItem('rf_user', JSON.stringify(user)); }, b);
    // Ghi lại lúc mỗi tin đo hiện trong khung chat, ngay trong trang.
    await page.addInitScript(() => {
      window.__seen = {};
      new MutationObserver(() => {
        for (const bubble of document.querySelectorAll('.chat-bubble')) {
          const match = /đo độ trễ (\d+)-(\w+)/.exec(bubble.textContent);
          if (match && !window.__seen[match[0]]) window.__seen[match[0]] = Date.now();
        }
      }).observe(document, { childList: true, subtree: true, characterData: true });
    });
    await page.goto(`${WEB}/messages?c=${encodeURIComponent(conversation.id)}`);
    await page.getByRole('log').waitFor();
    await sleep(5000); // chờ socket nối (nếu realtime bật) và lần polling đầu

    const run = Math.random().toString(36).slice(2, 8);
    const results = [];
    for (let i = 1; i <= COUNT; i++) {
      const text = `đo độ trễ ${i}-${run}`;
      const sentAt = Date.now();
      await call(`/chat/conversations/${conversation.id}/messages`, { token: a.token, method: 'POST', body: { text, clientMessageId: crypto.randomUUID() } });
      let seenAt = null;
      while (!seenAt && Date.now() - sentAt < WAIT_MS) {
        seenAt = await page.evaluate(key => window.__seen[key] ?? null, text);
        if (!seenAt) await sleep(50);
      }
      const ms = seenAt ? seenAt - sentAt : null;
      results.push(ms);
      console.log(`tin ${String(i).padStart(2)}: ${ms === null ? `không hiện sau ${WAIT_MS / 1000} giây` : ms + ' ms'}`);
      if (i < COUNT) await sleep(Math.max(0, GAP_MS - (Date.now() - sentAt)));
    }

    const ok = results.filter(ms => ms !== null).sort((x, y) => x - y);
    console.log(`\nChế độ: ${realtime ? 'realtime (WebSocket)' : 'polling (realtime đang tắt)'} · ${new Date().toISOString()}`);
    console.log(`Tin hiện: ${ok.length}/${COUNT}`);
    if (ok.length) console.log(`p50 = ${percentile(ok, 50)} ms · p95 = ${percentile(ok, 95)} ms · nhanh nhất ${ok[0]} ms · chậm nhất ${ok[ok.length - 1]} ms`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.message || error); process.exitCode = 1; });
