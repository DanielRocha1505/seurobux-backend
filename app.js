const express = require('express');
const cors = require('cors');
const path = require('path');
const routes = require('./routes');
const fs = require('fs').promises;
const db = require('./src/config/database');
const rateLimit = require('express-rate-limit');

const app = express();

// Configuração CORS
app.use(cors({
  origin: ['https://seurobux.com', 'http://localhost:5173'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
}));

app.use(express.json());

// Logger para requisições da API
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api', routes);

// Modificar a rota catch-all para o frontend
app.get('*', async (req, res) => {
  if (!req.path.startsWith('/api')) {
    try {
      const [settings] = await db.query('SELECT website_id FROM crisp_settings LIMIT 1');
      const crispId = settings[0]?.website_id || 'dd205284-113c-487d-92ac-f77fb3e0a1fc';
      
      let html = await fs.readFile(path.join(__dirname, '../dist/index.html'), 'utf8');
      
      // Substituir o ID do Crisp
      html = html.replace(
        /CRISP_WEBSITE_ID="[^"]*"/,
        `CRISP_WEBSITE_ID="${crispId}"`
      );
      
      res.send(html);
    } catch (error) {
      console.error('Erro ao servir index.html:', error);
      res.sendFile(path.join(__dirname, '../dist/index.html'));
    }
  }
});

// Error handler global
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({ 
    message: 'Erro interno do servidor',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

module.exports = app; 