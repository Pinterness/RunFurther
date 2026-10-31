const mongoose = require('mongoose');
const { internalPath } = require('../../lib/internalPath.cjs');
const { normalizeSupportText } = require('../services/supportKnowledge');

const maxItems = (limit, label) => ({
  validator: (items) => items.length <= limit,
  message: `${label} tối đa ${limit} mục.`,
});

const sourceFields = () => ({
  title: { type: String, required: [true, 'Nguồn phải có tiêu đề.'], trim: true, maxlength: [80, 'Tiêu đề nguồn tối đa 80 ký tự.'] },
  url: {
    type: String,
    required: [true, 'Nguồn phải có liên kết.'],
    trim: true,
    validate: { validator: (value) => internalPath(value) !== null, message: 'Liên kết nguồn phải là đường dẫn nội bộ.' },
  },
});

const term = {
  type: String,
  trim: true,
  maxlength: [60, 'Mỗi từ khóa tối đa 60 ký tự.'],
  validate: { validator: (value) => normalizeSupportText(value) !== '', message: 'Từ khóa phải có chữ hoặc số.' },
};

// One knowledge article the support bot answers from. Only PUBLISHED articles reach the chat.
// `key` is the stable identifier the eval set and the unanswered queue refer to, so it never changes.
// `history` keeps earlier versions (written by the admin service, capped at 20).
const supportArticleSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: [true, 'Bài phải có mã.'],
      unique: true,
      immutable: true,
      match: [/^[a-z0-9][a-z0-9-]{1,59}$/, 'Mã bài chỉ gồm chữ thường không dấu, số và dấu gạch ngang (2–60 ký tự).'],
    },
    title: { type: String, required: [true, 'Bài phải có tiêu đề.'], trim: true, maxlength: [120, 'Tiêu đề tối đa 120 ký tự.'] },
    terms: {
      type: [term],
      validate: { validator: (items) => items.length >= 1 && items.length <= 30, message: 'Bài phải có từ 1 đến 30 từ khóa.' },
    },
    answer: { type: String, required: [true, 'Bài phải có câu trả lời.'], trim: true, maxlength: [2000, 'Câu trả lời tối đa 2000 ký tự.'] },
    sources: { type: [{ _id: false, ...sourceFields() }], validate: maxItems(3, 'Nguồn') },
    suggestions: {
      type: [{ type: String, trim: true, maxlength: [120, 'Mỗi câu gợi ý tối đa 120 ký tự.'] }],
      validate: maxItems(3, 'Câu gợi ý'),
    },
    priority: {
      type: Number,
      default: 0,
      min: [0, 'Độ ưu tiên từ 0 đến 9.'],
      max: [9, 'Độ ưu tiên từ 0 đến 9.'],
      validate: { validator: Number.isInteger, message: 'Độ ưu tiên phải là số nguyên.' },
    },
    status: { type: String, enum: { values: ['DRAFT', 'PUBLISHED'], message: 'Trạng thái bài không hợp lệ.' }, default: 'DRAFT' },
    version: { type: Number, default: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    history: [
      {
        _id: false,
        title: String,
        terms: [String],
        answer: String,
        sources: [{ _id: false, title: String, url: String }],
        suggestions: [String],
        priority: Number,
        status: String,
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        changedAt: Date,
      },
    ],
  },
  { timestamps: true },
);

module.exports = mongoose.models.SupportArticle || mongoose.model('SupportArticle', supportArticleSchema);
