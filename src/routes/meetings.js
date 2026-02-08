const express = require('express');
const router = express.Router();
const meetingsController = require('../controllers/meetingsController');

router.get('/', meetingsController.getMeetings);
router.post('/export', meetingsController.exportToMeeting);

outer.delete('/:id', meetingsController.deleteMeeting); 
router.post('/:id/reset', meetingsController.resetMeeting);
module.exports = router;