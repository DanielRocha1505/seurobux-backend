const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();

// Configuração do CORS
app.use(cors());

// Servir arquivos estáticos
app.use('/assets', express.static(path.join(__dirname, '../../public/assets')));
app.use('/uploads', express.static(path.join(__dirname, '../../public/uploads')));

// Servir arquivos do build em produção
app.use(express.static(path.join(__dirname, '../../dist')));

// Para desenvolvimento local
if (process.env.NODE_ENV === 'development') {
  app.use(express.static(path.join(__dirname, '../../public')));
  app.use(express.static(path.join(__dirname, '../../dist')));
}
