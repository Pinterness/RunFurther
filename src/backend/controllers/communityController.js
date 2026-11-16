// Route /api/community chỉ đọc request và trả kết quả; mọi luật nằm trong communityService.
const { handle } = require('../lib/asyncHandler');
const community = require('../services/communityService');

exports.me = handle(async (req, res) => {
  res.json(await community.getMine(req.userId));
});

exports.saveMe = handle(async (req, res) => {
  const { profile, created } = await community.saveMine(req.userId, req.body);
  res.status(created ? 201 : 200).json({ profile });
});

exports.deleteMe = handle(async (req, res) => {
  await community.deleteMine(req.userId);
  res.status(204).end();
});

exports.list = handle(async (req, res) => {
  res.json(await community.listProfiles(req.userId, { page: req.query.page }));
});

exports.detail = handle(async (req, res) => {
  res.json(await community.getProfile(req.userId, req.params.handle));
});
