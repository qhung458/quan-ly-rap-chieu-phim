const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');

const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, 64, options);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

async function verifyPassword(password, saved) {
  if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(saved)) return false;

  const [salt, expected] = saved.split(':');
  const hash = await derive(password, Buffer.from(salt, 'hex'), 64, options);
  return timingSafeEqual(hash, Buffer.from(expected, 'hex'));
}

module.exports = { hashPassword, verifyPassword };
