const Event = require('../models/Event');
const { assert } = require('../lib/errors');
const availableEvent = { 'moderation.state': { $nin: ['HIDDEN', 'SUSPENDED'] } };
async function lockOperationalEvent(eventId, session) {
  const event = await Event.findOneAndUpdate({ _id: eventId, ...availableEvent }, { $inc: { activityRevision: 1 } }, { session, new: true });
  assert(event, 409, 'Giải đã bị ẩn hoặc tạm ngừng. Không thể tiếp tục giao dịch hay vận hành.');
  return event;
}
module.exports = { availableEvent, lockOperationalEvent };
