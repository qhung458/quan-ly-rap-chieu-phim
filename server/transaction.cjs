const db = require('./db.cjs');

const databaseLockName = "CONCAT(?, '_', SHA2(DATABASE(), 224))";

async function transaction(work, lockName) {
  const connection = await db.getConnection();
  let locked = false;
  try {
    if (lockName) {
      const [[{ acquired }]] = await connection.query(
        `SELECT GET_LOCK(${databaseLockName}, 5) AS acquired`, [lockName]
      );
      if (acquired !== 1) {
        const error = new Error('Database lock unavailable');
        error.code = 'APP_DB_LOCK_BUSY';
        throw error;
      }
      locked = true;
    }

    await connection.beginTransaction();
    try {
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    // MySQL named locks remain held after commit or rollback until released.
    if (locked) {
      try {
        const [[{ released }]] = await connection.query(
          `SELECT RELEASE_LOCK(${databaseLockName}) AS released`, [lockName]
        );
        if (released !== 1) connection.destroy();
      } catch {
        connection.destroy();
      }
    }
    connection.release();
  }
}

module.exports = transaction;
