const db = require("../db");

async function createResponse(req, res) {
  const { pollId, questionId, optionId, value } = req.body;

  try {
    const result = await db.query(
      `INSERT INTO responses (poll_id, question_id, option_id, value, created_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
      [pollId, questionId, optionId || null, value || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Erro ao gravar resposta:", err);
    res.status(500).json({ error: "Erro ao gravar resposta" });
  }
}
module.exports = {
  createResponse
};