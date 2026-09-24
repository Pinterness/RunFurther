const Organization = require("../models/Organization");
const Event = require("../models/Event");

async function listOrganizations(req, res, next) {
  try {
    const filter = { status: "ACTIVE", $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] };
    const organizations = await Organization.find(filter)
      .select("name slug type branding createdAt")
      .lean();

    return res.status(200).json({ organizations });
  } catch (error) {
    return next(error);
  }
}

async function getOrganizationBySlug(req, res, next) {
  try {
    const slug = req.params.slug.trim().toLowerCase();
    const organization = await Organization.findOne({
      slug,
      status: "ACTIVE",
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    }).lean();

    if (!organization) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy đơn vị tổ chức." });
    }

    const events = await Event.find({ organizerId: organization._id, status: { $in: ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'COMPLETED'] } })
      .select("slug name dateInfo location status bannerUrl logoUrl")
      .sort({ "dateInfo.raceDate": -1 })
      .lean();

    return res.status(200).json({ organization, events });
  } catch (error) {
    return next(error);
  }
}

async function createOrganization(req, res, next) {
  try {
    const { name, slug, type = "ENTERPRISE", branding = {} } = req.body;

    if (typeof name !== 'string' || !name.trim() || typeof slug !== 'string' || !slug.trim()) {
      return res.status(400).json({ message: "name và slug là bắt buộc." });
    }

    const existing = await Organization.findOne({
      slug: slug.trim().toLowerCase(),
    });
    if (existing) {
      return res.status(409).json({ message: "Slug này đã tồn tại." });
    }

    const expiresAt =
      type === "CASUAL"
        ? new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
        : null;

    const organization = await Organization.create({
      name: name.trim(),
      slug: slug.trim().toLowerCase(),
      type,
      ownerId: req.userId,
      branding,
      expiresAt,
      status: "ACTIVE",
    });

    return res.status(201).json({
      message: "Tạo đơn vị tổ chức thành công!",
      organization,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listOrganizations,
  getOrganizationBySlug,
  createOrganization,
};
