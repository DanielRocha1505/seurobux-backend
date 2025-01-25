require('dotenv').config();
const express = require('express');
const app = require('./app');
const db = require('./src/config/database');
const PaymentController = require('./src/controllers/PaymentController');

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    const connection = await db.getConnection();
    console.log('Conectado ao banco de dados');
    connection.release();

    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);

      setInterval(async () => {
        await PaymentController.checkPaymentStatus();
      }, 30000);
    });
  } catch (err) {
    console.error('Erro ao iniciar servidor:', err);
    process.exit(1);
  }
}

startServer(); 