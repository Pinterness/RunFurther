const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  kind: { type: String, enum: ['banner', 'logo'], required: true },
  data: { type: Buffer, required: true, select: false },
  width: Number,
  height: Number,
}, { timestamps: true });
module.exports = mongoose.models.EventImage || mongoose.model('EventImage', schema);
