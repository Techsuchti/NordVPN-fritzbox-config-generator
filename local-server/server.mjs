import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const PORT = Number(process.env.PORT || 8080)
const DATA_DIR = process.env.DATA_DIR || '/data'
const DIST_DIR = process.env.DIST_DIR || '/usr/share/nginx/html'
const SESSION_DAYS = 30
const NORDVPN_CREDENTIALS_URL = 'https://api.nordvpn.com/v1/users/services/credentials'
const UPSTREAM_API = 'https://nordgen.selfhoster.win/api'

fs.mkdirSync(DATA_DIR, { recursive: true })
const db = new DatabaseSync(path.join(DATA_DIR, 'nordgen.sqlite'))
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    nordvpn_token TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`)

function getMasterKey() {
  if (process.env.LOCAL_MASTER_KEY) {
    const value = process.env.LOCAL_MASTER_KEY.trim()
    const key = /^[0-9a-fA-F]{64}$/.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64')
    if (key.length !== 32) throw new Error('LOCAL_MASTER_KEY must be 32 bytes')
    return key
  }
  const file = path.join(DATA_DIR, 'master.key')
  if (fs.existsSync(file)) {
    const key = fs.readFileSync(file)
    if (key.length !== 32) throw new Error('Invalid /data/master.key')
    return key
  }
  const key = crypto.randomBytes(32)
  fs.writeFileSync(file, key, { mode: 0o600 })
  return key
}
const MASTER_KEY = getMasterKey()
function b64(value) { return Buffer.from(value).toString('base64url') }
function unb64(value) { return Buffer.from(value, 'base64url') }
function encrypt(value) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv, ciphertext, cipher.getAuthTag()].map(b64).join('.')
}
function decrypt(value) {
  const [iv, ciphertext, tag] = value.split('.').map(unb64)
  const decipher = crypto.createDecipheriv('aes-256-gcm', MASTER_KEY, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
function hashPassword(password, salt = crypto.randomBytes(16)) {
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })
  return `scrypt:v1:${salt.toString('base64url')}:${hash.toString('base64url')}`
}
function verifyPassword(password, stored) {
  try {
    const [, version, saltText, hashText] = stored.split(':')
    if (version !== 'v1') return false
    const salt = Buffer.from(saltText, 'base64url')
    const expected = Buffer.from(hashText, 'base64url')
    const actual = crypto.scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 })
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
  } catch { return false }
}
function json(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders })
  res.end(JSON.stringify(payload))
}
function parseCookies(req) {
  const result = {}
  for (const part of (req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return result
}
function sessionUser(req) {
  const id = parseCookies(req).nordgen_session
  if (!id) return null
  return db.prepare(`SELECT users.id, users.username, users.nordvpn_token FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id = ? AND sessions.expires_at > ?`).get(id, Date.now()) || null
}
function setSession(res, userId) {
  const sessionId = crypto.randomBytes(32).toString('hex')
  const expires = Date.now() + SESSION_DAYS * 86400000
  db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(sessionId, userId, expires, Date.now())
  res.setHeader('Set-Cookie', `nordgen_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`)
}
function clearSession(req, res) {
  const id = parseCookies(req).nordgen_session
  if (id) db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  res.setHeader('Set-Cookie', 'nordgen_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')
}
function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try { return new URL(origin).origin === `http://${req.headers.host}` } catch { return false }
}
async function readBody(req, limit = 64 * 1024) {
  const chunks = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('Request too large'); chunks.push(chunk) }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}
const validUsername = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{3,32}$/.test(value)
const validPassword = value => typeof value === 'string' && value.length >= 10 && value.length <= 256
const validToken = value => typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value)
const validWireGuardKey = value => typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value)

async function handleAuth(req, res, pathname) {
  if (req.method === 'POST' && pathname === '/local-api/auth/register') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Forbidden' }), true
    if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count > 0) return json(res, 409, { error: 'Setup already completed' }), true
    const body = await readBody(req)
    if (!validUsername(body.username) || !validPassword(body.password)) return json(res, 400, { error: 'Username or password is invalid' }), true
    const name = body.username.trim(); const now = Date.now()
    const result = db.prepare('INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)').run(name, hashPassword(body.password), now, now)
    setSession(res, result.lastInsertRowid)
    return json(res, 201, { username: name }), true
  }
  if (req.method === 'POST' && pathname === '/local-api/auth/login') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Forbidden' }), true
    const body = await readBody(req)
    const user = typeof body.username === 'string' ? db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(body.username.trim()) : null
    if (!user || !verifyPassword(body.password, user.password_hash)) return json(res, 401, { error: 'Username or password is incorrect' }), true
    setSession(res, user.id); return json(res, 200, { username: user.username }), true
  }
  if (req.method === 'POST' && pathname === '/local-api/auth/logout') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Forbidden' }), true
    clearSession(req, res); return json(res, 200, { ok: true }), true
  }
  if (req.method === 'GET' && pathname === '/local-api/auth/status') {
    const user = sessionUser(req); const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count
    return json(res, 200, { setupRequired: count === 0, authenticated: !!user, username: user?.username || null, tokenStored: !!user?.nordvpn_token }), true
  }
  return false
}

async function handleLocalApi(req, res, pathname) {
  if (await handleAuth(req, res, pathname)) return
  const user = sessionUser(req)
  if (!user) { json(res, 401, { error: 'Not authenticated' }); return }
  if (!sameOrigin(req)) { json(res, 403, { error: 'Forbidden' }); return }
  if (req.method === 'GET' && pathname === '/local-api/profile') { json(res, 200, { username: user.username, tokenStored: !!user.nordvpn_token }); return }
  if (req.method === 'PUT' && pathname === '/local-api/profile/token') {
    const body = await readBody(req)
    if (!validToken(body.token)) { json(res, 400, { error: 'Invalid NordVPN Access Token' }); return }
    db.prepare('UPDATE users SET nordvpn_token = ?, updated_at = ? WHERE id = ?').run(encrypt(body.token), Date.now(), user.id)
    json(res, 200, { tokenStored: true }); return
  }
  if (req.method === 'DELETE' && pathname === '/local-api/profile/token') {
    db.prepare('UPDATE users SET nordvpn_token = NULL, updated_at = ? WHERE id = ?').run(Date.now(), user.id)
    json(res, 200, { tokenStored: false }); return
  }
  if (req.method === 'POST' && pathname === '/local-api/key') {
    if (!user.nordvpn_token) { json(res, 400, { error: 'No NordVPN Access Token saved in your profile' }); return }
    let token; try { token = decrypt(user.nordvpn_token) } catch { json(res, 500, { error: 'Stored token could not be decrypted' }); return }
    let upstream
    try { upstream = await fetch(NORDVPN_CREDENTIALS_URL, { headers: { Accept: 'application/json', Authorization: `Bearer token:${token}` }, signal: AbortSignal.timeout(20000) }) }
    catch { json(res, 503, { error: 'NordVPN API unavailable' }); return }
    if (upstream.status === 401) { json(res, 401, { error: 'Expired token' }); return }
    if (!upstream.ok) { json(res, 503, { error: 'NordVPN API error' }); return }
    let payload; try { payload = await upstream.json() } catch { json(res, 503, { error: 'Invalid NordVPN API response' }); return }
    const key = payload?.nordlynx_private_key
    if (!validWireGuardKey(key)) { json(res, 503, { error: 'NordVPN API returned an invalid private key' }); return }
    json(res, 200, { key }); return
  }
  json(res, 404, { error: 'Not Found' })
}

async function proxyApi(req, res, pathname) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`)
  const target = new URL(UPSTREAM_API + pathname.slice('/api'.length) + requestUrl.search)
  const headers = { ...req.headers, host: 'nordgen.selfhoster.win', origin: 'https://nordgen.selfhoster.win', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }
  // Node fetch transparently decompresses upstream responses. Do not forward
  // the browser's compression headers or the upstream Content-Encoding, otherwise
  // the browser tries to decompress an already decompressed response ("Decoding failed").
  delete headers.connection
  delete headers['content-length']
  delete headers['accept-encoding']
  delete headers['content-encoding']
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : req
  const upstream = await fetch(target, { method: req.method, headers, body, redirect: 'manual' })
  const responseHeaders = Object.fromEntries(upstream.headers.entries())
  delete responseHeaders['content-length']
  delete responseHeaders['content-encoding']
  delete responseHeaders['transfer-encoding']
  res.writeHead(upstream.status, responseHeaders)
  if (upstream.body) for await (const chunk of upstream.body) res.write(Buffer.from(chunk))
  res.end()
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }
function serveStatic(req, res) {
  const pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname)
  if (pathname === '/health') { json(res, 200, { status: 'ok' }); return }
  let file = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname)
  if (!file.startsWith(DIST_DIR)) { json(res, 403, { error: 'Forbidden' }); return }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST_DIR, 'index.html')
  if (!fs.existsSync(file)) { json(res, 404, { error: 'Not Found' }); return }
  const ext = path.extname(file).toLowerCase()
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' })
  fs.createReadStream(file).pipe(res)
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, `http://${req.headers.host}`).pathname
    if (pathname.startsWith('/local-api/')) { await handleLocalApi(req, res, pathname); return }
    if (pathname.startsWith('/api/')) { if (!sessionUser(req)) { json(res, 401, { error: 'Not authenticated' }); return } await proxyApi(req, res, pathname); return }
    serveStatic(req, res)
  } catch (error) {
    console.error('request_error', error instanceof Error ? error.message : String(error))
    if (!res.headersSent) json(res, 500, { error: 'Internal Server Error' }); else res.end()
  }
})
server.listen(PORT, '0.0.0.0', () => console.log(`NordVPN FRITZ!Box Generator listening on :${PORT}`))
