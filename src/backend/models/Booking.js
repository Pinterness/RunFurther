const mongoose = require("mongoose");

const runnerInfoSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true, maxlength: 30 },
    gender: { type: String, enum: ["Nam", "Nữ", "Khác"], default: "Nam" },
    birthday: { type: String, trim: true },
    nationality: { type: String, default: "Việt Nam", trim: true },
    emergencyContact: { type: String, trim: true, maxlength: 120 },
    emergencyPhone: { type: String, trim: true, maxlength: 30 },
    shirtSize: {
      type: String,
      enum: ["XS", "S", "M", "L", "XL", "XXL", "3XL"],
      default: "M",
    },
    club: { type: String, trim: true, maxlength: 120 },
  },
  { _id: false },
);

const addonsSchema = new mongoose.Schema(
  {
    photoPackage: { type: Boolean, default: false },
    pastaParty: { type: Boolean, default: false },
  },
  { _id: false },
);

const bookingSchema = new mongoose.Schema(
  {
    orderCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
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
    runnerInfo: {
      type: runnerInfoSchema,
      required: true,
    },
    addons: {
      type: addonsSchema,
      default: () => ({}),
    },
    price: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    pointsDiscount: { type: Number, default: 0, min: 0 },
    finalAmount: { type: Number, required: true, min: 0 },
    paymentMethod: {
      type: String,
      enum: ["WALLET", "VIETQR", "RUNPOINTS"],
      default: "VIETQR",
    },
    status: {
      type: String,
      enum: ["HOLD", "EXPIRED", "PAID", "CANCELLED"],
      default: "HOLD",
    },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

bookingSchema.index({ expiresAt: 1 });
bookingSchema.index({ userId: 1, createdAt: -1 });

module.exports =
  mongoose.models.Booking || mongoose.model("Booking", bookingSchema);
