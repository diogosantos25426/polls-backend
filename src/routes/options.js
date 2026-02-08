const express = require('express');
const router = express.Router();
const optionsController = require('../controllers/optionsController');
const auth = require('../middleware/auth');

router.post('/', auth, optionsController.createOption);
router.get('/question/:questionId', optionsController.listOptionsByQuestion);
router.put('/:id', auth, optionsController.updateOption);
router.delete('/:id', auth, optionsController.deleteOption);

module.exports = router;
