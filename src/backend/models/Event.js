const mongoose = require("mongoose");

const dateInfoSchema = new mongoose.Schema(
  {
    raceDate: { type: Date, required: true },
    registrationStart: { type: Date, required: true },
    registrationEnd: { type: Date, required: true },
  },
  { _id: false },
);

const locationSchema = new mongoose.Schema(
  {
    city: { type: String, required: true, trim: true, maxlength: 100 },
    venue: { type: String, required: true, trim: true, maxlength: 200 },
  },
  { _id: false },
);

const eventSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Slug must use lowercase kebab-case",
      ],
    },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, immutable: true, index: true },
    activityRevision: { type: Number, default: 0, select: false },
    moderation: {
      state: { type: String, enum: ['ACTIVE', 'HIDDEN', 'SUSPENDED'], default: 'ACTIVE' },
      reason: { type: String, default: '', maxlength: 1000 },
      reviewedAt: Date,
    },
    status: {
      type: String,
      enum: [
        "DRAFT",
        "PUBLISHED",
        "REGISTRATION_OPEN",
        "REGISTRATION_CLOSED",
        "COMPLETED",
        "CANCELLED",
      ],
      default: "DRAFT",
    },
    dateInfo: { type: dateInfoSchema, required: true },
    location: { type: locationSchema, required: true },
    organizerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
    },
    bankAccountInfo: {
      bankName: { type: String, default: "", trim: true },
      accountNo: { type: String, default: "", trim: true },
      accountName: { type: String, default: "", trim: true },
    },
    bannerUrl: { type: String, trim: true },
    logoUrl: { type: String, trim: true },
  },
  { timestamps: true },
);

module.exports = mongoose.models.Event || mongoose.model("Event", eventSchema);
