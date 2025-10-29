const axios = require('axios');

/**
 * Envia uma mensagem formatada para o Discord via Webhook.
 * @param {string} message - A mensagem principal.
 * @param {'info' | 'success' | 'warn' | 'error'} type - O tipo de log (muda a cor).
 * @param {string} taskName - O nome da tarefa ou módulo.
 */
const sendToDiscord = async (message, type = 'info', taskName = 'Scheduler') => {
    const webhookUrl = 'https://discord.com/api/webhooks/1432810373244915732/OapA83WGKuWf1rlxbtQGFPkwD_H4K9mIxtO8BaIKrO1ZVyT5u5UNyKLVi_U0u0Ce41D1';
    if (!webhookUrl) {
        console.error('DISCORD_WEBHOOK_URL não está definida. Log do Discord ignorado.');
        return;
    }

    // Define cores com base no tipo
    const colors = {
        info: 3447003,    // Azul
        success: 3066993,  // Verde
        warn: 15105570,  // Amarelo
        error: 15158332   // Vermelho
    };

    const embed = {
        title: `[${type.toUpperCase()}] - ${taskName}`,
        description: message,
        color: colors[type] || colors.info,
        timestamp: new Date().toISOString()
    };

    try {
        await axios.post(webhookUrl, {
            embeds: [embed]
        });
    } catch (error) {
        console.error('Erro ao enviar log para o Discord:', error.message);
    }
};

module.exports = { sendToDiscord };