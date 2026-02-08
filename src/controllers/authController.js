const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const SALT_ROUNDS = 10;

async function register(req, res) {
  const { username, email, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username e password obrigatórios' });
  }

  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await db.query(
      'INSERT INTO users (username, email, password_hash, created_at) VALUES ($1, $2, $3, now()) RETURNING id, username, email, created_at',
      [username, email || null, hash]
    );

    const user = result.rows[0];
    res.status(201).json({ user });
  } catch (err) {
    console.error('Erro no register:', err); // log detalhado no console

    if (err.code === '23505') {
      return res.status(409).json({ error: 'username já existe', details: err.detail });
    }

    res.status(500).json({ error: 'Erro no registo', details: err.message });
  }
}

async function login(req, res) {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username e password obrigatórios' });
  }

  try {
    const { rows } = await db.query(
      'SELECT id, username, password_hash FROM users WHERE username = $1',
      [username]
    );
    const user = rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token });
  } catch (err) {
    console.error('Erro no login:', err); // log detalhado no console
    res.status(500).json({ error: 'Erro no login', details: err.message });
  }
}

module.exports = { register, login };
