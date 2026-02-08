const db = require('../db');

// 1. EXPORTAR PARA REUNIÃO
async function exportToMeeting(req, res) {
    const { pollId } = req.body;
    const userId = req.user.userId;

    try {
        await db.query('BEGIN');

        const poll = await db.query('SELECT * FROM polls WHERE id = $1', [pollId]);
        if (poll.rowCount === 0) return res.status(404).json({ error: "Sondagem não encontrada" });

        const mRes = await db.query(
            `INSERT INTO meetings (poll_id, title, created_by) VALUES ($1, $2, $3) RETURNING id`,
            [pollId, poll.rows[0].title, userId]
        );
        const meetingId = mRes.rows[0].id;

        const qRes = await db.query(
            `SELECT * FROM questions WHERE poll_id = $1 AND type NOT IN ('image_text', 'text_block') ORDER BY position`,
            [pollId]
        );

        for (let i = 0; i < qRes.rows.length; i++) {
            const q = qRes.rows[i];
            const newQ = await db.query(
                `INSERT INTO meeting_questions (meeting_id, type, prompt, position, original_question_id)
                 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                [meetingId, q.type, q.prompt, i, q.id]
            );

            const optRes = await db.query('SELECT * FROM options WHERE question_id = $1', [q.id]);
            for (const opt of optRes.rows) {
                await db.query(
                    `INSERT INTO meeting_options (meeting_question_id, text, position) VALUES ($1, $2, $3)`,
                    [newQ.rows[0].id, opt.text, opt.position]
                );
            }
        }

        await db.query('COMMIT');
        res.json({ meetingId });
    } catch (err) {
        await db.query('ROLLBACK');
        console.error("Erro ao exportar:", err);
        res.status(500).json({ error: err.message });
    }
}

async function deleteMeeting(req, res) {
    const { id } = req.params;
    try {
        await db.query('BEGIN');
       
        await db.query('DELETE FROM responses WHERE poll_id = $1', [id]);
        await db.query(`DELETE FROM meeting_options WHERE meeting_question_id IN 
                       (SELECT id FROM meeting_questions WHERE meeting_id = $1)`, [id]);
        await db.query('DELETE FROM meeting_questions WHERE meeting_id = $1', [id]);
        await db.query('DELETE FROM meetings WHERE id = $1', [id]);
        
        await db.query('COMMIT');
        res.json({ message: "Eliminado com sucesso" });
    } catch (err) {
        await db.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: err.message });
    }
}
// 3. RESET DE RESPOSTAS
async function resetMeeting(req, res) {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM responses WHERE poll_id = $1', [id]);
        res.json({ message: "Todas as respostas foram eliminadas!" });
    } catch (err) {
        console.error("Erro ao fazer reset:", err);
        res.status(500).json({ error: "Erro ao limpar respostas" });
    }
}

// 4. OBTER REUNIÕES (Necessário para a lista no frontend)
async function getMeetings(req, res) {
    try {
        const result = await db.query('SELECT * FROM meetings ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

module.exports = { 
    exportToMeeting, 
    deleteMeeting, 
    resetMeeting,
    getMeetings 
};