const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address"],
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 30,
    },
    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
      default: null,
    },
    avatarTheme: { type: String, enum: ['forest', 'clay', 'ocean', 'plum'], default: 'forest' },
    systemRole: {
      type: String,
      enum: ["RUNNER", "USER", "ORGANIZER", "SUPER_ADMIN"],
      default: "RUNNER",
    },
    status: {
      type: String,
      enum: ["ACTIVE", "BANNED"],
      default: "ACTIVE",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
