import mongoose from 'mongoose'
import { app } from './app.js'
import { ensureDefaultTheme } from './models/HeroTheme.js'
import { checkAndFlagPassouts, syncCurrentCoreMembers } from './utils/passout.js'
import { startCompetitionStatusJob } from './jobs/competitionStatusJob.js'

// Standalone entry (local dev, Render, VPS). On Vercel, api/index.js is used instead.
const PORT = process.env.PORT || 3001

// Schedules a daily passout+core-sync check at 00:05 each night.
// Runs with pure Node setTimeout — no extra dependencies.
function scheduleDailyPassoutCheck() {
  const now  = new Date()
  const next = new Date(now)
  next.setDate(next.getDate() + 1)
  next.setHours(0, 5, 0, 0)           // 00:05 AM next day
  const delay = next - now
  setTimeout(async () => {
    console.log('⏰  Daily passout check triggered')
    await checkAndFlagPassouts().catch(e => console.error('⚠️  Passout check failed:', e.message))
    await syncCurrentCoreMembers().catch(e => console.error('⚠️  Core sync failed:', e.message))
    scheduleDailyPassoutCheck()        // reschedule for the following day
  }, delay)
  const h = String(next.getHours()).padStart(2,'0'), m = String(next.getMinutes()).padStart(2,'0')
  console.log(`⏰  Next passout check scheduled: ${next.toDateString()} ${h}:${m}`)
}

process.on('uncaughtException',  err => console.error('❌  Uncaught exception:',  err))
process.on('unhandledRejection', err => console.error('❌  Unhandled rejection:', err))

mongoose
  .connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅  MongoDB connected')
    // Run immediately on startup
    await ensureDefaultTheme().catch(e => console.error('⚠️  Hero theme init failed:', e.message))
    await checkAndFlagPassouts().catch(e => console.error('⚠️  Passout check failed:', e.message))
    await syncCurrentCoreMembers().catch(e => console.error('⚠️  Core sync failed:', e.message))
    await startCompetitionStatusJob()
    // Then schedule daily at 00:05 so June 1 transition fires automatically
    scheduleDailyPassoutCheck()
    app.listen(PORT, () => console.log(`🚀  Server → http://localhost:${PORT}`))
  })
  .catch(err => { console.error('❌  MongoDB:', err.message); process.exit(1) })
