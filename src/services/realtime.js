const { Server } = require("socket.io");
const db = require("../db");

let io;

// Só usamos pollState para saber se está a mostrar resultados
// NÃO usamos para guardar índice
const pollState = {}; 

function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: "*" }
  });

  io.on("connection", (socket) => {
    console.log("🔌 Socket connected:", socket.id);

    // -------------------------------
    // ENTRAR NA SALA
    // -------------------------------
    socket.on("joinPoll", ({ pollId, name }) => {
      const room = `poll:${pollId}`;  // Uniformizado para "poll:ID"
      socket.join(room);
      socket.data = { pollId, name: name || "Participante" };

      console.log(`👤 ${socket.data.name} entrou em ${room}`);

      io.to(room).emit("participantJoined", {
        name: socket.data.name
      });
    });

    // No back-end, dentro do io.on("connection", ...)
    // Adiciona o argumento 'callback' aqui 
socket.on("startPoll", async ({ pollId, questionIds }, callback) => {
  try {
    if (!questionIds || questionIds.length === 0) {
      if (callback) callback({ status: "error", message: "No questions found" });
      return;
    }

    // 1. Guardar o estado na memória do servidor
    pollState[pollId] = {
      started: true,
      currentIndex: 0,
      questionIds,
      showingResults: false,
      isMeeting: true
    };

    const firstQuestionId = questionIds[0];
    const room = `poll:${pollId}`;

    console.log(`🚀 Iniciando Meeting ${pollId} com a pergunta: ${firstQuestionId}`);

    // 2. Emitir para os telemóveis avançarem
    io.to(room).emit("pollStarted", { 
      pollId: Number(pollId),
      questionId: firstQuestionId,
      currentIdx: 0
    });

    // 3. ✅ O PASSO QUE FALTA: Responder ao Host que está tudo OK
    if (typeof callback === "function") {
      callback({ status: "ok", firstQuestionId });
    }

  } catch (err) {
    console.error("❌ Erro no startPoll:", err);
    if (typeof callback === "function") {
      callback({ status: "error", message: err.message });
    }
  }
});

    // -------------------------------
    // PEDIR PERGUNTA ATUAL (LIVEPOLL)
    // -------------------------------
    socket.on("getCurrentQuestion", async ({ pollId }) => {
      try {
        // 1. Procurar em que posição (current_idx) a reunião está
        const meetingRes = await db.query(
          "SELECT current_idx FROM meetings WHERE id = $1",
          [pollId]
        );

        if (meetingRes.rows.length > 0) {
          const currentIdx = meetingRes.rows[0].current_idx || 0;

          // 2. Buscar a pergunta que corresponde a essa posição
          const questionsRes = await db.query(
            "SELECT id FROM meeting_questions WHERE meeting_id = $1 ORDER BY position ASC",
            [pollId]
          );

          const targetQuestion = questionsRes.rows[currentIdx];

          if (targetQuestion) {
            // ENVIAR APENAS O ID DA PERGUNTA ATUAL
            socket.emit("currentQuestionData", {
              questionId: targetQuestion.id 
            });
          }
        }
      } catch (err) {
        console.error("Erro ao sincronizar:", err);
      }
    });

    // -------------------------------
    // AVANÇAR PASSO (HOST CLICA NEXT)
    // -------------------------------
    socket.on("nextStep", async ({ pollId }) => {
      const room = `poll:${pollId}`;  // Uniformizado

      try {
        console.log("➡️ nextStep:", pollId);

        // 1. Ver se é uma MEETING
        const meetingRes = await db.query(
          "SELECT current_idx FROM meetings WHERE id = $1",
          [pollId]
        );

        if (meetingRes.rows.length === 0) {
          console.log("nextStep chamado para poll normal (ignorado)");
          return;
        }

        const currentIdx = meetingRes.rows[0].current_idx || 0;

        // 2. procurar todas as perguntas da meeting
        const questionsRes = await db.query(
          "SELECT id FROM meeting_questions WHERE meeting_id = $1 ORDER BY position ASC",
          [pollId]
        );

        const questions = questionsRes.rows;

        if (questions.length === 0) {
          console.log("⚠️ Meeting sem perguntas");
          return;
        }

        // Inicializar estado se não existir
        if (!pollState[pollId]) {
          pollState[pollId] = { showingResults: false };
        }

        const state = pollState[pollId];

        // -------------------------------
        // PASSO A: MOSTRAR RESULTADOS
        // -------------------------------
        if (!state.showingResults) {
          state.showingResults = true;
          console.log("📊 Mostrar resultados");
          io.to(room).emit("showResults");
          return;
        }

        // -------------------------------
        // PASSO B: PRÓXIMA PERGUNTA
        // -------------------------------
        const nextIdx = currentIdx + 1;

        if (nextIdx >= questions.length) {
          console.log("🏁 Fim da meeting");
          io.to(room).emit("pollFinished");
          delete pollState[pollId];
          return;
        }

        // Atualizar índice na BD
        await db.query(
          "UPDATE meetings SET current_idx = $1 WHERE id = $2",
          [nextIdx, pollId]
        );

        state.showingResults = false;

        const nextQuestion = questions[nextIdx];

        console.log("➡️ Próxima pergunta:", nextQuestion.id);

        io.to(room).emit("questionChanged", {
          questionId: nextQuestion.id
        });

      } catch (err) {
        console.error("❌ Erro em nextStep:", err);
      }
    });

    // -------------------------------
    // QUANDO ALGUÉM RESPONDE
    // -------------------------------
    socket.on("submitAnswer", ({ pollId }) => {
      const room = `poll:${pollId}`;  // Uniformizado
      
      // Log para o terminal do servidor
      console.log(`\n🗳️  [SOCKET] Voto detetado na Meeting: ${pollId}`);
      console.log(`📢  Notificando Host em ${room} para atualizar resultados...`);
      
      // Notifica todos na sala (especialmente o Host) para fazerem fetchStats()
      io.to(room).emit("answerSubmitted", { pollId, timestamp: Date.now() });
      
      // Backup broadcast (opcional)
      io.emit("answerSubmitted", { pollId }); 
    });

    // -------------------------------
    // DISCONNECT
    // -------------------------------
    socket.on("disconnect", () => {
      if (socket.data?.pollId) {
        console.log("❌ Saiu:", socket.data.name);
        io.to(`poll:${socket.data.pollId}`).emit("participantLeft", {  // Uniformizado
          name: socket.data.name
        });
      }
    });
  });
}

// -------------------------------
// FUNÇÕES AUXILIARES
// -------------------------------
function emitToPoll(pollId, event, data) {
  if (io) io.to(`poll:${pollId}`).emit(event, data);  // Uniformizado
}

function isQuestionLocked(pollId) {
  return pollState[pollId]?.showingResults === true;
}

module.exports = {
  initRealtime,
  isQuestionLocked,
  emitToPoll
};