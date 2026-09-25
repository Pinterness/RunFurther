const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  organizationName: { type: String, required: true, trim: true, maxlength: 200 },
  phone: { type: String, required: true, trim: true, maxlength: 30 },
  description: { type: String, required: true, trim: true, maxlength: 2000 },
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
  reviewNote: { type: String, maxlength: 1000, default: '' },
  reviews: [{ actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, status: String, reason: String, at: Date }],
}, { timestamps: true });
module.exports = mongoose.models.OrganizerApplication || mongoose.model('OrganizerApplication', schema);
