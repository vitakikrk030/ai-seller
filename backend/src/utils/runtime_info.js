const { execSync } = require('child_process');

function getGitCommit() {
  if (process.env.GIT_COMMIT) {
    return String(process.env.GIT_COMMIT).trim();
  }

  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch (err) {
    return 'unknown';
  }
}

function getPipelineVersion() {
  return 'direct_ai_v3';
}

module.exports = {
  getGitCommit,
  getPipelineVersion,
};
