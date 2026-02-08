const db = require("../db");
const { emitToPoll } = require("../services/realtime");

async function createLiveResponse(req, res) {
  const { meetingId, questionId, optionId, value } = req.body;

  try {
    // 1. Validar dados obrigatórios
    if (!meetingId || !questionId) {
      return res.status(400).json({ error: "meetingId e questionId são obrigatórios." });
    }

    let responseData;

    // 2. Lógica para Escolha Múltipla / Escala (quando há optionId)
    if (optionId) {
      // Atualizar contagem de votos na tabela meeting_options
      const updateResult = await db.query(
        "UPDATE meeting_options SET votes = votes + 1 WHERE id = $1 RETURNING *",
        [optionId]
      );

      if (updateResult.rowCount === 0) {
        return res.status(404).json({ error: "Opção da reunião não encontrada." });
      }

      // Inserir registo individual na tabela responses para histórico/auditoria
      const insertResult = await db.query(
        `INSERT INTO responses (poll_id, question_id, meeting_option_id, value, created_at)
         VALUES (
           (SELECT poll_id FROM meetings WHERE id = $1), 
           $2, $3, $4, NOW()
         ) RETURNING *`,
        [meetingId, questionId, optionId, value || null]
      );
      
      responseData = insertResult.rows[0];
    } 
    
    // 3. Lógica para Resposta Aberta / Nuvem de Palavras (quando há apenas value)
    else if (value) {
      const insertResult = await db.query(
        `INSERT INTO responses (poll_id, question_id, value, created_at)
         VALUES (
           (SELECT poll_id FROM meetings WHERE id = $1), 
           $2, $3, NOW()
         ) RETURNING *`,
        [meetingId, questionId, value]
      );
      
      responseData = insertResult.rows[0];
    } else {
      return res.status(400).json({ error: "Dados insuficientes para gravar voto." });
    }


    emitToPoll(meetingId, "answerSubmitted", { 
      questionId, 
      optionId, 
      value 
    });

    return res.status(201).json(responseData);

  } catch (err) {
    console.error("❌ Erro ao gravar live response:", err.message);
    return res.status(500).json({ error: "Erro interno ao processar voto." });
  }
}

module.exports = { createLiveResponse };