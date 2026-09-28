import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import type { LessonPlan, TeacherScheduleSlot } from '../../lib/types'
import { findMatchingLessonPlan, isPastLessonSlot } from '../../pages/Planning'

// ── Date helpers ─────────────────────────────────────────────────────────────

function isoToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function weekMondayOf(date: Date): Date {
  const d = new Date(date)
  const jsDay = d.getDay() // 0=Sun…6=Sat
  const diff = jsDay === 0 ? -6 : 1 - jsDay
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  /** Scope data to this teacher's timetable. Omit for school-wide leadership views. */
  teacherId?: string | null
  /** Further scope to a specific class */
  classId?: string | null
  /** Card heading */
  title?: string
  /** Optional custom style overrides */
  style?: React.CSSProperties
}

interface Stats {
  totalScheduled: number
  totalPast: number
  plannedPast: number
  missedPast: number
  futurePlanned: number
  futureUnplanned: number
  compliancePct: number
}

export default function LessonPlanComplianceCard({
  teacherId,
  classId,
  title = 'Lesson Plan Compliance',
  style
}: Props) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setLoading(true)
      try {
        const [{ slots }, plans] = await Promise.all([
          api.getTeacherTimetable(teacherId || 'all'),
          api.listLessonPlans({
            teacherId: teacherId || undefined,
            classId: classId || undefined
          }).catch(() => [] as LessonPlan[])
        ])

        const today = new Date()
        // Window: 4 weeks back to 5 weeks ahead (covers full current term)
        const windowStart = addDays(weekMondayOf(today), -28)
        const windowEnd   = addDays(weekMondayOf(today),  35)

        let totalScheduled = 0
        let totalPast = 0
        let plannedPast = 0
        let futurePlanned = 0
        let futureUnplanned = 0

        let cursor = new Date(windowStart)
        while (cursor <= windowEnd) {
          const jsDay = cursor.getDay() // 0=Sun…6=Sat
          if (jsDay >= 1 && jsDay <= 5) {
            // TeacherScheduleSlot day_of_week: 0=Mon…4=Fri
            const slotDay = jsDay - 1
            const daySlots = slots.filter((s) => {
              if (s.day_of_week !== slotDay) return false
              if (classId && s.class_id !== classId) return false
              return true
            })

            const dateStr = toISO(cursor)
            for (const slot of daySlots) {
              totalScheduled++
              const matchingPlan = findMatchingLessonPlan(slot, dateStr, plans)
              const isPast = isPastLessonSlot(dateStr, slot.start_time, slot.end_time)

              if (matchingPlan) {
                if (isPast) {
                  totalPast++
                  plannedPast++
                } else {
                  futurePlanned++
                }
              } else {
                if (isPast) {
                  totalPast++
                } else {
                  futureUnplanned++
                }
              }
            }
          }
          cursor = addDays(cursor, 1)
        }

        const missedPast = totalPast - plannedPast
        const compliancePct = totalPast > 0 ? Math.round((plannedPast / totalPast) * 100) : (totalScheduled > 0 ? 100 : 0)

        if (!cancelled) {
          setStats({
            totalScheduled,
            totalPast,
            plannedPast,
            missedPast,
            futurePlanned,
            futureUnplanned,
            compliancePct
          })
        }
      } catch {
        if (!cancelled) setStats(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => { cancelled = true }
  }, [teacherId, classId])

  if (loading) {
    return (
      <div className="card" style={{ padding: '20px', borderRadius: '12px', borderLeft: '4px solid #94a3b8', ...style }}>
        <div style={{ fontSize: '13px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          📋 {title}
        </div>
        <div style={{ fontSize: '28px', fontWeight: 800, color: '#94a3b8', marginTop: 8 }}>—</div>
        <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#94a3b8' }}>Calculating compliance…</p>
      </div>
    )
  }

  const hasSchedule = (stats?.totalScheduled ?? 0) > 0
  const pct = stats?.compliancePct ?? 0

  const borderColor = !hasSchedule ? '#94a3b8' : pct >= 90 ? '#15803d' : pct >= 70 ? '#d97706' : '#dc2626'
  const pctColor    = !hasSchedule ? '#64748b' : pct >= 90 ? '#15803d' : pct >= 70 ? '#b45309' : '#b91c1c'
  const pctBg       = !hasSchedule ? '#f1f5f9' : pct >= 90 ? '#dcfce7' : pct >= 70 ? '#fef3c7' : '#fee2e2'

  return (
    <div className="card" style={{ padding: '20px', borderRadius: '12px', borderLeft: `4px solid ${borderColor}`, ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {title}
        </span>
        <span style={{ fontSize: '20px' }}>📋</span>
      </div>

      {/* Main KPI */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: '28px', fontWeight: 800, color: pctColor }}>
          {hasSchedule ? `${pct}%` : '—%'}
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 12,
            background: pctBg,
            color: pctColor
          }}
        >
          {!hasSchedule
            ? 'No Schedule Active'
            : pct >= 90
            ? '✓ High Compliance'
            : pct >= 70
            ? '⚠ Needs Attention'
            : '✘ Critical (Missed Lessons)'}
        </span>
      </div>

      {!hasSchedule ? (
        <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#64748b' }}>
          Upload your timetable in Planning to monitor real-time lesson plan delivery.
        </p>
      ) : (
        /* Four-State Color Breakdown */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginTop: 12 }}>
          {/* 1. Future Planned: Lime Green */}
          <div style={{ background: '#f7fee7', border: '1px solid #84cc16', borderRadius: 6, padding: '6px 8px' }}>
            <div style={{ fontSize: 10, color: '#3f6212', fontWeight: 700, textTransform: 'uppercase' }}>
              ✓ Future Planned
            </div>
            <div style={{ fontWeight: 800, color: '#365314', fontSize: 16 }}>
              {stats?.futurePlanned ?? 0}
            </div>
          </div>

          {/* 2. Past Delivered (Planned): Deep Green */}
          <div style={{ background: '#f0fdf4', border: '1px solid #15803d', borderRadius: 6, padding: '6px 8px' }}>
            <div style={{ fontSize: 10, color: '#166534', fontWeight: 700, textTransform: 'uppercase' }}>
              ✓ Past Delivered
            </div>
            <div style={{ fontWeight: 800, color: '#14532d', fontSize: 16 }}>
              {stats?.plannedPast ?? 0}
            </div>
          </div>

          {/* 3. Future Unplanned: Blue */}
          <div style={{ background: '#eff6ff', border: '1px solid #3b82f6', borderRadius: 6, padding: '6px 8px' }}>
            <div style={{ fontSize: 10, color: '#1d4ed8', fontWeight: 700, textTransform: 'uppercase' }}>
              ⏱ Future To Plan
            </div>
            <div style={{ fontWeight: 800, color: '#1e40af', fontSize: 16 }}>
              {stats?.futureUnplanned ?? 0}
            </div>
          </div>

          {/* 4. Past Unplanned: Very Sharp Red */}
          <div style={{ background: '#fef2f2', border: '1.5px solid #dc2626', borderRadius: 6, padding: '6px 8px' }}>
            <div style={{ fontSize: 10, color: '#991b1b', fontWeight: 700, textTransform: 'uppercase' }}>
              ✘ Past Missed
            </div>
            <div style={{ fontWeight: 800, color: '#b91c1c', fontSize: 16 }}>
              {stats?.missedPast ?? 0}
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <Link
          to="/planning"
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: '#2563eb',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4
          }}
        >
          <span>Open Lesson Planning Board</span>
          <span>→</span>
        </Link>
      </div>
    </div>
  )
}
