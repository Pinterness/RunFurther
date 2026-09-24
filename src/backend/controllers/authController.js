const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const RunnerProfile = require('../models/RunnerProfile');
const transaction = require('../services/transaction');
const { profileData, serializeProfile } = require('../services/runnerProfileService');

const PASSWORD_MIN_LENGTH = 8;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createAccessToken(user) {
  if (!process.env.JWT_SECRET) {
    throw createHttpError(500, 'JWT authentication is not configured.');
  }

  return jwt.sign(
    {
      sub: user._id.toString(),
      email: user.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
  );
}

function serializeUser(user) {
  return {
    id: user._id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    avatarTheme: user.avatarTheme || 'forest',
    walletId: user.walletId,
    systemRole: user.systemRole,
    status: user.status,
    createdAt: user.createdAt,
  };
}

async function register(req, res, next) {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const fullName = typeof req.body.fullName === 'string' ? req.body.fullName.trim() : '';
    const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : undefined;

    if (!email || !fullName || !password) {
      throw createHttpError(400, 'email, password, and fullName are required.');
    }

    if (password.length < PASSWORD_MIN_LENGTH) {
      throw createHttpError(400, `password must contain at least ${PASSWORD_MIN_LENGTH} characters.`);
    }

    const existingUser = await User.exists({ email });
    if (existingUser) {
      throw createHttpError(409, 'An account with this email already exists.');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const profile = profileData(req.body.profile);
    const user = await transaction(async session => {
      const [user] = await User.create([{ email, passwordHash, fullName, phone }], { session });
      await RunnerProfile.create([{ userId: user._id, ...profile }], { session });
      createAccessToken(user); // Validate JWT configuration before committing the account.
      return user;
    });
    const token = createAccessToken(user);

    return res.status(201).json({ token, user: serializeUser(user) });
  } catch (error) {
    if (error.code === 11000) {
      return next(createHttpError(409, 'An account with this email already exists.'));
    }
    return next(error);
  }
}

async function login(req, res, next) {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      throw createHttpError(400, 'email and password are required.');
    }

    const user = await User.findOne({ email }).select('+passwordHash');
    const passwordMatches = user && (await bcrypt.compare(password, user.passwordHash));

    if (!passwordMatches) {
      throw createHttpError(401, 'Invalid email or password.');
    }

    if (user.status !== 'ACTIVE') {
      throw createHttpError(403, 'This account is not active.');
    }

    const token = createAccessToken(user);
    return res.status(200).json({ token, user: serializeUser(user) });
  } catch (error) {
    return next(error);
  }
}

async function getCurrentUser(req, res, next) {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      throw createHttpError(404, 'User not found.');
    }

    const profile = await RunnerProfile.findOne({ userId: user._id });
    return res.status(200).json({ user: serializeUser(user), profile: serializeProfile(profile) });
  } catch (error) {
    return next(error);
  }
}

async function updateCurrentUser(req, res, next) {
  try {
    const result = await transaction(async session => {
      const user = await User.findById(req.userId).session(session);
      if (!user) throw createHttpError(404, 'Không tìm thấy tài khoản.');
      for (const field of ['fullName', 'phone', 'avatarTheme']) if (req.body[field] !== undefined) {
        if (typeof req.body[field] !== 'string') throw createHttpError(400, 'Thông tin tài khoản không hợp lệ.');
        user[field] = req.body[field].trim();
      }
      await user.save({ session });
      let profile = await RunnerProfile.findOne({ userId: user._id }).session(session);
      if (!profile) profile = new RunnerProfile({ userId: user._id });
      Object.assign(profile, profileData(req.body.profile));
      await profile.save({ session });
      return { user: serializeUser(user), profile: serializeProfile(profile) };
    });
    res.json(result);
  } catch (error) { next(error); }
}
module.exports = { register, login, getCurrentUser, updateCurrentUser };
