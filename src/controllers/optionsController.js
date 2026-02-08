const db = require('../db');

/**
 * body: { questionId, text, position }
 */
async function createOption(req, res) {
  const { questionId, text, position = 0 } = req.body;
  if (!questionId || !text) return res.status(400).json({ error: 'questionId e text obrigatórios' });
  try {
    const { rows } = await db.query(
      'INSERT INTO options (question_id, text, position) VALUES ($1,$2,$3) RETURNING *',
      [questionId, text, position]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro a criar opção' });
  }
}

async function listOptionsByQuestion(req, res) {
  const questionId = req.params.questionId;
  try {
    const { rows } = await db.query('SELECT * FROM options WHERE question_id = $1 ORDER BY position', [questionId]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro a obter opções' });
  }
}

async function updateOption(req, res) {
  const id = req.params.id;
  const { text, position } = req.body;
  try {
    const { rows } = await db.query(
      'UPDATE options SET text = COALESCE($1, text), position = COALESCE($2, position) WHERE id = $3 RETURNING *',
      [text, position, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Opção não encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro a atualizar opção' });
  }
}

async function deleteOption(req, res) {
  const id = req.params.id;
  try {
    await db.query('DELETE FROM options WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro a apagar opção' });
  }
}

module.exports = { createOption, listOptionsByQuestion, updateOption, deleteOption };
