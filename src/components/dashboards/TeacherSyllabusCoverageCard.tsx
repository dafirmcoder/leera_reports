import React, { useState } from 'react'
import type { CurriculumScheme, LessonPlan, WorkPlan } from '../../lib/types'
import { subjectNamesMatch } from '../../lib/api.supabase'

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
  title = '🎯 Curriculum & Syllabus Coverage',
  style
}: Props) {
  const [showBreakdown, setShowBreakdown] = useState(true)

  // Filter to this teacher's plans if teacherId is provided
  const myWorkPlans = teacherId ? workPlans.filter((wp) => wp.teacher_id === teacherId) : workPlans
  const myLessonPlans = teacherId ? lessonPlans.filter((lp) => lp.teacher_id === teacherId) : lessonPlans

  // Collect all unique objectives used in lesson plans
  const lessonPlanCoveredCodes = new Set<string>()
  const lessonPlanCoveredIds = new Set<string>()
  const lessonPlanCoveredTexts = new Set<string>()

  myLessonPlans.forEach((lp) => {
    (lp.objectives || []).forEach((obj) => {
      if (obj.code_snapshot?.trim()) {
        lessonPlanCoveredCodes.add(obj.code_snapshot.trim().toLowerCase())
      }
      if (obj.objective_id) {
        lessonPlanCoveredIds.add(obj.objective_id)
      }
      if (obj.text_snapshot?.trim()) {
        lessonPlanCoveredTexts.add(obj.text_snapshot.trim().toLowerCase())
      }
    })
  })

  // 1. SEMESTER WORK PLAN METRICS
  let totalWpObjectives = 0
  let coveredWpObjectives = 0
  const uniqueCoveredCodes = new Set<string>()

  myWorkPlans.forEach((wp) => {
    (wp.weeks || []).forEach((w) => {
      (w.objectives || []).forEach((obj) => {
        totalWpObjectives++
        const normCode = (obj.code_snapshot || '').trim().toLowerCase()
        const normText = (obj.text_snapshot || '').trim().toLowerCase()
        const isCoveredByLp =
          (normCode && lessonPlanCoveredCodes.has(normCode)) ||
          (obj.objective_id && lessonPlanCoveredIds.has(obj.objective_id)) ||
          (normText && normText.length > 5 && lessonPlanCoveredTexts.has(normText))

        if (obj.is_met || isCoveredByLp) {
          coveredWpObjectives++
          if (normCode) uniqueCoveredCodes.add(normCode)
        }
      })
    })
  })

  const wpCoveragePct = totalWpObjectives > 0
    ? Math.min(100, Math.round((coveredWpObjectives / totalWpObjectives) * 100))
    : 0

  // 2. FULL SYLLABUS / CURRICULUM METRICS (only count authentic uploaded syllabuses, not auto-generated General placeholders)
  const validSchemes = (schemes || []).filter((s) => s.year_group !== 'General' && (s.objectives_count || 0) > 0)
  const linkedSchemes = validSchemes.filter((s) => myWorkPlans.some((wp) => wp.scheme_id === s.id))
  const subjectSchemes = validSchemes.filter((s) =>
    myWorkPlans.some((wp) => wp.subject_id === s.subject_code || (wp.subject_name && subjectNamesMatch(wp.subject_name, s.subject_name)))
  )
  const activeSchemes = linkedSchemes.length > 0 ? linkedSchemes : subjectSchemes
  const hasSyllabus = activeSchemes.length > 0

  const totalSyllabusObjectives = hasSyllabus ? activeSchemes.reduce((acc, s) => acc + (s.objectives_count || 0), 0) : 0

  const totalSyllabusCovered = coveredWpObjectives > 0
    ? coveredWpObjectives
    : new Set([...uniqueCoveredCodes, ...lessonPlanCoveredCodes]).size

  const syllabusCoveragePct = hasSyllabus && totalSyllabusObjectives > 0
    ? Math.min(100, Math.round((totalSyllabusCovered / totalSyllabusObjectives) * 100))
    : 0

  // Status badge styling
  const getBadgeStyle = (pct: number) => {
    if (pct >= 75) return { bg: '#dcfce7', text: '#15803d', label: 'On Track' }
    if (pct >= 40) return { bg: '#fef3c7', text: '#b45309', label: 'In Progress' }
    return { bg: '#fee2e2', text: '#b91c1c', label: 'Getting Started' }
  }

  const wpStatus = getBadgeStyle(wpCoveragePct)
  const sylStatus = getBadgeStyle(syllabusCoveragePct)

  // Subject-level breakdown
  const subjectBreakdown = myWorkPlans.map((wp) => {
    const wpObjs = (wp.weeks || []).flatMap((w) => w.objectives || [])
    const totalObjs = wpObjs.length
    const coveredCount = wpObjs.filter((obj) => {
      const normCode = (obj.code_snapshot || '').trim().toLowerCase()
      const normText = (obj.text_snapshot || '').trim().toLowerCase()
      const isCoveredByLp =
        (normCode && lessonPlanCoveredCodes.has(normCode)) ||
        (obj.objective_id && lessonPlanCoveredIds.has(obj.objective_id)) ||
        (normText && normText.length > 5 && lessonPlanCoveredTexts.has(normText))
      return obj.is_met || isCoveredByLp
    }).length
    const thisWpPct = totalObjs > 0 ? Math.min(100, Math.round((coveredCount / totalObjs) * 100)) : 0

    const matchingScheme = validSchemes.find(
      (s) => (wp.scheme_id && s.id === wp.scheme_id) ||
        (s.subject_code && wp.subject_id && s.subject_code === wp.subject_id) ||
        (s.subject_name && wp.subject_name && subjectNamesMatch(s.subject_name, wp.subject_name))
    )
    const hasItemSyllabus = Boolean(matchingScheme && (matchingScheme.objectives_count || 0) > 0)
    const schemeObjsCount = hasItemSyllabus ? matchingScheme!.objectives_count! : 0
    const thisSylPct = schemeObjsCount > 0 ? Math.min(100, Math.round((coveredCount / schemeObjsCount) * 100)) : 0

    return {
      id: wp.id,
      title: `${wp.subject_name || 'Subject'} — ${wp.class_name || 'Class'}`,
      schemeTitle: hasItemSyllabus ? `${matchingScheme!.title} (${matchingScheme!.year_group})` : 'No Syllabus Linked',
      hasSyllabus: hasItemSyllabus,
      wpTotal: totalObjs,
      wpCovered: coveredCount,
      wpPct: thisWpPct,
      sylTotal: schemeObjsCount,
      sylCovered: coveredCount,
      sylPct: thisSylPct
    }
  })

  return (
    <div
      className="card"
      style={{
        padding: '18px 20px',
        marginBottom: 20,
        backgroundColor: '#ffffff',
        border: '1.5px solid #cbd5e1',
        borderRadius: 10,
        boxShadow: '0 1px 4px rgba(15, 23, 42, 0.06)',
        ...style
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{title}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>
              (Dual Tracking: Semester Work Plan &amp; Cambridge Syllabus)
            </span>
          </h3>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
            Objectives are automatically marked as <strong>Covered</strong> once used in scheduled lesson plans.
          </div>
        </div>

        <button
          type="button"
          className="btn btn-ghost btn-small"
          style={{ fontSize: 12, padding: '4px 10px', color: '#475569' }}
          onClick={() => setShowBreakdown(!showBreakdown)}
        >
          {showBreakdown ? '▲ Hide Subject Breakdown' : '▼ View Subject Breakdown'}
        </button>
      </div>

      {/* 2-Column Dual Coverage Progress Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 16 }}>
        {/* Metric 1: Semester Work Plan Coverage */}
        <div
          style={{
            padding: '14px 16px',
            backgroundColor: '#f8fafc',
            border: '1.5px solid #e2e8f0',
            borderRadius: 8,
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#0f766e', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                1. Semester Work Plan Coverage
              </span>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
                {coveredWpObjectives} <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>/ {totalWpObjectives || 0} Objectives</span>
              </div>
            </div>
            <span
              style={{
                padding: '3px 8px',
                borderRadius: 9999,
                fontSize: 11,
                fontWeight: 700,
                backgroundColor: wpStatus.bg,
                color: wpStatus.text
              }}
            >
              {wpCoveragePct}% ({wpStatus.label})
            </span>
          </div>

          {/* Progress Bar */}
          <div style={{ width: '100%', height: 8, backgroundColor: '#e2e8f0', borderRadius: 9999, overflow: 'hidden', marginBottom: 6 }}>
            <div
              style={{
                height: '100%',
                width: `${Math.max(3, wpCoveragePct)}%`,
                backgroundColor: '#0f766e',
                borderRadius: 9999,
                transition: 'width 0.4s ease'
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            Objectives taught vs. planned targets in current semester work plans.
          </div>
        </div>

        {/* Metric 2: Full Cambridge Syllabus Coverage */}
        <div
          style={{
            padding: '14px 16px',
            backgroundColor: '#f8fafc',
            border: '1.5px solid #e2e8f0',
            borderRadius: 8,
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div>
              <span style={{ fontSize: 11, fontWeight: 800, color: hasSyllabus ? '#4C2570' : '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                2. Full Syllabus Coverage
              </span>
              {hasSyllabus ? (
                <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
                  {totalSyllabusCovered} <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>/ {totalSyllabusObjectives} Objectives</span>
                </div>
              ) : (
                <div style={{ fontSize: 15, fontWeight: 700, color: '#64748b', marginTop: 4 }}>
                  No Syllabus Uploaded
                </div>
              )}
            </div>
            {hasSyllabus ? (
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: 9999,
                  fontSize: 11,
                  fontWeight: 700,
                  backgroundColor: sylStatus.bg,
                  color: sylStatus.text
                }}
              >
                {syllabusCoveragePct}% ({sylStatus.label})
              </span>
            ) : (
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: 9999,
                  fontSize: 11,
                  fontWeight: 600,
                  backgroundColor: '#f1f5f9',
                  color: '#64748b'
                }}
              >
                Pending
              </span>
            )}
          </div>

          {/* Progress Bar */}
          <div style={{ width: '100%', height: 8, backgroundColor: '#e2e8f0', borderRadius: 9999, overflow: 'hidden', marginBottom: 6 }}>
            <div
              style={{
                height: '100%',
                width: hasSyllabus ? `${Math.max(3, syllabusCoveragePct)}%` : '0%',
                backgroundColor: '#4C2570',
                borderRadius: 9999,
                transition: 'width 0.4s ease'
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            {hasSyllabus
              ? 'Total curriculum syllabus objectives mastered across the full academic year.'
              : 'Upload official Cambridge syllabus in Curriculum Schemes to track full year coverage.'}
          </div>
        </div>
      </div>

      {/* Expandable Subject Breakdown */}
      {showBreakdown && subjectBreakdown.length > 0 && (
        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 10 }}>
            Subject &amp; Class Coverage Breakdown:
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
            {subjectBreakdown.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: '10px 14px',
                  backgroundColor: '#ffffff',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <strong style={{ fontSize: 13, color: '#0f172a' }}>{item.title}</strong>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#0f766e' }}>{item.wpPct}% WP</span>
                </div>
                <div style={{ fontSize: 11, color: item.hasSyllabus ? '#64748b' : '#94a3b8', marginBottom: 8 }}>
                  Framework: {item.schemeTitle}
                </div>

                {/* Micro Dual Bars */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, color: '#475569' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span>Semester Work Plan:</span>
                      <strong>{item.wpCovered} / {item.wpTotal} ({item.wpPct}%)</strong>
                    </div>
                    <div style={{ width: '100%', height: 5, backgroundColor: '#f1f5f9', borderRadius: 9999, overflow: 'hidden' }}>
                      <div style={{ width: `${item.wpPct}%`, height: '100%', backgroundColor: '#0f766e', borderRadius: 9999 }} />
                    </div>
                  </div>

                  {item.hasSyllabus ? (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span>Full Cambridge Syllabus:</span>
                        <strong>{item.sylCovered} / {item.sylTotal} ({item.sylPct}%)</strong>
                      </div>
                      <div style={{ width: '100%', height: 5, backgroundColor: '#f1f5f9', borderRadius: 9999, overflow: 'hidden' }}>
                        <div style={{ width: `${item.sylPct}%`, height: '100%', backgroundColor: '#4C2570', borderRadius: 9999 }} />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2, color: '#94a3b8' }}>
                        <span>Full Cambridge Syllabus:</span>
                        <span style={{ fontStyle: 'italic', fontSize: 10.5 }}>No Syllabus Uploaded</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
