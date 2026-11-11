'use strict';
function withTimeout(promise, milliseconds, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); timer.unref(); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
module.exports = { withTimeout };
