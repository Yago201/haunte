const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./ponto.db', (err) => {
  if (err) {
    return console.error('Erro ao abrir o banco:', err.message);
  }

  // Executa os comandos de forma serializada para manter a ordem
  db.serialize(() => {
    // Remove a tabela 'funcionarios' se ela já existir
    db.run(`DROP TABLE IF EXISTS funcionarios`);

    // Cria a tabela 'funcionarios'
    db.run(
      `CREATE TABLE IF NOT EXISTS funcionarios (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL
      )`
    );

    // Insere um funcionário na tabela
    db.run(
      `INSERT INTO funcionarios (id, name) VALUES (?, ?)`,
      ['12345', 'João Silva'],
      (err) => {
        if (err) {
          console.error('Erro ao inserir funcionário:', err.message);
        } else {
          console.log('Funcionário inserido com sucesso!');
        }

        // Fecha o banco de dados apenas após a conclusão das operações
        db.close((closeErr) => {
          if (closeErr) {
            console.error('Erro ao fechar o banco:', closeErr.message);
          } else {
            console.log('Banco fechado com sucesso.');
          }
        });
      }
    );
  });
});
