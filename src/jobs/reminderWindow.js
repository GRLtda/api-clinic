// src/jobs/reminderWindow.js
const { DateTime } = require('luxon');

const DEFAULT_WINDOW_MINUTES = 2;
const DEFAULT_TZ = 'America/Sao_Paulo';

/**
 * Calcula a janela alvo [startUtc, endUtc] para "agora + offsetMinutes".
 * Usa tolerância simétrica de ±windowMinutes.
 */
function computeOffsetWindowUtc({
  nowUtc = DateTime.utc(),
  offsetMinutes,
  windowMinutes = DEFAULT_WINDOW_MINUTES,
}) {
  if (typeof offsetMinutes !== 'number') {
    throw new Error('offsetMinutes obrigatório (minutos).');
  }
  const target = nowUtc.plus({ minutes: offsetMinutes });
  const startUtc = target.minus({ minutes: windowMinutes });
  const endUtc   = target.plus({ minutes: windowMinutes });
  return { startUtc: startUtc.toJSDate(), endUtc: endUtc.toJSDate() };
}

/**
 * Formata data/hora pro paciente no fuso desejado.
 */
function formatForPatient(dateJs, tz = DEFAULT_TZ) {
  const dt = DateTime.fromJSDate(dateJs, { zone: tz });
  return {
    date: dt.toFormat('dd/LL/yyyy'),
    time: dt.toFormat('HH:mm'),
    full: dt.toFormat("dd/LL/yyyy 'às' HH:mm"),
  };
}

module.exports = {
  computeOffsetWindowUtc,
  formatForPatient,
  DEFAULT_TZ,
  DEFAULT_WINDOW_MINUTES,
};
