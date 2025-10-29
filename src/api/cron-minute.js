import { runTaskInWorker } from '../crm/scheduler/auto-message.service.js';

export default async function handler(req, res) {
  try {
    console.log('[CRON] Executando tarefa de 1 minuto...');
    await runTaskInWorker("APPOINTMENT_1_MIN_BEFORE");
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[CRON] Erro na tarefa de 1 minuto:', err);
    res.status(500).json({ error: err.message });
  }
}
