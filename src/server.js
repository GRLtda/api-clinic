require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/database');
const { runRemindersSweep } = require('./jobs/reminders.job');

const PORT = process.env.PORT || 3001;

// Conecta ao banco de dados
connectDB();

setInterval(() => {
  runRemindersSweep().catch(err => console.error('Reminders sweep failed', err));
}, 60 * 1000); // a cada 1 minuto

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
