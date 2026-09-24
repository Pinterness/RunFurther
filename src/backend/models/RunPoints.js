const mongoose = require("mongoose");

const pointHistorySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["EARNED", "REDEEMED", "EXPIRED"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    referenceType: {
      type: String,
      trim: true,
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true },
);

const runPointsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: 0,
    },
    lifetimeEarned: {
      type: Number,
      default: 0,
      min: 0,
    },
    history: {
      type: [pointHistorySchema],
      default: [],
    },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.RunPoints || mongoose.model("RunPoints", runPointsSchema);
