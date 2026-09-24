const mongoose = require("mongoose");

const assignmentSchema = new mongoose.Schema(
  {
    stationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Station",
      default: null,
    },
    locationName: { type: String, trim: true, maxlength: 150 },
  },
  { _id: false },
);

const eventAccountSchema = new mongoose.Schema(
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
    employeeName: { type: String, required: true, trim: true, maxlength: 120 },
    accountType: {
      type: String,
      required: true,
      enum: [
        "EVENT_ADMIN",
        "STAFF_MANAGER",
        "CHECKIN",
        "RACE_KIT",
        "CHECKPOINT",
        "MARSHAL",
        "TIMING",
        "WATER_STATION",
        "MEDICAL",
        "VOLUNTEER",
      ],
    },
    loginCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 50,
    },
    assignment: assignmentSchema,
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE"],
      default: "ACTIVE",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

// A login code can be reused by different events, but only once within each event.
eventAccountSchema.index({ eventId: 1, loginCode: 1 }, { unique: true });

module.exports =
  mongoose.models.EventAccount ||
  mongoose.model("EventAccount", eventAccountSchema);
