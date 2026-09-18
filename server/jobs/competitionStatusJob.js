import cron        from 'node-cron'
import Competition  from '../models/Competition.js'

export async function refreshStatuses() {
  const comps = await Competition.find({ manualStatus: false })
  for (const c of comps) {
    const computed = c.computeStatus()
    if (c.status !== computed) { c.status = computed; await c.save() }
  }
}

export async function startCompetitionStatusJob() {
  // Run once on startup so status is current immediately
  await refreshStatuses().catch(e => console.error('⚠️  Competition status refresh failed:', e.message))

  // Then re-run every hour — competition dates are day-level so hourly is more than sufficient
  cron.schedule('0 * * * *', async () => {
    await refreshStatuses().catch(e => console.error('⚠️  Competition status refresh failed:', e.message))
  })

  console.log('⏰  Competition status job scheduled (hourly)')
}
