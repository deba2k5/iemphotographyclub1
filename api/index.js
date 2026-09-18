import mongoose from 'mongoose'
import { app } from '../server/app.js'

// Vercel serverless entry. The Mongo connection is cached across warm invocations.
let conn = null
async function connect() {
  if (mongoose.connection.readyState === 1) return
  conn ??= mongoose.connect(process.env.MONGODB_URI, { bufferCommands: false })
  try { await conn } catch (e) { conn = null; throw e }
}

export default async function handler(req, res) {
  try {
    await connect()
  } catch (e) {
    console.error('❌  MongoDB:', e.message)
    return res.status(503).json({ error: 'Database unavailable' })
  }
  return app(req, res)
}
