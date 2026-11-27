// Kiểm các đường vào tính năng nhắn tin (P13.3) trên web đang chạy (npm run dev:web): nút "Nhắn tin" và hộp soạn lời
// mời trên hồ sơ cộng đồng, phần "Tin nhắn" trong tab Cộng đồng của /account, và lời mời người nhận đã từ chối.
// Mọi API là dữ liệu giả qua page.route, không cần backend hay database.
// Chạy: node scripts/checkChatEntryUI.js (WEB_TEST_URL để đổi địa chỉ, CHROME_PATH nếu không có Chrome cài sẵn).
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const base = process.env.WEB_TEST_URL || 'http://localhost:3000';

const CHAT_CONSENT = { version: 'chat-v1', text: 'Văn bản đồng ý nhắn tin mẫu.' };
const card = (handle, displayName, canMessage) => ({ handle, displayName, avatarTheme: 'ocean', bio: '', memberSince: '2026-01', canMessage });
const conversation = (id, status, isRequester, name) => ({ id, status, isRequester, other: { displayName: name, avatarTheme: 'forest', handle: null }, lastMessage: { seq: 1, mine: isRequester, text: 'Chào bạn' }, lastMessageAt: '2026-11-26T03:00:00.000Z', unread: false });

(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    const account = {
      user: { _id: 'u1', fullName: 'Người Chạy Thử', email: 'runner@test.local', phone: '0900000000', avatarTheme: 'forest', createdAt: '2026-01-02T00:00:00.000Z' },
      profile: { gender: 'Không chia sẻ', birthday: '1995-03-10', nationality: 'Việt Nam', shirtSize: 'M', club: '', emergencyContact: '', emergencyPhone: '' },
    };
    const chatMe = { consent: true, consentText: CHAT_CONSENT, locked: false, eligible: true, realtime: false };
    const profiles = {
      'nguoi-moi': card('nguoi-moi', 'Người Được Mời', true),
      'da-co-cuoc': card('da-co-cuoc', 'Đã Có Cuộc', true),
      'khong-nhan': card('khong-nhan', 'Không Nhận', true),
      'khong-nhan-tin': card('khong-nhan-tin', 'Không Nhắn Được', false),
    };
    const conversations = { c1: conversation('c1', 'REQUEST', true, 'Người Được Mời'), c3: conversation('c3', 'DECLINED', false, 'Người Đã Mời Tôi') };
    let blocks = [{ id: 'b1', displayName: 'Trần Bị Chặn', avatarTheme: 'clay' }];
    const invites = [], consents = [], unblocks = [], accepts = [];
    let inviteMode = 'ok';

    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname.replace(/^\/api/, ''), method = request.method();
      const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (method === 'OPTIONS') return reply({});
      if (path === '/auth/me') return reply(account);
      if (path === '/registrations/me') return reply({ registrations: [] });
      if (path === '/bookings/me') return reply({ bookings: [] });
      if (path === '/wallet') return reply({ wallet: { balance: 0 }, runPoints: { balance: 0 } });
      if (path === '/registrations/achievements/me') return reply({ achievements: { completedRaces: 0, totalKm: 0 } });
      if (path === '/notifications') return reply({ notifications: [] });
      if (path === '/admin/organizer-access') return reply({ application: null });
      if (path === '/community/me') return reply({ profile: null, eligible: true, consentText: { version: 'profile-v1', text: 'Mẫu' }, results: null });
      const profile = /^\/community\/profiles\/([^/]+)$/.exec(path);
      if (profile) return profiles[profile[1]] ? reply(profiles[profile[1]]) : reply({ message: 'Không tìm thấy hồ sơ.', code: 'COMMUNITY_NOT_FOUND' }, 404);
      if (path === '/chat/me') return reply(chatMe);
      if (path === '/chat/me/consent' && method === 'PUT') { consents.push(request.postDataJSON()); chatMe.consent = true; return reply(chatMe); }
      if (path === '/chat/me/consent' && method === 'DELETE') { consents.push('DELETE'); chatMe.consent = false; return route.fulfill({ status: 204 }); }
      if (path === '/chat/blocks') return reply({ blocks });
      const unblock = /^\/chat\/blocks\/([^/]+)$/.exec(path);
      if (unblock && method === 'DELETE') { unblocks.push(unblock[1]); blocks = blocks.filter(item => item.id !== unblock[1]); return route.fulfill({ status: 204 }); }
      if (path === '/chat/invites' && method === 'POST') {
        const body = request.postDataJSON(); invites.push(body);
        if (inviteMode === 'network') { inviteMode = 'ok'; return route.abort('internetdisconnected'); }
        if (body.handle === 'da-co-cuoc') return reply({ message: 'Hai bạn đã có cuộc trò chuyện.', code: 'CHAT_CONVERSATION_EXISTS', conversationId: 'c3' }, 409);
        if (body.handle === 'khong-nhan') return reply({ message: 'Không tìm thấy người nhận lời mời.', code: 'CHAT_TARGET_NOT_FOUND' }, 404);
        return reply({ conversation: conversations.c1, message: { seq: 1, mine: true, text: body.text, createdAt: '2026-11-26T03:00:00.000Z', clientMessageId: body.clientMessageId } }, 201);
      }
      if (path === '/chat/unread') return reply({ count: 0 });
      if (path === '/chat/conversations') return reply({ conversations: url.searchParams.get('box') === 'invites' ? [] : [conversations.c1], hasMore: false });
      const one = /^\/chat\/conversations\/(c\d)(?:\/(messages|accept|read))?$/.exec(path);
      if (one) {
        const [, id, action] = one;
        if (!action) return reply({ conversation: conversations[id] });
        if (action === 'messages') return reply({ messages: [{ seq: 1, mine: !conversations[id].isRequester ? false : true, text: 'Chào bạn', createdAt: '2026-11-26T03:00:00.000Z' }], hasMore: false });
        if (action === 'accept') { accepts.push(id); conversations[id] = { ...conversations[id], status: 'ACTIVE' }; return reply({ conversation: conversations[id] }); }
        if (action === 'read') return route.fulfill({ status: 204 });
      }
      return reply({ message: 'Không có dữ liệu giả cho ' + path }, 404);
    });

    await page.goto(base + '/login');
    await page.evaluate(() => localStorage.setItem('rf_token', 'chat-entry-fixture-only'));

    // Nút "Nhắn tin" → hộp soạn → gửi xong mở đúng cuộc vừa tạo.
    await page.goto(base + '/community/nguoi-moi');
    await page.getByRole('button', { name: 'Nhắn tin' }).click();
    const text = page.getByLabel('Tin nhắn đầu tiên');
    await expect(text).toBeFocused();
    await text.fill('Chào bạn, mình cũng chạy 21K Hà Nội');
    if (process.env.CHAT_UI_SHOTS) await page.screenshot({ path: process.env.CHAT_UI_SHOTS + '/entry-composer.png', fullPage: true });
    // Mất mạng lần đầu: báo rõ, gửi lại dùng đúng mã cũ.
    inviteMode = 'network';
    await text.fill('Chào bạn, mình cũng chạy 21K Hà Nội');
    await page.getByRole('button', { name: 'Gửi lời mời' }).click();
    await expect(page.getByText('mất kết nối', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Gửi lời mời' }).click();
    await expect(page).toHaveURL(/\/messages\?c=c1$/);
    assert.equal(invites.length, 2);
    assert.equal(invites[0].clientMessageId, invites[1].clientMessageId, 'gửi lại dùng cùng clientMessageId');
    assert.equal(invites[1].handle, 'nguoi-moi');

    // Hai người đã có cuộc (409): mở cuộc đó. Người nhận đã từ chối thấy dòng giải thích và nút Chấp nhận.
    await page.goto(base + '/community/da-co-cuoc');
    await page.getByRole('button', { name: 'Nhắn tin' }).click();
    await page.getByLabel('Tin nhắn đầu tiên').fill('Mình mời lại nhé');
    await page.getByRole('button', { name: 'Gửi lời mời' }).click();
    await expect(page).toHaveURL(/\/messages\?c=c3$/);
    await expect(page.getByText('Bạn đã từ chối lời mời này')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Từ chối' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Chấp nhận' }).click();
    await expect(page.getByLabel('Nội dung tin nhắn')).toBeEnabled();
    assert.deepEqual(accepts, ['c3']);

    // Người nhận không đạt điều kiện: chỉ "Không gửi được lời mời.", không lộ lý do.
    await page.goto(base + '/community/khong-nhan');
    await page.getByRole('button', { name: 'Nhắn tin' }).click();
    await page.getByLabel('Tin nhắn đầu tiên').fill('Chào bạn');
    await page.getByRole('button', { name: 'Gửi lời mời' }).click();
    await expect(page.locator('.chat-invite-composer [role="alert"]')).toHaveText('Không gửi được lời mời.');

    // canMessage false: không có nút; người xem chưa bật nhắn tin thì có lời nhắc tới tab Cộng đồng.
    chatMe.consent = false;
    await page.goto(base + '/community/khong-nhan-tin');
    await expect(page.getByRole('heading', { name: 'Không Nhắn Được' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nhắn tin' })).toHaveCount(0);
    await expect(page.getByText('bạn bật “Cho phép nhắn tin”', { exact: false })).toBeVisible();

    // Tab Cộng đồng: ô đồng ý không tick sẵn, nút khóa tới khi tick, bật gửi đúng chat-v1, tắt gọi DELETE.
    await page.goto(base + '/account#community');
    const agree = page.getByLabel('Cho phép thành viên gửi lời mời nhắn tin cho tôi');
    await expect(agree).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Bật nhắn tin' })).toBeDisabled();
    await agree.check();
    await page.getByRole('button', { name: 'Bật nhắn tin' }).click();
    await expect(page.getByText('Đã bật nhắn tin', { exact: false })).toBeVisible();
    assert.deepEqual(consents[0], { consentVersion: 'chat-v1' });
    await page.getByRole('button', { name: 'Tắt nhắn tin' }).click();
    await expect(page.getByText('Đã tắt nhắn tin', { exact: false })).toBeVisible();
    assert.equal(consents[1], 'DELETE');

    // Ảnh phần Tin nhắn (chỉ khi đặt CHAT_UI_SHOTS=<thư mục>) để người làm tự nhìn.
    if (process.env.CHAT_UI_SHOTS) await page.screenshot({ path: process.env.CHAT_UI_SHOTS + '/entry-settings.png', fullPage: true });
    // Danh sách chặn: "Bỏ chặn" gọi DELETE đúng id và dòng biến mất.
    await expect(page.getByText('Trần Bị Chặn')).toBeVisible();
    await page.getByRole('button', { name: 'Bỏ chặn' }).click();
    await expect(page.getByText('Bạn chưa chặn ai.')).toBeVisible();
    assert.deepEqual(unblocks, ['b1']);

    assert.deepEqual(errors, [], 'không có lỗi JavaScript trên trang');
    console.log('checkChatEntryUI: đạt', { invites: invites.length, consents: consents.length, unblocks: unblocks.length });
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
