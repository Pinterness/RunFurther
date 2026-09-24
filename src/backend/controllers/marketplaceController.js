const crypto = require('crypto');
const MarketplaceListing = require('../models/MarketplaceListing');
const Registration = require('../models/Registration');
const Event = require('../models/Event');
const User = require('../models/User');
const { changeBalance } = require('../services/walletService');
const transaction = require('../services/transaction');
const { assert, escapeRegex } = require('../lib/errors');

async function listListings(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const filter = { status: 'ACTIVE' };
    if (req.query.listingType) filter.listingType = req.query.listingType;
    if (req.query.eventId) filter.eventId = req.query.eventId;
    if (req.query.search) filter.title = { $regex: escapeRegex(String(req.query.search).slice(0, 120)), $options: 'i' };
    const [listings, total] = await Promise.all([
      MarketplaceListing.find(filter).populate('sellerId', 'fullName').populate('eventId', 'name slug dateInfo location').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      MarketplaceListing.countDocuments(filter),
    ]);
    res.json({ listings, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
}
async function transferableEvent(eventId, session) {
  const event = await Event.findOne({ _id: eventId, status: { $in: ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'] }, 'dateInfo.raceDate': { $gt: new Date() } }).session(session);
  assert(event, 409, 'Transfers are closed for this event.');
}
async function createListing(req, res, next) {
  try {
    const { listingType, registrationId, title, description = '', price, images = [] } = req.body;
    assert(['BIB_TRANSFER', 'GEAR'].includes(listingType), 400, 'Invalid listing type.');
    assert(typeof title === 'string' && title.trim(), 400, 'Title is required.');
    assert(Number.isSafeInteger(price) && price > 0, 400, 'Price must be a positive integer in VND.');
    const listing = await transaction(async session => {
      const data = { listingType, sellerId: req.userId, title, description, price, images, originalPrice: price };
      if (listingType === 'BIB_TRANSFER') {
        const registration = await Registration.findOne({ _id: registrationId, userId: req.userId, status: 'CONFIRMED', 'logistics.hasCheckedIn': false, 'logistics.raceKitIssued': false }).populate('categoryId').session(session);
        assert(registration, 409, 'Ticket is not available for transfer.');
        await transferableEvent(registration.eventId, session);
        const originalPrice = registration.payment.paidAmount;
        assert(price <= Math.floor(originalPrice * 1.1), 400, 'Price exceeds 110% of original ticket price.');
        Object.assign(data, { registrationId: registration._id, eventId: registration.eventId, originalPrice, bibNumber: registration.bibNumber, categoryInfo: registration.categoryId.name });
        registration.status = 'PENDING_TRANSFER';
        await registration.save({ session });
      }
      return (await MarketplaceListing.create([data], { session }))[0];
    });
    res.status(201).json({ listing, message: 'Đã đăng tin.' });
  } catch (error) { next(error); }
}
async function buyListing(req, res, next) {
  try {
    const listing = await transaction(async session => {
      const listing = await MarketplaceListing.findById(req.params.listingId).session(session);
      assert(listing, 404, 'Listing not found.');
      if (listing.status === 'SOLD' && String(listing.buyerId) === String(req.userId)) return listing;
      assert(listing.status === 'ACTIVE', 409, 'Listing is no longer available.');
      assert(String(listing.sellerId) !== String(req.userId), 400, 'Cannot buy your own listing.');
      const seller = await User.findOne({ _id: listing.sellerId, status: 'ACTIVE' }).session(session);
      assert(seller, 409, 'Seller account is unavailable.');
      if (listing.listingType === 'BIB_TRANSFER') {
        const profile = req.body.newRunnerProfile;
        assert(profile && ['fullName', 'email', 'phone'].every(k => typeof profile[k] === 'string' && profile[k].trim()), 400, 'New runner name, email and phone are required.');
        await transferableEvent(listing.eventId, session);
        const reg = await Registration.findOne({ _id: listing.registrationId, userId: listing.sellerId, status: 'PENDING_TRANSFER', 'logistics.hasCheckedIn': false, 'logistics.raceKitIssued': false }).session(session);
        assert(reg, 409, 'Ticket cannot be transferred.');
        reg.userId = req.userId;
        reg.runnerProfile = profile;
        if (profile.shirtSize) reg.logistics.shirtSize = profile.shirtSize;
        reg.qrToken = 'RF-' + crypto.randomBytes(24).toString('hex');
        reg.status = 'CONFIRMED';
        await reg.save({ session });
      }
      await changeBalance({ userId: req.userId, amount: listing.price, type: 'DEBIT', referenceType: 'MARKETPLACE', referenceId: listing._id, key: 'BUY-' + listing._id }, session);
      await changeBalance({ userId: listing.sellerId, amount: listing.price, type: 'CREDIT', referenceType: 'MARKETPLACE', referenceId: listing._id, key: 'SELL-' + listing._id }, session);
      listing.status = 'SOLD';
      listing.buyerId = req.userId;
      listing.soldAt = new Date();
      await listing.save({ session });
      return listing;
    });
    res.json({ listing, message: 'Thanh toán và chuyển quyền sở hữu thành công.' });
  } catch (error) { next(error); }
}
async function cancelListing(req, res, next) {
  try {
    await transaction(async session => {
      const listing = await MarketplaceListing.findOne({ _id: req.params.listingId, sellerId: req.userId }).session(session);
      assert(listing, 404, 'Listing not found.');
      if (listing.status === 'CANCELLED') return;
      assert(listing.status === 'ACTIVE', 409, 'Sold listing cannot be cancelled.');
      if (listing.listingType === 'BIB_TRANSFER') {
        const reg = await Registration.findOneAndUpdate({ _id: listing.registrationId, userId: req.userId, status: 'PENDING_TRANSFER' }, { status: 'CONFIRMED' }, { session });
        assert(reg, 409, 'Ticket ownership has changed.');
      }
      listing.status = 'CANCELLED';
      await listing.save({ session });
    });
    res.json({ message: 'Đã hủy tin.' });
  } catch (error) { next(error); }
}
module.exports = { listListings, createListing, buyListing, cancelListing };

