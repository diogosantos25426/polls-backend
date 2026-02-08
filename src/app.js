const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const liveResponsesRoutes = require('./routes/liveResponses');
const pollsRoutes = require('./routes/polls');
const authRoutes = require('./routes/auth');
const responseRoutes = require('./routes/responses');
const questionsRoutes = require('./routes/questions');
const optionsRoutes = require('./routes/options');
const db = require('./db');

const app = express();

// --------------------------------------------------
// HELMET / CSP
// --------------------------------------------------
if (process.env.NODE_ENV === 'production') {
  app.use(helmet());
} else {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: [
            "'self'",
            "http://localhost:5173",
            "http://192.168.1.224:5173",
            "http://localhost:4000",
            "http://192.168.1.224:4000",
            "ws://localhost:4000",
            "ws://192.168.1.224:4000",
            "wss://localhost:4000",
            "wss://192.168.1.224:4000"
          ],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"]
        }
      }
    })
  );
}

// --------------------------------------------------
// MIDDLEWARES
// --------------------------------------------------
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
// --------------------------------------------------
// ROTAS DE MEETINGS
// --------------------------------------------------

// 1. Listar reuniões
app.get('/api/meetings', async (req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM meetings ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Erro ao listar reuniões:", err);
    res.status(500).json({ error: "Erro ao carregar lista de reuniões" });
  }
});


app.get('/api/meetings/:id/stats', async (req, res) => {
  const { id } = req.params;

  try {
    const meetingResult = await db.query(
      "SELECT * FROM meetings WHERE id = $1",
      [id]
    );

    if (meetingResult.rows.length === 0) {
      return res.status(404).json({ error: "Reunião não encontrada" });
    }

    const questionsResult = await db.query(`
      SELECT 
        mq.id,
        mq.meeting_id,
        mq.prompt,
        mq.type,
        mq.position,
        mq.settings,
        
        -- Opções
        (SELECT json_agg(
           json_build_object(
             'id', mo.id,
             'text', mo.text,
             'votes', mo.votes
           )
         )
         FROM meeting_options mo
         WHERE mo.meeting_question_id = mq.id
        ) AS options,
        
        -- RESPONSES (Nome corrigido para bater com o Frontend)
        -- Aqui transformamos o vote_count em múltiplos objetos para o renderChart funcionar
        (SELECT json_agg(r)
         FROM (
           SELECT label, vote_count as count, question_type
           FROM meeting_results mr
           WHERE mr.meeting_id = $1 AND mr.question_id = mq.id
         ) r
        ) AS responses
      
      FROM meeting_questions mq
      WHERE mq.meeting_id = $1
      ORDER BY mq.position ASC
    `, [id]);

    const stats = {
      poll: meetingResult.rows[0],
      questions: questionsResult.rows || [],
      currentIdx: meetingResult.rows[0].current_idx || 0
    };

    res.json(stats);

  } catch (err) {
    console.error("Erro ao buscar stats da reunião:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});


app.delete('/api/meetings/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('BEGIN');
    // Eliminar por ordem de dependência (Respostas -> Opções -> Perguntas -> Reunião)
    await db.query('DELETE FROM responses WHERE question_id IN (SELECT id FROM meeting_questions WHERE meeting_id = $1)', [id]);
    await db.query('DELETE FROM meeting_options WHERE meeting_question_id IN (SELECT id FROM meeting_questions WHERE meeting_id = $1)', [id]);
    await db.query('DELETE FROM meeting_questions WHERE meeting_id = $1', [id]);
    await db.query('DELETE FROM meetings WHERE id = $1', [id]);
    await db.query('COMMIT');
    res.json({ success: true, message: "Meeting eliminada com sucesso" });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error("Erro ao apagar reunião:", err);
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/meetings/:id/reset', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query(`
      DELETE FROM responses 
      WHERE question_id IN (SELECT id FROM meeting_questions WHERE meeting_id = $1)
    `, [id]);
    res.json({ success: true, message: "Respostas limpas com sucesso" });
  } catch (err) {
    console.error("Erro ao fazer reset:", err);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------
// DETALHE DE PERGUNTA (LivePoll)
// --------------------------------------------------
app.get('/api/questions/detail/:id', async (req, res) => {
  const { id } = req.params;
  console.log("🔍 A procurar detalhes para a pergunta ID:", id);

  try {
    let result = await db.query(
      "SELECT * FROM meeting_questions WHERE id = $1",
      [id]
    );

    let optionsTable = "meeting_options";
    let foreignKey = "meeting_question_id";

    if (result.rows.length === 0) {
      console.log("ℹ️ Não encontrada em meeting_questions, a tentar em questions...");
      result = await db.query(
        "SELECT * FROM questions WHERE id = $1",
        [id]
      );
      optionsTable = "options";
      foreignKey = "question_id";
    }

    if (result.rows.length === 0) {
      console.error("❌ Pergunta não encontrada em nenhuma tabela.");
      return res.status(404).json({ error: "Pergunta não existe" });
    }

    const question = result.rows[0];

    const optionsResult = await db.query(
      `SELECT id, text FROM ${optionsTable} WHERE ${foreignKey} = $1 ORDER BY id ASC`,
      [id]
    );

    console.log(`✅ Sucesso! Tabela: ${optionsTable}, Encontradas: ${optionsResult.rows.length} opções.`);

    res.json({
      ...question,
      options: optionsResult.rows
    });

  } catch (err) {
    console.error("❌ Erro em /api/questions/detail:", err);
    res.status(500).json({ error: "Erro interno ao carregar opções" });
  }
});

// --------------------------------------------------
// ROTAS PADRÃO (E LIVE RESPONSES)
// --------------------------------------------------
app.use('/api/live-responses', liveResponsesRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/polls', pollsRoutes);
app.use('/api/responses', responseRoutes);
app.use('/api/questions', questionsRoutes);
app.use('/api/options', optionsRoutes);

// --------------------------------------------------
// EXPORTAR POLL PARA MEETING
// --------------------------------------------------
app.post('/api/meetings/export', async (req, res) => {
  const { pollId } = req.body;
  const userId = (req.user && req.user.id) ? req.user.id : 1;

  try {
    await db.query('BEGIN');
    const pollResult = await db.query("SELECT title FROM polls WHERE id = $1", [pollId]);
    if (pollResult.rows.length === 0) return res.status(404).json({ error: "Sondagem não encontrada" });

    const questionsResult = await db.query("SELECT * FROM questions WHERE poll_id = $1 ORDER BY position", [pollId]);
    const newMeeting = await db.query(
      "INSERT INTO meetings (title, poll_id, user_id, current_idx) VALUES ($1, $2, $3, 0) RETURNING id",
      [pollResult.rows[0].title, pollId, userId]
    );

    const meetingId = newMeeting.rows[0].id;
    const interactiveQs = questionsResult.rows.filter(q =>
      !['text_block', 'image_text', 'title_slide'].includes(q.type.toLowerCase())
    );

    for (let i = 0; i < interactiveQs.length; i++) {
      const q = interactiveQs[i];
      const mq = await db.query(
        "INSERT INTO meeting_questions (meeting_id, prompt, type, position, settings) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [meetingId, q.prompt, q.type, i, q.settings]
      );

      const questionType = q.type.toLowerCase().trim();
      if (questionType === 'scale') {
        const settings = typeof q.settings === "string" ? JSON.parse(q.settings) : q.settings || {};
        const scaleMin = Number(settings.scaleMin) || 1;
        const scaleMax = Number(settings.scaleMax) || 5;
        for (let n = scaleMin; n <= scaleMax; n++) {
          await db.query("INSERT INTO meeting_options (meeting_question_id, text, votes) VALUES ($1, $2, 0)", [mq.rows[0].id, n.toString()]);
        }
      } else {
        const options = await db.query("SELECT * FROM options WHERE question_id = $1", [q.id]);
        for (const opt of options.rows) {
          await db.query("INSERT INTO meeting_options (meeting_question_id, text, votes) VALUES ($1, $2, 0)", [mq.rows[0].id, opt.text]);
        }
      }
    }
    await db.query('COMMIT');
    res.json({ success: true, meetingId });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error("ERRO NA EXPORTAÇÃO:", err);
    res.status(500).json({ error: "Erro interno no servidor" });
  }
});
// Rota para processar votos vindos de uma Meeting (Modo Reunião)

app.post('/api/responses/meeting-vote', async (req, res) => {
  const { pollId, questionId, questionType, label, value } = req.body;

  if (!pollId || !questionId || !questionType || !label) {
    return res.status(400).json({ error: "Dados incompletos" });
  }

  try {
    // UPSERT: incrementa vote_count se já existir, senão cria
    const result = await db.query(`
      INSERT INTO meeting_results
      (meeting_id, question_id, question_type, label, vote_count)
      VALUES ($1, $2, $3, $4, 1)
      ON CONFLICT (meeting_id, question_id, label)
      DO UPDATE SET vote_count = meeting_results.vote_count + 1
      RETURNING *;
    `, [pollId, questionId, questionType, String(label)]);

    console.log(`✅ Voto registado! Meeting ${pollId}, Question ${questionId}, Label "${label}", Total: ${result.rows[0].vote_count}`);

    // Notifica o host via Socket.io
    const io = req.app.get('socketio');
    if (io) {
      console.log(`📢 Emitindo answerSubmitted para poll:${pollId}`); 
      io.to(`poll:${pollId}`).emit("answerSubmitted", { questionId });
    } else {
      console.error("❌ IO não disponível para emit");
    }

    res.json({ success: true, data: result.rows[0] });

  } catch (err) {
    console.error("❌ Erro ao guardar voto:", err.message);
    res.status(500).json({ error: "Erro interno ao salvar voto" });
  }
});


app.get('/api/meeting-results/:meetingId/:questionId', async (req, res) => {
  const { meetingId, questionId } = req.params;
  try {
    const result = await db.query(
      `SELECT label, vote_count FROM meeting_results 
       WHERE meeting_id = $1 AND question_id = $2
       ORDER BY vote_count DESC`,
      [meetingId, questionId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar resultados" });
  }
});


// --------------------------------------------------
// HEALTH & ROOT
// --------------------------------------------------
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/', (req, res) => res.send('API polls-server is running.'));

module.exports = app;