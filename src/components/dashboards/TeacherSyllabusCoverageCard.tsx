import React from 'react'
import type { CurriculumScheme, LessonPlan, WorkPlan } from '../../lib/types'

interface Props {
  teacherId?: string
  workPlans: WorkPlan[]
  lessonPlans: LessonPlan[]
  schemes: CurriculumScheme[]
  title?: string
  style?: React.CSSProperties
}

export default function TeacherSyllabusCoverageCard({
  teacherId,
  workPlans,
  lessonPlans,
  schemes,
  title = '🎯 Syllabus Coverage Status',
  style
}: Props) {
  // Filter to this teacher's plans
  const myWorkPlans = teacherId ? workPlans.filter((wp) => wp.teacher_id === teacherId) : workPlans
  const myLessonPlans = teacherId ? lessonPlans.filter((lp) => lp.teacher_id === teacherId) : lessonPlans

  // Collect all unique objectives covered in work plans and lesson plans
  const coveredObjectivesMap = new Map<string, { code: string; text: string; source: 'work_plan' | 'lesson_plan' }>()

  myWorkPlans.forEach((wp) => {
    wp.weeks?.forEach((w) => {
      w.objectives?.forEach((obj) => {
        if (obj.code_snapshot) {
          coveredObjectivesMap.set(obj.code_snapshot, {
            code: obj.code_snapshot,
            text: obj.text_snapshot,
            source: 'work_plan'
          })
        }
      })
    })
  })

  myLessonPlans.forEach((lp) => {
    lp.objectives?.forEach((obj) => {
      if (obj.code_snapshot) {
        coveredObjectivesMap.set(obj.code_snapshot, {
          code: obj.code_snapshot,
          text: obj.text_snapshot,
          source: 'lesson_plan'
        })
      }
    })
  })

  // Match schemes linked to teacher's work plans
  const linkedSchemes = schemes.filter((s) => myWorkPlans.some((wp) => wp.scheme_id === s.id))
  // Fallback to schemes matching subject codes if no explicit scheme_id
  const subjectSchemes = schemes.filter((s) => myWorkPlans.some((wp) => wp.subject_id === s.subject_code || wp.subject_name?.toLowerCase() === s.subject_name?.toLowerCase()))
  const activeSchemes = linkedSchemes.length > 0 ? linkedSchemes : subjectSchemes

  const totalSyllabusObjectives = activeSchemes.reduce((acc, s) => acc + (s.objectives_count || 0), 0)
  const totalCovered = coveredObjectivesMap.size
  const overallCoveragePct = totalSyllabusObjectives > 0
    ? Math.min(100, Math.round((totalCovered / totalSyllabusObjectives) * 100))
    : (totalCovered > 0 ? 100 : 0)

  // Status badge styling
  let statusBadgeColor = '#ef4444' // red
  let statusLabel = 'Getting Started'
  if (overallCoveragePct >= 75) {
    statusBadgeColor = '#10b981' // green
    statusLabel = 'On Track'
  } else if (overallCoveragePct >= 40) {
    statusBadgeColor = '#f59e0b' // yellow
    statusLabel = 'In Progress'
  }

  return (
    <div
      className="card"
      style={{
        padding: '16px 20px',
        marginBottom: 20,
        backgroundColor: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        ...style
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1e293b' }}>{title}</h3>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 9999,
              fontSize: 11,
              fontWeight: 600,
              backgroundColor: `${statusBadgeColor}15`,
              color: statusBadgeColor,
              border: `1px solid ${statusBadgeColor}40`
            }}
          >
            {statusLabel} ({overallCoveragePct}%)
          </span>
        </div>
        <div style={{ fontSize: 12, color: '#64748b' }}>
          <strong>{totalCovered}</strong> / {totalSyllabusObjectives || '—'} Objectives Covered
        </div>
      </div>

      {/* Progress Bar */}
      <div
        style={{
          width: '100%',
          height: 10,
          backgroundColor: '#f1f5f9',
          borderRadius: 9999,
          overflow: 'hidden',
          marginBottom: 14
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.max(4, overallCoveragePct)}%`,
            backgroundColor: overallCoveragePct >= 75 ? '#10b981' : overallCoveragePct >= 40 ? '#f59e0b' : '#3b82f6',
            borderRadius: 9999,
            transition: 'width 0.4s ease'
          }}
        />
      </div>

      {/* Scheme Breakdown */}
      {activeSchemes.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          {activeSchemes.map((scheme) => {
            const schemeObjs = scheme.objectives_count || 0
            return (
              <div
                key={scheme.id}
                style={{
                  padding: '8px 12px',
                  backgroundColor: '#f8fafc',
                  borderRadius: 6,
                  border: '1px solid #edf2f7',
                  fontSize: 12
                }}
              >
                <div style={{ fontWeight: 600, color: '#334155', marginBottom: 2 }}>{scheme.title || scheme.subject_name}</div>
                <div style={{ color: '#64748b', fontSize: 11 }}>
                  Framework: {scheme.framework} · Year: {scheme.year_group}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: '#475569' }}>
                  <span>Syllabus Objectives:</span>
                  <strong>{schemeObjs}</strong>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
          Work plans and lesson plans will automatically register syllabus objectives as they are prepared.
        </div>
      )}
    </div>
  )
}
