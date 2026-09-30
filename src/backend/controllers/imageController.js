const sharp = require('sharp');
const Image = require('../models/EventImage');
const { assert } = require('../lib/errors');
async function upload(req, res, next) {
  try {
    const kind = req.query.kind;
    assert(['banner', 'logo'].includes(kind), 400, 'Chọn ảnh bìa hoặc logo.');
    assert(Buffer.isBuffer(req.body) && req.body.length > 0, 400, 'Chọn một ảnh JPG, PNG hoặc WebP.');
    let result;
    try {
      const input = sharp(req.body, { limitInputPixels: 24000000, failOn: 'warning' });
      const meta = await input.metadata();
      assert(['jpeg', 'png', 'webp'].includes(meta.format) && (meta.pages || 1) === 1, 400, 'Chỉ nhận ảnh tĩnh JPG, PNG hoặc WebP.');
      result = await input.rotate().resize({ width: kind === 'banner' ? 1920 : 512, height: kind === 'banner' ? 1080 : 512, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
    } catch { assert(false, 400, 'Ảnh không hợp lệ. Dùng ảnh tĩnh JPG/PNG/WebP, tối đa 24 megapixel.'); }
    const image = await Image.create({ ownerId: req.userId, kind, data: result.data, width: result.info.width, height: result.info.height });
    res.status(201).json({ url: '/api/media/images/' + image._id, width: image.width, height: image.height });
  } catch (error) { next(error); }
}
async function read(req, res, next) {
  try {
    const image = await Image.findById(req.params.imageId).select('+data').lean();
    assert(image, 404, 'Không tìm thấy ảnh.');
    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable', 'Cross-Origin-Resource-Policy': 'cross-origin' });
    res.send(Buffer.from(image.data.buffer));
  } catch (error) { next(error); }
}
async function validateImages(data, ownerId, existing = {}) {
  for (const [field, kind] of [['bannerUrl','banner'], ['logoUrl','logo']]) {
    if (data[field] === undefined || data[field] === existing[field]) continue;
    assert(typeof data[field] === 'string', 400, 'Đường dẫn ảnh không hợp lệ.');
    if (!data[field]) continue;
    const match = /^\/api\/media\/images\/([a-f0-9]{24})$/.exec(data[field]);
    assert(match && await Image.exists({ _id: match[1], ownerId, kind }), 403, 'Ảnh phải được tải lên bởi chủ giải và đúng loại ảnh.');
  }
}
module.exports = { upload, read, validateImages };
