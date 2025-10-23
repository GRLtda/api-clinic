// src/server.js
require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/database');
const { startAutoMessageScheduler } = require('./api/crm/scheduler/auto-message.service'); // <-- NOVO IMPORT

const PORT = process.env.PORT || 3001;

// Conecta ao banco de dados
connectDB();

startAutoMessageScheduler();

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});