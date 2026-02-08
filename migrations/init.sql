-- users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  email VARCHAR(200),
  password_hash VARCHAR(200),
  role VARCHAR(50) DEFAULT 'participant',
  created_at TIMESTAMP DEFAULT now()
);

-- polls
CREATE TABLE IF NOT EXISTS polls (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT now()
);

-- questions
CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  poll_id INTEGER REFERENCES polls(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  prompt TEXT NOT NULL,
  position INTEGER DEFAULT 0
);

-- options
CREATE TABLE IF NOT EXISTS options (
  id SERIAL PRIMARY KEY,
  question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  position INTEGER DEFAULT 0
);

-- responses
CREATE TABLE IF NOT EXISTS responses (
  id SERIAL PRIMARY KEY,
  poll_id INTEGER REFERENCES polls(id) ON DELETE CASCADE,
  question_id INTEGER REFERENCES questions(id),
  option_id INTEGER REFERENCES options(id),
  user_id INTEGER REFERENCES users(id),
  value TEXT,
  created_at TIMESTAMP DEFAULT now()
);
--- Tabelas para o Modo Reunião (Exportação Limpa) ---

CREATE TABLE IF NOT EXISTS meetings (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255),
    poll_id INTEGER,
    user_id INTEGER,
    current_idx INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS meeting_questions (
    id SERIAL PRIMARY KEY,
    meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
    prompt TEXT,
    type VARCHAR(50),
    position INTEGER,
    settings JSONB
);

CREATE TABLE IF NOT EXISTS meeting_options (
    id SERIAL PRIMARY KEY,
    meeting_question_id INTEGER REFERENCES meeting_questions(id) ON DELETE CASCADE,
    text TEXT,
    votes INTEGER DEFAULT 0
);