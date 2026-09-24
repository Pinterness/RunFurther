const express = require('express');
const {
  listEvents,
  getEventBySlug,
  listEventCategories,
  listResults,
} = require('../controllers/eventController');

const router = express.Router();

router.get('/', listEvents);
router.get('/:slug', getEventBySlug);
router.get('/:slug/categories', listEventCategories);
router.get('/:slug/results', listResults);

module.exports = router;
