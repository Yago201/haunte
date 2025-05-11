const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createObjectCsvWriter } = require('csv-writer');
const { DateTime } = require('luxon');
const mysql = require('mysql2/promise');

const app = express();
const port = 3000;
const secretKey = 'seuSegredoSuperSeguro'; // Em produção, use variáveis de ambiente!

// Middleware para interpretar JSON (substituindo o body-parser)
app.use(express.json());

// Servir arquivos estáticos da pasta "public"
app.use(express.static(path.join(__dirname, 'public')));

// Criação do pool de conexões MySQL
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',   // ou o usuário que você utiliza
  password: 'rm', // a nova senha definida para o root
  database: 'ponto', // nome do banco que você criou
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Função para criar as tabelas no MySQL
async function createTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS funcionarios (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS registros (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id VARCHAR(50) NOT NULL,
        time VARCHAR(10) NOT NULL,
        date VARCHAR(12) NOT NULL,
        type VARCHAR(50) NOT NULL,
        justification VARCHAR(255),
        UNIQUE (employee_id, time, date),
        FOREIGN KEY (employee_id) REFERENCES funcionarios(id) ON DELETE CASCADE
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        action VARCHAR(255) NOT NULL,
        admin VARCHAR(50) NOT NULL,
        timestamp DATETIME NOT NULL
      );
    `);

    console.log('Tabelas criadas com sucesso no MySQL.');
  } catch (err) {
    console.error('Erro ao criar tabelas:', err.message);
    process.exit(1);
  }
}

// Cria as tabelas na inicialização do servidor
createTables();

// Função para registrar logs
async function logAction(action, admin) {
  // Formata o timestamp para DATETIME (YYYY-MM-DD HH:mm:ss)
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  try {
    await pool.query(
      `INSERT INTO logs (action, admin, timestamp) VALUES (?, ?, ?)`,
      [action, admin, timestamp]
    );
  } catch (err) {
    console.error('Erro ao registrar log:', err.message);
  }
}

// Cadastro de funcionário
app.post('/cadastrar_funcionario', async (req, res) => {
  // Log para debugar o corpo da requisição
  console.log('Dados recebidos no cadastro:', req.body);

  const { id, name } = req.body;
  
  if (!id || !name) {
    return res.status(400).json({
      success: false,
      message: 'Nome e ID do funcionário são obrigatórios.'
    });
  }

  try {
    const [rows] = await pool.query('SELECT id FROM funcionarios WHERE id = ?', [id]);
    if (rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'ID já cadastrado.'
      });
    }
    
    await pool.query('INSERT INTO funcionarios (id, name) VALUES (?, ?)', [id, name]);
    res.json({
      success: true,
      message: 'Funcionário cadastrado com sucesso.'
    });
  } catch (err) {
    console.error('Erro ao cadastrar funcionário:', err.message);
    res.status(500).json({
      success: false,
      message: 'Erro ao cadastrar funcionário.'
    });
  }
});

// Registro de ponto
app.post('/registrar_ponto', async (req, res) => {
  const { employeeId, type = 'entrada', justification = '' } = req.body;

  if (!employeeId) {
    return res.status(400).json({
      success: false,
      message: 'ID do funcionário é obrigatório.'
    });
  }

  const now = DateTime.now().setZone('America/Manaus');
  const time = now.toFormat('HH:mm:ss');
  const date = now.toFormat('dd/MM/yyyy');

  if (type === 'entrada') {
    const limite = DateTime.fromObject({ hour: 9, minute: 0 }, { zone: 'America/Manaus' });
    if (now > limite && justification.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Justificativa obrigatória para entradas após as 09:00.'
      });
    }
  }

  try {
    const [rows] = await pool.query('SELECT id FROM funcionarios WHERE id = ?', [employeeId]);
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Funcionário não encontrado.'
      });
    }

    await pool.query(
      'INSERT INTO registros (employee_id, time, date, type, justification) VALUES (?, ?, ?, ?, ?)',
      [employeeId, time, date, type, justification]
    );
    
    res.json({
      success: true,
      message: `Ponto de ${type} registrado com sucesso.`
    });
  } catch (err) {
    console.error('Erro ao registrar ponto:', err.message);
    res.status(500).json({
      success: false,
      message: 'Erro ao registrar ponto.'
    });
  }
});

// Login do administrador
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const [rows] = await pool.query('SELECT * FROM admins WHERE username = ?', [username]);

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Usuário ou senha incorretos."
      });
    }

    const admin = rows[0];
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Usuário ou senha incorretos."
      });
    }

    const token = jwt.sign({ id: admin.id, username: admin.username }, secretKey, { expiresIn: '1h' });
    res.json({ success: true, token });
  } catch (err) {
    console.error('Erro no login:', err.message);
    res.status(500).json({
      success: false,
      message: "Erro ao processar login."
    });
  }
});

// Exportar registros em CSV
app.get('/exportar_csv', async (req, res) => {
  const csvWriter = createObjectCsvWriter({
    path: './historico_ponto.csv',
    header: [
      { id: 'employee_id', title: 'ID' },
      { id: 'name', title: 'Nome' },
      { id: 'date', title: 'Data' },
      { id: 'time', title: 'Horário' },
      { id: 'type', title: 'Tipo' },
      { id: 'justification', title: 'Justificativa' }
    ]
  });

  try {
    const [rows] = await pool.query(`
      SELECT r.employee_id, f.name, r.date, r.time, r.type, r.justification 
      FROM registros r
      INNER JOIN funcionarios f ON r.employee_id = f.id
    `);

    await csvWriter.writeRecords(rows);
    res.download('./historico_ponto.csv');
  } catch (err) {
    console.error('Erro ao exportar CSV:', err.message);
    res.status(500).json({ 
      success: false, 
      message: "Erro ao exportar CSV."
    });
  }
});

// Exibir registros com nome do funcionário
app.get('/registros', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT r.id, f.name AS nome, r.date, r.time, r.type, r.justification
      FROM registros r
      JOIN funcionarios f ON r.employee_id = f.id
      ORDER BY r.date DESC, r.time DESC
    `);

    if (!rows || rows.length === 0) {
      return res.json({ success: true, registros: [], message: 'Nenhum registro encontrado' });
    }
    res.json({ success: true, registros: rows });
  } catch (err) {
    console.error('Erro ao buscar registros:', err.message);
    res.status(500).json({ 
      success: false, 
      message: 'Erro ao buscar registros: ' + err.message 
    });
  }
});

// Remover funcionário
app.delete('/remover_funcionario/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM funcionarios WHERE id = ?`, [id]);
    await logAction(`Funcionário ${id} removido`, 'admin1');  // Substitua 'admin1' pelo admin autenticado
    res.json({ success: true, message: "Funcionário removido com sucesso." });
  } catch (err) {
    console.error('Erro ao remover funcionário:', err.message);
    res.status(500).json({ 
      success: false, 
      message: "Erro ao remover funcionário." 
    });
  }
});

// Listar todos os funcionários
app.get('/funcionarios', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT id, name FROM funcionarios`);
    res.json({ success: true, funcionarios: rows });
  } catch (err) {
    console.error('Erro ao buscar funcionários:', err.message);
    res.status(500).json({ 
      success: false, 
      message: 'Erro ao buscar funcionários.' 
    });
  }
});

// Apagar todos os registros
app.delete('/apagar_todos_registros', async (req, res) => {
  console.log('➡️ Requisição para apagar todos os registros recebida');
  try {
    const [result] = await pool.query(`DELETE FROM registros`);
    console.log(`✅ Registros apagados: ${result.affectedRows}`);
    res.json({
      success: true,
      message: 'Todos os registros foram apagados com sucesso.'
    });
  } catch (err) {
    console.error('Erro ao apagar registros:', err.message);
    res.status(500).json({
      success: false,
      message: 'Erro ao apagar registros.'
    });
  }
});

// Página de registro
app.get('/registro', (req, res) => {
  console.log('⚡ Rota /registro acessada');
  res.sendFile(path.join(__dirname, 'public', 'registro.html'));
});

// Iniciar o servidor
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
