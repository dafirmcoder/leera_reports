import type {
  Assignment,
  ClassInfo,
  CurriculumObjective,
  CurriculumScheme,
  LessonPlan,
  Profile,
  Subject,
  TeacherScheduleSlot,
  WorkPlan
} from './types'
import { findMatchingLessonPlan, isPastLessonSlot } from '../pages/Planning'

// ── Date Helpers ────────────────────────────────────────────────────────────

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

// ── Types ───────────────────────────────────────────────────────────────────

export type ComplianceTier = 'high' | 'moderate' | 'at_risk'

export interface TeacherComplianceStats {
  teacherId: string
  teacherName: string
  email: string
  role: string
  isCoordinator: boolean
  assignedClasses: string[]
  assignedSubjects: string[]
  
  // Lesson plan compliance metrics
  totalScheduled: number
  totalPast: number
  plannedPast: number
  missedPast: number
  futurePlanned: number
  futureUnplanned: number
  totalPlanned: number
  compliancePct: number
  complianceTier: ComplianceTier // 'high' >= 80%, 'moderate' 50-79%, 'at_risk' < 50%

  // Status breakdown of created lesson plans
  statusCounts: {
    approved: number
    submitted: number
    draft: number
    returned: number
  }

  // Work plan coverage metrics
  workPlanCoverage: {
    totalWorkPlanObjectives: number
    coveredObjectives: number
    coveragePct: number
  }

  // Syllabus coverage metrics
  syllabusCoverage: {
    totalSyllabusObjectives: number
    coveredObjectives: number
    coveragePct: number
    workPlansCount: number
    schemesCount: number
  }
}

export interface ExecutivePlanningOverview {
  totalTeachers: number
  averageCompliancePct: number
  atRiskTeachersCount: number
  totalExpectedLessons: number
  totalPlannedLessons: number
  pendingApprovalsCount: number
  averageWorkPlanCoveragePct: number
  averageSyllabusCoveragePct: number
  teacherStats: TeacherComplianceStats[]
}

// ── Analytics Calculation ───────────────────────────────────────────────────

export function calculateTeacherComplianceAndCoverage(params: {
  profiles: Profile[]
  slots: TeacherScheduleSlot[]
  lessonPlans: LessonPlan[]
  workPlans: WorkPlan[]
  schemes: CurriculumScheme[]
  assignments: Assignment[]
  classes: ClassInfo[]
  subjects: Subject[]
}): ExecutivePlanningOverview {
  const {
    profiles,
    slots,
    lessonPlans,
    workPlans,
    schemes,
    assignments,
    classes,
    subjects
  } = params

  // Filter to teaching personnel (subject teachers, homeroom teachers, coordinators, or any profile with timetable/assignments/plans)
  const teacherProfiles = profiles.filter((p) => {
    if (p.role === 'subject_teacher' || p.role === 'homeroom_teacher' || p.role === 'curriculum_coordinator') return true
    if (Array.isArray(p.additional_roles) && p.additional_roles.some((r) => r === 'curriculum_coordinator' || r === 'subject_teacher' || r === 'homeroom_teacher')) return true
    const hasAssignments = assignments.some((a) => a.teacher_id === p.id)
    const hasSlots = slots.some((s) => s.teacher_id === p.id)
    const hasPlans = lessonPlans.some((lp) => lp.teacher_id === p.id) || workPlans.some((wp) => wp.teacher_id === p.id)
    return hasAssignments || hasSlots || hasPlans
  })

  const today = new Date()
  // Academic window: 4 weeks back to 5 weeks ahead (covers full active term)
  const windowStart = addDays(weekMondayOf(today), -28)
  const windowEnd = addDays(weekMondayOf(today), 35)

  const teacherStats: TeacherComplianceStats[] = teacherProfiles.map((teacher) => {
    const tid = teacher.id
    const teacherSlots = slots.filter((s) => s.teacher_id === tid)
    const teacherLessonPlans = lessonPlans.filter((lp) => lp.teacher_id === tid)
    const teacherWorkPlans = workPlans.filter((wp) => wp.teacher_id === tid)
    const teacherAssignments = assignments.filter((a) => a.teacher_id === tid)

    // Collect assigned classes and subjects
    const classIds = new Set<string>()
    const subjectIds = new Set<string>()

    teacherSlots.forEach((s) => {
      if (s.class_id) classIds.add(s.class_id)
      if (s.subject_id) subjectIds.add(s.subject_id)
    })
    teacherAssignments.forEach((a) => {
      if (a.class_id) classIds.add(a.class_id)
      if (a.subject_id) subjectIds.add(a.subject_id)
    })
    teacherLessonPlans.forEach((lp) => {
      if (lp.class_id) classIds.add(lp.class_id)
      if (lp.subject_id) subjectIds.add(lp.subject_id)
    })

    const assignedClassNames = Array.from(classIds)
      .map((cid) => classes.find((c) => c.id === cid)?.name)
      .filter(Boolean) as string[]

    const assignedSubjectNames = Array.from(subjectIds)
      .map((sid) => subjects.find((s) => s.id === sid)?.name)
      .filter(Boolean) as string[]

    // Calculate timetable slots vs plans in the academic window
    let totalScheduled = 0
    let totalPast = 0
    let plannedPast = 0
    let futurePlanned = 0
    let futureUnplanned = 0

    let cursor = new Date(windowStart)
    while (cursor <= windowEnd) {
      const jsDay = cursor.getDay()
      if (jsDay >= 1 && jsDay <= 5) {
        const slotDay = jsDay - 1
        const daySlots = teacherSlots.filter((s) => s.day_of_week === slotDay)
        const dateStr = toISO(cursor)

        for (const slot of daySlots) {
          totalScheduled++
          const matchingPlan = findMatchingLessonPlan(slot, dateStr, teacherLessonPlans)
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
    const totalPlanned = teacherLessonPlans.length

    // Compliance % calculation:
    // If there were past lessons, compliance is based on past delivery.
    // If no past lessons yet, compliance is 100% if they have planned, or 0% if nothing planned.
    let compliancePct = 0
    if (totalPast > 0) {
      compliancePct = Math.round((plannedPast / totalPast) * 100)
    } else if (totalScheduled > 0) {
      compliancePct = futurePlanned > 0 ? 100 : 0
    } else if (totalPlanned > 0) {
      compliancePct = 100
    }

    // Thresholds: High >= 80%, Moderate 50-79%, At Risk < 50%
    let complianceTier: ComplianceTier = 'high'
    if (compliancePct < 50) {
      complianceTier = 'at_risk'
    } else if (compliancePct < 80) {
      complianceTier = 'moderate'
    }

    // Status counts
    const statusCounts = {
      approved: 0,
      submitted: 0,
      draft: 0,
      returned: 0
    }
    teacherLessonPlans.forEach((lp) => {
      if (lp.status === 'approved') statusCounts.approved++
      else if (lp.status === 'submitted') statusCounts.submitted++
      else if (lp.status === 'draft') statusCounts.draft++
      else if (lp.status === 'returned') statusCounts.returned++
    })

    // ── Coverage Metrics Calculation ──────────────────────────────────────────
    // 1. Collect covered objectives from lesson plans
    const coveredObjectivesSet = new Set<string>()
    const coveredTextsSet = new Set<string>()
    teacherLessonPlans.forEach((lp) => {
      lp.objectives?.forEach((obj) => {
        if (obj.code_snapshot?.trim()) {
          coveredObjectivesSet.add(obj.code_snapshot.trim().toLowerCase())
        }
        if (obj.objective_id) {
          coveredObjectivesSet.add(obj.objective_id)
        }
        if (obj.text_snapshot?.trim() && obj.text_snapshot.trim().length > 5) {
          coveredTextsSet.add(obj.text_snapshot.trim().toLowerCase())
        }
      })
    })

    // 2. Collect objectives from Semester Work Plans
    let totalWorkPlanObjectives = 0
    let coveredWpObjectives = 0
    teacherWorkPlans.forEach((wp) => {
      wp.weeks?.forEach((w) => {
        w.objectives?.forEach((obj) => {
          totalWorkPlanObjectives++
          const normCode = (obj.code_snapshot || '').trim().toLowerCase()
          const normText = (obj.text_snapshot || '').trim().toLowerCase()
          const isCovered =
            obj.is_met ||
            (normCode && coveredObjectivesSet.has(normCode)) ||
            (obj.objective_id && coveredObjectivesSet.has(obj.objective_id)) ||
            (normText && normText.length > 5 && coveredTextsSet.has(normText))

          if (isCovered) {
            coveredWpObjectives++
            if (normCode) coveredObjectivesSet.add(normCode)
          }
        })
      })
    })

    const workPlanCoveragePct = totalWorkPlanObjectives > 0
      ? Math.min(100, Math.round((coveredWpObjectives / totalWorkPlanObjectives) * 100))
      : 0

    // 3. Full Syllabus / Schemes coverage
    let totalSyllabusObjectives = 0
    const teacherSchemes = schemes.filter((sc) => subjectIds.has(sc.subject_code) || teacherWorkPlans.some((wp) => wp.scheme_id === sc.id))
    teacherSchemes.forEach((sc) => {
      totalSyllabusObjectives += sc.objectives_count || 0
    })
    if (totalSyllabusObjectives === 0 && totalWorkPlanObjectives > 0) {
      totalSyllabusObjectives = totalWorkPlanObjectives
    }

    const coveredSyllabusObjectives = coveredWpObjectives > 0 ? coveredWpObjectives : coveredObjectivesSet.size
    const syllabusCoveragePct = totalSyllabusObjectives > 0
      ? Math.min(100, Math.round((coveredSyllabusObjectives / totalSyllabusObjectives) * 100))
      : 0

    const isCoordinator = teacher.role === 'curriculum_coordinator' ||
      (Array.isArray(teacher.additional_roles) && teacher.additional_roles.includes('curriculum_coordinator'))

    return {
      teacherId: tid,
      teacherName: teacher.full_name || teacher.email || 'Teacher',
      email: teacher.email,
      role: teacher.role,
      isCoordinator,
      assignedClasses: assignedClassNames,
      assignedSubjects: assignedSubjectNames,
      totalScheduled,
      totalPast,
      plannedPast,
      missedPast,
      futurePlanned,
      futureUnplanned,
      totalPlanned,
      compliancePct,
      complianceTier,
      statusCounts,
      workPlanCoverage: {
        totalWorkPlanObjectives,
        coveredObjectives: coveredWpObjectives,
        coveragePct: workPlanCoveragePct
      },
      syllabusCoverage: {
        totalSyllabusObjectives,
        coveredObjectives: coveredSyllabusObjectives,
        coveragePct: syllabusCoveragePct,
        workPlansCount: teacherWorkPlans.length,
        schemesCount: teacherSchemes.length
      }
    }
  })

  // Sort by compliance ascending so at-risk teachers (<50%) appear at the top
  teacherStats.sort((a, b) => a.compliancePct - b.compliancePct || a.teacherName.localeCompare(b.teacherName))

  // Global KPIs
  const totalTeachers = teacherStats.length
  const totalExpectedLessons = teacherStats.reduce((acc, t) => acc + t.totalPast, 0)
  const totalPlannedLessons = teacherStats.reduce((acc, t) => acc + t.plannedPast, 0)
  const atRiskTeachersCount = teacherStats.filter((t) => t.complianceTier === 'at_risk').length
  const averageCompliancePct = totalTeachers > 0
    ? Math.round(teacherStats.reduce((acc, t) => acc + t.compliancePct, 0) / totalTeachers)
    : 100
  const pendingApprovalsCount = teacherStats.reduce((acc, t) => acc + t.statusCounts.submitted, 0)
  const averageWorkPlanCoveragePct = totalTeachers > 0
    ? Math.round(teacherStats.reduce((acc, t) => acc + t.workPlanCoverage.coveragePct, 0) / totalTeachers)
    : 0
  const averageSyllabusCoveragePct = totalTeachers > 0
    ? Math.round(teacherStats.reduce((acc, t) => acc + t.syllabusCoverage.coveragePct, 0) / totalTeachers)
    : 0

  return {
    totalTeachers,
    averageCompliancePct,
    atRiskTeachersCount,
    totalExpectedLessons,
    totalPlannedLessons,
    pendingApprovalsCount,
    averageWorkPlanCoveragePct,
    averageSyllabusCoveragePct,
    teacherStats
  }
}
