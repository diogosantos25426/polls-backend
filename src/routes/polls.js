const express = require('express');
const router = express.Router();
const pollsController = require('../controllers/pollsController');
const pollsStatsController = require('../controllers/pollsStatsController');
const auth = require('../middleware/auth');

router.post('/', auth, pollsController.createPoll);
router.get('/', auth, pollsController.listPolls);
router.get('/:id', pollsController.getPoll);
router.get('/:id/stats', pollsStatsController.getPollStats);
router.put('/:id', auth, pollsController.updatePoll);
router.delete('/:id', auth, pollsController.deletePoll);
router.post('/:id/questions/sync', auth, pollsController.syncQuestions);
router.post('/:id/duplicate', auth, pollsController.duplicatePoll);


router.post('/generate-ai', auth, pollsController.generateWithAI);
module.exports = router;