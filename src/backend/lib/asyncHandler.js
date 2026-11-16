// Bọc một handler async của Express: lỗi ném ra (kể cả lỗi của await) được chuyển cho error handler qua next(error),
// thay vì thành promise bị từ chối mà Express 4 không bắt. Ba controller của trợ lý (supportController,
// supportKnowledgeController, supportAiController) dùng chung hàm này.
const handle = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };

module.exports = { handle };
