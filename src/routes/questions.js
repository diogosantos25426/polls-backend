const express = require('express');
const router = express.Router();
const questionsController = require('../controllers/questionsController');
const auth = require('../middleware/auth'); // protege criação/edição se quiseres

// CRUD mínimo
router.post('/', auth, questionsController.createQuestion);     // criar pergunta
router.get('/:id', questionsController.getQuestion);            // ler pergunta
router.put('/:id', auth, questionsController.updateQuestion);  // editar
router.delete('/:id', auth, questionsController.deleteQuestion); // apagar

module.exports = router;
