const Registration = require("../models/Registration");
const Event = require("../models/Event");
const EventCategory = require("../models/EventCategory");
function timeSeconds(value) { return value.split(':').reduce((total, part) => total * 60 + Number(part), 0); }

async function listMyRegistrations(req, res, next) {
  try {
    const registrations = await Registration.find({ userId: req.userId })
      .populate(
        "eventId",
        "name slug dateInfo location status bannerUrl logoUrl",
      )
      .populate("categoryId", "name code distance")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ registrations });
  } catch (error) {
    return next(error);
  }
}

async function getRegistrationById(req, res, next) {
  try {
    const registration = await Registration.findById(req.params.registrationId)
      .populate("eventId", "name slug dateInfo location")
      .populate("categoryId", "name code distance")
      .lean();

    if (!registration) {
      return res.status(404).json({ message: "Registration not found." });
    }

    if (registration.userId.toString() !== req.userId.toString()) {
      return res.status(403).json({ message: "Forbidden." });
    }

    return res.status(200).json({ registration });
  } catch (error) {
    return next(error);
  }
}

async function getMyAchievements(req, res, next) {
  try {
    const registrations = await Registration.find({
      userId: req.userId,
      status: { $in: ["CONFIRMED", "CHECKED_IN", "KIT_COLLECTED"] },
    })
      .populate("eventId", "name slug dateInfo location")
      .populate("categoryId", "name code distance")
      .sort({ "eventId.dateInfo.raceDate": -1 })
      .lean();

    let totalKm = 0;
    let completedRaces = 0;
    const personalBests = {};

    registrations.forEach((reg) => {
      if (!reg.finishResult?.chipTime || !/^[0-9]+:[0-5][0-9]:[0-5][0-9]$/.test(reg.finishResult.chipTime)) return;
      const distance = reg.categoryId?.distance || 0;
      totalKm += distance;
      completedRaces += 1;

      if (reg.finishResult?.chipTime) {
        const catCode = reg.categoryId?.code || `${distance}K`;
        if (
          !personalBests[catCode] ||
          timeSeconds(reg.finishResult.chipTime) < timeSeconds(personalBests[catCode])
        ) {
          personalBests[catCode] = reg.finishResult.chipTime;
        }
      }
    });

    return res.status(200).json({
      achievements: {
        totalKm,
        totalRaces: registrations.length,
        completedRaces,
        personalBests,
        history: registrations,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function lookupTicket(req, res, next) {
  try {
    const { query, eventId } = req.query;
    if (typeof query !== 'string' || !query.trim() || query.length > 120) {
      return res.status(400).json({ message: "Query parameter is required." });
    }

    const trimmed = query.trim();
    const filter = {
      $or: [
        { bibNumber: trimmed.toUpperCase() },
        { qrToken: trimmed },
        { "runnerProfile.phone": trimmed },
        { "runnerProfile.email": trimmed.toLowerCase() },
      ],
    };

    if (eventId) {
      filter.eventId = eventId;
    }

    const registration = await Registration.findOne(filter)
      .populate("eventId", "name slug dateInfo location")
      .populate("categoryId", "name code distance")
      .lean();

    if (!registration) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy thông tin đăng ký phù hợp." });
    }

    // Sanitize sensitive info for public lookup
    const safeData = {
      id: registration._id,
      bibNumber: registration.bibNumber,
      eventName: registration.eventId?.name,
      category: registration.categoryId?.name,
      distance: registration.categoryId?.distance,
      fullName: registration.runnerProfile?.fullName,
      status: registration.status,
      logistics: {
        shirtSize: registration.logistics?.shirtSize,
        hasCheckedIn: registration.logistics?.hasCheckedIn,
        raceKitIssued: registration.logistics?.raceKitIssued,
      },
    };

    return res.status(200).json({ ticket: safeData });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listMyRegistrations,
  getRegistrationById,
  getMyAchievements,
  lookupTicket,
};
