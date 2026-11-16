// Đồng hồ hạn mức cho chuông của Super Admin (spec 4.9, master plan §14.3). App chỉ đo được hai thứ: dung lượng
// Atlas (gói Free 512 MB, ghi thêm sẽ lỗi khi đầy) và lượt AI hôm nay (AI_DAILY_LIMIT). Từ 70% là mức vàng, từ 90%
// là mức đỏ. Mỗi đồng hồ có dạng { name, label, read(now), period(now) }; thêm đồng hồ mới chỉ cần thêm vào mảng.
const mongoose = require('mongoose');
const { pacificDay, readDailyLimit, todayUsage } = require('./aiUsageService');

const ATLAS_LIMIT_BYTES = 512 * 1024 * 1024;
const ATLAS_CACHE_MS = 10 * 60 * 1000;
const LEVELS = [90, 70];
const monthFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' });
const megabytes = bytes => (bytes / 1048576).toLocaleString('vi-VN', { maximumFractionDigits: 1 });

const SYSTEM_DATABASES = ['admin', 'local', 'config'];

// Gói Atlas Free giới hạn 512 MB cho cả cluster, không riêng database của app (P09). Hàm cộng dataSize + indexSize
// của mọi database trừ database hệ thống. Database của app đo bằng chính connection.db.stats(); các database khác
// đo qua client.db(tên). Tài khoản không được liệt kê database thì đo riêng database của app như trước.
async function clusterStats({ connection = mongoose.connection } = {}) {
  const own = connection.db.databaseName;
  let names;
  try {
    const { databases } = await connection.db.admin().command({ listDatabases: 1, nameOnly: true });
    names = databases.map(database => database.name).filter(name => !SYSTEM_DATABASES.includes(name) && name !== own);
  } catch { names = []; }
  const all = await Promise.all([connection.db.stats(), ...names.map(name => connection.client.db(name).stats())]);
  return all.reduce((total, stats) => ({
    dataSize: total.dataSize + (Number(stats?.dataSize) || 0),
    indexSize: total.indexSize + (Number(stats?.indexSize) || 0),
  }), { dataSize: 0, indexSize: 0 });
}

// Atlas tính dung lượng bằng dataSize + indexSize, không tính storageSize. Kết quả được giữ 10 phút, vì chuông của
// mỗi Super Admin hỏi lại server 60 giây một lần. Đọc lỗi thì không giữ, để lần sau đọc lại.
function createAtlasMeter({ stats = () => clusterStats(), cacheMs = ATLAS_CACHE_MS, now = Date.now } = {}) {
  let cached = null;
  return {
    name: 'atlas',
    label: 'Dung lượng Atlas',
    async read() {
      if (cached && now() - cached.at < cacheMs) return cached.value;
      const result = await stats();
      const used = (Number(result?.dataSize) || 0) + (Number(result?.indexSize) || 0);
      const value = { used, limit: ATLAS_LIMIT_BYTES, detail: `${megabytes(used)} MB / 512 MB của gói Atlas Free` };
      cached = { at: now(), value };
      return value;
    },
    // Mỗi tháng (giờ Việt Nam) một khóa, nên mỗi ngưỡng chỉ báo một lần mỗi tháng.
    period: at => monthFormat.format(at),
    clear() { cached = null; },
  };
}

// Lượt AI hôm nay so với AI_DAILY_LIMIT. Giới hạn 0 nghĩa là AI không chạy, nên không đọc DB và không báo.
function createAiMeter({ usage = todayUsage, env = process.env } = {}) {
  return {
    name: 'ai',
    label: 'Lượt AI hôm nay',
    async read(now) {
      const limit = readDailyLimit(env);
      if (limit <= 0) return { used: 0, limit: 0, detail: '' };
      const used = await usage(now);
      return { used, limit, detail: `${used} / ${limit} lượt hôm nay; lượt hồi lúc 0 giờ giờ Thái Bình Dương (14 hoặc 15 giờ chiều giờ Việt Nam)` };
    },
    // Lượt hồi mỗi ngày Pacific, nên khóa theo ngày: hôm sau đầy lại thì chuông báo lại.
    period: at => pacificDay(at),
  };
}

// Đồng hồ Atlas dùng chung cho mọi request để cache 10 phút có tác dụng.
const atlasMeter = createAtlasMeter();
const defaultMeters = () => [atlasMeter, createAiMeter()];
const clearQuotaCache = () => atlasMeter.clear();

// Mục chuông cho các đồng hồ từ 70% trở lên. Khóa `quota:<name>:<70|90>:<kỳ>` nên qua mức 90 thì có khóa mới và
// chuông hiện lại, kể cả khi admin đã đọc mục mức 70. Phần trăm làm tròn xuống để 89,9% không hiện thành 90%.
async function quotaAlerts({ meters = defaultMeters(), now = new Date() } = {}) {
  const readings = await Promise.all(meters.map(async meter => {
    try { return { meter, reading: await meter.read(now) }; }
    catch (error) { console.error(`Quota meter ${meter.name} failed:`, error.message); return null; }
  }));
  const items = [];
  for (const entry of readings) {
    if (!entry) continue;
    const { meter, reading: { used, limit, detail } } = entry;
    if (!(limit > 0)) continue;
    const percent = Math.floor((used / limit) * 100);
    const level = LEVELS.find(value => percent >= value);
    if (!level) continue;
    items.push({ key: `quota:${meter.name}:${level}:${meter.period(now)}`, title: `${meter.label} đã dùng ${percent}% (mức ${level}%)`, detail, href: '/admin', at: now });
  }
  return items;
}

module.exports = { ATLAS_LIMIT_BYTES, clusterStats, createAtlasMeter, createAiMeter, quotaAlerts, clearQuotaCache };
