const express = require('express');
const router = express.Router();
const { handleMessage } = require('./handler');

router.post('/webhook', (req, res) => {
  res.sendStatus(200);
  const msg = req.body?.message;
  if (msg) {
    handleMessage(msg).catch((err) => console.error('handleMessage error:', err));
  }
});

module.exports = router;
