const db = require('../db');
const { emitToPoll } = require('../services/realtime');
const { GoogleGenerativeAI } = require("@google/generative-ai");

/**
Gera estrutura de sondagem via IA (Gemini GRÁTIS)
 */
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function listModels() {
  const models = await genAI.listModels();
  console.log(models);
}
async function generateWithAI(req, res) {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt vazio" });

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY não configurada no servidor" });
    }

    // Usa o cliente já inicializado no topo

const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const instruction = `
Cria uma sondagem sobre: "${prompt}"
Podes usar estes tipos de elementos conforme necessário:
1. "multiple": Pergunta de escolha múltipla. Requer array "options".
2. "scale": Escala de avaliação. Requer "scaleMax" (ex: 5 ou 10) e "labels" (objeto com "min" e "max"). Seja criativo nas labels (ex: "Péssimo" e "Incrível").
3. "word_cloud": Para gerar uma nuvem de palavras. Requer "prompt".
4. "open_text": Pergunta de resposta aberta longa. Requer "prompt".
5. "image_text": Bloco de conteúdo informativo. Requer "content" (texto) e "imageUrl" (podes sugerir um URL de imagem placeholder ou real).

Responde APENAS com JSON válido, sem markdown, sem texto extra.

Formato:
{
  "title": "título da sondagem",
  "description": "descrição breve",
  "elements": [
    {"type":"multiple","prompt":"pergunta?","options":["opção 1","opção 2"]},
    {"type":"text_block","content":"texto informativo"}
  ]
}
`;

    const result = await model.generateContent(instruction);
    const response = await result.response;
    let text = response.text().trim();

    // Limpa markdown
    text = text.replace(/```json|```/g, "");

    // Parsing seguro do JSON
    let jsonResponse;
    try {
      jsonResponse = JSON.parse(text);
    } catch (parseErr) {
      console.error("ERRO a fazer parse do JSON do modelo:", parseErr, "-> Texto retornado:", text);
      return res.status(500).json({
        error: "Falha ao processar resposta da IA",
        details: "O modelo retornou texto inválido"
      });
    }

    res.json(jsonResponse);

  } catch (err) {
    console.error("ERRO GEMINI:", err);
    res.status(500).json({ error: "Falha na IA", details: err.message });
  }
}

async function duplicatePoll(req, res) {
  const { id } = req.params;
  const userId = req.user.userId;

  try {
    // 1. Obter a sondagem original completa (Poll + Questions + Options)
    const original = await getPollInternal(id);
    if (!original) return res.status(404).json({ error: 'Sondagem original não encontrada' });

    await db.query('BEGIN');

    // 2. Inserir a nova cabeçalho da sondagem
    const newPollRes = await db.query(
      `INSERT INTO polls (title, description, created_by, created_at)
       VALUES ($1, $2, $3, now())
       RETURNING *`,
      [`${original.poll.title} (Cópia)`, original.poll.description, userId]
    );

    const newPollId = newPollRes.rows[0].id;

    // 3. Iterar sobre as perguntas originais (vêm do getPollInternal)
    if (original.questions && original.questions.length > 0) {
      for (const q of original.questions) {
        
        // Garantir que settings é uma string JSON para a BD
        const settingsParam = q.settings && typeof q.settings === 'object' 
          ? JSON.stringify(q.settings) 
          : q.settings;

        // Inserir a nova pergunta vinculada à nova Poll
        const qRes = await db.query(
          `INSERT INTO questions (poll_id, prompt, type, position, settings)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [newPollId, q.prompt, q.type, q.position, settingsParam]
        );

        const newQuestionId = qRes.rows[0].id;

        // 4. Copiar Opções da pergunta original (se existirem)
        if (q.options && q.options.length > 0) {
          for (const opt of q.options) {
            await db.query(
              `INSERT INTO options (question_id, text, position)
               VALUES ($1, $2, $3)`,
              [newQuestionId, opt.text, opt.position]
            );
          }
        }
      }
    }

    await db.query('COMMIT');
    
    console.log(`📋 Sondagem ${id} duplicada para ${newPollId} pelo user ${userId}`);
    res.status(201).json(newPollRes.rows[0]);

  } catch (err) {
    await db.query('ROLLBACK');
    console.error("❌ Erro ao duplicar sondagem:", err);
    res.status(500).json({ error: 'Erro interno ao duplicar sondagem' });
  }
}
/**
 * 🆕 Cria uma sondagem simples (Título + Descrição)
 */
// Exemplo de como deve estar no Controller
async function createPoll(req, res) {
  const { title, description, access, accessCode } = req.body;
  
  // 1. Extrair o ID do utilizador (injetado pelo authMiddleware)
  // Tentamos .id ou .userId para garantir compatibilidade
  const userId = req.user?.id || req.user?.userId;

  // LOG DE DEPURAÇÃO: Verifica se o ID aparece no terminal do Node
  console.log("🛠️ Tentando criar sondagem para o User ID:", userId);

  if (!userId) {
    return res.status(401).json({ error: "Utilizador não autenticado corretamente." });
  }

  try {
    // 2. Query SQL com a coluna 'created_by'
    const result = await db.query(
      `INSERT INTO polls (title, description, access, access_code, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id, title`, 
      [
        title, 
        description, 
        access || 'public', 
        accessCode || null, 
        userId // Este é o valor que estava a faltar na tua tabela!
      ]
    );

    console.log("✅ Sondagem criada com sucesso na BD:", result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("❌ Erro ao inserir na tabela polls:", err.message);
    res.status(500).json({ error: "Erro ao criar sondagem: " + err.message });
  }
}

/**
 * 🔒 Lista sondagens do utilizador autenticado
 */
async function listPolls(req, res) {
  const userId = req.user.userId;

  try {
    const { rows } = await db.query(
      `SELECT id, title, description, created_at
       FROM polls
       WHERE created_by = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro a obter sondagens' });
  }
}

/**
 * 🔍 Obtém uma sondagem completa
 */
async function getPoll(req, res) {
  const { id } = req.params;
  try {
    // 1. Buscar a sondagem
    const pollRes = await db.query('SELECT * FROM polls WHERE id = $1', [id]);
    const poll = pollRes.rows[0];
    if (!poll) return res.status(404).json({ error: "Sondagem não encontrada" });

    // 2. Buscar perguntas e CONTAR quantos votos cada uma tem na tabela responses
    const qRes = await db.query(
      `SELECT q.*, 
        (SELECT COUNT(*) FROM responses r WHERE r.question_id = q.id) as "totalVotes"
       FROM questions q 
       WHERE q.poll_id = $1 
       ORDER BY q.position`,
      [id]
    );

    const questions = qRes.rows;
    const qIds = questions.map(q => q.id);

    if (qIds.length > 0) {
      // 3. Buscar opções (para escolha múltipla)
      const optRes = await db.query(
        'SELECT * FROM options WHERE question_id = ANY($1) ORDER BY position',
        [qIds]
      );

      // 4. Buscar as respostas REAIS (o que está na coluna 'value')
      const respRes = await db.query(
        'SELECT question_id, option_id, value FROM responses WHERE question_id = ANY($1)',
        [qIds]
      );

      // 5. Montar o objeto final
      const questionsWithData = questions.map(q => ({
        ...q,
        // Se settings for string, converte para objeto
        settings: typeof q.settings === 'string' ? JSON.parse(q.settings) : q.settings,
        options: optRes.rows.filter(opt => opt.question_id === q.id),
        // Adicionamos a lista de respostas brutas para o frontend processar
        allResponses: respRes.rows.filter(r => r.question_id === q.id)
      }));

      return res.json({ poll, questions: questionsWithData });
    }

    res.json({ poll, questions: [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao carregar dados da sondagem" });
  }
}
async function resetMeeting(req, res) {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM responses WHERE poll_id = $1", [id]);
    res.status(200).json({ message: "Respostas eliminadas" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
/**
 * 📝 Atualiza dados básicos da sondagem
 */
async function updatePoll(req, res) {
  const { id } = req.params;
  const { title, description } = req.body;
  const userId = req.user.userId;

  try {
    const result = await db.query(
      `UPDATE polls SET title = $1, description = $2 
       WHERE id = $3 AND created_by = $4 RETURNING *`,
      [title, description, id, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Sondagem não encontrada ou sem permissão' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar sondagem' });
  }
}

/**
 * 🗑️ Elimina uma sondagem
 */
async function deletePoll(req, res) {
  const { id } = req.params;
  const userId = req.user.userId;

  try {
    const result = await db.query(
      'DELETE FROM polls WHERE id = $1 AND created_by = $2',
      [id, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Sondagem não encontrada ou sem permissão' });
    }

    res.json({ message: 'Sondagem eliminada com sucesso' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao eliminar sondagem' });
  }
}

/**
 * 🔄 Sincroniza perguntas e opções
 */
async function syncQuestions(req, res) {
  const { id } = req.params;
  const { questions } = req.body;
  
  // 1. DEPURAÇÃO CRÍTICA (Vê o terminal do teu VS Code/Node depois de tentar salvar)
  console.log("--- DEBUG SYNC ---");
  console.log("ID da Sondagem (URL):", id);
  console.log("Dados do Utilizador (Token):", req.user);
  
  // Tenta extrair o ID de qualquer propriedade possível
  const userId = req.user?.id || req.user?.userId || req.user?.sub;
  console.log("ID extraído do Token:", userId);

  try {
    // 2. Procurar quem criou a sondagem
    const check = await db.query(
      'SELECT created_by FROM polls WHERE id = $1',
      [id]
    );

    if (check.rowCount === 0) {
      return res.status(404).json({ error: 'Sondagem não encontrada' });
    }

    const ownerId = check.rows[0].created_by;
    console.log("Dono na Base de Dados:", ownerId);

    // 3. COMPARAÇÃO ULTRA-SEGURA
    // Convertemos ambos para String e limpamos espaços para garantir que "4" == 4
    if (String(ownerId).trim() !== String(userId).trim()) {
      console.log(`🚫 BLOQUEIO 403: Dono(${ownerId}) não coincide com User(${userId})`);
      return res.status(403).json({ 
        error: 'Acesso negado', 
        debug: { owner: ownerId, user: userId } 
      });
    }
    // 4. Início da transação para garantir que não ficamos com dados parciais
    await db.query('BEGIN');

    // 5. Limpar a estrutura antiga de perguntas
    // (As opções costumam ser apagadas via ON DELETE CASCADE, mas se não tiveres, 
    // deves apagar as options primeiro ou garantir o CASCADE na BD)
    await db.query('DELETE FROM questions WHERE poll_id = $1', [id]);

    // 6. Inserir as novas perguntas
    if (Array.isArray(questions)) {
      for (let i = 0; i < questions.length; i++) {
      const q = questions[i];

// Verificamos o que a tua tabela REALMENTE tem. 
// Se não tiveres 'settings', remove-o da query abaixo:
const qRes = await db.query(
  `INSERT INTO questions (poll_id, type, prompt, position, settings) 
   VALUES ($1, $2, $3, $4, $5) RETURNING id`,
  [
    id, 
    q.type, 
    q.prompt || q.content || 'Sem título', 
    i, 
    q.settings ? JSON.stringify(q.settings) : '{}' 
  ]
);

        const newQuestionId = qRes.rows[0].id;

        // 7. Inserir opções se for o caso (múltipla escolha)
        if (Array.isArray(q.options) && q.options.length > 0) {
          for (let j = 0; j < q.options.length; j++) {
            const optionText = q.options[j];
            if (optionText && optionText.trim() !== "") {
              await db.query(
                `INSERT INTO options (question_id, text, position)
                 VALUES ($1, $2, $3)`,
                [newQuestionId, optionText.trim(), j]
              );
            }
          }
        }
      }
    }

    await db.query('COMMIT');
    console.log(`✅ Estrutura da sondagem ${id} sincronizada com sucesso!`);
    res.json({ ok: true, message: 'Estrutura sincronizada' });

  } catch (err) {
    if (db) await db.query('ROLLBACK');
    console.error("❌ Erro em syncQuestions:", err.message);
    res.status(500).json({ error: 'Erro interno ao sincronizar: ' + err.message });
  }
}

/**
 * 📤 Exportar sondagem
 */
async function exportPoll(req, res) {
  const { id } = req.params;

  try {
    const pollData = await getPollInternal(id);
    if (!pollData) return res.status(404).json({ error: 'Não encontrada' });
    res.json(pollData);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao exportar' });
  }
}

/**
 * 📥 Importar sondagem
 */
async function importPoll(req, res) {
  const { title, description, questions } = req.body;
  const userId = req.user.userId;

  try {
    const pollRes = await db.query(
      `INSERT INTO polls (title, description, created_by, created_at)
       VALUES ($1, $2, $3, now())
       RETURNING *`,
      [title, description, userId]
    );

    const pollId = pollRes.rows[0].id;

    for (let q of questions) {
      const qRes = await db.query(
        `INSERT INTO questions (poll_id, type, prompt, position)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [pollId, q.type, q.prompt, q.position || 0]
      );

      const questionId = qRes.rows[0].id;

      if (q.options?.length) {
        for (let o of q.options) {
          await db.query(
            `INSERT INTO options (question_id, text, position)
             VALUES ($1, $2, $3)`,
            [questionId, typeof o === 'string' ? o : o.text, o.position || 0]
          );
        }
      }
    }

    res.status(201).json({ ok: true, pollId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao importar sondagem' });
  }
}

/**
 * 🛠️ Função auxiliar interna
 */
async function getPollInternal(id) {
  // 1. Procurar a sondagem
  const pollRes = await db.query('SELECT * FROM polls WHERE id = $1', [id]);
  const poll = pollRes.rows[0];
  if (!poll) return null;

  // 2. Procurar todas as perguntas desta sondagem
  const qRes = await db.query(
    'SELECT * FROM questions WHERE poll_id = $1 ORDER BY position',
    [id]
  );

  const questions = qRes.rows;
  const qIds = questions.map(q => q.id);

  let options = [];
  let responses = [];

  if (qIds.length) {
    // 3. Procurar todas as opções das perguntas desta sondagem
    const optRes = await db.query(
      'SELECT * FROM options WHERE question_id = ANY($1) ORDER BY position',
      [qIds]
    );
    options = optRes.rows;

    // 4. 🔥 AQUI ESTAVA O ERRO: Precisamos de buscar as respostas!
    const respRes = await db.query(
      'SELECT * FROM responses WHERE question_id = ANY($1) ORDER BY created_at DESC',
      [qIds]
    );
    responses = respRes.rows;
  }

  // 5. Montar o objeto final injetando options e responses em cada pergunta
  return {
    poll,
    questions: questions.map(q => ({
      ...q,
      // Filtramos as opções que pertencem a esta pergunta
      options: options.filter(o => o.question_id === q.id),
      // 🔥 Injetamos o array de respostas para o PollView poder ler!
      responses: responses.filter(r => r.question_id === q.id)
    }))
  };
}

module.exports = {
  generateWithAI,
  createPoll,
  listPolls,
  getPoll,
  updatePoll,
  deletePoll,
  syncQuestions,
  exportPoll,
  importPoll,
  duplicatePoll
};
