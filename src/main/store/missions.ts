import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import { addSchedule, removeSchedule, type Cadence } from './schedules'

export interface MissionRecord {
  id: string
  title: string
  goal: string
  conversationId: string
  scheduleId: string | null
  status: 'active' | 'paused' | 'done'
  progress: string | null
  createdAt: number
  updatedAt: number
}

interface Row {
  id: string
  title: string
  goal: string
  conversation_id: string
  schedule_id: string | null
  status: string
  progress: string | null
  created_at: number
  updated_at: number
}

function toRecord(r: Row): MissionRecord {
  return {
    id: r.id,
    title: r.title,
    goal: r.goal,
    conversationId: r.conversation_id,
    scheduleId: r.schedule_id,
    status: r.status as MissionRecord['status'],
    progress: r.progress,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export function missionCheckinPrompt(mission: { id: string; title: string; goal: string }): string {
  return (
    `[Mission check-in: "${mission.title}"] GOAL: ${mission.goal}\n` +
    'Read your memory for prior progress. Do the NEXT concrete increment of this mission now. ' +
    'When done: save_memory with updated progress, call update_mission with a one-line progress summary ' +
    `(mission_id "${mission.id}"; set status "done" only when the goal is fully achieved), ` +
    'and send_to_session to the Control Room if you hit a milestone or blocker.'
  )
}

export function listMissions(): MissionRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM missions ORDER BY updated_at DESC')
    .all() as unknown as Row[]
  return rows.map(toRecord)
}

export function addMission(
  title: string,
  goal: string,
  conversationId: string,
  cadence: Cadence
): MissionRecord {
  const id = randomUUID()
  const now = Date.now()
  const schedule = addSchedule(conversationId, missionCheckinPrompt({ id, title, goal }), cadence)
  getDb()
    .prepare(
      `INSERT INTO missions (id, title, goal, conversation_id, schedule_id, status, progress, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, ?)`
    )
    .run(id, title, goal, conversationId, schedule.id, now, now)
  return listMissions().find((m) => m.id === id)!
}

export function updateMissionProgress(
  id: string,
  progress: string,
  status?: MissionRecord['status']
): void {
  const mission = listMissions().find((m) => m.id === id)
  if (!mission) throw new Error('Unknown mission')
  getDb()
    .prepare('UPDATE missions SET progress = ?, status = COALESCE(?, status), updated_at = ? WHERE id = ?')
    .run(progress, status ?? null, Date.now(), id)
  // A finished or paused mission stops its check-ins.
  if ((status === 'done' || status === 'paused') && mission.scheduleId) {
    removeSchedule(mission.scheduleId)
    getDb().prepare('UPDATE missions SET schedule_id = NULL WHERE id = ?').run(id)
  }
}

export function removeMission(id: string): void {
  const mission = listMissions().find((m) => m.id === id)
  if (mission?.scheduleId) removeSchedule(mission.scheduleId)
  getDb().prepare('DELETE FROM missions WHERE id = ?').run(id)
}

export function missionsForConversation(conversationId: string): MissionRecord[] {
  return listMissions().filter((m) => m.conversationId === conversationId)
}
