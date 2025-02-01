require('dotenv').config();
const app = require('./app');
const db = require('./src/config/database');

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    const connection = await db.getConnection();
    console.log('Conectado ao banco de dados');
    connection.release();

    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
  } catch (err) {
    console.error('Erro ao iniciar servidor:', err);
    process.exit(1);
  }
}

startServer(); 