const express = require('express');
const path = require('path');
const cors = require('cors');
const routes = require('./routes');

const app = express();

// Configurações básicas
app.use(cors());
app.use(express.json());

// Logger para requisições da API
app.use('/api', (req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  console.log('Body:', req.body);
  
  // Captura a resposta
  const oldSend = res.send;
  res.send = function(data) {
    console.log('Response:', data);
    oldSend.apply(res, arguments);
  };
  
  next();
});

// Rotas da API
app.use('/api', routes);

// Arquivos estáticos depois das rotas da API
app.use(express.static(path.join(__dirname, '../../dist')));
app.use('/assets', express.static(path.join(__dirname, '../../public/assets')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rota catch-all para o frontend (deve ser a última)
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../../dist/index.html'));
  }
});

// Error handler global
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  if (req.path.startsWith('/api')) {
    res.status(500).json({ 
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  } else {
    res.status(500).send('Erro interno do servidor');
  }
});

module.exports = app;
