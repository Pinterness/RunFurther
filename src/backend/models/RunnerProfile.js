const mongoose = require('mongoose');

const emergencyContactSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 30 },
    relation: { type: String, required: true, trim: true, maxlength: 50 },
  },
  { _id: false },
);

const runnerProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    gender: {
      type: String,
      enum: ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'],
    },
    dob: Date,
    nationality: { type: String, trim: true, maxlength: 80, default: 'Việt Nam' },
    club: { type: String, trim: true, maxlength: 120 },
    identityCard: { type: String, trim: true, maxlength: 50 },
    bloodType: {
      type: String,
      enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
    },
    medicalHistory: { type: String, trim: true, maxlength: 2000 },
    emergencyContact: emergencyContactSchema,
    defaultShirtSize: {
      type: String,
      enum: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
    },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.RunnerProfile || mongoose.model('RunnerProfile', runnerProfileSchema);
