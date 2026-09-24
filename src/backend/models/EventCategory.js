const mongoose = require("mongoose");

const rulesSchema = new mongoose.Schema(
  {
    minAge: { type: Number, min: 0, max: 120 },
    cutOffTimeMinutes: { type: Number, min: 1 },
  },
  { _id: false },
);

const eventCategorySchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 30,
    },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    distance: { type: Number, required: true, min: 0 },
    price: { type: Number, required: true, default: 650000, min: 0 },
    quotaTotal: { type: Number, required: true, min: 0 },
    quotaSold: { type: Number, default: 0, min: 0 },
    quotaHold: { type: Number, default: 0, min: 0 },
    rules: { type: rulesSchema, default: () => ({}) },
  },
  { timestamps: true },
);

// Category codes identify a race category within one event.
eventCategorySchema.index({ eventId: 1, code: 1 }, { unique: true });

module.exports =
  mongoose.models.EventCategory ||
  mongoose.model("EventCategory", eventCategorySchema);
