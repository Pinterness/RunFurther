// Route của Super Admin cho công tắc AI của trợ lý; luật nằm ở aiSettingService.js.
const { setAiEnabled, presentAiSetting } = require('../services/aiSettingService');

const handle = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };

exports.get = handle(async (_req, res) => { res.json({ setting: await presentAiSetting() }); });
exports.update = handle(async (req, res) => {
  await setAiEnabled(req.body?.aiEnabled, req.userId);
  res.json({ setting: await presentAiSetting() });
});
