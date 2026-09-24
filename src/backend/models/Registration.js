const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },
    transactionId: {
      type: String,
      default: null,
    },
    paymentMethod: {
      type: String,
      enum: ["WALLET", "VIETQR", "RUNPOINTS", "BANK_TRANSFER"],
      default: "VIETQR",
    },
    paidAmount: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false },
);

const runnerProfileSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    gender: { type: String, default: "Nam" },
    birthday: { type: String, trim: true },
    nationality: { type: String, default: "Việt Nam" },
    emergencyContact: { type: String, trim: true },
    emergencyPhone: { type: String, trim: true },
    club: { type: String, trim: true },
  },
  { _id: false },
);

const logisticsSchema = new mongoose.Schema(
  {
    shirtSize: {
      type: String,
      trim: true,
      enum: ["XS", "S", "M", "L", "XL", "2XL", "3XL", "XXL"],
      default: "M",
    },
    issuedShirtSize: {
      type: String,
      trim: true,
      enum: ["XS", "S", "M", "L", "XL", "2XL", "3XL", "XXL"],
    },
    hasCheckedIn: { type: Boolean, default: false },
    checkedInAt: { type: Date, default: null },
    raceKitIssued: { type: Boolean, default: false },
    raceKitIssuedAt: { type: Date, default: null },
    corral: { type: String, trim: true, maxlength: 30 },
    wave: { type: String, trim: true, maxlength: 30 },
  },
  { _id: false },
);

const finishResultSchema = new mongoose.Schema(
  {
    chipTime: { type: String, trim: true },
    gunTime: { type: String, trim: true },
    overallRank: { type: Number },
    genderRank: { type: Number },
    categoryRank: { type: Number },
    certificateUrl: { type: String, trim: true },
  },
  { _id: false },
);

const registrationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EventCategory",
      required: true,
    },
    bibNumber: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 30,
    },
    qrToken: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    status: {
      type: String,
      enum: [
        "CONFIRMED",
        "CHECKED_IN",
        "KIT_COLLECTED",
        "PENDING_TRANSFER",
        "TRANSFERRED",
        "CANCELLED",
      ],
      default: "CONFIRMED",
    },
    runnerProfile: {
      type: runnerProfileSchema,
      required: true,
    },
    payment: {
      type: paymentSchema,
      required: true,
    },
    logistics: {
      type: logisticsSchema,
      default: () => ({}),
    },
    finishResult: {
      type: finishResultSchema,
      default: null,
    },
  },
  { timestamps: true },
);

// A distinct key order/name coexists with both versions of the legacy event-first
// index, without dropping indexes or changing registration data at startup.
registrationSchema.index({ bibNumber: 1, eventId: 1 }, { name: 'unique_bib_per_event', unique: true, partialFilterExpression: { bibNumber: { $type: 'string' } } });
registrationSchema.index({ 'payment.bookingId': 1 }, { unique: true });
registrationSchema.index({ userId: 1, eventId: 1 });
registrationSchema.index({ status: 1 });

module.exports =
  mongoose.models.Registration ||
  mongoose.model("Registration", registrationSchema);
