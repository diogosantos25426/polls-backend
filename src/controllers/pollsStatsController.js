const db = require('../db');

async function getPollStats(req, res) {
  const pollId = req.params.id;
  
  try {
    // 1) Obter poll
    const pollRes = await db.query('SELECT id, title, description, created_at FROM polls WHERE id = $1', [pollId]);
    const poll = pollRes.rows[0];
    
    if (!poll) {
      return res.status(404).json({ error: 'Sondagem não encontrada' });
    }

    // 2) Obter perguntas
    const qRes = await db.query(
      'SELECT id, type, prompt, settings FROM questions WHERE poll_id = $1 ORDER BY position, id', 
      [pollId]
    );
    const questions = qRes.rows;

    const questionsWithStats = [];

    for (const q of questions) {
      const type = (q.type || '').toLowerCase();

      const isScale = type.includes('scale');
      const isChoice = type.includes('multiple');
      const isText = type.includes('open') || type.includes('word');

      // Parse seguro do settings
      let parsedSettings = {};
      try {
        parsedSettings = (typeof q.settings === 'string') ? JSON.parse(q.settings) : (q.settings || {});
      } catch (e) {
        parsedSettings = {};
      }

      if (isScale) {
        // Contagem para Escalas (agrupado por valor)
        const statsRes = await db.query(
          `SELECT value, COUNT(*)::int as count 
           FROM responses 
           WHERE question_id = $1 AND value IS NOT NULL 
           GROUP BY value`,
          [q.id]
        );

        const totalRes = await db.query(
          'SELECT COUNT(*)::int as total FROM responses WHERE question_id = $1',
          [q.id]
        );

        questionsWithStats.push({
          id: q.id,
          type: q.type,
          prompt: q.prompt,
          settings: parsedSettings,
          totalVotes: totalRes.rows[0]?.total || 0,
          responses: statsRes.rows 
        });

      } else if (isChoice) {
        // Contagem para Múltipla Escolha
        const optRes = await db.query(
          `SELECT o.id, o.text, COALESCE(counts.votes, 0)::int AS votes
           FROM options o
           LEFT JOIN (
             SELECT option_id, COUNT(*) AS votes
             FROM responses
             WHERE question_id = $1 AND option_id IS NOT NULL
             GROUP BY option_id
           ) counts ON counts.option_id = o.id
           WHERE o.question_id = $1
           ORDER BY o.position`,
          [q.id]
        );

        questionsWithStats.push({
          id: q.id,
          type: q.type,
          prompt: q.prompt,
          totalVotes: optRes.rows.reduce((acc, curr) => acc + curr.votes, 0),
          options: optRes.rows
        });

      } else {
        const respRes = await db.query(
          'SELECT id, value FROM responses WHERE question_id = $1 AND value IS NOT NULL LIMIT 200',
          [q.id]
        );

        questionsWithStats.push({
          id: q.id,
          type: q.type,
          prompt: q.prompt,
          totalVotes: respRes.rowCount,
          responses: respRes.rows
        });
      }
    }

    res.json({ poll, questions: questionsWithStats });

  } catch (err) {
    console.error('❌ ERRO CRÍTICO NO DATABASE:', err.message);
    res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
}

module.exports = { getPollStats };