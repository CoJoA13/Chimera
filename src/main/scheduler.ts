import type { SessionManager } from './ipc/sessions'
import { dueSchedules, markRan, postpone } from './store/schedules'
import { getConversation, listGroupMembers } from './store/conversations'

const TICK_MS = 30_000
const BUSY_RETRY_MS = 120_000

/**
 * Runs scheduled prompts. Ticks every 30s; a due schedule fires into its
 * conversation like a normal user turn (so it lands in the transcript and
 * triggers the usual notifications). Busy sessions get postponed, not skipped.
 */
export function startScheduler(manager: SessionManager): void {
  setInterval(() => {
    void (async () => {
      for (const schedule of dueSchedules()) {
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
            await manager.groupSend(conversation.id, `[Scheduled task] ${schedule.prompt}`)
          } else {
            if (manager.isBusy(conversation.id)) {
              postpone(schedule.id, BUSY_RETRY_MS)
              continue
            }
            markRan(schedule.id, schedule.cadence)
            await manager.startForConversation(conversation.id)
            await manager.send(conversation.id, `[Scheduled task] ${schedule.prompt}`)
          }
        } catch (err) {
          // Budget reached or provider error — try again later rather than dying.
          console.error(`[scheduler] ${schedule.id} failed:`, err)
          postpone(schedule.id, BUSY_RETRY_MS)
        }
      }
    })()
  }, TICK_MS)
}
