const db = require('./index');

const policyRuns = {
  async create(data) {
    const result = await db.query(
      `INSERT INTO policy_runs (
        user_id,
        order_id,
        mode,
        input_json,
        raw_output,
        decision_json,
        validation_status,
        validation_errors,
        backend_actions
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        data.user_id,
        data.order_id || null,
        data.mode || 'primary',
        JSON.stringify(data.input_json || {}),
        data.raw_output || null,
        data.decision_json ? JSON.stringify(data.decision_json) : null,
        data.validation_status || 'passed',
        JSON.stringify(data.validation_errors || []),
        JSON.stringify(data.backend_actions || []),
      ]
    );
    return result.rows[0];
  },

  async getByUser(userId, limit = 50) {
    const result = await db.query(
      'SELECT * FROM policy_runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    return result.rows;
  },
};

module.exports = policyRuns;
