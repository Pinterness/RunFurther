const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ['customer', 'support'], required: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true, trim: true, maxlength: 4000 },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  subject: { type: String, required: true, trim: true, maxlength: 160 },
  status: { type: String, enum: ['OPEN', 'ANSWERED', 'CLOSED'], default: 'OPEN' },
  messages: { type: [messageSchema], validate: value => value.length > 0 && value.length <= 100 },
}, { timestamps: true });
schema.index({ userId: 1, updatedAt: -1 });
schema.index({ status: 1, updatedAt: -1 });
module.exports = mongoose.models.SupportTicket || mongoose.model('SupportTicket', schema);
