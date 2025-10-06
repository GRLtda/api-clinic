// database.js
const mongoose = require('mongoose');

const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI não definido nas variáveis de ambiente.');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI, {
      // useNewUrlParser/useUnifiedTopology não são mais necessários nas versões atuais
      autoIndex: false, // em prod, preferir gerenciar índices manualmente
      maxPoolSize: 20,  // melhora concorrência
    });

    console.log('MongoDB Conectado com Sucesso!');
  } catch (err) {
    console.error('Erro ao conectar com o MongoDB:', err.message);
    process.exit(1);
  }

  // Boas práticas de encerramento
  process.on('SIGINT', async () => {
    await mongoose.connection.close();
    process.exit(0);
  });
};

module.exports = connectDB;
