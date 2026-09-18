import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve, join } from 'path'   // join lives in 'path'
import { existsSync }             from 'fs'     // existsSync lives in 'fs'

const __dir = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dir, '..', '.env') })

import express    from 'express'
import cors       from 'cors'
import helmet     from 'helmet'
import mongoose   from 'mongoose'
import mediaRoutes              from './routes/media.js'
import postRoutes               from './routes/posts.js'
import globalAnnouncementRoutes from './routes/globalAnnouncements.js'
import settingsRoutes           from './routes/settings.js'
import authRoutes               from './routes/auth.js'
import adminRoutes       from './routes/admin.js'
import uploadRoutes      from './routes/upload.js'
import postcardsRoutes   from './routes/postcards.js'
import galleryRoutes     from './routes/gallery.js'
import eventsRoutes      from './routes/events.js'
import membersRoutes     from './routes/members.js'
import coreRoutes        from './routes/coreCommittee.js'
import socialRoutes      from './routes/socialLinks.js'
import competitionsRoutes from './routes/competitions.js'
import activitiesRoutes   from './routes/activities.js'
import magazineRoutes    from './routes/magazines.js'
import imageProxyRoutes  from './routes/imageProxy.js'
import heroThemesRoutes  from './routes/heroThemes.js'

const app    = express()
app.set('trust proxy', 1)   // read real client IP from X-Forwarded-For (needed behind Nginx/Render/Railway)
const PORT   = process.env.PORT || 3001
const isProd = process.env.NODE_ENV === 'production'

// Security headers with Content-Security-Policy.
// modulePreload polyfill is disabled in vite.config.js so no inline scripts exist
// in the production build, allowing script-src 'self' without 'unsafe-inline'.
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      // React inline style props + Google Fonts / FontShare CSS
      styleSrc:    ["'self'", "'unsafe-inline'",
                    'https://fonts.googleapis.com',
                    'https://api.fontshare.com'],
      imgSrc:      ["'self'", 'data:', 'blob:', 'https:'],  // S3 images
      connectSrc:  ["'self'", 'https:'],
      // Google Fonts static files + FontShare font binaries (css: api, files: cdn)
      fontSrc:     ["'self'", 'data:',
                    'https://fonts.gstatic.com',
                    'https://api.fontshare.com',
                    'https://cdn.fontshare.com'],
      // S3 videos — without this, falls back to default-src 'self' and blocks all external media
      mediaSrc:    ["'self'", 'https:'],
      objectSrc:   ["'none'"],
      baseUri:     ["'self'"],
      formAction:  ["'self'"],
      workerSrc:   ["'self'", 'blob:'],
      frameAncestors: ["'none'"],
    },
  },
}))

// In prod the SPA is served by this same Express server (same origin), so CORS only
// matters if you later add a separate frontend domain. ALLOWED_ORIGINS is optional.
// In production the SPA is served from the same Express server (same origin),
// so browsers never send a CORS header for normal usage. ALLOWED_ORIGINS is only
// needed if a separate frontend domain or mobile app calls this API.
// Default to false (no cross-origin access) when the env var is not set.
const allowedOrigins = isProd
  ? (process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : false)
  : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175']

if (isProd && !process.env.ALLOWED_ORIGINS) {
  console.log('ℹ️   ALLOWED_ORIGINS not set — cross-origin requests blocked (safe for same-origin SPA deploy)')
}

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}))
app.use(express.json({ limit: '5mb' }))

app.use('/api/media',         mediaRoutes)
app.use('/api/posts',         postRoutes)
app.use('/api/announce',      globalAnnouncementRoutes)
app.use('/api/settings',      settingsRoutes)
app.use('/api/auth',          authRoutes)
app.use('/api/admin',        adminRoutes)
app.use('/api/upload',       uploadRoutes)
app.use('/api/postcards',    postcardsRoutes)
app.use('/api/gallery',      galleryRoutes)
app.use('/api/events',       eventsRoutes)
app.use('/api/members',      membersRoutes)
app.use('/api/core',         coreRoutes)
app.use('/api/social',       socialRoutes)
app.use('/api/competitions', competitionsRoutes)
app.use('/api/activities',   activitiesRoutes)
app.use('/api/magazines',   magazineRoutes)
app.use('/api/proxy/image', imageProxyRoutes)
app.use('/api/hero-themes', heroThemesRoutes)
app.get('/api/health', (_, res) => res.json({ status: 'ok', time: new Date() }))

// Resend credential check — visit /api/health/email to verify RESEND_API_KEY works
app.get('/api/health/email', async (req, res) => {
  try {
    const { Resend } = await import('resend')
    const r = new Resend(process.env.RESEND_API_KEY)
    const { error } = await r.emails.send({
      from:    process.env.EMAIL_FROM || 'IEM Photography Club <onboarding@resend.dev>',
      to:      'delivered@resend.dev',
      subject: 'Health check',
      html:    '<p>ok</p>',
    })
    if (error) throw new Error(error.message || JSON.stringify(error))
    res.json({ ok: true, from: process.env.EMAIL_FROM || '(default onboarding@resend.dev)' })
  } catch (e) {
    res.json({ ok: false, error: e.message })
  }
})

// Vercel Cron target (see vercel.json). Vercel sends 'Authorization: Bearer $CRON_SECRET'.
// Replaces the setTimeout / node-cron jobs in index.js, which can't run on serverless.
app.get('/api/cron/daily', async (req, res) => {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const { checkAndFlagPassouts, syncCurrentCoreMembers } = await import('./utils/passout.js')
    const { refreshStatuses }  = await import('./jobs/competitionStatusJob.js')
    const { ensureDefaultTheme } = await import('./models/HeroTheme.js')
    await ensureDefaultTheme()
    await checkAndFlagPassouts()
    await syncCurrentCoreMembers()
    await refreshStatuses()
    res.json({ ok: true })
  } catch (e) {
    console.error('❌  Cron failed:', e.message)
    res.status(500).json({ ok: false })
  }
})

// Static SPA serving only for standalone hosting (Render/VPS). On Vercel the CDN serves dist/.
if (isProd && !process.env.VERCEL) {
  const dist = join(__dir, '..', 'dist')
  if (existsSync(dist)) {
    app.use(express.static(dist))
    app.get(/^(?!\/api).*/, (_, res) => res.sendFile(join(dist, 'index.html')))
  } else {
    console.warn('⚠️   dist/ not found — run `npm run build` first')
  }
}

// Global Express error handler — catches next(err) from all routes/middleware
app.use((err, req, res, _next) => {
  console.error('❌  Express error:', err.message)
  const status = err.status || err.statusCode || 500
  res.status(status).json({ error: isProd ? 'Internal server error' : err.message })
})

export { app, isProd }
