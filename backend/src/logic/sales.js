const { processTurn } = require('../runtime/orchestrator');

async function processMessage(user, text, options = {}) {
  return processTurn(user, {
    text,
    messageId: options.messageId || null,
    hasPhoto: false,
  });
}

async function processPhoto(user, imageUrl, caption, options = {}) {
  return processTurn(user, {
    text: caption || 'Клиент отправил фото',
    imageUrl,
    messageId: options.messageId || null,
    hasPhoto: true,
  });
}

module.exports = {
  processMessage,
  processPhoto,
  processTurn,
};
