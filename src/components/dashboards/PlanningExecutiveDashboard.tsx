import React, { useMemo, useState } from 'react'
import type {
  Assignment,
  ClassInfo,
  CurriculumScheme,
  LessonPlan,
  Profile,
  Subject,
  TeacherScheduleSlot,
  WorkPlan
} from '../../lib/types'
import {
  calculateTeacherComplianceAndCoverage,
  type ComplianceTier,
  type TeacherComplianceStats
} from '../../lib/planningAnalytics'

interface Props {
  profiles: Profile[]
  slots: TeacherScheduleSlot[]
  lessonPlans: LessonPlan[]
  workPlans: WorkPlan[]
  schemes: CurriculumScheme[]
  assignments: Assignment[]
  classes: ClassInfo[]
  subjects: Subject[]
  currentUserId?: string
  isDirector?: boolean
  isHeadOfSchool?: boolean
  isCoordinator?: boolean
  onPreviewLessonPlanPdf: (plan: LessonPlan) => void
  onApproveLessonPlan?: (planId: string) => Promise<void>
  onReturnLessonPlan?: (planId: string, comment: string) => Promise<void>
}

export default function PlanningExecutiveDashboard({
  profiles,
  slots,
  lessonPlans,
  workPlans,
  schemes,
  assignments,
  classes,
  subjects,
  currentUserId,
  isDirector,
  isHeadOfSchool,
  isCoordinator,
  onPreviewLessonPlanPdf,
  onApproveLessonPlan,
  onReturnLessonPlan
}: Props) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTier, setSelectedTier] = useState<'all' | ComplianceTier>('all')
  const [selectedRole, setSelectedRole] = useState<'all' | 'coordinator' | 'teacher'>('all')

  // Selected teacher for "View Lesson Plans" modal
  const [inspectingTeacher, setInspectingTeacher] = useState<TeacherComplianceStats | null>(null)
  const [inspectStatusFilter, setInspectStatusFilter] = useState<'all' | 'approved' | 'submitted' | 'draft' | 'returned'>('all')
  const [inspectComment, setInspectComment] = useState('')
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)

  // Calculate analytics
  const analytics = useMemo(() => {
    return calculateTeacherComplianceAndCoverage({
      profiles,
      slots,
      lessonPlans,
      workPlans,
      schemes,
      assignments,
      classes,
      subjects
    })
  }, [profiles, slots, lessonPlans, workPlans, schemes, assignments, classes, subjects])

  // Filtered teachers list
  const filteredTeachers = useMemo(() => {
    return analytics.teacherStats.filter((t) => {
      // Tier filter
      if (selectedTier !== 'all' && t.complianceTier !== selectedTier) return false

      // Role filter
      if (selectedRole === 'coordinator' && !t.isCoordinator) return false
      if (selectedRole === 'teacher' && t.isCoordinator) return false

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchesName = t.teacherName.toLowerCase().includes(q)
        const matchesEmail = t.email?.toLowerCase().includes(q)
        const matchesClass = t.assignedClasses.some((c) => c.toLowerCase().includes(q))
        const matchesSubject = t.assignedSubjects.some((s) => s.toLowerCase().includes(q))
        if (!matchesName && !matchesEmail && !matchesClass && !matchesSubject) return false
      }

      return true
    })
  }, [analytics.teacherStats, selectedTier, selectedRole, searchQuery])

  // Lesson plans for currently inspected teacher
  const teacherLessonPlans = useMemo(() => {
    if (!inspectingTeacher) return []
    let plans = lessonPlans.filter((lp) => lp.teacher_id === inspectingTeacher.teacherId)
    if (inspectStatusFilter !== 'all') {
      plans = plans.filter((lp) => lp.status === inspectStatusFilter)
    }
    // Sort descending by date
    return plans.sort((a, b) => new Date(b.lesson_date).getTime() - new Date(a.lesson_date).getTime())
  }, [inspectingTeacher, lessonPlans, inspectStatusFilter])

  // Helpers for tier badges
  const renderTierBadge = (tier: ComplianceTier, pct: number) => {
    if (tier === 'at_risk') {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            borderRadius: 9999,
            fontSize: 12,
            fontWeight: 700,
            backgroundColor: '#fee2e2',
            color: '#dc2626',
            border: '1px solid #fca5a5'
          }}
        >
          🔴 {pct}% (At Risk &lt;50%)
        </span>
      )
    }
    if (tier === 'moderate') {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            borderRadius: 9999,
            fontSize: 12,
            fontWeight: 700,
            backgroundColor: '#fef3c7',
            color: '#b45309',
            border: '1px solid #fcd34d'
          }}
        >
          🟡 {pct}% (Moderate 50-79%)
        </span>
      )
    }
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 8px',
          borderRadius: 9999,
          fontSize: 12,
          fontWeight: 700,
          backgroundColor: '#d1fae5',
          color: '#059669',
          border: '1px solid #6ee7b7'
        }}
      >
        🟢 {pct}% (Compliant ≥80%)
      </span>
    )
  }

  return (
    <div>
      {/* ── 1. EXECUTIVE KPI SUMMARY CARDS ─────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
        {/* Overall Compliance */}
        <div className="card" style={{ padding: '14px 18px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
            Overall Compliance
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: analytics.averageCompliancePct >= 80 ? '#10b981' : analytics.averageCompliancePct >= 50 ? '#f59e0b' : '#ef4444' }}>
              {analytics.averageCompliancePct}%
            </span>
            <span style={{ fontSize: 12, color: '#64748b' }}>school average</span>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>
            {analytics.totalPlannedLessons} planned of {analytics.totalExpectedLessons} expected
          </div>
        </div>

        {/* At Risk Teachers */}
        <div className="card" style={{ padding: '14px 18px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
            At Risk (&lt;50% Compliance)
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: analytics.atRiskTeachersCount > 0 ? '#ef4444' : '#10b981' }}>
              {analytics.atRiskTeachersCount}
            </span>
            <span style={{ fontSize: 12, color: '#64748b' }}>of {analytics.totalTeachers} teachers</span>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: analytics.atRiskTeachersCount > 0 ? '#dc2626' : '#059669' }}>
            {analytics.atRiskTeachersCount > 0 ? 'Requires immediate leadership follow-up' : 'All teachers ≥50% compliant'}
          </div>
        </div>

        {/* Syllabus Coverage */}
        <div className="card" style={{ padding: '14px 18px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
            Syllabus Coverage
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: '#0284c7' }}>
              {analytics.averageSyllabusCoveragePct}%
            </span>
            <span style={{ fontSize: 12, color: '#64748b' }}>average coverage</span>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: '#64748b' }}>
            Based on active Cambridge curriculum schemes
          </div>
        </div>

        {/* Pending Approvals */}
        <div className="card" style={{ padding: '14px 18px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
            Pending Review
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: analytics.pendingApprovalsCount > 0 ? '#f59e0b' : '#64748b' }}>
              {analytics.pendingApprovalsCount}
            </span>
            <span style={{ fontSize: 12, color: '#64748b' }}>submitted plans</span>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: '#64748b' }}>
            Awaiting Coordinator / HOS sign-off
          </div>
        </div>
      </div>

      {/* ── 2. FILTER & SEARCH CONTROLS ────────────────────────────────────── */}
      <div
        className="card"
        style={{
          padding: '12px 18px',
          marginBottom: 16,
          backgroundColor: '#ffffff',
          border: '1.5px solid #cbd5e1',
          borderRadius: 10,
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flex: 1, minWidth: 260 }}>
          <input
            type="text"
            placeholder="🔍 Search teacher, subject, class..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: '9px 14px',
              borderRadius: 8,
              border: '1.5px solid #94a3b8',
              fontSize: 13.5,
              fontWeight: 500,
              color: '#0f172a',
              backgroundColor: '#ffffff',
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.05)',
              minWidth: 260,
              flex: 1
            }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* Tier Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, color: '#0f172a', fontWeight: 700 }}>Compliance:</span>
            <select
              value={selectedTier}
              onChange={(e) => setSelectedTier(e.target.value as any)}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1.5px solid #94a3b8',
                fontSize: 13,
                fontWeight: 600,
                color: '#0f172a',
                backgroundColor: '#ffffff',
                boxShadow: '0 1px 2px rgba(15, 23, 42, 0.05)',
                cursor: 'pointer'
              }}
            >
              <option value="all">All Tiers ({analytics.totalTeachers})</option>
              <option value="at_risk">🔴 At Risk (&lt;50%) ({analytics.atRiskTeachersCount})</option>
              <option value="moderate">🟡 Moderate (50-79%)</option>
              <option value="high">🟢 High (≥80%)</option>
            </select>
          </div>

          {/* Role Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, color: '#0f172a', fontWeight: 700 }}>Role:</span>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as any)}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1.5px solid #94a3b8',
                fontSize: 13,
                fontWeight: 600,
                color: '#0f172a',
                backgroundColor: '#ffffff',
                boxShadow: '0 1px 2px rgba(15, 23, 42, 0.05)',
                cursor: 'pointer'
              }}
            >
              <option value="all">All Staff</option>
              <option value="coordinator">Curriculum Coordinators</option>
              <option value="teacher">Subject &amp; Homeroom Teachers</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── 3. TEACHER COMPLIANCE & COVERAGE TABLE ──────────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #e2e8f0', borderRadius: 8, backgroundColor: '#ffffff' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1e293b' }}>
            Teacher Lesson Plan Compliance &amp; Syllabus Coverage ({filteredTeachers.length})
          </h3>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            Window: 4 weeks past to 5 weeks ahead
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                <th style={{ padding: '10px 14px' }}>Teacher</th>
                <th style={{ padding: '10px 14px' }}>Scope / Subjects</th>
                <th style={{ padding: '10px 14px', textAlign: 'center' }}>Expected (Past)</th>
                <th style={{ padding: '10px 14px', textAlign: 'center' }}>Planned (Past)</th>
                <th style={{ padding: '10px 14px', textAlign: 'center' }}>Compliance %</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', minWidth: 140 }}>Syllabus Coverage</th>
                <th style={{ padding: '10px 14px', textAlign: 'center' }}>Plan Statuses</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTeachers.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '28px', textAlign: 'center', color: '#94a3b8' }}>
                    No teachers found matching the selected filters.
                  </td>
                </tr>
              ) : (
                filteredTeachers.map((t) => {
                  const isCurrent = t.teacherId === currentUserId
                  return (
                    <tr
                      key={t.teacherId}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        backgroundColor: t.complianceTier === 'at_risk' ? '#fff5f5' : isCurrent ? '#f0fdf4' : 'transparent',
                        transition: 'background-color 0.15s ease'
                      }}
                    >
                      {/* Teacher name & role */}
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ fontWeight: 600, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {t.teacherName}
                          {isCurrent && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, backgroundColor: '#bbf7d0', color: '#166534' }}>You</span>}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                          {t.isCoordinator && (
                            <span style={{ padding: '1px 5px', borderRadius: 4, backgroundColor: '#ede9fe', color: '#6d28d9', fontSize: 10, fontWeight: 600 }}>
                              Coordinator
                            </span>
                          )}
                          <span>{t.email}</span>
                        </div>
                      </td>

                      {/* Scope: Classes and Subjects */}
                      <td style={{ padding: '10px 14px', maxWidth: 180 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {t.assignedSubjects.length > 0 ? t.assignedSubjects.join(', ') : 'No subjects'}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                          {t.assignedClasses.length > 0 ? t.assignedClasses.join(', ') : 'No classes'}
                        </div>
                      </td>

                      {/* Expected past lessons */}
                      <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: '#475569' }}>
                        {t.totalPast}
                      </td>

                      {/* Planned past lessons */}
                      <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: t.missedPast > 0 ? '#dc2626' : '#059669' }}>
                        {t.plannedPast}
                        {t.missedPast > 0 && (
                          <div style={{ fontSize: 10, color: '#ef4444', fontWeight: 500 }}>
                            ({t.missedPast} missed)
                          </div>
                        )}
                      </td>

                      {/* Compliance % Badge */}
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        {renderTierBadge(t.complianceTier, t.compliancePct)}
                      </td>

                      {/* Syllabus Coverage Bar */}
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                          <span style={{ fontWeight: 600, color: '#334155' }}>{t.syllabusCoverage.coveragePct}%</span>
                          <span style={{ color: '#64748b' }}>
                            {t.syllabusCoverage.coveredObjectives} / {t.syllabusCoverage.totalSyllabusObjectives || '—'}
                          </span>
                        </div>
                        <div style={{ width: '100%', height: 6, backgroundColor: '#e2e8f0', borderRadius: 9999, overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${Math.max(4, t.syllabusCoverage.coveragePct)}%`,
                              height: '100%',
                              backgroundColor: t.syllabusCoverage.coveragePct >= 75 ? '#10b981' : t.syllabusCoverage.coveragePct >= 40 ? '#f59e0b' : '#3b82f6',
                              borderRadius: 9999
                            }}
                          />
                        </div>
                      </td>

                      {/* Plan Status Badges */}
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: 4, flexWrap: 'wrap' }}>
                          {t.statusCounts.approved > 0 && (
                            <span style={{ padding: '1px 5px', borderRadius: 4, backgroundColor: '#dcfce7', color: '#15803d', fontSize: 10, fontWeight: 600 }} title="Approved">
                              ✓ {t.statusCounts.approved}
                            </span>
                          )}
                          {t.statusCounts.submitted > 0 && (
                            <span style={{ padding: '1px 5px', borderRadius: 4, backgroundColor: '#fef3c7', color: '#b45309', fontSize: 10, fontWeight: 600 }} title="Submitted / Pending">
                              ⏳ {t.statusCounts.submitted}
                            </span>
                          )}
                          {t.statusCounts.draft > 0 && (
                            <span style={{ padding: '1px 5px', borderRadius: 4, backgroundColor: '#f1f5f9', color: '#475569', fontSize: 10, fontWeight: 500 }} title="Draft">
                              📝 {t.statusCounts.draft}
                            </span>
                          )}
                          {t.statusCounts.returned > 0 && (
                            <span style={{ padding: '1px 5px', borderRadius: 4, backgroundColor: '#fee2e2', color: '#b91c1c', fontSize: 10, fontWeight: 600 }} title="Returned">
                              ↩ {t.statusCounts.returned}
                            </span>
                          )}
                          {t.totalPlanned === 0 && (
                            <span style={{ fontSize: 11, color: '#94a3b8' }}>None</span>
                          )}
                        </div>
                      </td>

                      {/* Action: View Lesson Plans */}
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                        <button
                          className="btn btn-secondary btn-small"
                          onClick={() => setInspectingTeacher(t)}
                          style={{ padding: '4px 10px', fontSize: 12, fontWeight: 600 }}
                        >
                          📖 View Lesson Plans
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 4. "VIEW LESSON PLANS" INSPECTION MODAL ────────────────────────── */}
      {inspectingTeacher && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 900,
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#ffffff',
              borderRadius: 12,
              padding: 0,
              overflow: 'hidden',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
            }}
          >
            {/* Modal Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0f172a' }}>
                  Lesson Plans: {inspectingTeacher.teacherName}
                </h3>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  {inspectingTeacher.assignedSubjects.join(', ')} · {inspectingTeacher.assignedClasses.join(', ')}
                  {' · '}
                  Compliance: <strong>{inspectingTeacher.compliancePct}%</strong>
                </div>
              </div>
              <button
                className="btn btn-ghost btn-small"
                onClick={() => setInspectingTeacher(null)}
                style={{ fontSize: 18, lineHeight: 1, padding: '4px 8px' }}
              >
                ✕
              </button>
            </div>

            {/* Filter Bar in Modal */}
            <div style={{ padding: '10px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Filter Status:</span>
              {(['all', 'submitted', 'approved', 'draft', 'returned'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setInspectStatusFilter(st)}
                  style={{
                    padding: '3px 9px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: inspectStatusFilter === st ? 700 : 500,
                    backgroundColor: inspectStatusFilter === st ? '#1e293b' : '#ffffff',
                    color: inspectStatusFilter === st ? '#ffffff' : '#475569',
                    border: '1px solid #cbd5e1',
                    cursor: 'pointer',
                    textTransform: 'capitalize'
                  }}
                >
                  {st === 'all' ? `All (${lessonPlans.filter((lp) => lp.teacher_id === inspectingTeacher.teacherId).length})` : st}
                </button>
              ))}
            </div>

            {/* Lesson Plans List in Modal */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
              {teacherLessonPlans.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
                  No lesson plans found for this filter.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {teacherLessonPlans.map((lp) => {
                    const isPending = lp.status === 'submitted'
                    const isActioning = actionLoadingId === lp.id

                    return (
                      <div
                        key={lp.id}
                        style={{
                          padding: '14px 16px',
                          borderRadius: 8,
                          border: '1px solid #e2e8f0',
                          backgroundColor: '#f8fafc',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          gap: 12,
                          flexWrap: 'wrap'
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 260 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                              {new Date(lp.lesson_date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                            {lp.start_time && lp.end_time && (
                              <span style={{ fontSize: 11, color: '#64748b' }}>({lp.start_time} – {lp.end_time})</span>
                            )}
                            <span
                              style={{
                                padding: '1px 6px',
                                borderRadius: 4,
                                fontSize: 10,
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                backgroundColor:
                                  lp.status === 'approved' ? '#dcfce7' :
                                  lp.status === 'submitted' ? '#fef3c7' :
                                  lp.status === 'returned' ? '#fee2e2' : '#e2e8f0',
                                color:
                                  lp.status === 'approved' ? '#15803d' :
                                  lp.status === 'submitted' ? '#b45309' :
                                  lp.status === 'returned' ? '#b91c1c' : '#475569'
                              }}
                            >
                              {lp.status}
                            </span>
                          </div>

                          <div style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
                            {lp.subject_name || 'Subject'} · {lp.class_name || 'Class'}
                          </div>

                          <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                            {lp.challenge_title ? <strong>{lp.challenge_title} — </strong> : null}
                            {lp.topic_title || 'Untitled Topic'}
                          </div>

                          {lp.objectives && lp.objectives.length > 0 && (
                            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                              🎯 {lp.objectives.length} objectives: {lp.objectives.map((o) => o.code_snapshot).filter(Boolean).join(', ')}
                            </div>
                          )}

                          {lp.review_comment && (
                            <div style={{ marginTop: 6, padding: '4px 8px', borderRadius: 4, backgroundColor: '#f1f5f9', fontSize: 11, color: '#334155', borderLeft: '3px solid #64748b' }}>
                              <strong>Feedback:</strong> {lp.review_comment}
                            </div>
                          )}
                        </div>

                        {/* Actions for this Lesson Plan */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                          <button
                            className="btn btn-secondary btn-small"
                            onClick={() => onPreviewLessonPlanPdf(lp)}
                            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}
                          >
                            📄 Preview PDF
                          </button>

                          {/* Leadership Review Actions for Pending Plans */}
                          {isPending && (isDirector || isHeadOfSchool || isCoordinator) && (
                            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                              {onApproveLessonPlan && (
                                <button
                                  className="btn btn-primary btn-small"
                                  disabled={isActioning}
                                  onClick={async () => {
                                    setActionLoadingId(lp.id)
                                    try {
                                      await onApproveLessonPlan(lp.id)
                                    } finally {
                                      setActionLoadingId(null)
                                    }
                                  }}
                                  style={{ backgroundColor: '#10b981', borderColor: '#10b981', fontSize: 11, padding: '3px 8px' }}
                                >
                                  ✓ Approve
                                </button>
                              )}
                              {onReturnLessonPlan && (
                                <button
                                  className="btn btn-ghost btn-small"
                                  disabled={isActioning}
                                  onClick={async () => {
                                    const comment = prompt('Enter return reason / revision notes for teacher:', 'Please revise learning activities and objectives.')
                                    if (comment === null) return
                                    setActionLoadingId(lp.id)
                                    try {
                                      await onReturnLessonPlan(lp.id, comment)
                                    } finally {
                                      setActionLoadingId(null)
                                    }
                                  }}
                                  style={{ color: '#ef4444', fontSize: 11, padding: '3px 8px' }}
                                >
                                  ↩ Return
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', backgroundColor: '#f8fafc' }}>
              <button className="btn btn-secondary" onClick={() => setInspectingTeacher(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
