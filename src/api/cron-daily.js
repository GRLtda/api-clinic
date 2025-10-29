import { runTaskInWorker } from '../crm/scheduler/auto-message.service.js';

export default async function handler(req, res) {
  try {
    console.log('[CRON] Executando tarefas diárias...');
    await Promise.all([
      runTaskInWorker("APPOINTMENT_2_DAYS_BEFORE"),
      runTaskInWorker("APPOINTMENT_1_DAY_BEFORE"),
      runTaskInWorker("PATIENT_BIRTHDAY")
    ]);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[CRON] Erro nas tarefas diárias:', err);
    res.status(500).json({ error: err.message });
  }
}
