const mongoose = require("mongoose");

const marketplaceListingSchema = new mongoose.Schema(
  {
    listingType: {
      type: String,
      enum: ["BIB_TRANSFER", "GEAR"],
      required: true,
    },
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      default: null,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    registrationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Registration",
      default: null,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    originalPrice: {
      type: Number,
      min: 0,
    },
    categoryInfo: {
      type: String,
      trim: true,
    },
    bibNumber: {
      type: String,
      trim: true,
      uppercase: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "SOLD", "CANCELLED"],
      default: "ACTIVE",
    },
    buyerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    soldAt: {
      type: Date,
      default: null,
    },
    images: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true },
);

marketplaceListingSchema.index({ status: 1, createdAt: -1 });
marketplaceListingSchema.index({ eventId: 1, status: 1 });
marketplaceListingSchema.index({ sellerId: 1 });

module.exports =
  mongoose.models.MarketplaceListing ||
  mongoose.model("MarketplaceListing", marketplaceListingSchema);
