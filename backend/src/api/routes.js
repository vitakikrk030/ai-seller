const express = require('express');
const router = express.Router();
const users = require('../db/users');
const messages = require('../db/messages');

router.get('/users', async (req, res) => {
  try {
    res.json(await users.getAll());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/users/:id/messages', async (req, res) => {
  try {
    const user = await users.getById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(await messages.getByUser(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
