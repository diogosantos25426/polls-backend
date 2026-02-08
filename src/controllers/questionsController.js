const db = require('../db');

/**
 * body: { pollId, type, prompt, position }
 */
async function createQuestion(req, res) {
  const { pollId, type, prompt, position = 0 } = req.body;
  if (!pollId || !type || !prompt) return res.status(400).json({ error: 'pollId, type e prompt obrigatórios' });
  try {
    const { rows } = await db.query(
      'INSERT INTO questions (poll_id, type, prompt, position) VALUES ($1,$2,$3,$4) RETURNING *',
      [pollId, type, prompt, position]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro a criar pergunta' });
  }
}

async function getQuestion(req, res) {
  const id = req.params.id;
  try {
    const { rows } = await db.query('SELECT * FROM questions WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Pergunta não encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro a obter pergunta' });
  }
}
async function getQuestionDetail(req, res) {
  const { id } = req.params;

  try {
    // 1. Vai buscar a pergunta
    const questionRes = await db.query(
      "SELECT * FROM questions WHERE id = $1",
      [id]
    );

    if (questionRes.rows.length === 0) {
      return res.status(404).json({ error: "Pergunta não encontrada" });
    }

    const question = questionRes.rows[0];

    const optionsRes = await db.query(
      "SELECT id, text FROM options WHERE question_id = $1 ORDER BY id ASC",
      [id]
    );

    // 3. Junta tudo num objeto só
    res.json({
      ...question,
      options: optionsRes.rows // Aqui é onde o array deixa de estar vazio
    });

  } catch (err) {
    console.error("Erro ao carregar detalhes:", err);
    res.status(500).json({ error: "Erro interno" });
  }
}
async function updateQuestion(req, res) {
  const id = req.params.id;
  const { prompt, type, position } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE questions SET prompt = COALESCE($1, prompt), type = COALESCE($2, type), position = COALESCE($3, position) WHERE id = $4 RETURNING *`,
      [prompt, type, position, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Pergunta não encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro a atualizar pergunta' });
  }
}

async function deleteQuestion(req, res) {
  const id = req.params.id;
  try {
    await db.query('DELETE FROM questions WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro a apagar pergunta' });
  }
}

module.exports = { createQuestion, getQuestion, updateQuestion, deleteQuestion };
