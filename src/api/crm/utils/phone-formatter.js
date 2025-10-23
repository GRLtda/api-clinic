/**
 * Utilitário para formatação de números de telefone brasileiros
 * Adiciona automaticamente o prefixo 55 do Brasil
 */

/**
 * Formata o número de telefone adicionando o prefixo 55 do Brasil
 * @param {string} phone - Número de telefone a ser formatado
 * @returns {string} - Número formatado com prefixo 55
 */
const formatPhoneNumber = (phone) => {
  if (!phone) return "";

  // Remove todos os caracteres não numéricos
  const cleanPhone = phone.replace(/[^0-9]/g, "");

  // Se o número já começa com 55, retorna como está
  if (cleanPhone.startsWith("55")) {
    return cleanPhone;
  }

  // Se o número começa com 0, remove o 0 e adiciona 55
  if (cleanPhone.startsWith("0")) {
    return "55" + cleanPhone.substring(1);
  }

  // Se o número não tem 55 nem 0, adiciona 55
  return "55" + cleanPhone;
};

module.exports = {
  formatPhoneNumber,
};
