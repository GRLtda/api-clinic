// src/server.js (Mantido com a estrutura assíncrona do último ajuste)
require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/database');
const { Sentry } = require('./utils/sentry');

const PORT = process.env.PORT || 3001;

connectDB().then(() => { 
    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
}).catch(err => {
    console.error('Falha ao iniciar o servidor devido a erro no DB:', err);
    Sentry.captureException(err); 
    process.exit(1);
});
