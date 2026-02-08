const express = require('express');
const router = express.Router();
const responsesController = require('../controllers/responsesController');
//const auth = require('../middleware/auth');

router.post('/', /*auth*/ responsesController.createResponse);
module.exports = router;
