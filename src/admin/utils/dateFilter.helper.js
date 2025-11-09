// src/admin/utils/dateFilter.helper.js
const { DateTime } = require('luxon');

/**
 * @typedef {'%Y-%m-%d' | '%Y-%m'} MongoGroupFormat
 */

/**
 * @typedef {Object} DateFilterResult
 * @property {Date} startDate - Um objeto Date do JS para o $match (maior ou igual).
 * @property {MongoGroupFormat} groupByFormat - O formato para agrupar no MongoDB Aggregation.
 * @property {'day' | 'month'} periodUnit - A unidade do período (dia ou mês).
 */

/**
 * Calcula a data de início e o formato de agrupamento com base na query string.
 * @param {string} filterQuery - O filtro da query (ex: '7d', '1m', '6m', '12m').
 * @returns {DateFilterResult}
 */
exports.getDateRangeFromFilter = (filterQuery) => {
  const now = DateTime.now();
  let startDate;
  let groupByFormat;
  let periodUnit;

  switch (filterQuery) {
    case '7d':
      // 7 dias atrás, agrupado por dia
      startDate = now.minus({ days: 7 }).startOf('day').toJSDate();
      groupByFormat = '%Y-%m-%d';
      periodUnit = 'day';
      break;
    case '1m':
      // 1 mês (usamos 30 dias) atrás, agrupado por dia
      startDate = now.minus({ days: 30 }).startOf('day').toJSDate();
      groupByFormat = '%Y-%m-%d';
      periodUnit = 'day';
      break;
    case '6m':
      // 6 meses atrás, agrupado por mês
      startDate = now.minus({ months: 6 }).startOf('month').toJSDate();
      groupByFormat = '%Y-%m';
      periodUnit = 'month';
      break;
    case '12m':
    default:
      // 12 meses atrás (default), agrupado por mês
      startDate = now.minus({ months: 12 }).startOf('month').toJSDate();
      groupByFormat = '%Y-%m';
      periodUnit = 'month';
      break;
  }

  return { startDate, groupByFormat, periodUnit };
};