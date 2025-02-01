const express = require('express');
const cors = require('cors');
const path = require('path');
const routes = require('./src/routes');
const db = require('./src/config/database');

const app = express();

// Lista de domínios permitidos
const allowedOrigins = [
  'https://seurobux.com',
  ...(process.env.NODE_ENV === 'development' ? ['http://localhost:5173', 'http://localhost:3000'] : [])
];

// Configuração CORS mais restrita
const corsOptions = {
  origin: function (origin, callback) {
    // Permitir requisições sem origin (como apps mobile ou Postman em desenvolvimento)
    if (!origin && process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Não permitido pelo CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Origin'
  ],
  credentials: true,
  maxAge: 86400,
  preflightContinue: false,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));

// Middleware de segurança adicional
app.use((req, res, next) => {
  const origin = req.get('origin');
  
  if (!origin && process.env.NODE_ENV === 'production') {
    return res.status(403).json({ 
      error: 'Acesso direto não permitido' 
    });
  }

  if (process.env.NODE_ENV === 'production' && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ 
      error: 'Origem não autorizada' 
    });
  }

  next();
});

// Aumentar limite do JSON
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logger para requisições da API
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - Origin: ${req.get('origin')}`);
  next();
});

// Pasta de uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rotas da API
app.use('/api', routes);

// Error handler global
app.use((err, req, res, next) => {
  if (err.message === 'Não permitido pelo CORS') {
    return res.status(403).json({
      message: 'Acesso não autorizado',
      error: 'Origem não permitida'
    });
  }

  console.error('Server Error:', err);
  res.status(500).json({ 
    message: 'Erro interno do servidor',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

module.exports = app; 