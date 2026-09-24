require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../src/backend/models/User');

async function promoteSuperAdmin() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    throw new Error('Usage: npm run promote:super-admin -- user@example.com');
  }
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required.');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const user = await User.findOneAndUpdate(
    { email },
    { $set: { systemRole: 'SUPER_ADMIN', status: 'ACTIVE' } },
    { new: true },
  );

  if (!user) {
    throw new Error(`No user exists with email: ${email}`);
  }

  console.log(`${user.email} is now a SUPER_ADMIN.`);
}

promoteSuperAdmin()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
