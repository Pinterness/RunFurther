// Isolated display fixtures. Never query or mutate production data.
const categories = [{ _id: 'cat-1', name: 'Half marathon', code: '21K', distance: 21, price: 650000, quotaTotal: 500, quotaSold: 128, quotaHold: 0, rules: { minAge: 16 } }, { _id: 'cat-2', name: '10 km', code: '10K', distance: 10, price: 350000, quotaTotal: 800, quotaSold: 234, quotaHold: 0, rules: {} }];
const race = { _id: 'race-1', name: 'Dalat Forest Trail', slug: 'dalat-forest', createdBy: 'runner-1', organizerId: 'org-1', status: 'REGISTRATION_OPEN', moderation: { state: 'ACTIVE' }, bannerUrl: '/assets/figma/event-trail.png', dateInfo: { registrationStart: '2026-11-01T00:00:00Z', registrationEnd: '2027-02-01T00:00:00Z', raceDate: '2027-02-21T00:00:00Z' }, location: { city: 'Đà Lạt', venue: 'Hồ Tuyền Lâm' }, categories: ['10K', '21K'], quota: 362, quotaTotal: 1300, price: 350000 };
const races = [race, { ...race, _id: 'race-2', name: 'Saigon Riverside Run', slug: 'saigon-riverside', location: { city: 'TP. Hồ Chí Minh', venue: 'Công viên ven sông' } }, { ...race, _id: 'race-3', name: 'Hanoi Autumn Marathon', slug: 'hanoi-autumn', location: { city: 'Hà Nội', venue: 'Hồ Tây' } }];
const userFor = role => ({ _id: 'runner-1', id: 'runner-1', fullName: 'Nguyễn Minh Anh', email: 'runner@example.com', phone: '0900123456', avatarTheme: 'forest', systemRole: role === 'admin' ? 'SUPER_ADMIN' : 'RUNNER', createdAt: '2025-01-01T00:00:00Z' });
const profile = { birthday: '1996-07-14', gender: 'Nữ', nationality: 'Việt Nam', shirtSize: 'M', club: 'Sunday Running Club', emergencyContact: 'Người thân', emergencyPhone: '0900111222' };
const ticket = { _id: 'ticket-1', eventId: race, categoryId: categories[0], status: 'CONFIRMED', bibNumber: '21K-0128', qrToken: 'RF-UNSLOP-AUDIT-FIXTURE', runnerProfile: { fullName: 'Nguyễn Minh Anh' }, logistics: { shirtSize: 'M', hasCheckedIn: false, raceKitIssued: false }, payment: { paidAmount: 650000 } };
function respond(url, role = 'runner') {
  const path = new URL(url, 'https://fixture.example').pathname.replace(/^\/api/, '');
  if (path === '/events') return { events: races, pagination: { total: 3, totalPages: 1, page: 1 } };
  if (path === '/events/dalat-forest') return { event: { ...race, categories } };
  if (path.endsWith('/categories')) return { event: race, categories };
  if (path === '/auth/me') return { user: userFor(role), profile };
  if (path === '/admin/organizer-access') return { application: role === 'owner' ? { status: 'APPROVED' } : null };
  if (path === '/notifications') return { notifications: [], unreadCount: 0 };
  if (path === '/registrations/me') return { registrations: [ticket] };
  if (path === '/bookings/me') return { bookings: [] };
  if (path === '/registrations/achievements/me') return { achievements: { completedRaces: 2, totalKm: 31 } };
  if (path === '/wallet') return { wallet: { balance: 1500000, status: 'ACTIVE', currency: 'VND' }, runPoints: { balance: 150 }, topup: { available: true, minAmount: 10000, maxAmount: 100000000, codeTtlHours: 24, maxActive: 3 } };
  if (path === '/wallet/ledger') return { ledger: [] };
  if (path === '/wallet/payments') return { payments: [] };
  if (path === '/marketplace') return { listings: races.map((event, i) => ({ _id: 'listing-' + i, listingType: 'BIB_TRANSFER', title: 'Nhượng BIB ' + (i ? '10 km' : '21 km'), description: 'Thay đổi lịch trình, nhượng lại suất chạy trước ngày diễn ra giải.', price: i ? 350000 : 600000, originalPrice: i ? 350000 : 650000, bibNumber: i ? '10K-0314' : '21K-0128', categoryInfo: i ? '10 km' : 'Half marathon · 21 km', eventId: event, sellerId: { _id: 'seller-1', fullName: 'Trần Hoàng Nam' } })), pagination: { total: 3, totalPages: 1, page: 1 } };
  if (path === '/banks') return { banks: [{ bin: '970422', code: 'MB', shortName: 'MBBank', name: 'Ngân hàng TMCP Quân đội', supported: true }] };
  if (path === '/organizations/mine') return { organizations: [{ _id: 'org-1', name: 'Câu lạc bộ Đường Rừng', slug: 'duong-rung' }] };
  if (path === '/admin/events') return { events: [race] };
  if (path === '/admin/events/race-1') return { event: race, categories };
  if (path === '/admin/platform/applications') return { applications: [{ _id: 'app-1', organizationName: 'Câu lạc bộ Đường Rừng', userId: userFor('owner'), phone: '0900123456', description: 'Tổ chức các giải chạy cộng đồng tại địa phương.', status: 'PENDING' }] };
  if (path === '/admin/platform/events') return { events: [race], total: 1 };
  return null;
}
module.exports = { respond, userFor };
