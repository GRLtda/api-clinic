const Sentry = require('@sentry/node');
require('dotenv').config();

// Inicializa o Sentry
Sentry.init({
  // Use a DSN do seu projeto Sentry (deve estar em seu .env)
  dsn: process.env.SENTRY_DSN,
  
  // Nível de amostragem de performance (ajuste conforme a necessidade)
  tracesSampleRate: 1.0, 
  
  // Ambiente (ex: 'production', 'development', 'staging')
  environment: process.env.NODE_ENV || 'development',
});

// Exporta as funcionalidades mais usadas
module.exports = {
  Sentry,
  // Função helper para capturar logs no CRM/Scheduler
  captureException: (error, context = {}) => {
    Sentry.withScope((scope) => {
      if (context.tags) {
        scope.setTags(context.tags);
      }
      if (context.extra) {
        scope.setExtras(context.extra);
      }
      Sentry.captureException(error);
    });
    // Se não for em ambiente de produção, loga no console também
    if (process.env.NODE_ENV !== 'production') {
      console.error('SENTRY CAPTURE:', error.message, context.tags);
    }
  },
};