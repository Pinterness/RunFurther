const jwt = require('jsonwebtoken');
const EventAccount = require('../models/EventAccount');
const User = require('../models/User');
const Event = require('../models/Event');

function getBearerToken(req) {
  const authorization = req.headers.authorization;
  if (!authorization || !authorization.startsWith('Bearer ')) {
    return null;
  }

  return authorization.slice(7).trim();
}

function getEventId(req) {
  return (
    req.eventId ||
    req.event?._id ||
    req.params?.eventId ||
    req.body?.eventId ||
    req.query?.eventId ||
    req.headers['x-event-id']
  );
}

async function verifyUserToken(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Authentication token is required.' });
  }

  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ message: 'JWT authentication is not configured.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ _id: payload.sub, status: 'ACTIVE' }).select('_id systemRole status');
    if (!user) return res.status(401).json({ message: 'User account is inactive or unavailable.' });
    req.currentUser = user;
    req.user = payload;
    req.userId = payload.sub || payload.userId || payload.id;
    return next();
  } catch (_error) {
    return res.status(401).json({ message: 'Invalid or expired authentication token.' });
  }
}

async function verifyStaffLoginCode(req, res, next) {
  const loginCode = req.headers['x-login-code'];
  const eventId = getEventId(req);

  if (!eventId) {
    return res.status(400).json({ message: 'Event context is required.' });
  }

  if (typeof loginCode !== 'string' || !loginCode.trim()) {
    return res.status(401).json({ message: 'Staff login code is required.' });
  }

  try {
    const account = await EventAccount.findOne({
      eventId,
      loginCode: loginCode.trim().toUpperCase(),
      status: 'ACTIVE',
    });

    if (!account) {
      return res.status(401).json({ message: 'Invalid or inactive staff login code.' });
    }

    if (account.accountType === 'EVENT_ADMIN') return res.status(403).json({ message: 'Quản lý sự kiện phải đăng nhập bằng tài khoản cá nhân.' });
    if (account.userId && !await User.exists({ _id: account.userId, status: 'ACTIVE' })) return res.status(401).json({ message: 'Tài khoản nhân sự không còn hoạt động.' });

    req.staffAccount = account;
    req.accountType = account.accountType;
    req.assignment = account.assignment;
    req.eventId = account.eventId;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAccountType(allowedTypes) {
  const permittedTypes = Array.isArray(allowedTypes) ? allowedTypes : [allowedTypes];

  return (req, res, next) => {
    if (!req.accountType || !permittedTypes.includes(req.accountType)) {
      return res.status(403).json({ message: 'Forbidden for this staff account type.' });
    }

    return next();
  };
}

async function getActiveUser(userId) {
  return User.findOne({ _id: userId, status: 'ACTIVE' }).select('_id fullName email systemRole status');
}

async function requireSuperAdmin(req, res, next) {
  try {
    if (!req.userId) {
      return res.status(401).json({ message: 'Authentication token is required.' });
    }

    const user = await getActiveUser(req.userId);
    if (!user || user.systemRole !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Super administrator access is required.' });
    }

    req.currentUser = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

// Allows a SUPER_ADMIN globally or the creator with an active EVENT_ADMIN assignment.
async function requireEventAdmin(req, res, next) {
  try {
    if (!req.userId) {
      return res.status(401).json({ message: 'Authentication token is required.' });
    }

    const eventId = getEventId(req);
    if (!eventId) {
      return res.status(400).json({ message: 'Event context is required.' });
    }

    const user = await getActiveUser(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User account is inactive or unavailable.' });
    }

    const event = await Event.findById(eventId).select('createdBy');
    if (!event) return res.status(404).json({ message: 'Không tìm thấy sự kiện.' });

    if (user.systemRole === 'SUPER_ADMIN') {
      req.currentUser = user;
      req.eventId = eventId;
      return next();
    }

    const eventAdminAccount = await EventAccount.findOne({
      eventId,
      userId: user._id,
      accountType: 'EVENT_ADMIN',
      status: 'ACTIVE',
    });

    const ownsEvent = String(event.createdBy) === String(user._id);
    if (!eventAdminAccount || !ownsEvent) {
      return res.status(403).json({ message: 'Event administrator access is required for this event.' });
    }

    req.currentUser = user;
    req.eventId = eventAdminAccount.eventId;
    req.eventAdminAccount = eventAdminAccount;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  verifyUserToken,
  verifyStaffLoginCode,
  requireAccountType,
  requireSuperAdmin,
  requireEventAdmin,
  requireEventRoles,
};

function requireEventRoles(roles) {
  return async (req, res, next) => {
    const check = async () => {
      if (req.currentUser?.systemRole === 'SUPER_ADMIN') return next();
      const account = await EventAccount.findOne({ eventId: getEventId(req), userId: req.userId, status: 'ACTIVE', accountType: { $in: roles } });
      if (!account) return res.status(403).json({ message: 'Insufficient permissions for this event.' });
      if (account.accountType === 'EVENT_ADMIN' && !await Event.exists({ _id: getEventId(req), createdBy: req.userId })) return res.status(403).json({ message: 'Bạn không phải người tạo sự kiện này.' });
      req.staffAccount = account;
      req.accountType = account.accountType;
      return next();
    };
    try {
      if (getBearerToken(req)) return await verifyUserToken(req, res, () => check().catch(next));
      return await verifyStaffLoginCode(req, res, () => requireAccountType(roles)(req, res, next));
    } catch (error) { return next(error); }
  };
}
