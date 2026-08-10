import type { SessionManager } from './ipc/sessions'
import { dueSchedules, markRan, postpone } from './store/schedules'
import { getConversation, listGroupMembers } from './store/conversations'
import { logActivity } from './store/activity'

const TICK_MS = 30_000
const BUSY_RETRY_MS = 120_000

/**
 * Runs scheduled prompts. Ticks every 30s; a due schedule fires into its
 * conversation like a normal user turn (so it lands in the transcript and
 * triggers the usual notifications). Busy sessions get postponed, not skipped.
 */
const MAX_FIRES_PER_TICK = 2

export function startScheduler(manager: SessionManager): void {
  setInterval(() => void runDueSchedules(manager), TICK_MS)
}

/** One scheduler tick — exported for tests. */
export async function runDueSchedules(manager: SessionManager): Promise<void> {
  {
    {
      // Wake-from-sleep collapse: fire at most a couple per tick, stagger the rest.
      let fired = 0
      let staggered = 0
      for (const schedule of dueSchedules()) {
        if (fired >= MAX_FIRES_PER_TICK) {
          staggered++
          postpone(schedule.id, staggered * 60_000)
          continue
        }
        fired++
        const conversation = getConversation(schedule.conversationId)
        if (!conversation) {
          markRan(schedule.id, schedule.cadence) // orphan: keep cycling, harmless
          continue
        }
        try {
          if (conversation.kind === 'group') {
            const busy = listGroupMembers(conversation.id).some(
              (m) => manager.isBusy(m.id)
            )
            if (busy) {
              postpone(schedule.id, BUSY_RETRY_MS)
              continue
            }
            markRan(schedule.id, schedule.cadence)
            logActivity('schedule', `Ran in "${conversation.title}": ${schedule.prompt}`, conversation.id)
            await manager.groupSend(conversation.id, `[Scheduled task] ${schedule.prompt}`)
          } else {
            if (manager.isBusy(conversation.id)) {
              postpone(schedule.id, BUSY_RETRY_MS)
              continue
            }
            markRan(schedule.id, schedule.cadence)
            logActivity('schedule', `Ran in "${conversation.title}": ${schedule.prompt}`, conversation.id)
            await manager.startForConversation(conversation.id)
            await manager.send(conversation.id, `[Scheduled task] ${schedule.prompt}`)
          }
        } catch (err) {
          // Budget reached or provider error — try again later rather than dying.
          console.error(`[scheduler] ${schedule.id} failed:`, err)
          postpone(schedule.id, BUSY_RETRY_MS)
        }
      }
    }
  }
}
