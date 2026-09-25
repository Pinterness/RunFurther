const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, enum: ['HIDDEN', 'SUSPENDED', 'ACTIVE'], required: true },
  reason: { type: String, required: true, trim: true, maxlength: 1000 },
}, { timestamps: true });
module.exports = mongoose.models.EventModeration || mongoose.model('EventModeration', schema);
