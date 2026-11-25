'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const ExcelJS = require('exceljs');
const mysql = require('mysql2/promise');

const root = path.join(__dirname, '..', '..');
const sql = name => readFileSync(path.join(root, 'sqlCode', name), 'utf8');
const fixturePassword = 'Rap-fixture-only-2026!';

async function withSchema(run) {
  const host = process.env.DB_HOST || '127.0.0.1';
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(host), 'Integration fixtures must use local MySQL.');
  const schema = 'rap_test_' + randomUUID().replaceAll('-', '');
  assert.notEqual(schema.toLowerCase(), process.env.DB_NAME?.toLowerCase());
  const options = {
    host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, charset: 'utf8mb4', connectTimeout: 5000
  };
  const control = await mysql.createConnection(options);
  let connection;
  let created = false;
  try {
    await control.query('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci', [schema]);
    created = true;
    connection = await mysql.createConnection({ ...options, database: schema, multipleStatements: true });
    await run(connection, schema);
  } finally {
    try {
      if (connection) await connection.end();
      if (created) await control.query('DROP DATABASE ??', [schema]);
    } finally {
      await control.end();
    }
  }
}

async function withApplication(schema, run) {
  const probe = net.createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  const origin = 'http://127.0.0.1:' + port;
  const app = spawn(process.execPath, ['server/index.cjs'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DB_NAME: schema, PORT: String(port), SESSION_SECRET: randomUUID() }
  });
  let errors = '';
  app.stderr.on('data', chunk => { errors = (errors + chunk).slice(-2000); });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test application startup timed out.')), 10000);
      app.once('error', error => { clearTimeout(timer); reject(error); });
      app.once('exit', code => { clearTimeout(timer); reject(new Error('Test application exited ' + code + '\n' + errors)); });
      app.stdout.on('data', chunk => {
        if (!chunk.toString().includes(origin)) return;
        clearTimeout(timer);
        resolve();
      });
    });
    const request = (route, { cookie, method = 'GET', data, query } = {}) => {
      const url = new URL(route, origin);
      for (const [name, values] of Object.entries(query ?? {})) {
        for (const value of [].concat(values)) url.searchParams.append(name, value);
      }
      return fetch(url, {
        method, signal: AbortSignal.timeout(10000),
        headers: { origin, ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json' } : {}) },
        body: data ? JSON.stringify(data) : undefined
      });
    };
    try {
      await run(request, origin);
    } catch (error) {
      if (errors) error.message += '\nỨng dụng thử: ' + errors;
      throw error;
    }
  } finally {
    if (app.exitCode === null && app.signalCode === null) {
      const closed = once(app, 'exit');
      app.kill();
      await closed;
    }
  }
}

async function json(request, route, options, expected = 200) {
  const response = await request(route, options);
  const payload = await response.json();
  assert.equal(response.status, expected, JSON.stringify(payload));
  return payload;
}

async function signIn(request, username) {
  const response = await request('/api/auth/login', {
    method: 'POST', data: { TenDangNhap: username, MatKhau: fixturePassword }
  });
  assert.equal(response.status, 200, await response.text());
  return response.headers.getSetCookie()[0].split(';')[0];
}

async function signUp(request, username) {
  return json(request, '/api/auth/register', {
    method: 'POST', data: { TenDangNhap: username, HoTen: 'Tài khoản kiểm thử', MatKhau: fixturePassword, XacNhanMatKhau: fixturePassword }
  }, 201);
}

async function download(request, route, cookie, snapshotId) {
  const response = await request(route, { cookie, query: { snapshotId } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await response.arrayBuffer());
  return book;
}

function sheetRows(book, sheetNumber) {
  return book.getWorksheet(sheetNumber).getSheetValues().slice(2).map(row => row.slice(1));
}

module.exports = { sql, withSchema, withApplication, json, signIn, signUp, download, sheetRows };
