const mongoose = require("mongoose");

const applicantSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true, maxlength: 30 },
    birthday: { type: String, trim: true },
    tShirtSize: {
      type: String,
      enum: ["XS", "S", "M", "L", "XL", "XXL", "3XL"],
      default: "L",
    },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
);

const volunteerApplicationSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    applicant: {
      type: applicantSchema,
      required: true,
    },
    desiredRole: {
      type: String,
      required: true,
      enum: [
        "CHECKIN",
        "RACE_KIT",
        "MARSHAL",
        "WATER_STATION",
        "TIMING",
        "MEDICAL",
        "VOLUNTEER",
      ],
      default: "VOLUNTEER",
    },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },
    assignedRole: {
      type: String,
      enum: [
        "CHECKIN",
        "RACE_KIT",
        "MARSHAL",
        "WATER_STATION",
        "TIMING",
        "MEDICAL",
        "VOLUNTEER",
      ],
    },
    loginCode: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 30,
    },
    eventAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EventAccount",
      default: null,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewNote: {
      type: String,
      trim: true,
      maxlength: 300,
    },
  },
  { timestamps: true },
);

volunteerApplicationSchema.index({ eventId: 1, "applicant.email": 1 });
volunteerApplicationSchema.index({ userId: 1, createdAt: -1 });
volunteerApplicationSchema.index({ eventId: 1, 'applicant.email': 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'PENDING' } });

module.exports =
  mongoose.models.VolunteerApplication ||
  mongoose.model("VolunteerApplication", volunteerApplicationSchema);
