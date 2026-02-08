
const express = require("express");
const router = express.Router();

const liveResponsesController = require('../controllers/liveResponsesController');

router.post("/meeting-vote", liveResponsesController.createLiveResponse);

module.exports = router;