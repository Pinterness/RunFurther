require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../src/backend/models/User");
const Event = require("../src/backend/models/Event");
const EventCategory = require("../src/backend/models/EventCategory");
const EventAccount = require("../src/backend/models/EventAccount");
const Organization = require("../src/backend/models/Organization");
const MarketplaceListing = require("../src/backend/models/MarketplaceListing");
const Wallet = require("../src/backend/models/Wallet");
const RunPoints = require("../src/backend/models/RunPoints");

async function seed() {
  if (process.env.NODE_ENV === 'production') throw new Error('Seeding is disabled in production.');
  const uri = process.env.SEED_MONGODB_URI;
  if (!uri) throw new Error('Set SEED_MONGODB_URI to a dedicated development database.');
  await mongoose.connect(uri);
  const name = mongoose.connection.name;
  if (!/_(dev|test)$/.test(name)) throw new Error('Seed database name must end in _dev or _test.');
  const collections = await mongoose.connection.db.listCollections().toArray();
  if (collections.length) throw new Error('Seed only supports an empty database. Existing data was not changed.');

  // 1. Create Super Admin
  const adminEmail = "admin@runfurther.vn";
  const adminPasswordHash = await bcrypt.hash("admin123456", 10);
  const admin = await User.create({
    email: adminEmail,
    passwordHash: adminPasswordHash,
    fullName: "Hệ Thống Super Admin",
    phone: "0988888888",
    systemRole: "SUPER_ADMIN",
    status: "ACTIVE",
  });
  console.log("Created Super Admin: admin@runfurther.vn / admin123456");

  // 2. Create Organizer
  const organizerEmail = "organizer@runfurther.vn";
  const orgPasswordHash = await bcrypt.hash("organizer123456", 10);
  const organizer = await User.create({
    email: organizerEmail,
    passwordHash: orgPasswordHash,
    fullName: "Nhà Tổ Chức Sự Kiện",
    phone: "0901234567",
    systemRole: "ORGANIZER",
    status: "ACTIVE",
  });
  console.log("Created Organizer: organizer@runfurther.vn / organizer123456");

  await require('../src/backend/models/OrganizerApplication').create({ userId: organizer._id, organizationName: 'VNG Marathon Series', phone: '0901234567', description: 'Development fixture only', status: 'APPROVED', reviewNote: 'Development seed', reviews: [{ actorId: admin._id, status: 'APPROVED', reason: 'Development seed', at: new Date() }] });

  // 3. Create Organizations
  const enterpriseOrg = await Organization.create({
    name: "VNG Marathon Series",
    slug: "vng-run-club",
    type: "ENTERPRISE",
    ownerId: organizer._id,
    branding: {
      description:
        "Đơn vị tổ chức chuỗi giải chạy marathon chuyên nghiệp hàng đầu Việt Nam",
      website: "https://vng.com.vn",
      contactPhone: "0901234567",
      contactEmail: "contact@vngrunners.vn",
    },
    status: "ACTIVE",
  });

  // 4. Create Events & Categories
  const eventsData = [
    {
      slug: "hue-heritage-run-2025",
      name: "Hue Heritage Run 2025",
      status: "REGISTRATION_OPEN",
      dateInfo: {
        raceDate: new Date("2025-05-18T04:00:00.000Z"),
        registrationStart: new Date("2024-10-01T00:00:00.000Z"),
        registrationEnd: new Date("2025-05-01T23:59:59.000Z"),
      },
      location: {
        city: "Kinh thành Huế, Thừa Thiên Huế",
        venue: "Quảng trường Ngọ Môn, Đại Nội Huế",
      },
      bankAccountInfo: {
        bankName: "MBBank",
        accountNo: "0901234567",
        accountName: "RUN FURTHER VIETNAM",
      },
      categories: [
        {
          code: "5K",
          name: "5K Discovery Run",
          distance: 5,
          price: 450000,
          quotaTotal: 1000,
        },
        {
          code: "10K",
          name: "10K Heritage Challenge",
          distance: 10,
          price: 650000,
          quotaTotal: 1500,
        },
        {
          code: "21K",
          name: "21K Half Marathon",
          distance: 21.1,
          price: 850000,
          quotaTotal: 2000,
        },
        {
          code: "42K",
          name: "42K Full Marathon",
          distance: 42.195,
          price: 1100000,
          quotaTotal: 1000,
        },
      ],
    },
    {
      slug: "dalat-ultra-trail-2024",
      name: "Dalat Ultra Trail 2024",
      status: "REGISTRATION_OPEN",
      dateInfo: {
        raceDate: new Date("2024-11-15T03:30:00.000Z"),
        registrationStart: new Date("2024-05-01T00:00:00.000Z"),
        registrationEnd: new Date("2024-11-01T23:59:59.000Z"),
      },
      location: {
        city: "Đà Lạt, Lâm Đồng",
        venue: "Thung Lũng Tình Yêu, TP. Đà Lạt",
      },
      bankAccountInfo: {
        bankName: "MBBank",
        accountNo: "0901234567",
        accountName: "RUN FURTHER VIETNAM",
      },
      categories: [
        {
          code: "10K",
          name: "10K Trail Fun",
          distance: 10,
          price: 750000,
          quotaTotal: 800,
        },
        {
          code: "21K",
          name: "21K Trail Quest",
          distance: 21,
          price: 1050000,
          quotaTotal: 1200,
        },
        {
          code: "55K",
          name: "55K Ultra Trail",
          distance: 55,
          price: 1450000,
          quotaTotal: 800,
        },
        {
          code: "85K",
          name: "85K King of Mountains",
          distance: 85,
          price: 1850000,
          quotaTotal: 500,
        },
      ],
    },
    {
      slug: "hcmc-night-run-10k-2024",
      name: "HCMC Night Run 10K 2024",
      status: "REGISTRATION_OPEN",
      dateInfo: {
        raceDate: new Date("2024-12-21T18:00:00.000Z"),
        registrationStart: new Date("2024-07-01T00:00:00.000Z"),
        registrationEnd: new Date("2024-12-10T23:59:59.000Z"),
      },
      location: {
        city: "Quận 1, TP. Hồ Chí Minh",
        venue: "Phố đi bộ Nguyễn Huệ, Quận 1",
      },
      bankAccountInfo: {
        bankName: "MBBank",
        accountNo: "0901234567",
        accountName: "RUN FURTHER VIETNAM",
      },
      categories: [
        {
          code: "5K",
          name: "5K Night Stride",
          distance: 5,
          price: 350000,
          quotaTotal: 1000,
        },
        {
          code: "10K",
          name: "10K City Lights",
          distance: 10,
          price: 500000,
          quotaTotal: 1500,
        },
      ],
    },
  ];

  for (const item of eventsData) {
    let event = await Event.create({
      slug: item.slug,
      name: item.name,
      status: item.status,
      dateInfo: {
        registrationStart: new Date(Date.now() - 86400000),
        registrationEnd: new Date(Date.now() + 30 * 86400000),
        raceDate: new Date(Date.now() + 45 * 86400000),
      },
      location: item.location,
      organizerId: enterpriseOrg._id,
      createdBy: organizer._id,
      bankAccountInfo: item.bankAccountInfo,
    });
    console.log(`Created Event: ${event.name}`);
    await EventAccount.create({ eventId: event._id, userId: organizer._id, employeeName: organizer.fullName, accountType: 'EVENT_ADMIN', loginCode: require('crypto').randomBytes(12).toString('hex'), createdBy: organizer._id });

    for (const cat of item.categories) {
      await EventCategory.create({
        eventId: event._id,
        code: cat.code,
        name: cat.name,
        distance: cat.distance,
        price: cat.price,
        quotaTotal: cat.quotaTotal,
        quotaSold: 0,
        quotaHold: 0,
      });
    }

    // Create Staff Accounts for this event (PIN 123456)
    await EventAccount.create({
      eventId: event._id,
      userId: organizer._id,
      employeeName: "Trưởng Ban Nhân Sự (Staff Lead)",
      accountType: "STAFF_MANAGER",
      loginCode: "MGR999",
      createdBy: admin._id,
      status: "ACTIVE",
    });

    await EventAccount.create({
      eventId: event._id,
      userId: organizer._id,
      employeeName: "Nhân viên Check-in 01",
      accountType: "CHECKIN",
      loginCode: "CHK101",
      createdBy: admin._id,
      status: "ACTIVE",
    });

    await EventAccount.create({
      eventId: event._id,
      userId: organizer._id,
      employeeName: "Nhân viên Phát Race-kit 01",
      accountType: "RACE_KIT",
      loginCode: "KIT202",
      createdBy: admin._id,
      status: "ACTIVE",
    });
    console.log(`Created Staff PINs for ${item.slug}: MGR999, CHK101, KIT202`);
  }

  console.log("Database seeding complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
