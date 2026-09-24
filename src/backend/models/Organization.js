const mongoose = require("mongoose");

const brandingSchema = new mongoose.Schema(
  {
    logoUrl: { type: String, trim: true },
    website: { type: String, trim: true },
    description: { type: String, trim: true, maxlength: 1000 },
    contactPhone: { type: String, trim: true },
    contactEmail: { type: String, trim: true, lowercase: true },
  },
  { _id: false },
);

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
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
    type: {
      type: String,
      enum: ["ENTERPRISE", "CASUAL"],
      default: "ENTERPRISE",
    },
    status: {
      type: String,
      enum: ["ACTIVE", "SUSPENDED", "ARCHIVED"],
      default: "ACTIVE",
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    branding: {
      type: brandingSchema,
      default: () => ({}),
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.Organization ||
  mongoose.model("Organization", organizationSchema);
