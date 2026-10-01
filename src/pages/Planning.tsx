import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSchool } from '../context/SchoolContext'
import { api } from '../lib/api'
import { can } from '../lib/permissions'
import { parseSyllabusPdf, type ExtractedSyllabus } from '../lib/syllabusPdfParser'
import { parseWorkPlanPdf, type WorkPlanParseProgress } from '../lib/workPlanPdfParser'
import { parseTeacherTimetablePdf } from '../lib/timetablePdfParser'
import { generateLessonPlanPdf, generateWorkPlanPdf } from '../lib/planningPdf'
import {
  isLessonTimeInPast,
  type Assignment,
  type ClassInfo,
  type CurriculumObjective,
  type CurriculumScheme,
  type CurriculumTopic,
  type LessonPlan,
  type Profile,
  type Subject,
  type TeacherScheduleSlot,
  type WorkPlan,
  type WorkPlanWeek,
  type ParsedWorkPlan,
  type ParsedWorkPlanWeek
} from '../lib/types'
import PlanningExecutiveDashboard from '../components/dashboards/PlanningExecutiveDashboard'
import TeacherSyllabusCoverageCard from '../components/dashboards/TeacherSyllabusCoverageCard'
import { AiStageButton } from '../components/AiStageButton'
import { GeminiApiKeyModal } from '../components/GeminiApiKeyModal'
import {
  generateAllStages,
  hasGeminiApiKey,
  type LessonContext
} from '../lib/gemini'

type PlanningSubTab = 'executive' | 'work_plans' | 'lesson_plans' | 'timetable' | 'curriculum' | 'review'

const DAYS_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function getMondayOfDate(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  const diff = date.getDate() - day + (day === 0 ? -6 : 1)
  date.setDate(diff)
  date.setHours(0, 0, 0, 0)
  return date
}

export function formatDateISO(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isPastLessonSlot(dateStr: string, startTime?: string | null, endTime?: string | null): boolean {
  if (!dateStr) return false
  const now = new Date()
  const todayStr = formatDateISO(now)

  // Planning closes at end of day: only strictly previous calendar dates are blocked.
  // Today's lessons remain open for planning regardless of the current clock time.
  // startTime / endTime are accepted for backward compatibility but not used for the gate.
  void startTime; void endTime
  return dateStr < todayStr
}

export function normalizeTimeString(t?: string | null): string {
  if (!t) return ''
  const trimmed = t.trim()
  const parts = trimmed.split(':')
  if (parts.length >= 2) {
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`
  }
  return trimmed
}

export function findMatchingLessonPlan(
  slot: TeacherScheduleSlot,
  dateStr: string,
  plans: LessonPlan[]
): LessonPlan | undefined {
  return plans.find((lp) => {
    if (lp.lesson_date !== dateStr) return false

    // Direct schedule slot match
    if (slot.id && lp.schedule_slot_id && slot.id === lp.schedule_slot_id) {
      return true
    }

    const classMatches =
      (slot.class_id && lp.class_id === slot.class_id) ||
      (slot.class_name && lp.class_name && slot.class_name.toLowerCase().trim() === lp.class_name.toLowerCase().trim())

    const subjectMatches =
      (slot.subject_id && lp.subject_id === slot.subject_id) ||
      (slot.subject_name && lp.subject_name && slot.subject_name.toLowerCase().trim() === lp.subject_name.toLowerCase().trim())

    if (!classMatches || !subjectMatches) return false

    if (slot.start_time && lp.start_time) {
      return normalizeTimeString(slot.start_time) === normalizeTimeString(lp.start_time)
    }

    return true
  })
}

export interface TeachingActivityStages {
  starter: string
  exposition: string
  learnersActivity: string
  plenary: string
}

export function parseActivityStages(rawText?: string | null): TeachingActivityStages {
  if (!rawText) return { starter: '', exposition: '', learnersActivity: '', plenary: '' }

  let starter = ''
  let exposition = ''
  let learnersActivity = ''
  let plenary = ''

  const stageRegex = /(?:^|\n)\s*(?:•\s*)?(Starter(?:\s*Activity)?(?:\s*\([^)]*\))?:?|Exposition(?:\s*(?:Methods|methods)?(?:\s*\([^)]*\))?)?:?|Learner(?:s)?\s*(?:Activity|activity)?(?:\s*\([^)]*\))?:?|Plenary(?:\s*\([^)]*\))?:?|Main\s*Activity:?)/gi
  const matches = [...rawText.matchAll(stageRegex)]

  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]
      const title = match[1].toLowerCase()
      const startIndex = match.index! + match[0].length
      const endIndex = i + 1 < matches.length ? matches[i + 1].index! : rawText.length
      const body = rawText.slice(startIndex, endIndex).trim().replace(/^[-—:\s]+/, '')

      if (title.includes('starter')) {
        starter = body.replace(/^(?:\(\d+\s*min(?:s)?\)[:-\s]*)/i, '')
      } else if (title.includes('exposition') || title.includes('main activity')) {
        exposition = body.replace(/^(?:\(\d+\s*min(?:s)?\)[:-\s]*)/i, '')
      } else if (title.includes('learner')) {
        learnersActivity = body.replace(/^(?:\(\d+\s*min(?:s)?\)[:-\s]*)/i, '')
      } else if (title.includes('plenary')) {
        plenary = body.replace(/^(?:\(\d+\s*min(?:s)?\)[:-\s]*)/i, '')
      }
    }
  } else {
    learnersActivity = rawText.trim()
  }

  return { starter, exposition, learnersActivity, plenary }
}

export function formatActivityStages(stages: TeachingActivityStages): string {
  const hasAny = stages.starter.trim() || stages.exposition.trim() || stages.learnersActivity.trim() || stages.plenary.trim()
  if (!hasAny) return ''

  const starter = stages.starter.trim() || 'Inquiry discussion, recap of prior knowledge, and introduction of the lesson inquiry question.'
  const exposition = stages.exposition.trim() || 'Direct instruction, concept explanation, key vocabulary, and guided teacher demonstration.'
  const learnersActivity = stages.learnersActivity.trim() || 'Differentiated student tasks, collaborative problem-solving, and practical application exercises.'
  const plenary = stages.plenary.trim() || 'Exit ticket — review key learning objectives, student self-reflection, and preview next session.'

  return [
    `Starter: ${starter}`,
    `Exposition: ${exposition}`,
    `Learners Activity: ${learnersActivity}`,
    `Plenary: ${plenary}`
  ].join('\n\n')
}

export interface PredictedObjectiveItem {
  id?: string
  objective_id?: string | null
  code_snapshot: string
  text_snapshot: string
  is_met?: boolean
  week_sequence: number
  week_topic?: string | null
  week_challenge?: string | null
  week_label?: string | null
  is_already_planned?: boolean
}

export interface SmartPredictionResult {
  predictedObjectives: PredictedObjectiveItem[]
  reason: 'date_matched_week' | 'earliest_unplanned_week' | 'unmet_fallback' | 'all_covered'
  weekSequence?: number
  weekTopic?: string
  weekChallenge?: string
}

export function predictNextUnusedObjectives(
  workPlan: WorkPlan | null,
  existingLessonPlans: LessonPlan[],
  classId: string,
  subjectId: string,
  targetDate?: string,
  currentLessonPlanId?: string
): SmartPredictionResult {
  if (!workPlan || !workPlan.weeks || workPlan.weeks.length === 0) {
    return { predictedObjectives: [], reason: 'all_covered' }
  }

  // Set of codes already planned in other lesson plans for this class and subject
  const plannedCodes = new Set(
    existingLessonPlans
      .filter((lp) => lp.class_id === classId && lp.subject_id === subjectId && lp.id !== currentLessonPlanId)
      .flatMap((lp) => (lp.objectives || []).map((o) => o.code_snapshot))
  )

  const sortedWeeks = [...workPlan.weeks].sort((a, b) => a.sequence - b.sequence)

  // 1. Try date-matching: check if targetDate falls into a week's start_date and end_date
  if (targetDate) {
    const matchedWeek = sortedWeeks.find((w) => {
      if (w.start_date && w.end_date) {
        return targetDate >= w.start_date && targetDate <= w.end_date
      }
      return false
    })

    if (matchedWeek) {
      const weekUnused = (matchedWeek.objectives || [])
        .filter((o) => !o.is_met && !plannedCodes.has(o.code_snapshot))
        .map((o) => ({
          ...o,
          week_sequence: matchedWeek.sequence,
          week_label: matchedWeek.week_label,
          week_topic: matchedWeek.topic_title,
          week_challenge: matchedWeek.challenge_title,
          is_already_planned: false
        }))

      if (weekUnused.length > 0) {
        return {
          predictedObjectives: weekUnused,
          reason: 'date_matched_week',
          weekSequence: matchedWeek.sequence,
          weekTopic: matchedWeek.topic_title || undefined,
          weekChallenge: matchedWeek.challenge_title || undefined
        }
      }
    }
  }

  // 2. Sequential search: Find earliest week in sequence with unused (not met & not planned) objectives
  for (const w of sortedWeeks) {
    const unusedInWeek = (w.objectives || [])
      .filter((o) => !o.is_met && !plannedCodes.has(o.code_snapshot))
      .map((o) => ({
        ...o,
        week_sequence: w.sequence,
        week_label: w.week_label,
        week_topic: w.topic_title,
        week_challenge: w.challenge_title,
        is_already_planned: false
      }))

    if (unusedInWeek.length > 0) {
      return {
        predictedObjectives: unusedInWeek,
        reason: 'earliest_unplanned_week',
        weekSequence: w.sequence,
        weekTopic: w.topic_title || undefined,
        weekChallenge: w.challenge_title || undefined
      }
    }
  }

  // 3. Fallback: If all objectives have been planned in some lesson plan, but some are still !is_met
  for (const w of sortedWeeks) {
    const unmetInWeek = (w.objectives || [])
      .filter((o) => !o.is_met)
      .map((o) => ({
        ...o,
        week_sequence: w.sequence,
        week_label: w.week_label,
        week_topic: w.topic_title,
        week_challenge: w.challenge_title,
        is_already_planned: plannedCodes.has(o.code_snapshot)
      }))

    if (unmetInWeek.length > 0) {
      return {
        predictedObjectives: unmetInWeek,
        reason: 'unmet_fallback',
        weekSequence: w.sequence,
        weekTopic: w.topic_title || undefined,
        weekChallenge: w.challenge_title || undefined
      }
    }
  }

  return { predictedObjectives: [], reason: 'all_covered' }
}

export default function Planning() {
  const { profile, user } = useAuth()
  const { school, classes, subjects, refresh } = useSchool()

  // Roles & Capabilities
  const isLeadership = can(profile?.role, 'viewDirectorDashboard', profile?.additional_roles)
  const canManageCurriculum = can(profile?.role, 'manageCurriculum', profile?.additional_roles)
  const isCoordinator = profile?.role === 'curriculum_coordinator' || Boolean(profile?.additional_roles && profile.additional_roles.includes('curriculum_coordinator'))
  const isDirector = profile?.role === 'director' || Boolean(profile?.additional_roles && profile.additional_roles.includes('director'))
  const isHeadOfSchool = profile?.role === 'head_of_school' || Boolean(profile?.additional_roles && profile.additional_roles.includes('head_of_school'))
  const hasExecutiveAccess = isLeadership || isDirector || isHeadOfSchool || isCoordinator
  const isTeacher = profile?.role === 'homeroom_teacher' || profile?.role === 'subject_teacher' || isCoordinator || !isLeadership

  const [activeTab, setActiveTab] = useState<PlanningSubTab>(() => {
    if (profile?.role === 'director' || profile?.role === 'head_of_school') {
      return 'executive'
    }
    return 'work_plans'
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Profiles and school schedule slots for executive dashboard
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [allTimetableSlots, setAllTimetableSlots] = useState<TeacherScheduleSlot[]>([])

  // Auto-switch to executive tab for Director or Head of School once profile loads
  useEffect(() => {
    if ((profile?.role === 'director' || profile?.role === 'head_of_school') && activeTab === 'work_plans') {
      setActiveTab('executive')
    }
  }, [profile?.role])

  // Work Plans State
  const [workPlans, setWorkPlans] = useState<WorkPlan[]>([])
  const [selectedWorkPlan, setSelectedWorkPlan] = useState<WorkPlan | null>(null)
  const [workPlanScope, setWorkPlanScope] = useState<'my' | 'all'>('my')
  const [showCreateWorkPlanModal, setShowCreateWorkPlanModal] = useState(false)
  const [createWpClassId, setCreateWpClassId] = useState('')
  const [createWpSubjectId, setCreateWpSubjectId] = useState('')

  // Work Plans Import State (Onboarding)
  const [parsingWorkPlanPdf, setParsingWorkPlanPdf] = useState(false)
  const [parsedWorkPlan, setParsedWorkPlan] = useState<ParsedWorkPlan | null>(null)
  const [showImportWorkPlanModal, setShowImportWorkPlanModal] = useState(false)
  const [importWpClassId, setImportWpClassId] = useState('')
  const [importWpSubjectId, setImportWpSubjectId] = useState('')
  const [importWpSubjectCode, setImportWpSubjectCode] = useState('')
  const [importWpFramework, setImportWpFramework] = useState('CAMBRIDGE_LOWER_SECONDARY')
  const [importWpAcademicYear, setImportWpAcademicYear] = useState('2026/2027')
  const [importWpSemester, setImportWpSemester] = useState('1')
  const [workPlanParseProgress, setWorkPlanParseProgress] = useState<(WorkPlanParseProgress & { fileName?: string }) | null>(null)

  // Lesson Plans State
  const [lessonPlans, setLessonPlans] = useState<LessonPlan[]>([])
  const [selectedLessonPlan, setSelectedLessonPlan] = useState<LessonPlan | null>(null)
  const [lessonPlanScope, setLessonPlanScope] = useState<'my' | 'all'>('my')
  const [lpViewMode, setLpViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedWeekMonday, setSelectedWeekMonday] = useState<Date>(() => getMondayOfDate(new Date()))
  const [showCreateLessonPlanModal, setShowCreateLessonPlanModal] = useState(false)
  const [createLpClassId, setCreateLpClassId] = useState('')
  const [createLpSubjectId, setCreateLpSubjectId] = useState('')
  const [createLpSlotId, setCreateLpSlotId] = useState<string | null>(null)
  const [createLpDate, setCreateLpDate] = useState(() => formatDateISO(new Date()))
  const [createLpStartTime, setCreateLpStartTime] = useState('08:30')
  const [createLpEndTime, setCreateLpEndTime] = useState('09:15')
  const [createLpTopicTitle, setCreateLpTopicTitle] = useState('')
  const [createLpChallengeTitle, setCreateLpChallengeTitle] = useState('')
  const [matchingWorkPlanForLp, setMatchingWorkPlanForLp] = useState<WorkPlan | null>(null)
  const [loadingMatchingWp, setLoadingMatchingWp] = useState(false)
  const [selectedLpObjectiveCodes, setSelectedLpObjectiveCodes] = useState<string[]>([])
  const [matchingWpForSelectedLp, setMatchingWpForSelectedLp] = useState<WorkPlan | null>(null)
  const [addObjectiveCodeForSelectedLp, setAddObjectiveCodeForSelectedLp] = useState('')

  // Gemini AI Lesson Plan Generation State
  const [createLpStarter, setCreateLpStarter] = useState('')
  const [createLpExposition, setCreateLpExposition] = useState('')
  const [createLpLearners, setCreateLpLearners] = useState('')
  const [createLpPlenary, setCreateLpPlenary] = useState('')
  const [createLpAssessmentIdeas, setCreateLpAssessmentIdeas] = useState('')
  const [showGeminiApiKeyModal, setShowGeminiApiKeyModal] = useState(false)
  const [generatingAllStages, setGeneratingAllStages] = useState(false)
  const [syncingAttendance, setSyncingAttendance] = useState(false)

  // Teaching Assignments State
  const [assignments, setAssignments] = useState<Assignment[]>([])

  // Timetable State
  const [timetableSlots, setTimetableSlots] = useState<TeacherScheduleSlot[]>([])
  const [showUploadTimetableModal, setShowUploadTimetableModal] = useState(false)
  const [parsingTimetable, setParsingTimetable] = useState(false)
  const [parsedTimetablePreview, setParsedTimetablePreview] = useState<TeacherScheduleSlot[]>([])

  // Curriculum & PDF Ingestion State
  const [schemes, setSchemes] = useState<CurriculumScheme[]>([])
  const [selectedSchemeDetail, setSelectedSchemeDetail] = useState<{
    scheme: CurriculumScheme
    topics: CurriculumTopic[]
    objectives: CurriculumObjective[]
  } | null>(null)
  const [parsingPdf, setParsingPdf] = useState(false)
  const [extractedSyllabus, setExtractedSyllabus] = useState<ExtractedSyllabus | null>(null)
  const [showPdfIngestModal, setShowPdfIngestModal] = useState(false)

  // PDF Preview State
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null)
  const [pdfPreviewTitle, setPdfPreviewTitle] = useState('')
  const [showPdfPreviewModal, setShowPdfPreviewModal] = useState(false)

  // Review Queue state
  const [reviewPlans, setReviewPlans] = useState<{ workPlans: WorkPlan[]; lessonPlans: LessonPlan[] }>({
    workPlans: [],
    lessonPlans: []
  })
  const [reviewComment, setReviewComment] = useState('')
  const [reviewTarget, setReviewTarget] = useState<{ type: 'work_plan' | 'lesson_plan'; id: string } | null>(null)

  // Load Initial Data
  useEffect(() => {
    loadAllPlanningData()
  }, [profile?.id, activeTab])

  const loadAllPlanningData = async () => {
    setLoading(true)
    setError(null)
    try {
      const teacherFilter = hasExecutiveAccess ? undefined : { teacherId: profile?.id }

      // Fetch Work Plans & Lesson Plans
      const [wps, lps] = await Promise.all([
        api.listWorkPlans(teacherFilter),
        api.listLessonPlans(teacherFilter)
      ])

      // Automatically mark any objective used in a lesson plan as COVERED in the work plan
      const coveredCodeKeys = new Set<string>()
      const coveredTextKeys = new Set<string>()
      lps.forEach((lp) => {
        (lp.objectives || []).forEach((o) => {
          if (o.code_snapshot?.trim()) {
            const c = o.code_snapshot.trim().toLowerCase()
            coveredCodeKeys.add(`${lp.class_id}_${lp.subject_id}_${c}`)
            coveredCodeKeys.add(c)
          }
          if (o.text_snapshot?.trim()) {
            const t = o.text_snapshot.trim().toLowerCase()
            if (t.length > 5) {
              coveredTextKeys.add(`${lp.class_id}_${lp.subject_id}_${t}`)
              coveredTextKeys.add(t)
            }
          }
        })
      })

      const synchedWps = wps.map((wp) => {
        const synchedWeeks = (wp.weeks || []).map((wk) => {
          const synchedObjs = (wk.objectives || []).map((obj) => {
            const normCode = (obj.code_snapshot || '').trim().toLowerCase()
            const normText = (obj.text_snapshot || '').trim().toLowerCase()
            const isUsedInLp =
              (normCode && (
                coveredCodeKeys.has(`${wp.class_id}_${wp.subject_id}_${normCode}`) ||
                coveredCodeKeys.has(normCode)
              )) ||
              (normText && normText.length > 5 && (
                coveredTextKeys.has(`${wp.class_id}_${wp.subject_id}_${normText}`) ||
                coveredTextKeys.has(normText)
              ))

            if (isUsedInLp && !obj.is_met) {
              return { ...obj, is_met: true, met_at: obj.met_at || new Date().toISOString() }
            }
            return obj
          })
          const allMet = synchedObjs.length > 0 && synchedObjs.every((o) => o.is_met)
          return {
            ...wk,
            objectives: synchedObjs,
            is_commed: wk.is_commed || allMet
          }
        })
        return {
          ...wp,
          weeks: synchedWeeks
        }
      })

      setWorkPlans(synchedWps)
      setLessonPlans(lps)

      // Fetch Timetable for current user
      const tt = await api.getTeacherTimetable(profile?.id)
      setTimetableSlots(tt.slots)

      // If user has executive oversight access, fetch all staff profiles and all schedule slots
      if (hasExecutiveAccess) {
        const [allTt, profs] = await Promise.all([
          api.getTeacherTimetable('all').catch(() => ({ timetable: null, slots: [] as TeacherScheduleSlot[] })),
          api.listProfiles().catch(() => [] as Profile[])
        ])
        setAllTimetableSlots(allTt.slots || [])
        setProfiles(profs || [])
      }

      // One-time reset of legacy pre-seeded frameworks so curriculum library starts at 0
      if (localStorage.getItem('leera_curriculum_reset_v3') !== 'true') {
        try {
          await api.clearCurriculumLibrary()
          localStorage.setItem('leera_curriculum_reset_v3', 'true')
        } catch (e) {
          console.warn('Auto-clearing legacy curriculum library failed:', e)
        }
      }

      // Fetch Curriculum Schemes
      const scs = await api.listCurriculumSchemes()
      setSchemes(scs)

      // Fetch Class Subject Teacher Assignments
      const ass = await api.listAssignments().catch(() => [] as Assignment[])
      setAssignments(ass)

      // If Leadership, fetch Review Queue
      if (isLeadership) {
        const allWps = await api.listWorkPlans()
        const allLps = await api.listLessonPlans()
        setReviewPlans({
          workPlans: allWps.filter((p) => p.status === 'submitted' || p.status === 'under_review'),
          lessonPlans: allLps.filter((p) => p.status === 'submitted')
        })
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load planning data.')
    } finally {
      setLoading(false)
    }
  }

  // -------------------------------------------------------------------------
  // TEACHER ASSIGNMENT & PERMISSION FILTERING
  // -------------------------------------------------------------------------
  // Teacher's explicit subject-class assignments
  const teacherAssignments = assignments.filter((a) => a.teacher_id === profile?.id)

  // Homeroom class if user is the assigned homeroom teacher
  const homeroomClass = classes.find(
    (c) => c.homeroom_teacher_id === profile?.id || c.id === profile?.class_id
  )

  // Classes that the current user is allowed to plan for
  const availableClasses = isLeadership
    ? classes
    : classes.filter((c) =>
        teacherAssignments.some((a) => a.class_id === c.id) ||
        (homeroomClass && homeroomClass.id === c.id)
      )

  // Subjects that the current user is allowed to plan for in a given class
  const getAllowedSubjectsForClass = (classId: string) => {
    if (!classId) return []
    if (isLeadership) return subjects

    const assignedSubjectIds = new Set(
      teacherAssignments
        .filter((a) => a.class_id === classId)
        .map((a) => a.subject_id)
    )

    // If teacher is homeroom teacher of this class and no explicit subject assignments were defined yet for them in this class:
    if (homeroomClass && homeroomClass.id === classId && assignedSubjectIds.size === 0) {
      return subjects
    }

    return subjects.filter((s) => assignedSubjectIds.has(s.id))
  }

  // Determine if a draft work plan or lesson plan is visible to the current user
  // Rules:
  // 1. Submitted / approved / returned plans are always visible to leadership / assigned viewers
  // 2. Directors and Head of School should NOT see draft workplans and lesson plans (they only see them once submitted)
  // 3. Coordinators only see draft workplans and lesson plans for subjects-classes they teach (own assignments)
  // 4. Regular teachers only see their own drafts
  const canViewDraftPlan = (plan: { teacher_id?: string; class_id?: string; subject_id?: string; status?: string }) => {
    if (!plan || plan.status !== 'draft') return true

    const isOwnPlan = plan.teacher_id === profile?.id
    const isAssignedSubjectClass = teacherAssignments.some(
      (a) => a.class_id === plan.class_id && a.subject_id === plan.subject_id
    ) || (homeroomClass && homeroomClass.id === plan.class_id && isOwnPlan)

    if (isCoordinator) {
      // Coordinators only see draft workplans and lesson plans for subjects-classes they teach (own assignments)
      return isAssignedSubjectClass || isOwnPlan
    }

    if (isDirector || isHeadOfSchool) {
      // Directors and Head of School should not see draft workplans and lesson plans. They only see them once they are submitted.
      return isOwnPlan && isAssignedSubjectClass
    }

    // Regular teachers only see their own drafts
    return isOwnPlan
  }

  const myWorkPlans = useMemo(() => {
    return workPlans.filter((wp) => wp.teacher_id === profile?.id)
  }, [workPlans, profile?.id])

  const allVisibleWorkPlans = useMemo(() => {
    return workPlans.filter((wp) => canViewDraftPlan(wp))
  }, [workPlans, profile?.id, isCoordinator, isDirector, isHeadOfSchool, teacherAssignments, homeroomClass])

  const displayedWorkPlans = isLeadership && workPlanScope === 'my' ? myWorkPlans : allVisibleWorkPlans

  const myLessonPlans = useMemo(() => {
    return lessonPlans.filter((lp) => lp.teacher_id === profile?.id)
  }, [lessonPlans, profile?.id])

  const allVisibleLessonPlans = useMemo(() => {
    return lessonPlans.filter((lp) => canViewDraftPlan(lp))
  }, [lessonPlans, profile?.id, isCoordinator, isDirector, isHeadOfSchool, teacherAssignments, homeroomClass])

  const displayedLessonPlans = isLeadership && lessonPlanScope === 'my' ? myLessonPlans : allVisibleLessonPlans

  const openCreateWorkPlan = () => {
    const initClass = availableClasses.length === 1 ? availableClasses[0].id : ''
    setCreateWpClassId(initClass)
    if (initClass) {
      const allowedSubs = getAllowedSubjectsForClass(initClass)
      setCreateWpSubjectId(allowedSubs.length === 1 ? allowedSubs[0].id : '')
    } else {
      setCreateWpSubjectId('')
    }
    setShowCreateWorkPlanModal(true)
  }

  const handleNavigateWeek = (offsetWeeks: number) => {
    setSelectedWeekMonday((prev) => {
      const next = new Date(prev)
      next.setDate(next.getDate() + offsetWeeks * 7)
      return next
    })
  }

  const handleResetCurrentWeek = () => {
    setSelectedWeekMonday(getMondayOfDate(new Date()))
  }

  const weekSlotStats = useMemo(() => {
    let totalSlots = 0
    let futurePlannedCount = 0
    let pastPlannedCount = 0
    let futureUnplannedCount = 0
    let pastUnplannedCount = 0

    for (let dayIdx = 0; dayIdx < 5; dayIdx++) {
      const dayDate = new Date(selectedWeekMonday)
      dayDate.setDate(selectedWeekMonday.getDate() + dayIdx)
      const dayDateStr = formatDateISO(dayDate)
      const slots = timetableSlots.filter((s) => s.day_of_week === dayIdx)
      totalSlots += slots.length

      for (const s of slots) {
        const isPlanned = !!findMatchingLessonPlan(s, dayDateStr, lessonPlans)
        const isPast = isPastLessonSlot(dayDateStr, s.start_time, s.end_time)

        if (isPlanned) {
          if (isPast) pastPlannedCount++
          else futurePlannedCount++
        } else {
          if (isPast) pastUnplannedCount++
          else futureUnplannedCount++
        }
      }
    }

    return {
      totalSlots,
      futurePlannedCount,
      pastPlannedCount,
      futureUnplannedCount,
      pastUnplannedCount,
      plannedCount: futurePlannedCount + pastPlannedCount,
      unplannedCount: futureUnplannedCount + pastUnplannedCount
    }
  }, [selectedWeekMonday, timetableSlots, lessonPlans])

  const openCreateLessonPlan = (
    slotClass?: string,
    slotSubject?: string,
    slotStartTime?: string,
    slotEndTime?: string,
    slotDate?: string,
    slotId?: string
  ) => {
    const targetDate = slotDate || formatDateISO(new Date())

    // If a plan already exists for this slot & date, reopen it directly instead of showing a blank modal!
    if (slotClass && slotSubject) {
      const existing = lessonPlans.find((lp) => {
        if (lp.lesson_date !== targetDate) return false
        if (slotId && lp.schedule_slot_id === slotId) return true
        const cMatches = (slotClass && lp.class_name && lp.class_name.toLowerCase().trim() === slotClass.toLowerCase().trim())
        const sMatches = (slotSubject && lp.subject_name && lp.subject_name.toLowerCase().trim() === slotSubject.toLowerCase().trim())
        if (!cMatches || !sMatches) return false
        if (slotStartTime && lp.start_time) {
          return normalizeTimeString(slotStartTime) === normalizeTimeString(lp.start_time)
        }
        return true
      })
      if (existing) {
        handleSelectLessonPlan(existing.id)
        return
      }
    }

    // Planning closes at end of day: block only previous calendar dates, not earlier slots on today
    if (isPastLessonSlot(targetDate, slotStartTime, slotEndTime)) {
      setError(
        `Cannot plan a lesson on a past date: ${slotClass || 'This class'} on ${targetDate} is in the past. You can plan lessons for today or any future date.`
      )
      return
    }

    let cId = ''
    let sId = ''
    if (slotClass) {
      const c = availableClasses.find((cls) => cls.name.toLowerCase() === slotClass.toLowerCase() || cls.id === slotClass)
      if (c) cId = c.id
    }
    if (!cId && availableClasses.length === 1) {
      cId = availableClasses[0].id
    }
    if (cId && slotSubject) {
      const allowed = getAllowedSubjectsForClass(cId)
      const s = allowed.find((sb) => sb.name.toLowerCase() === slotSubject.toLowerCase() || sb.id === slotSubject)
      if (s) sId = s.id
    }
    if (cId && !sId) {
      const allowed = getAllowedSubjectsForClass(cId)
      if (allowed.length === 1) sId = allowed[0].id
    }
    setCreateLpSlotId(slotId || null)
    setCreateLpClassId(cId)
    setCreateLpSubjectId(sId)
    setCreateLpDate(targetDate)
    setCreateLpStartTime(slotStartTime ? normalizeTimeString(slotStartTime) : '08:30')
    setCreateLpEndTime(slotEndTime ? normalizeTimeString(slotEndTime) : '09:15')
    setCreateLpTopicTitle('')
    setCreateLpChallengeTitle('')
    setSelectedLpObjectiveCodes([])
    setCreateLpStarter('')
    setCreateLpExposition('')
    setCreateLpLearners('')
    setCreateLpPlenary('')
    setCreateLpAssessmentIdeas('')
    setShowCreateLessonPlanModal(true)
  }

  // Sync matching work plan and uncovered objectives when Class / Subject is selected in Lesson Plan modal
  useEffect(() => {
    if (!showCreateLessonPlanModal || !createLpClassId || !createLpSubjectId) {
      setMatchingWorkPlanForLp(null)
      setSelectedLpObjectiveCodes([])
      return
    }
    let active = true
    const fetchMatchingWp = async () => {
      setLoadingMatchingWp(true)
      try {
        const match = workPlans.find((wp) => wp.class_id === createLpClassId && wp.subject_id === createLpSubjectId)
        if (match) {
          const fullWp = await api.getWorkPlan(match.id)
          if (active) {
            setMatchingWorkPlanForLp(fullWp)
            // Smart Prediction: Auto-predict next unused objective for this lesson slot
            const pred = predictNextUnusedObjectives(
              fullWp,
              lessonPlans,
              createLpClassId,
              createLpSubjectId,
              createLpDate
            )
            if (pred.predictedObjectives.length > 0) {
              const topObj = pred.predictedObjectives[0]
              setSelectedLpObjectiveCodes([topObj.code_snapshot])
              setCreateLpTopicTitle((prev) => prev || pred.weekTopic || topObj.week_topic || topObj.text_snapshot)
              if (pred.weekChallenge || topObj.week_challenge) {
                setCreateLpChallengeTitle((prev) => prev || pred.weekChallenge || topObj.week_challenge || '')
              }
            } else {
              setSelectedLpObjectiveCodes([])
            }
          }
        } else {
          if (active) {
            setMatchingWorkPlanForLp(null)
            setSelectedLpObjectiveCodes([])
          }
        }
      } catch (e) {
        console.warn('Could not load work plan for lesson plan creation:', e)
      } finally {
        if (active) setLoadingMatchingWp(false)
      }
    }
    fetchMatchingWp()
    return () => {
      active = false
    }
  }, [createLpClassId, createLpSubjectId, showCreateLessonPlanModal, workPlans])

  // Fetch matching work plan for selected lesson plan to allow adding more uncovered objectives
  useEffect(() => {
    if (!selectedLessonPlan) {
      setMatchingWpForSelectedLp(null)
      return
    }
    let active = true
    const loadWp = async () => {
      const match = workPlans.find(
        (wp) => wp.class_id === selectedLessonPlan.class_id && wp.subject_id === selectedLessonPlan.subject_id
      )
      if (match) {
        try {
          const fullWp = await api.getWorkPlan(match.id)
          if (active) setMatchingWpForSelectedLp(fullWp)
        } catch (e) {
          console.warn('Failed to load work plan for selected lesson plan:', e)
        }
      } else {
        if (active) setMatchingWpForSelectedLp(null)
      }
    }
    loadWp()
    return () => {
      active = false
    }
  }, [selectedLessonPlan?.id, selectedLessonPlan?.class_id, selectedLessonPlan?.subject_id, workPlans])

  // Extract all objectives and uncovered objectives for the active modal
  const availableLpObjectives = (matchingWorkPlanForLp?.weeks || []).flatMap((w) =>
    (w.objectives || []).map((o) => ({
      ...o,
      week_sequence: w.sequence,
      week_label: w.week_label,
      week_topic: w.topic_title,
      week_challenge: w.challenge_title
    }))
  )
  const uncoveredLpObjectives = availableLpObjectives.filter((o) => !o.is_met)
  const coveredLpObjectives = availableLpObjectives.filter((o) => o.is_met)

  // Smart Prediction for Create Lesson Plan Modal
  const smartPredictionForCreate = useMemo(() => {
    return predictNextUnusedObjectives(
      matchingWorkPlanForLp,
      lessonPlans,
      createLpClassId,
      createLpSubjectId,
      createLpDate
    )
  }, [matchingWorkPlanForLp, lessonPlans, createLpClassId, createLpSubjectId, createLpDate])

  // Smart Prediction for Selected Lesson Plan Editor
  const smartPredictionForSelected = useMemo(() => {
    if (!selectedLessonPlan) return null
    return predictNextUnusedObjectives(
      matchingWpForSelectedLp,
      lessonPlans,
      selectedLessonPlan.class_id,
      selectedLessonPlan.subject_id,
      selectedLessonPlan.lesson_date,
      selectedLessonPlan.id
    )
  }, [matchingWpForSelectedLp, lessonPlans, selectedLessonPlan])

  const plannedCodesForCreate = useMemo(() => {
    return new Set(
      lessonPlans
        .filter((lp) => lp.class_id === createLpClassId && lp.subject_id === createLpSubjectId)
        .flatMap((lp) => (lp.objectives || []).map((o) => o.code_snapshot))
    )
  }, [lessonPlans, createLpClassId, createLpSubjectId])

  const predictedCodesSetForCreate = useMemo(() => {
    return new Set((smartPredictionForCreate?.predictedObjectives || []).map((o) => o.code_snapshot))
  }, [smartPredictionForCreate])

  // Sort uncovered objectives: Smart Predicted first, then other unplanned, then previously planned
  const sortedUncoveredLpObjectives = useMemo(() => {
    return [...uncoveredLpObjectives].sort((a, b) => {
      const aPred = predictedCodesSetForCreate.has(a.code_snapshot) ? 1 : 0
      const bPred = predictedCodesSetForCreate.has(b.code_snapshot) ? 1 : 0
      if (aPred !== bPred) return bPred - aPred

      const aPlanned = plannedCodesForCreate.has(a.code_snapshot) ? 1 : 0
      const bPlanned = plannedCodesForCreate.has(b.code_snapshot) ? 1 : 0
      if (aPlanned !== bPlanned) return aPlanned - bPlanned

      return a.week_sequence - b.week_sequence
    })
  }, [uncoveredLpObjectives, predictedCodesSetForCreate, plannedCodesForCreate])

  const selectedCreateSubject = subjects.find((s) => s.id === createLpSubjectId)
  const isCreateLpGlobalPerspectives = !!(
    selectedCreateSubject?.name?.toLowerCase().includes('global perspective') ||
    selectedCreateSubject?.name?.toLowerCase().includes('gp') ||
    matchingWorkPlanForLp?.subject_name?.toLowerCase().includes('global perspective') ||
    matchingWorkPlanForLp?.subject_name?.toLowerCase().includes('gp')
  )

  // -------------------------------------------------------------------------
  // WORK PLAN ACTIONS
  // -------------------------------------------------------------------------

  const handleSelectWorkPlan = async (id: string) => {
    setLoading(true)
    try {
      const wp = await api.getWorkPlan(id)
      if (wp) {
        if (wp.status === 'draft' && !canViewDraftPlan(wp)) {
          setError('Draft work plans are only visible once submitted.')
          return
        }
        setSelectedWorkPlan(wp)
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load work plan details.')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateWorkPlan = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const classId = createWpClassId || (form.get('class_id') as string)
    const subjectId = createWpSubjectId || (form.get('subject_id') as string)
    const schemeId = (form.get('scheme_id') as string) || null

    if (!classId || !subjectId) {
      setError('Please select both a class and a subject assigned to you.')
      return
    }

    if (!isLeadership) {
      const allowed = getAllowedSubjectsForClass(classId)
      if (!allowed.some((s) => s.id === subjectId)) {
        setError('You are only authorized to create work plans for classes and subjects assigned to you.')
        return
      }
    }

    try {
      setLoading(true)
      const id = await api.createWorkPlan({
        class_id: classId,
        subject_id: subjectId,
        scheme_id: schemeId,
        resources: form.get('resources') as string,
        notes: form.get('notes') as string
      })
      setShowCreateWorkPlanModal(false)
      setSuccess('Semester Work Plan initialized successfully.')
      await handleSelectWorkPlan(id)
      await loadAllPlanningData()
    } catch (err: any) {
      setError(err?.message || 'Could not create work plan.')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveWorkPlanDraft = async () => {
    if (!selectedWorkPlan) return
    try {
      setLoading(true)
      await api.saveWorkPlanWeeks(selectedWorkPlan.id, selectedWorkPlan.weeks || [])
      setSuccess('Work Plan draft saved successfully.')
    } catch (err: any) {
      setError(err?.message || 'Failed to save work plan.')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitWorkPlan = async (id: string) => {
    if (!confirm('Are you sure you want to submit this Semester Work Plan for leadership review?')) return
    try {
      setLoading(true)
      await api.submitWorkPlan(id)
      setSuccess('Work Plan submitted for review.')
      if (selectedWorkPlan && selectedWorkPlan.id === id) {
        setSelectedWorkPlan({ ...selectedWorkPlan, status: 'submitted' })
      }
      await loadAllPlanningData()
    } catch (err: any) {
      setError(err?.message || 'Failed to submit work plan.')
    } finally {
      setLoading(false)
    }
  }

  const handlePreviewWorkPlanPdf = async (wp: WorkPlan) => {
    if (!school) return
    if (wp.status === 'draft' && !canViewDraftPlan(wp)) {
      setError('Draft work plans can only be previewed once submitted.')
      return
    }
    try {
      // Ensure weeks are loaded
      const fullPlan = wp.weeks ? wp : (await api.getWorkPlan(wp.id)) || wp
      const doc = await generateWorkPlanPdf(fullPlan, school)
      const blob = doc.output('blob')
      const url = URL.createObjectURL(blob)
      setPdfPreviewUrl(url)
      setPdfPreviewTitle(`Work Plan — ${wp.subject_name || 'Subject'} (${wp.class_name || 'Class'})`)
      setShowPdfPreviewModal(true)
    } catch (err: any) {
      setError(err?.message || 'Could not generate work plan PDF.')
    }
  }

  const handleWorkPlanFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setParsingWorkPlanPdf(true)
    setWorkPlanParseProgress({
      percent: 5,
      stage: 'Loading PDF document...',
      detail: file.name,
      fileName: file.name
    })
    setError(null)
    try {
      const parsed = await parseWorkPlanPdf(file, (prog) => {
        setWorkPlanParseProgress({
          ...prog,
          fileName: file.name
        })
      })
      setParsedWorkPlan(parsed)

      // Try auto-matching class
      let matchedClassId = ''
      if (parsed.class_name) {
        const foundClass = availableClasses.find(
          (c) => c.name.toLowerCase().includes(parsed.class_name!.toLowerCase()) ||
                 parsed.class_name!.toLowerCase().includes(c.name.toLowerCase())
        )
        if (foundClass) matchedClassId = foundClass.id
      }
      if (!matchedClassId && availableClasses.length === 1) {
        matchedClassId = availableClasses[0].id
      }
      setImportWpClassId(matchedClassId)

      // Try auto-matching subject
      let matchedSubjectId = ''
      const allowedSubs = matchedClassId ? getAllowedSubjectsForClass(matchedClassId) : subjects
      if (parsed.subject_name) {
        const foundSub = allowedSubs.find(
          (s) => s.name.toLowerCase().includes(parsed.subject_name!.toLowerCase()) ||
                 parsed.subject_name!.toLowerCase().includes(s.name.toLowerCase())
        )
        if (foundSub) matchedSubjectId = foundSub.id
      }
      if (!matchedSubjectId && allowedSubs.length === 1) {
        matchedSubjectId = allowedSubs[0].id
      }
      setImportWpSubjectId(matchedSubjectId)

      // Set Subject Code, Framework Level & Semester
      setImportWpSubjectCode(parsed.subject_code || '')
      setImportWpFramework(parsed.framework || 'CAMBRIDGE_LOWER_SECONDARY')
      setImportWpAcademicYear(parsed.academic_year || '2026/2027')
      setImportWpSemester(parsed.semester || '1')

      // Brief pause to display 100% completion before showing review modal
      setTimeout(() => {
        setParsingWorkPlanPdf(false)
        setWorkPlanParseProgress(null)
        setShowImportWorkPlanModal(true)
      }, 450)
    } catch (err: any) {
      setError(err?.message || 'Failed to parse work plan PDF.')
      setParsingWorkPlanPdf(false)
      setWorkPlanParseProgress(null)
    } finally {
      e.target.value = ''
    }
  }

  const toggleParsedObjectiveCoverage = (weekIdx: number, objIdx: number) => {
    if (!parsedWorkPlan) return
    const updatedWeeks = [...parsedWorkPlan.weeks]
    const targetWeek = { ...updatedWeeks[weekIdx] }
    const updatedObjs = [...(targetWeek.objectives || [])]
    const targetObj = { ...updatedObjs[objIdx] }
    targetObj.is_met = !targetObj.is_met
    updatedObjs[objIdx] = targetObj
    targetWeek.objectives = updatedObjs
    targetWeek.is_commed = updatedObjs.length > 0 && updatedObjs.every((o) => o.is_met)
    updatedWeeks[weekIdx] = targetWeek
    setParsedWorkPlan({ ...parsedWorkPlan, weeks: updatedWeeks })
  }

  const toggleParsedWeekCoverage = (weekIdx: number, isCovered: boolean) => {
    if (!parsedWorkPlan) return
    const updatedWeeks = [...parsedWorkPlan.weeks]
    const targetWeek = { ...updatedWeeks[weekIdx] }
    const updatedObjs = (targetWeek.objectives || []).map((o) => ({ ...o, is_met: isCovered }))
    targetWeek.objectives = updatedObjs
    targetWeek.is_commed = isCovered
    if (isCovered) {
      if (!targetWeek.remarks || /not covered/i.test(targetWeek.remarks)) {
        targetWeek.remarks = 'Covered'
      }
    } else {
      if (!targetWeek.remarks || /covered/i.test(targetWeek.remarks)) {
        targetWeek.remarks = 'Not covered'
      }
    }
    updatedWeeks[weekIdx] = targetWeek
    setParsedWorkPlan({ ...parsedWorkPlan, weeks: updatedWeeks })
  }

  const handleConfirmImportWorkPlan = async () => {
    if (!parsedWorkPlan) return
    if (!importWpFramework) {
      setError('Please select the Educational Level / Framework (e.g. Cambridge Primary, Lower Secondary, IGCSE, or AS & A Level).')
      return
    }
    if (!importWpClassId) {
      setError('Please select the Target Class for this work plan.')
      return
    }
    if (!importWpSubjectId) {
      setError('Please select the Subject assigned to you for this work plan.')
      return
    }
    if (!importWpSubjectCode.trim()) {
      setError('Cambridge Subject Code is required. Please enter or select the Cambridge code (e.g. 0580, 0610, 0457).')
      return
    }

    const allObjs = parsedWorkPlan.weeks.flatMap((w) => w.objectives || [])
    const coveredCount = allObjs.filter((o) => o.is_met).length
    const uncoveredCount = allObjs.filter((o) => !o.is_met).length

    try {
      setLoading(true)
      const res = await api.importWorkPlan({
        class_id: importWpClassId,
        subject_id: importWpSubjectId,
        subject_code: importWpSubjectCode.trim(),
        framework: importWpFramework,
        academic_year: importWpAcademicYear,
        semester: importWpSemester,
        weeks: parsedWorkPlan.weeks
      })

      setShowImportWorkPlanModal(false)
      setParsedWorkPlan(null)
      setSuccess(
        `Work plan imported successfully! Extracted ${allObjs.length} objectives: ${coveredCount} marked as COVERED, ${uncoveredCount} marked as UNCOVERED for lesson planning (${res.objectivesIngested} new objectives added to curriculum library, zero duplicates).`
      )
      await loadAllPlanningData()
      if (res.workPlanId) {
        await handleSelectWorkPlan(res.workPlanId)
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to import work plan.')
    } finally {
      setLoading(false)
    }
  }

  // -------------------------------------------------------------------------
  // LESSON PLAN ACTIONS
  // -------------------------------------------------------------------------

  const handleSelectLessonPlan = async (id: string) => {
    setLoading(true)
    try {
      const lp = await api.getLessonPlan(id)
      if (lp) {
        if (lp.status === 'draft' && !canViewDraftPlan(lp)) {
          setError('Draft lesson plans are only visible once submitted.')
          return
        }
        // Auto-fill attendance from daily register if not already recorded or both 0
        if (lp.boys_attendance === null || lp.boys_attendance === undefined || (lp.boys_attendance === 0 && lp.girls_attendance === 0)) {
          try {
            const att = await api.getClassAttendanceGenderCount(lp.class_id, lp.lesson_date)
            if (att.recorded) {
              lp.boys_attendance = att.boysPresent
              lp.girls_attendance = att.girlsPresent
            }
          } catch {
            // Silently fall through
          }
        }
      }
      setSelectedLessonPlan(lp)
      setActiveTab('lesson_plans')
    } catch (e: any) {
      setError(e?.message || 'Failed to load lesson plan details.')
    } finally {
      setLoading(false)
    }
  }

  const handleSyncAttendanceForSelectedLp = async () => {
    if (!selectedLessonPlan) return
    setSyncingAttendance(true)
    try {
      const att = await api.getClassAttendanceGenderCount(selectedLessonPlan.class_id, selectedLessonPlan.lesson_date)
      if (att.recorded) {
        setSelectedLessonPlan({
          ...selectedLessonPlan,
          boys_attendance: att.boysPresent,
          girls_attendance: att.girlsPresent
        })
        setSuccess(`Attendance auto-filled: ${att.boysPresent} Boys, ${att.girlsPresent} Girls present (${att.totalPresent} total).`)
      } else {
        setError(`No attendance register found for this class on ${selectedLessonPlan.lesson_date}. Please record attendance in the Attendance module first.`)
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch attendance for this class and date.')
    } finally {
      setSyncingAttendance(false)
    }
  }

  const handleCreateLessonPlan = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const classId = createLpClassId || (form.get('class_id') as string) || ''
    const subjectId = createLpSubjectId || (form.get('subject_id') as string) || ''
    const lessonDate = createLpDate || (form.get('lesson_date') as string) || ''
    const startTime = createLpStartTime || (form.get('start_time') as string) || ''
    const endTime = createLpEndTime || (form.get('end_time') as string) || ''
    const topicTitle = createLpTopicTitle || (form.get('topic_title') as string) || ''
    const challengeTitle = createLpChallengeTitle || (form.get('challenge_title') as string) || ''

    if (!classId || !subjectId || !lessonDate || !topicTitle.trim()) {
      setError('Please provide assigned class, subject, date, and topic/challenge.')
      return
    }

    // Planning closes at end of day: block past dates, but today's slots remain open
    if (isPastLessonSlot(lessonDate, startTime, endTime)) {
      setError('Cannot create lesson plan: Lesson plans can only be created for today or future dates. Planning for past dates is closed.')
      return
    }

    if (!isLeadership) {
      const allowed = getAllowedSubjectsForClass(classId)
      if (!allowed.some((s) => s.id === subjectId)) {
        setError('You are only authorized to create lesson plans for classes and subjects assigned to you.')
        return
      }
    }

    // Strict Enforcement: Teachers can ONLY use uncovered objectives
    if (matchingWorkPlanForLp) {
      if (uncoveredLpObjectives.length === 0 && coveredLpObjectives.length > 0) {
        setError('Cannot create lesson plan: All learning objectives for this subject are already marked as COVERED in the work plan. Teachers can only plan lessons for uncovered objectives.')
        return
      }
      if (uncoveredLpObjectives.length > 0 && selectedLpObjectiveCodes.length === 0) {
        setError('Please select at least one uncovered learning objective from the work plan.')
        return
      }
    }

    const chosenObjectives = uncoveredLpObjectives
      .filter((o) => selectedLpObjectiveCodes.includes(o.code_snapshot))
      .map((o) => ({
        objective_id: o.objective_id,
        code_snapshot: o.code_snapshot,
        text_snapshot: o.text_snapshot
      }))

    try {
      setLoading(true)
        const starter = createLpStarter || (form.get('activity_starter') as string) || ''
        const exposition = createLpExposition || (form.get('activity_exposition') as string) || ''
        const learnersActivity = createLpLearners || (form.get('activity_learners') as string) || ''
        const plenary = createLpPlenary || (form.get('activity_plenary') as string) || ''
        const combinedActivity = formatActivityStages({ starter, exposition, learnersActivity, plenary }) || (form.get('main_teaching_activity') as string) || ''
        const assessmentIdeas = createLpAssessmentIdeas || (form.get('assessment_ideas') as string) || ''

        // Auto-fetch attendance for class on this date if recorded
        let initialBoys: number | null = null
        let initialGirls: number | null = null
        try {
          const att = await api.getClassAttendanceGenderCount(classId, lessonDate)
          if (att.recorded) {
            initialBoys = att.boysPresent
            initialGirls = att.girlsPresent
          }
        } catch {
          // silent fallback
        }

        const id = await api.createLessonPlan({
          class_id: classId,
          subject_id: subjectId,
          schedule_slot_id: createLpSlotId || null,
          lesson_date: lessonDate,
          start_time: startTime || null,
          end_time: endTime || null,
          topic_title: topicTitle.trim(),
          challenge_title: challengeTitle.trim() || '',
          main_teaching_activity: combinedActivity,
          assessment_ideas: assessmentIdeas,
          resources: (form.get('resources') as string) || '',
          boys_attendance: initialBoys,
          girls_attendance: initialGirls,
          objectives: chosenObjectives
        })
      setShowCreateLessonPlanModal(false)
      setCreateLpSlotId(null)
      setSelectedLpObjectiveCodes([])
      setCreateLpTopicTitle('')
      setCreateLpChallengeTitle('')
      setCreateLpStarter('')
      setCreateLpExposition('')
      setCreateLpLearners('')
      setCreateLpPlenary('')
      setCreateLpAssessmentIdeas('')
      setSuccess('Lesson Plan created successfully with attached uncovered objectives.')
      await loadAllPlanningData()
      await handleSelectLessonPlan(id)
    } catch (err: any) {
      setError(err?.message || 'Could not create lesson plan.')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveLessonPlan = async () => {
    if (!selectedLessonPlan) return
    // Gate: Teacher Reflections & Evaluation cannot be saved if lesson time has not passed
    const isPast = isLessonTimeInPast(selectedLessonPlan.lesson_date, selectedLessonPlan.end_time, selectedLessonPlan.start_time)
    if (selectedLessonPlan.reflection_remarks?.trim() && !isPast) {
      setError(`Teacher Reflections & Evaluation cannot be recorded before the scheduled lesson time has passed (${selectedLessonPlan.lesson_date}${selectedLessonPlan.end_time ? ` at ${selectedLessonPlan.end_time}` : ''}).`)
      return
    }
    try {
      setLoading(true)
      await api.updateLessonPlan(selectedLessonPlan.id, selectedLessonPlan)
      setSuccess('Lesson Plan saved successfully.')
      await loadAllPlanningData()
      const refreshed = await api.getLessonPlan(selectedLessonPlan.id)
      if (refreshed) {
        setSelectedLessonPlan(refreshed)
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to save lesson plan.')
    } finally {
      setLoading(false)
    }
  }

  // Build lesson context for Gemini AI activity generation in Edit Form
  const getContextForSelectedLp = (): LessonContext => {
    const currentStages = parseActivityStages(selectedLessonPlan?.main_teaching_activity)
    const objList = (selectedLessonPlan?.objectives || []).map((o) => ({
      code: o.code_snapshot,
      text: o.text_snapshot
    }))

    return {
      subject: selectedLessonPlan?.subject_name,
      className: selectedLessonPlan?.class_name,
      topic: selectedLessonPlan?.topic_title,
      challenge: selectedLessonPlan?.challenge_title,
      subtopic: selectedLessonPlan?.subtopic_title,
      objectives: objList,
      existingStages: {
        starter: currentStages.starter,
        exposition: currentStages.exposition,
        learnersActivity: currentStages.learnersActivity,
        plenary: currentStages.plenary,
        assessmentIdeas: selectedLessonPlan?.assessment_ideas || ''
      }
    }
  }

  // Build lesson context for Gemini AI activity generation in Create Modal
  const getContextForCreateLp = (): LessonContext => {
    const matchingClass = classes.find((c) => c.id === createLpClassId)
    const matchingSubject = subjects.find((s) => s.id === createLpSubjectId)
    const chosenObjectives = uncoveredLpObjectives
      .filter((o) => selectedLpObjectiveCodes.includes(o.code_snapshot))
      .map((o) => ({
        code: o.code_snapshot,
        text: o.text_snapshot
      }))

    return {
      subject: matchingSubject?.name || 'General',
      className: matchingClass?.name || 'Class',
      topic: createLpTopicTitle || 'Lesson Inquiry',
      challenge: createLpChallengeTitle,
      objectives: chosenObjectives,
      existingStages: {
        starter: createLpStarter,
        exposition: createLpExposition,
        learnersActivity: createLpLearners,
        plenary: createLpPlenary,
        assessmentIdeas: createLpAssessmentIdeas
      }
    }
  }

  // Generate all 4 instructional stages and assessment ideas for the selected lesson plan
  const handleGenerateAllForSelectedLp = async () => {
    if (!selectedLessonPlan) return

    try {
      setGeneratingAllStages(true)
      const context = getContextForSelectedLp()
      const all = await generateAllStages(context)
      const combined = formatActivityStages({
        starter: all.starter,
        exposition: all.exposition,
        learnersActivity: all.learnersActivity,
        plenary: all.plenary
      })
      setSelectedLessonPlan({
        ...selectedLessonPlan,
        main_teaching_activity: combined,
        assessment_ideas: all.assessmentIdeas || selectedLessonPlan.assessment_ideas
      })
      setSuccess('Generated all teaching stages and assessment ideas.')
    } catch (err: any) {
      setError(err?.message || 'Failed to generate teaching stages.')
    } finally {
      setGeneratingAllStages(false)
    }
  }

  // Generate all 4 instructional stages and assessment ideas for the new lesson plan modal
  const handleGenerateAllForCreateLp = async () => {
    try {
      setGeneratingAllStages(true)
      const context = getContextForCreateLp()
      const all = await generateAllStages(context)
      setCreateLpStarter(all.starter)
      setCreateLpExposition(all.exposition)
      setCreateLpLearners(all.learnersActivity)
      setCreateLpPlenary(all.plenary)
      if (all.assessmentIdeas) {
        setCreateLpAssessmentIdeas(all.assessmentIdeas)
      }
      setSuccess('Generated all teaching stages and assessment ideas.')
    } catch (err: any) {
      setError(err?.message || 'Failed to generate teaching stages.')
    } finally {
      setGeneratingAllStages(false)
    }
  }

  const handleSubmitLessonPlan = async (id: string) => {
    let plan: LessonPlan | null | undefined = lessonPlans.find((lp) => lp.id === id)
    if (selectedLessonPlan && selectedLessonPlan.id === id) {
      plan = selectedLessonPlan
    }
    if (!plan) {
      plan = (await api.getLessonPlan(id)) || null
    }

    if (plan) {
      const isPast = isLessonTimeInPast(plan.lesson_date, plan.end_time, plan.start_time)
      if (!isPast) {
        setError(`Cannot submit lesson plan: The scheduled lesson time has not passed yet (${plan.lesson_date}${plan.end_time ? ` at ${plan.end_time}` : ''}). Lesson plans can only be submitted after the lesson has concluded and reflections are recorded.`)
        return
      }
      const remarksLength = (plan.reflection_remarks || '').length
      if (remarksLength < 16) {
        setError('Cannot submit lesson plan: Please provide a complete Teacher Reflections & Evaluation before submitting for review.')
        return
      }
    }

    if (!confirm('Submit this Lesson Plan for review?')) return
    try {
      setLoading(true)
      // Save any pending reflections if submitting directly from active editor
      if (selectedLessonPlan && selectedLessonPlan.id === id) {
        await api.updateLessonPlan(selectedLessonPlan.id, selectedLessonPlan)
      }
      await api.submitLessonPlan(id)
      setSuccess('Lesson Plan submitted for review.')
      if (selectedLessonPlan && selectedLessonPlan.id === id) {
        setSelectedLessonPlan({ ...selectedLessonPlan, status: 'submitted' })
      }
      await loadAllPlanningData()
    } catch (err: any) {
      setError(err?.message || 'Could not submit lesson plan.')
    } finally {
      setLoading(false)
    }
  }

  const handlePreviewLessonPlanPdf = async (lp: LessonPlan) => {
    if (!school) return
    if (lp.status === 'draft' && !canViewDraftPlan(lp)) {
      setError('Draft lesson plans can only be previewed once submitted.')
      return
    }
    try {
      const fullPlan = lp.objectives ? lp : (await api.getLessonPlan(lp.id)) || lp
      const doc = await generateLessonPlanPdf(fullPlan, school)
      const blob = doc.output('blob')
      const url = URL.createObjectURL(blob)
      setPdfPreviewUrl(url)
      setPdfPreviewTitle(`Lesson Plan — ${lp.subject_name || 'Subject'} (${lp.lesson_date})`)
      setShowPdfPreviewModal(true)
    } catch (err: any) {
      setError(err?.message || 'Could not generate lesson plan PDF.')
    }
  }

  // -------------------------------------------------------------------------
  // TIMETABLE ACTIONS
  // -------------------------------------------------------------------------

  const handleTimetableFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setParsingTimetable(true)
    setError(null)
    try {
      const parsed = await parseTeacherTimetablePdf(file, classes, subjects)
      setParsedTimetablePreview(parsed.slots as any)
      setShowUploadTimetableModal(true)
      if (parsed.warnings.length > 0) {
        setError(parsed.warnings.join('; '))
      }
    } catch (err: any) {
      setError(err?.message || 'Could not parse timetable PDF.')
    } finally {
      setParsingTimetable(false)
    }
  }

  const handleConfirmTimetableSlots = async () => {
    try {
      setLoading(true)
      await api.saveTeacherScheduleSlots(parsedTimetablePreview)
      setShowUploadTimetableModal(false)
      setSuccess('Weekly timetable schedule configured successfully.')
      await loadAllPlanningData()
    } catch (err: any) {
      setError(err?.message || 'Failed to save timetable slots.')
    } finally {
      setLoading(false)
    }
  }

  // -------------------------------------------------------------------------
  // CURRICULUM & SYLLABUS PDF INGESTION (HEAD OF SCHOOL / COORDINATOR)
  // -------------------------------------------------------------------------

  const handleSyllabusFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setParsingPdf(true)
    setError(null)
    try {
      const extracted = await parseSyllabusPdf(file)
      setExtractedSyllabus(extracted)
      setShowPdfIngestModal(true)
    } catch (err: any) {
      setError(err?.message || 'Failed to extract text from curriculum PDF.')
    } finally {
      setParsingPdf(false)
    }
  }

  const handleSaveExtractedCurriculum = async () => {
    if (!extractedSyllabus) return
    try {
      setLoading(true)
      await api.saveCurriculumScheme({
        framework: extractedSyllabus.framework,
        subject_code: extractedSyllabus.subject_code,
        subject_name: extractedSyllabus.subject_name,
        year_group: extractedSyllabus.year_group,
        title: extractedSyllabus.title,
        syllabus_years: extractedSyllabus.syllabus_years,
        topics: extractedSyllabus.topics,
        objectives: extractedSyllabus.objectives
      })
      setShowPdfIngestModal(false)
      setExtractedSyllabus(null)
      setSuccess(`Curriculum for "${extractedSyllabus.title}" saved successfully!`)
      await loadAllPlanningData()
    } catch (err: any) {
      setError(err?.message || 'Failed to save curriculum scheme.')
    } finally {
      setLoading(false)
    }
  }

  const handleViewSchemeDetail = async (schemeId: string) => {
    setLoading(true)
    try {
      const detail = await api.getCurriculumSchemeWithDetails(schemeId)
      setSelectedSchemeDetail(detail)
    } catch (e: any) {
      setError(e?.message || 'Failed to load scheme details.')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteScheme = async (schemeId: string, schemeName: string) => {
    if (!window.confirm(`Are you sure you want to delete "${schemeName}"?`)) return
    try {
      setLoading(true)
      await api.deleteCurriculumScheme(schemeId)
      if (selectedSchemeDetail?.scheme.id === schemeId) {
        setSelectedSchemeDetail(null)
      }
      setSuccess(`Curriculum scheme "${schemeName}" deleted.`)
      await loadAllPlanningData()
    } catch (err: any) {
      setError(err?.message || 'Failed to delete curriculum scheme.')
    } finally {
      setLoading(false)
    }
  }

  const handleClearCurriculumLibrary = async () => {
    if (!window.confirm('Are you sure you want to reset and clear all curriculum schemes? This will reset the library to 0 schemes.')) return
    try {
      setLoading(true)
      await api.clearCurriculumLibrary()
      setSelectedSchemeDetail(null)
      setSuccess('Curriculum library cleared (0 schemes).')
      await loadAllPlanningData()
    } catch (err: any) {
      setError(err?.message || 'Failed to clear curriculum library.')
    } finally {
      setLoading(false)
    }
  }

  // -------------------------------------------------------------------------
  // REVIEW QUEUE ACTIONS
  // -------------------------------------------------------------------------

  const handleReviewAction = async (status: 'approved' | 'returned') => {
    if (!reviewTarget) return
    try {
      setLoading(true)
      if (reviewTarget.type === 'work_plan') {
        await api.reviewWorkPlan(reviewTarget.id, status, reviewComment)
      } else {
        await api.reviewLessonPlan(reviewTarget.id, status, reviewComment)
      }
      setSuccess(`Plan ${status === 'approved' ? 'Approved' : 'Returned with feedback'}.`)
      setReviewTarget(null)
      setReviewComment('')
      await loadAllPlanningData()
    } catch (err: any) {
      setError(err?.message || 'Failed to submit review.')
    } finally {
      setLoading(false)
    }
  }

  const handleApproveLessonPlanExecutive = async (planId: string) => {
    try {
      await api.reviewLessonPlan(planId, 'approved', '')
      setSuccess('Lesson plan approved successfully.')
      await loadAllPlanningData()
    } catch (err: any) {
      setError(err?.message || 'Failed to approve lesson plan.')
    }
  }

  const handleReturnLessonPlanExecutive = async (planId: string, comment: string) => {
    try {
      await api.reviewLessonPlan(planId, 'returned', comment)
      setSuccess('Lesson plan returned with feedback.')
      await loadAllPlanningData()
    } catch (err: any) {
      setError(err?.message || 'Failed to return lesson plan.')
    }
  }

  // -------------------------------------------------------------------------
  // RENDER HELPERS
  // -------------------------------------------------------------------------

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <span className="chip" style={{ background: '#dcfce7', color: '#15803d', fontWeight: 700 }}>✓ Approved</span>
      case 'submitted':
      case 'under_review':
        return <span className="chip" style={{ background: '#fef3c7', color: '#b45309', fontWeight: 700 }}>⏳ Submitted</span>
      case 'returned':
        return <span className="chip" style={{ background: '#fee2e2', color: '#b91c1c', fontWeight: 700 }}>↩ Returned</span>
      default:
        return <span className="chip" style={{ background: '#f1f5f9', color: '#475569', fontWeight: 700 }}>Draft</span>
    }
  }

  const renderWeeklyLessonGrid = (source: 'lesson_plans' | 'timetable') => {
    const currentFriday = new Date(selectedWeekMonday)
    currentFriday.setDate(selectedWeekMonday.getDate() + 4)

    return (
      <div>
        {/* Week Navigator & Statistics */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
            flexWrap: 'wrap',
            gap: 10,
            background: '#f8fafc',
            padding: '12px 16px',
            borderRadius: 8,
            border: '1px solid #e2e8f0'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', background: '#e2e8f0', borderRadius: 6, padding: 2 }}>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                style={{ padding: '3px 8px', fontSize: 12 }}
                onClick={() => handleNavigateWeek(-1)}
                title="Previous Week"
              >
                ← Prev Week
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                style={{ padding: '3px 10px', fontSize: 12, fontWeight: 700, color: '#0f172a' }}
                onClick={handleResetCurrentWeek}
              >
                Current Week
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                style={{ padding: '3px 8px', fontSize: 12 }}
                onClick={() => handleNavigateWeek(1)}
                title="Next Week"
              >
                Next Week →
              </button>
            </div>
            <span style={{ fontWeight: 800, fontSize: 14, color: '#0f172a' }}>
              📅 {selectedWeekMonday.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} –{' '}
              {currentFriday.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>

          {/* Status Breakdown Chips */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
            <span style={{ background: '#e2e8f0', color: '#1e293b', padding: '3px 10px', borderRadius: 12, fontWeight: 600 }}>
              {weekSlotStats.totalSlots} Total Periods
            </span>
            <span style={{ background: '#ecfccb', color: '#3f6212', padding: '3px 10px', borderRadius: 12, fontWeight: 700, border: '1.5px solid #84cc16' }}>
              ✓ {weekSlotStats.futurePlannedCount} Future Planned (Lime)
            </span>
            <span style={{ background: '#dcfce7', color: '#14532d', padding: '3px 10px', borderRadius: 12, fontWeight: 700, border: '1.5px solid #166534' }}>
              ✓ {weekSlotStats.pastPlannedCount} Past Delivered (Deep Green)
            </span>
            <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '3px 10px', borderRadius: 12, fontWeight: 700, border: '1.5px solid #3b82f6' }}>
              ⏱ {weekSlotStats.futureUnplannedCount} Future To Plan (Blue)
            </span>
            {weekSlotStats.pastUnplannedCount > 0 && (
              <span style={{ background: '#fee2e2', color: '#991b1b', padding: '3px 10px', borderRadius: 12, fontWeight: 800, border: '2px solid #dc2626' }}>
                ✘ {weekSlotStats.pastUnplannedCount} Past Missed (Sharp Red)
              </span>
            )}
          </div>
        </div>

        {timetableSlots.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🗓</div>
            <h4 style={{ margin: '0 0 6px', color: '#1e293b' }}>No Timetable Schedule Uploaded Yet</h4>
            <p style={{ margin: '0 0 14px', fontSize: 13, maxWidth: 500, marginLeft: 'auto', marginRight: 'auto' }}>
              To plan lessons weekly by date and time and monitor unplanned lessons in real-time, upload your timetable PDF in the Timetable tab.
            </p>
            {source === 'lesson_plans' && (
              <button className="btn btn-secondary btn-small" onClick={() => setActiveTab('timetable')}>
                Go to Timetable Tab
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
            {[0, 1, 2, 3, 4].map((dayIdx) => {
              const dayDate = new Date(selectedWeekMonday)
              dayDate.setDate(selectedWeekMonday.getDate() + dayIdx)
              const dayDateStr = formatDateISO(dayDate)
              const isToday = dayDateStr === formatDateISO(new Date())
              const daySlots = timetableSlots
                .filter((s) => s.day_of_week === dayIdx)
                .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))

              return (
                <div
                  key={dayIdx}
                  style={{
                    background: isToday ? '#f0f9ff' : '#f8fafc',
                    border: isToday ? '2px solid #0284c7' : '1px solid #e2e8f0',
                    borderRadius: 8,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8
                  }}
                >
                  {/* Day Header with Calendar Date */}
                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: 14,
                      color: isToday ? '#0369a1' : '#1e293b',
                      borderBottom: isToday ? '2px solid #38bdf8' : '1px solid #cbd5e1',
                      paddingBottom: 6,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <span>{DAYS_NAMES[dayIdx]}</span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: isToday ? '#0369a1' : '#64748b',
                        background: isToday ? '#e0f2fe' : 'transparent',
                        padding: isToday ? '1px 6px' : 0,
                        borderRadius: 10
                      }}
                    >
                      {dayDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      {isToday ? ' · Today' : ''}
                    </span>
                  </div>

                  {daySlots.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic', padding: '12px 4px', textAlign: 'center' }}>
                      No scheduled lessons
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {daySlots.map((s, idx) => {
                        const matchingLp = findMatchingLessonPlan(s, dayDateStr, displayedLessonPlans)
                        const isPast = isPastLessonSlot(dayDateStr, s.start_time, s.end_time)
                        const isPlanned = !!matchingLp

                        // Four-state color system:
                        // • Future + Planned   → Lime green (#f7fee7 / #84cc16)
                        // • Future + Unplanned → Blue (#eff6ff / #2563eb)
                        // • Past   + Planned   → Deep green (#f0fdf4 / #15803d)
                        // • Past   + Unplanned → Very sharp red (#fef2f2 / #dc2626)
                        const slotBg = isPlanned
                          ? (isPast ? '#f0fdf4' : '#f7fee7')
                          : (isPast ? '#fef2f2' : '#eff6ff')
                        const slotBdr = isPlanned
                          ? (isPast ? '2px solid #15803d' : '2px solid #84cc16')
                          : (isPast ? '2.5px solid #dc2626' : '2px solid #2563eb')
                        const slotShadow = isPast && !isPlanned
                          ? '0 0 0 1px #dc2626, 0 3px 6px rgba(220, 38, 38, 0.18)'
                          : isPlanned
                          ? (isPast ? '0 1px 2px rgba(21, 128, 61, 0.1)' : '0 1px 2px rgba(132, 204, 22, 0.15)')
                          : '0 1px 2px rgba(37, 99, 235, 0.12)'

                        const badgeBg = isPlanned
                          ? (isPast ? '#dcfce7' : '#ecfccb')
                          : (isPast ? '#fee2e2' : '#dbeafe')
                        const badgeClr = isPlanned
                          ? (isPast ? '#14532d' : '#3f6212')
                          : (isPast ? '#991b1b' : '#1d4ed8')
                        const badgeBdr = isPlanned
                          ? (isPast ? '1px solid #86efac' : '1px solid #a3e635')
                          : (isPast ? '1px solid #f87171' : '1px solid #93c5fd')

                        const subjectClr = isPlanned
                          ? (isPast ? '#064e3b' : '#1a2e05')
                          : (isPast ? '#7f1d1d' : '#1e3a8a')
                        const classClr = isPlanned
                          ? (isPast ? '#166534' : '#4d7c0f')
                          : (isPast ? '#b91c1c' : '#2563eb')
                        const timeClr = isPlanned
                          ? (isPast ? '#15803d' : '#4f772d')
                          : (isPast ? '#991b1b' : '#475569')
                        const dividerClr = isPlanned
                          ? (isPast ? '#bbf7d0' : '#d9f99d')
                          : (isPast ? '#fca5a5' : '#bfdbfe')

                        return (
                          <div
                            key={idx}
                            style={{
                              background: slotBg,
                              border: slotBdr,
                              borderRadius: 6,
                              padding: 10,
                              fontSize: 12,
                              boxShadow: slotShadow,
                              transition: 'all 0.15s ease'
                            }}
                          >
                            {/* Status Badge */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 800,
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.3px',
                                  background: badgeBg,
                                  color: badgeClr,
                                  border: badgeBdr
                                }}
                              >
                                {isPlanned
                                  ? (isPast ? `✓ Delivered (${matchingLp.status})` : `✓ Planned (${matchingLp.status})`)
                                  : (isPast ? '✘ Missed – Unplanned' : '⏱ Unplanned')}
                              </span>
                              <span style={{ fontSize: 11, fontWeight: 700, color: timeClr }}>
                                P{s.period_number}
                              </span>
                            </div>

                            {/* Subject & Class */}
                            <div style={{ fontWeight: 800, color: subjectClr, fontSize: 13 }}>
                              {s.subject_name}
                            </div>
                            <div style={{ color: classClr, fontWeight: 700, fontSize: 12 }}>
                              {s.class_name}
                            </div>

                            {/* Time & Room */}
                            <div style={{ fontSize: 11, color: timeClr, marginTop: 2 }}>
                              ⏱ {s.start_time} – {s.end_time} {s.room ? `· 📍 ${s.room}` : ''}
                            </div>

                            {/* Planned Details or Unplanned Action */}
                            {isPlanned ? (
                              <div style={{ marginTop: 6, borderTop: `1px solid ${dividerClr}`, paddingTop: 6 }}>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: isPast ? '#166534' : '#3f6212',
                                    fontWeight: 600,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                  }}
                                  title={matchingLp.topic_title}
                                >
                                  🎯 {matchingLp.topic_title}
                                </div>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-small"
                                  style={{
                                    marginTop: 6,
                                    fontSize: 11,
                                    padding: '3px 8px',
                                    width: '100%',
                                    borderColor: isPast ? '#166534' : '#84cc16',
                                    color: isPast ? '#14532d' : '#3f6212',
                                    fontWeight: 600,
                                    background: '#ffffff'
                                  }}
                                  onClick={() => handleSelectLessonPlan(matchingLp.id)}
                                >
                                  ✏ View & Edit Plan
                                </button>
                              </div>
                            ) : (
                              <div style={{ marginTop: 6, borderTop: `1px solid ${dividerClr}`, paddingTop: 6 }}>
                                {isPast ? (
                                  <div
                                    style={{
                                      background: '#fee2e2',
                                      borderRadius: 4,
                                      padding: '5px 8px',
                                      color: '#991b1b',
                                      fontSize: 11,
                                      fontWeight: 800,
                                      textAlign: 'center',
                                      border: '1px solid #ef4444'
                                    }}
                                  >
                                    🔒 Past Date (Planning Closed)
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn btn-small"
                                    style={{
                                      width: '100%',
                                      fontSize: 11,
                                      padding: '4px 8px',
                                      fontWeight: 700,
                                      background: '#2563eb',
                                      color: '#ffffff',
                                      border: 'none',
                                      cursor: 'pointer',
                                      boxShadow: '0 2px 4px rgba(37, 99, 235, 0.25)'
                                    }}
                                    onClick={() =>
                                      openCreateLessonPlan(
                                        s.class_name,
                                        s.subject_name,
                                        s.start_time,
                                        s.end_time,
                                        dayDateStr,
                                        s.id
                                      )
                                    }
                                  >
                                    + Plan Lesson
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 60 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: '#1e293b' }}>
            Planning & Curriculum
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
            Semester Work Plans, Prospective Lesson Planning, and Cambridge Curriculum Schemes.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {(isTeacher || canManageCurriculum) && (
            <label className="btn btn-secondary btn-small" style={{ cursor: 'pointer', margin: 0 }}>
              <span>{parsingWorkPlanPdf ? (workPlanParseProgress?.percent ? `⏳ Reading (${workPlanParseProgress.percent}%)…` : '⏳ Reading Work Plan…') : '📤 Upload Current Work Plan'}</span>
              <input type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={handleWorkPlanFileUpload} />
            </label>
          )}

          {isTeacher && (
            <label className="btn btn-secondary btn-small" style={{ cursor: 'pointer', margin: 0 }}>
              <span>{parsingTimetable ? '⏳ Parsing...' : '📅 Upload Timetable PDF'}</span>
              <input type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={handleTimetableFileUpload} />
            </label>
          )}

          {canManageCurriculum && (
            <label className="btn btn-secondary btn-small" style={{ cursor: 'pointer', margin: 0 }}>
              <span>{parsingPdf ? '⏳ Reading PDF...' : '📄 Upload Syllabus PDF'}</span>
              <input type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={handleSyllabusFileUpload} />
            </label>
          )}
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="notice notice-error" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button className="btn btn-ghost btn-small" onClick={() => setError(null)}>✕</button>
        </div>
      )}
      {success && (
        <div className="notice notice-ok" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{success}</span>
          <button className="btn btn-ghost btn-small" onClick={() => setSuccess(null)}>✕</button>
        </div>
      )}

      {/* Sub-tab Navigation */}
      <div className="seg" style={{ marginBottom: 20 }}>
        {hasExecutiveAccess && (
          <button
            className={`seg-btn ${activeTab === 'executive' ? 'active' : ''}`}
            onClick={() => setActiveTab('executive')}
            style={activeTab === 'executive' ? { fontWeight: 700 } : undefined}
          >
            📊 Executive Compliance
          </button>
        )}
        <button
          className={`seg-btn ${activeTab === 'work_plans' ? 'active' : ''}`}
          onClick={() => { setActiveTab('work_plans'); setSelectedWorkPlan(null) }}
        >
          📋 Semester Work Plans ({allVisibleWorkPlans.length})
        </button>
        <button
          className={`seg-btn ${activeTab === 'lesson_plans' ? 'active' : ''}`}
          onClick={() => { setActiveTab('lesson_plans'); setSelectedLessonPlan(null) }}
        >
          📖 Lesson Plans ({allVisibleLessonPlans.length})
        </button>
        <button
          className={`seg-btn ${activeTab === 'timetable' ? 'active' : ''}`}
          onClick={() => setActiveTab('timetable')}
        >
          🗓 My Timetable ({timetableSlots.length})
        </button>
        <button
          className={`seg-btn ${activeTab === 'curriculum' ? 'active' : ''}`}
          onClick={() => setActiveTab('curriculum')}
        >
          📚 Curriculum Library ({schemes.length})
        </button>
        {isLeadership && (
          <button
            className={`seg-btn ${activeTab === 'review' ? 'active' : ''}`}
            onClick={() => setActiveTab('review')}
          >
            ⚖ Review Queue ({reviewPlans.workPlans.length + reviewPlans.lessonPlans.length})
          </button>
        )}
      </div>

      {/* ===================================================================== */}
      {/* 0. EXECUTIVE PLANNING DASHBOARD (Director, HOS, Coordinator)         */}
      {/* ===================================================================== */}
      {activeTab === 'executive' && hasExecutiveAccess && (
        <PlanningExecutiveDashboard
          profiles={profiles}
          slots={allTimetableSlots.length > 0 ? allTimetableSlots : timetableSlots}
          lessonPlans={lessonPlans}
          workPlans={workPlans}
          schemes={schemes}
          assignments={assignments}
          classes={classes}
          subjects={subjects}
          currentUserId={profile?.id}
          isDirector={isDirector}
          isHeadOfSchool={isHeadOfSchool}
          isCoordinator={isCoordinator}
          onPreviewLessonPlanPdf={handlePreviewLessonPlanPdf}
          onApproveLessonPlan={handleApproveLessonPlanExecutive}
          onReturnLessonPlan={handleReturnLessonPlanExecutive}
        />
      )}

      {/* ===================================================================== */}
      {/* 1. WORK PLANS TAB                                                     */}
      {/* ===================================================================== */}
      {activeTab === 'work_plans' && (
        <div>
          {!selectedWorkPlan && (
            <TeacherSyllabusCoverageCard
              teacherId={isDirector || isHeadOfSchool ? undefined : profile?.id}
              workPlans={allVisibleWorkPlans}
              lessonPlans={allVisibleLessonPlans}
              schemes={schemes}
              title={isDirector || isHeadOfSchool ? '🎯 School-Wide Syllabus Coverage' : '🎯 My Syllabus Coverage (Work Plans & Lessons)'}
              style={{ marginBottom: 16 }}
            />
          )}
          {!selectedWorkPlan ? (
            (() => {
                return (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <h3 style={{ margin: 0, fontSize: 16 }}>Semester Work Plans</h3>
                        {isLeadership && (
                          <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', padding: 3, borderRadius: 6 }}>
                            <button
                              className={`btn btn-small ${workPlanScope === 'my' ? 'btn-primary' : 'btn-ghost'}`}
                              style={{ padding: '3px 10px', fontSize: 12 }}
                              onClick={() => setWorkPlanScope('my')}
                            >
                              👤 My Teaching Plans ({myWorkPlans.length})
                            </button>
                            <button
                              className={`btn btn-small ${workPlanScope === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                              style={{ padding: '3px 10px', fontSize: 12 }}
                              onClick={() => setWorkPlanScope('all')}
                            >
                              🏫 All School Plans ({allVisibleWorkPlans.length})
                            </button>
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <label className="btn btn-secondary btn-small" style={{ cursor: 'pointer', margin: 0 }}>
                          <span>{parsingWorkPlanPdf ? (workPlanParseProgress?.percent ? `⏳ Reading (${workPlanParseProgress.percent}%)…` : '⏳ Reading Work Plan…') : '📤 Upload Current Work Plan (Onboarding)'}</span>
                          <input type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={handleWorkPlanFileUpload} />
                        </label>
                        <button className="btn btn-primary btn-small" onClick={openCreateWorkPlan}>
                          + New Work Plan
                        </button>
                      </div>
                    </div>

                    {displayedWorkPlans.length === 0 ? (
                      <div className="card" style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
                        <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
                        <h4 style={{ margin: '0 0 6px', color: '#1e293b' }}>
                          {isLeadership && workPlanScope === 'my' ? 'No Personal Teaching Work Plans Yet' : 'No Work Plans Created Yet'}
                        </h4>
                        <p style={{ margin: '0 0 16px', fontSize: 13, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>
                          {isLeadership && workPlanScope === 'my'
                            ? 'As a coordinator and subject teacher, upload your prepared Semester 1 work plan to ingest objectives and track weekly coverage, or initialize a new blank plan.'
                            : 'For onboarding, upload your existing prepared Semester 1 work plan to automatically ingest objectives and map weekly coverage, or initialize a blank plan.'}
                        </p>
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                          <label className="btn btn-secondary" style={{ cursor: 'pointer', margin: 0 }}>
                            <span>{parsingWorkPlanPdf ? (workPlanParseProgress?.percent ? `⏳ Reading (${workPlanParseProgress.percent}%)…` : '⏳ Reading Work Plan…') : '📤 Upload Current Semester 1 Work Plan (PDF)'}</span>
                            <input type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={handleWorkPlanFileUpload} />
                          </label>
                          <button className="btn btn-primary" onClick={openCreateWorkPlan}>
                            + Initialize Blank Work Plan
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
                        {displayedWorkPlans.map((wp) => (
                    <div key={wp.id} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a' }}>
                            {wp.subject_name} · {wp.class_name}
                          </div>
                          <div style={{ fontSize: 12, color: '#64748b' }}>
                            {wp.academic_year} · Semester {wp.semester}
                          </div>
                        </div>
                        {getStatusBadge(wp.status)}
                      </div>

                      <div style={{ fontSize: 12, color: '#475569', background: '#f8fafc', padding: '6px 10px', borderRadius: 6 }}>
                        Teacher: <strong>{wp.teacher_name}</strong>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 'auto' }}>
                        <button className="btn btn-secondary btn-small grow" onClick={() => handleSelectWorkPlan(wp.id)}>
                          ✏ Open & Edit
                        </button>
                        <button className="btn btn-ghost btn-small" onClick={() => handlePreviewWorkPlanPdf(wp)}>
                          📄 PDF
                        </button>
                        {(wp.status === 'draft' || wp.status === 'returned') && (
                          <button className="btn btn-primary btn-small" onClick={() => handleSubmitWorkPlan(wp.id)}>
                            Submit
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })()
          ) : (
            /* Selected Work Plan Editor / Matrix */
            <div className="card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <button className="btn btn-ghost btn-small" onClick={() => setSelectedWorkPlan(null)} style={{ padding: 0, marginBottom: 4 }}>
                    ← Back to Work Plans
                  </button>
                  <h2 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>
                    {selectedWorkPlan.subject_name} · {selectedWorkPlan.class_name} (Semester {selectedWorkPlan.semester})
                  </h2>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    Status: {getStatusBadge(selectedWorkPlan.status)} · Rev. {selectedWorkPlan.revision} · Academic Year: {selectedWorkPlan.academic_year}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary btn-small" onClick={() => handlePreviewWorkPlanPdf(selectedWorkPlan)}>
                    📄 Preview PDF
                  </button>
                  <button className="btn btn-primary btn-small" onClick={handleSaveWorkPlanDraft}>
                    💾 Save Draft
                  </button>
                  {(selectedWorkPlan.status === 'draft' || selectedWorkPlan.status === 'returned') && (
                    <button className="btn btn-small" style={{ background: '#10b981', color: '#fff', fontWeight: 700 }} onClick={() => handleSubmitWorkPlan(selectedWorkPlan.id)}>
                      🚀 Submit for Review
                    </button>
                  )}
                </div>
              </div>

              {/* Coverage Progress Summary & Rules Banner */}
              {(() => {
                const allObjs = (selectedWorkPlan.weeks || []).flatMap((w) => w.objectives || [])
                const coveredCount = allObjs.filter((o) => o.is_met).length
                const uncoveredCount = allObjs.filter((o) => !o.is_met).length
                const wpPct = allObjs.length > 0 ? Math.round((coveredCount / allObjs.length) * 100) : 0

                // Match Full Syllabus Scheme
                const matchingScheme = schemes.find(
                  (s) => s.id === selectedWorkPlan.scheme_id ||
                    s.subject_code === selectedWorkPlan.subject_id ||
                    s.subject_name?.toLowerCase().trim() === selectedWorkPlan.subject_name?.toLowerCase().trim()
                )
                const totalSyllabusObjs = matchingScheme?.objectives_count || allObjs.length
                const sylPct = totalSyllabusObjs > 0 ? Math.min(100, Math.round((coveredCount / totalSyllabusObjs) * 100)) : 0

                return (
                  <div style={{ background: '#f8fafc', border: '1.5px solid #cbd5e1', borderRadius: 8, padding: '14px 18px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
                    <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ textAlign: 'center', borderRight: '1px solid #e2e8f0', paddingRight: 14 }}>
                        <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>WORK PLAN TARGET</div>
                        <div style={{ fontSize: 19, fontWeight: 800, color: '#0f172a' }}>{allObjs.length} <span style={{ fontSize: 11, color: '#64748b' }}>Objs</span></div>
                      </div>
                      <div style={{ textAlign: 'center', borderRight: '1px solid #e2e8f0', paddingRight: 14 }}>
                        <div style={{ fontSize: 11, color: '#166534', fontWeight: 700 }}>✓ COVERED</div>
                        <div style={{ fontSize: 19, fontWeight: 800, color: '#166534' }}>{coveredCount}</div>
                      </div>
                      <div style={{ textAlign: 'center', borderRight: '1px solid #e2e8f0', paddingRight: 14 }}>
                        <div style={{ fontSize: 11, color: '#b45309', fontWeight: 700 }}>⏳ UNCOVERED</div>
                        <div style={{ fontSize: 19, fontWeight: 800, color: '#b45309' }}>{uncoveredCount}</div>
                      </div>
                      <div style={{ textAlign: 'center', borderRight: '1px solid #e2e8f0', paddingRight: 14 }}>
                        <div style={{ fontSize: 11, color: '#0f766e', fontWeight: 700 }}>1. WORK PLAN COVERAGE</div>
                        <div style={{ fontSize: 19, fontWeight: 800, color: '#0f766e' }}>{wpPct}%</div>
                      </div>
                      {totalSyllabusObjs > 0 && (
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 11, color: '#4C2570', fontWeight: 700 }}>2. SYLLABUS COVERAGE</div>
                          <div style={{ fontSize: 19, fontWeight: 800, color: '#4C2570' }}>
                            {sylPct}% <span style={{ fontSize: 11, color: '#64748b' }}>({coveredCount}/{totalSyllabusObjs})</span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div style={{ fontSize: 12, color: '#334155', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '8px 12px', maxWidth: 440 }}>
                      🔒 <strong>Curriculum Coverage Rule:</strong> Objectives used in lesson plans are automatically marked as <strong>Covered</strong>. Teachers will <strong>ONLY use uncovered objectives</strong> to create prospective lesson plans.
                    </div>
                  </div>
                )
              })()}

              {/* Weeks Matrix */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: '#1f8a5f', color: '#fff', textAlign: 'left' }}>
                      <th style={{ padding: '8px 10px', width: 80 }}>Week</th>
                      <th style={{ padding: '8px 10px', width: 120 }}>Timeline / Dates</th>
                      <th style={{ padding: '8px 10px' }}>Topic / Challenge & Unit</th>
                      <th style={{ padding: '8px 10px', width: 240 }}>Learning Objectives</th>
                      <th style={{ padding: '8px 10px', width: 160 }}>Remarks & Lessons</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedWorkPlan.weeks || []).map((week, wIdx) => (
                      <tr key={week.id} style={{ borderBottom: '1px solid #e2e8f0', background: week.is_instructional ? '#fff' : '#fef2f2' }}>
                        <td style={{ padding: '8px 10px', fontWeight: 700 }}>
                          Week {week.sequence}
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{week.month_label}</div>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <input
                            type="text"
                            placeholder="e.g. 01 Sep – 05 Sep"
                            className="field"
                            style={{ width: '100%', fontSize: 11, padding: 4 }}
                            value={week.week_label || ''}
                            onChange={(e) => {
                              const updated = [...(selectedWorkPlan.weeks || [])]
                              updated[wIdx].week_label = e.target.value
                              setSelectedWorkPlan({ ...selectedWorkPlan, weeks: updated })
                            }}
                          />
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, fontSize: 11 }}>
                            <input
                              type="checkbox"
                              checked={week.is_instructional}
                              onChange={(e) => {
                                const updated = [...(selectedWorkPlan.weeks || [])]
                                updated[wIdx].is_instructional = e.target.checked
                                setSelectedWorkPlan({ ...selectedWorkPlan, weeks: updated })
                              }}
                            />
                            Instructional
                          </label>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {week.is_instructional ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <input
                                type="text"
                                placeholder={selectedWorkPlan.subject_name?.toLowerCase().includes('global perspective') ? 'Challenge (e.g. Keeping Healthy)' : 'Main Topic (e.g. Photosynthesis)'}
                                className="field"
                                style={{ width: '100%', fontSize: 12, padding: 4, fontWeight: 600 }}
                                value={week.challenge_title || week.topic_title || ''}
                                onChange={(e) => {
                                  const updated = [...(selectedWorkPlan.weeks || [])]
                                  if (selectedWorkPlan.subject_name?.toLowerCase().includes('global perspective')) {
                                    updated[wIdx].challenge_title = e.target.value
                                  } else {
                                    updated[wIdx].topic_title = e.target.value
                                  }
                                  setSelectedWorkPlan({ ...selectedWorkPlan, weeks: updated })
                                }}
                              />
                              <input
                                type="text"
                                placeholder="Subtopic / Unit (optional)"
                                className="field"
                                style={{ width: '100%', fontSize: 11, padding: 4 }}
                                value={week.subtopic_title || ''}
                                onChange={(e) => {
                                  const updated = [...(selectedWorkPlan.weeks || [])]
                                  updated[wIdx].subtopic_title = e.target.value
                                  setSelectedWorkPlan({ ...selectedWorkPlan, weeks: updated })
                                }}
                              />
                            </div>
                          ) : (
                            <input
                              type="text"
                              placeholder="Special Event (e.g. Mid-term Examinations)"
                              className="field"
                              style={{ width: '100%', fontSize: 12, padding: 4, color: '#dc2626' }}
                              value={week.event_label || ''}
                              onChange={(e) => {
                                const updated = [...(selectedWorkPlan.weeks || [])]
                                updated[wIdx].event_label = e.target.value
                                setSelectedWorkPlan({ ...selectedWorkPlan, weeks: updated })
                              }}
                            />
                          )}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {week.is_instructional ? (
                            <div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {(week.objectives || []).map((obj, oIdx) => (
                                  <div
                                    key={oIdx}
                                    style={{
                                      fontSize: 11,
                                      background: obj.is_met ? '#f0fdf4' : '#fffbeb',
                                      border: obj.is_met ? '1px solid #bbf7d0' : '1px solid #fde68a',
                                      padding: '4px 6px',
                                      borderRadius: 4,
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      gap: 6
                                    }}
                                  >
                                    <div style={{ flex: 1 }}>
                                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                                        <strong>{obj.code_snapshot}</strong>
                                        <button
                                          type="button"
                                          style={{
                                            border: 'none',
                                            borderRadius: 4,
                                            padding: '1px 5px',
                                            fontSize: 9.5,
                                            fontWeight: 700,
                                            cursor: 'pointer',
                                            background: obj.is_met ? '#166534' : '#b45309',
                                            color: '#fff'
                                          }}
                                          title="Click to toggle: Covered vs Not Covered"
                                          onClick={() => {
                                            const updated = [...(selectedWorkPlan.weeks || [])]
                                            const target = updated[wIdx].objectives?.[oIdx]
                                            if (target) {
                                              target.is_met = !target.is_met
                                              target.met_at = target.is_met ? new Date().toISOString() : null
                                              setSelectedWorkPlan({ ...selectedWorkPlan, weeks: updated })
                                            }
                                          }}
                                        >
                                          {obj.is_met ? '✓ Covered' : '⏳ Not Covered'}
                                        </button>
                                      </div>
                                      <div style={{ color: '#475569', fontSize: 10.5 }}>
                                        {obj.text_snapshot.substring(0, 50)}...
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-small"
                                      style={{ padding: 0, color: '#dc2626' }}
                                      title="Delete objective from week"
                                      onClick={() => {
                                        const updated = [...(selectedWorkPlan.weeks || [])]
                                        updated[wIdx].objectives?.splice(oIdx, 1)
                                        setSelectedWorkPlan({ ...selectedWorkPlan, weeks: updated })
                                      }}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                ))}
                              </div>
                              <button
                                type="button"
                                className="btn btn-secondary btn-small"
                                style={{ marginTop: 6, fontSize: 11, padding: '2px 6px' }}
                                onClick={() => {
                                  const code = prompt('Enter objective code (e.g. 8Sc.01 or 0838.R01):')
                                  if (!code) return
                                  const text = prompt('Enter learning objective description:') || code
                                  const updated = [...(selectedWorkPlan.weeks || [])]
                                  const objs = updated[wIdx].objectives || []
                                  objs.push({ code_snapshot: code, text_snapshot: text, is_met: false, id: '', work_plan_week_id: week.id, objective_id: null, met_at: null })
                                  updated[wIdx].objectives = objs
                                  setSelectedWorkPlan({ ...selectedWorkPlan, weeks: updated })
                                }}
                              >
                                + Add Objective
                              </button>
                            </div>
                          ) : (
                            <span style={{ color: '#94a3b8', fontSize: 11 }}>No objectives</span>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontSize: 11, color: '#64748b' }}>Lessons:</span>
                            <input
                              type="number"
                              min={0}
                              max={10}
                              className="field"
                              style={{ width: 54, fontSize: 13, padding: '4px 6px', fontWeight: 700, textAlign: 'center', border: '1.5px solid #94a3b8', borderRadius: 6, backgroundColor: '#ffffff', color: '#0f172a' }}
                              value={week.lessons_per_week || 1}
                              onChange={(e) => {
                                const updated = [...(selectedWorkPlan.weeks || [])]
                                updated[wIdx].lessons_per_week = parseInt(e.target.value) || 1
                                setSelectedWorkPlan({ ...selectedWorkPlan, weeks: updated })
                              }}
                            />
                          </div>
                          <textarea
                            placeholder="Remarks / Coverage comments (e.g. Covered, Not covered)..."
                            className="field"
                            rows={2}
                            style={{ width: '100%', fontSize: 12.5, padding: '6px 8px', border: '1.5px solid #94a3b8', borderRadius: 6, backgroundColor: '#ffffff', color: '#0f172a', fontWeight: 500 }}
                            value={week.remarks || ''}
                            onChange={(e) => {
                              const updated = [...(selectedWorkPlan.weeks || [])]
                              updated[wIdx].remarks = e.target.value
                              setSelectedWorkPlan({ ...selectedWorkPlan, weeks: updated })
                            }}
                          />
                          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                            <button
                              type="button"
                              style={{ fontSize: 9.5, padding: '2px 5px', borderRadius: 4, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#166534', cursor: 'pointer', fontWeight: 600 }}
                              title="Mark all objectives in this week as Covered"
                              onClick={() => {
                                const updated = [...(selectedWorkPlan.weeks || [])]
                                const w = updated[wIdx]
                                if (w.objectives) {
                                  w.objectives.forEach((o) => {
                                    o.is_met = true
                                    o.met_at = new Date().toISOString()
                                  })
                                }
                                if (!w.remarks || /not covered/i.test(w.remarks)) {
                                  w.remarks = 'Covered'
                                }
                                setSelectedWorkPlan({ ...selectedWorkPlan, weeks: updated })
                              }}
                            >
                              ✓ All Covered
                            </button>
                            <button
                              type="button"
                              style={{ fontSize: 9.5, padding: '2px 5px', borderRadius: 4, border: '1px solid #fde68a', background: '#fffbeb', color: '#b45309', cursor: 'pointer', fontWeight: 600 }}
                              title="Mark all objectives in this week as Not Covered"
                              onClick={() => {
                                const updated = [...(selectedWorkPlan.weeks || [])]
                                const w = updated[wIdx]
                                if (w.objectives) {
                                  w.objectives.forEach((o) => {
                                    o.is_met = false
                                    o.met_at = null
                                  })
                                }
                                if (!w.remarks || /covered/i.test(w.remarks)) {
                                  w.remarks = 'Not covered'
                                }
                                setSelectedWorkPlan({ ...selectedWorkPlan, weeks: updated })
                              }}
                            >
                              ⏳ Not Covered
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* 2. LESSON PLANS TAB                                                   */}
      {/* ===================================================================== */}
      {activeTab === 'lesson_plans' && (
        <div>
          {!selectedLessonPlan && (
            <TeacherSyllabusCoverageCard
              teacherId={isDirector || isHeadOfSchool ? undefined : profile?.id}
              workPlans={allVisibleWorkPlans}
              lessonPlans={allVisibleLessonPlans}
              schemes={schemes}
              title={isDirector || isHeadOfSchool ? '🎯 School-Wide Syllabus Coverage' : '🎯 My Syllabus Coverage Status'}
              style={{ marginBottom: 16 }}
            />
          )}
          {!selectedLessonPlan ? (
            (() => {
              return (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <h3 style={{ margin: 0, fontSize: 16 }}>Scheduled Lesson Plans</h3>
                      {/* View Mode Switcher: Weekly Lesson Grid vs All Plans */}
                      <div style={{ display: 'flex', gap: 3, background: '#e2e8f0', padding: 2, borderRadius: 6 }}>
                        <button
                          type="button"
                          className={`btn btn-small ${lpViewMode === 'grid' ? 'btn-primary' : 'btn-ghost'}`}
                          style={{ padding: '3px 10px', fontSize: 12, fontWeight: 700 }}
                          onClick={() => setLpViewMode('grid')}
                        >
                          📅 Weekly Lesson Grid
                        </button>
                        <button
                          type="button"
                          className={`btn btn-small ${lpViewMode === 'list' ? 'btn-primary' : 'btn-ghost'}`}
                          style={{ padding: '3px 10px', fontSize: 12, fontWeight: 700 }}
                          onClick={() => setLpViewMode('list')}
                        >
                          📋 All Lesson Plans ({displayedLessonPlans.length})
                        </button>
                      </div>

                      {isLeadership && (
                        <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', padding: 3, borderRadius: 6 }}>
                          <button
                            className={`btn btn-small ${lessonPlanScope === 'my' ? 'btn-primary' : 'btn-ghost'}`}
                            style={{ padding: '3px 10px', fontSize: 12 }}
                            onClick={() => setLessonPlanScope('my')}
                          >
                            👤 My Lesson Plans ({myLessonPlans.length})
                          </button>
                          <button
                            className={`btn btn-small ${lessonPlanScope === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                            style={{ padding: '3px 10px', fontSize: 12 }}
                            onClick={() => setLessonPlanScope('all')}
                          >
                            🏫 All School Plans ({allVisibleLessonPlans.length})
                          </button>
                        </div>
                      )}
                    </div>
                    <button className="btn btn-primary btn-small" onClick={() => openCreateLessonPlan()}>
                      + New Lesson Plan
                    </button>
                  </div>

                  {lpViewMode === 'grid' ? (
                    renderWeeklyLessonGrid('lesson_plans')
                  ) : displayedLessonPlans.length === 0 ? (
                    <div className="card" style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
                      <div style={{ fontSize: 36, marginBottom: 10 }}>📖</div>
                      <h4 style={{ margin: '0 0 6px', color: '#1e293b' }}>
                        {isLeadership && lessonPlanScope === 'my' ? 'No Personal Lesson Plans Yet' : 'No Lesson Plans Created Yet'}
                      </h4>
                      <p style={{ margin: '0 0 16px', fontSize: 13, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>
                        {isLeadership && lessonPlanScope === 'my'
                          ? 'As a coordinator and subject teacher, create prospective lesson plans for your assigned classes, complete with learning objectives and differentiation strategies.'
                          : 'Prepare prospective lesson plans with learning objectives, teaching activities, and assessment ideas.'}
                      </p>
                      <button className="btn btn-primary" onClick={() => openCreateLessonPlan()}>
                        + Create Lesson Plan
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
                      {displayedLessonPlans.map((lp) => (
                        <div key={lp.id} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a' }}>
                                {lp.subject_name} · {lp.class_name}
                              </div>
                              <div style={{ fontSize: 12, color: '#64748b' }}>
                                {new Date(lp.lesson_date).toLocaleDateString()}
                                {lp.start_time ? ` (${lp.start_time} – ${lp.end_time || ''})` : ''}
                              </div>
                            </div>
                            {getStatusBadge(lp.status)}
                          </div>

                          <div style={{ fontSize: 12, color: '#1e293b', background: '#f1f5f9', padding: '6px 10px', borderRadius: 6 }}>
                            <strong>{lp.challenge_title ? `Challenge: ${lp.challenge_title}` : 'Topic:'}</strong> {lp.topic_title}
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 'auto' }}>
                            <button className="btn btn-secondary btn-small grow" onClick={() => handleSelectLessonPlan(lp.id)}>
                              ✏ View & Edit
                            </button>
                            <button className="btn btn-ghost btn-small" onClick={() => handlePreviewLessonPlanPdf(lp)}>
                              📄 PDF
                            </button>
                            {(lp.status === 'draft' || lp.status === 'returned') && (() => {
                              const isPast = isLessonTimeInPast(lp.lesson_date, lp.end_time, lp.start_time)
                              const remarksLength = (lp.reflection_remarks || '').length
                              const hasRemarks = remarksLength >= 16
                              const canSubmit = isPast && hasRemarks

                              return (
                                <button
                                  className="btn btn-primary btn-small"
                                  disabled={!canSubmit}
                                  onClick={() => canSubmit && handleSubmitLessonPlan(lp.id)}
                                  title={
                                    !isPast
                                      ? 'Cannot submit yet: Scheduled lesson time has not passed.'
                                      : !hasRemarks
                                      ? 'Cannot submit yet: Please complete Teacher Reflections & Evaluation.'
                                      : 'Submit for review'
                                  }
                                  style={{
                                    opacity: canSubmit ? 1 : 0.5,
                                    cursor: canSubmit ? 'pointer' : 'not-allowed'
                                  }}
                                >
                                  Submit
                                </button>
                              )
                            })()}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })()
          ) : (
            /* Selected Lesson Plan Detail Editor */
            <div className="card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <button className="btn btn-ghost btn-small" onClick={() => setSelectedLessonPlan(null)} style={{ padding: 0, marginBottom: 4 }}>
                    ← Back to Lesson Plans
                  </button>
                  <h2 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>
                    {selectedLessonPlan.subject_name} · {selectedLessonPlan.class_name}
                  </h2>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    Date: {new Date(selectedLessonPlan.lesson_date).toLocaleDateString()}
                    {selectedLessonPlan.start_time ? ` (${selectedLessonPlan.start_time} – ${selectedLessonPlan.end_time})` : ''}
                    {' · Status: '}{getStatusBadge(selectedLessonPlan.status)}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary btn-small" onClick={() => handlePreviewLessonPlanPdf(selectedLessonPlan)}>
                    📄 Preview PDF
                  </button>
                  <button className="btn btn-primary btn-small" onClick={handleSaveLessonPlan}>
                    💾 Save Plan
                  </button>
                  {(selectedLessonPlan.status === 'draft' || selectedLessonPlan.status === 'returned') && (() => {
                    const isPast = isLessonTimeInPast(selectedLessonPlan.lesson_date, selectedLessonPlan.end_time, selectedLessonPlan.start_time)
                    const remarksLength = (selectedLessonPlan.reflection_remarks || '').length
                    const hasRemarks = remarksLength >= 16
                    const canSubmit = isPast && hasRemarks

                    return (
                      <button
                        className="btn btn-small"
                        disabled={!canSubmit}
                        style={{
                          background: canSubmit ? '#10b981' : '#94a3b8',
                          color: '#fff',
                          fontWeight: 700,
                          cursor: canSubmit ? 'pointer' : 'not-allowed',
                          opacity: canSubmit ? 1 : 0.65
                        }}
                        onClick={() => canSubmit && handleSubmitLessonPlan(selectedLessonPlan.id)}
                        title={
                          !isPast
                            ? 'Cannot submit yet: Scheduled lesson time has not passed.'
                            : !hasRemarks
                            ? 'Cannot submit yet: Please complete Teacher Reflections & Evaluation below.'
                            : 'Submit this lesson plan for leadership review'
                        }
                      >
                        🚀 Submit for Review
                      </button>
                    )
                  })()}
                </div>
              </div>

              {/* Two-tone accent divider bar matching PDF header */}
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20, height: 5, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: '48%', height: '100%', backgroundColor: '#E30A14' }} />
                <div style={{ width: '52%', height: '100%', backgroundColor: '#4C2570' }} />
              </div>

              {/* Form organized in exact order of the Lesson Plan PDF */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* ── 1. CONTEXT & METADATA (Header Table in PDF) ── */}
                <div style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, overflow: 'hidden', backgroundColor: '#ffffff', boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)' }}>
                  <div style={{ backgroundColor: '#f8fafc', padding: '10px 16px', borderBottom: '1.5px solid #cbd5e1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#4C2570', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      1. Context &amp; Schedule Metadata
                    </span>
                    <span style={{ fontSize: 11.5, color: '#64748b' }}>Table Rows 1 – 3 in Lesson Plan PDF</span>
                  </div>

                  <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    {/* Row 1: Teacher & Class */}
                    <div>
                      <label className="field-label">Teacher</label>
                      <input
                        type="text"
                        className="field"
                        style={{ width: '100%', backgroundColor: '#f1f5f9', cursor: 'default', fontWeight: 600 }}
                        value={selectedLessonPlan.teacher_name || profile?.full_name || 'Subject Teacher'}
                        readOnly
                      />
                    </div>
                    <div>
                      <label className="field-label">Class</label>
                      <input
                        type="text"
                        className="field"
                        style={{ width: '100%', backgroundColor: '#f1f5f9', cursor: 'default', fontWeight: 600 }}
                        value={selectedLessonPlan.class_name || 'Class'}
                        readOnly
                      />
                    </div>

                    {/* Row 2: Subject & Date/Time */}
                    <div>
                      <label className="field-label">Subject</label>
                      <input
                        type="text"
                        className="field"
                        style={{ width: '100%', backgroundColor: '#f1f5f9', cursor: 'default', fontWeight: 600 }}
                        value={selectedLessonPlan.subject_name || 'Subject'}
                        readOnly
                      />
                    </div>
                    <div>
                      <label className="field-label">Lesson Date &amp; Scheduled Time</label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 6 }}>
                        <input
                          type="date"
                          className="field"
                          value={selectedLessonPlan.lesson_date}
                          onChange={(e) => setSelectedLessonPlan({ ...selectedLessonPlan, lesson_date: e.target.value })}
                        />
                        <input
                          type="time"
                          className="field"
                          placeholder="Start"
                          value={selectedLessonPlan.start_time || ''}
                          onChange={(e) => setSelectedLessonPlan({ ...selectedLessonPlan, start_time: e.target.value })}
                        />
                        <input
                          type="time"
                          className="field"
                          placeholder="End"
                          value={selectedLessonPlan.end_time || ''}
                          onChange={(e) => setSelectedLessonPlan({ ...selectedLessonPlan, end_time: e.target.value })}
                        />
                      </div>
                    </div>

                    {/* Row 3: Unit / Sub-Unit (Topic Title) spanning both columns */}
                    <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div>
                        <label className="field-label" style={{ fontWeight: 700, color: '#0f172a' }}>Unit / Sub-Unit (Topic Title)</label>
                        <input
                          type="text"
                          className="field"
                          style={{ width: '100%' }}
                          placeholder="e.g. Unit 2: Networks and Digital Communication"
                          value={selectedLessonPlan.topic_title || ''}
                          onChange={(e) => setSelectedLessonPlan({ ...selectedLessonPlan, topic_title: e.target.value })}
                        />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div>
                          <label className="field-label">Challenge (Optional)</label>
                          <input
                            type="text"
                            placeholder="e.g. Keeping Healthy / Digital World"
                            className="field"
                            style={{ width: '100%' }}
                            value={selectedLessonPlan.challenge_title || ''}
                            onChange={(e) => setSelectedLessonPlan({ ...selectedLessonPlan, challenge_title: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="field-label">Subtopic (Optional)</label>
                          <input
                            type="text"
                            placeholder="e.g. Binary patterns"
                            className="field"
                            style={{ width: '100%' }}
                            value={selectedLessonPlan.subtopic_title || ''}
                            onChange={(e) => setSelectedLessonPlan({ ...selectedLessonPlan, subtopic_title: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── LEARNING OBJECTIVES (Directly below Topic / Unit) ── */}
                <div style={{ background: '#f8fafc', padding: 16, borderRadius: 8, border: '1.5px solid #cbd5e1', boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <label className="field-label" style={{ fontSize: 14, color: '#4C2570', fontWeight: 800, margin: 0, textTransform: 'uppercase' }}>
                        🎯 Learning Objectives ({(selectedLessonPlan.objectives || []).length})
                      </label>
                      <div style={{ fontSize: 11.5, color: '#475569', fontStyle: 'italic', marginTop: 2 }}>
                        "By the end of this lesson, learners should be able to:"
                      </div>
                    </div>

                    {/* Add Uncovered Objective Dropdown from Work Plan */}
                    {(() => {
                      const existingCodes = new Set((selectedLessonPlan.objectives || []).map((o) => o.code_snapshot))
                      const availableUncovered = (matchingWpForSelectedLp?.weeks || []).flatMap((w) =>
                        (w.objectives || [])
                          .filter((o) => !o.is_met && !existingCodes.has(o.code_snapshot))
                          .map((o) => ({ ...o, week_sequence: w.sequence }))
                      )

                      const predictedCodes = new Set((smartPredictionForSelected?.predictedObjectives || []).map((p) => p.code_snapshot))

                      const sortedAvailable = [...availableUncovered].sort((a, b) => {
                        const aPred = predictedCodes.has(a.code_snapshot) ? 1 : 0
                        const bPred = predictedCodes.has(b.code_snapshot) ? 1 : 0
                        if (aPred !== bPred) return bPred - aPred
                        return a.week_sequence - b.week_sequence
                      })

                      return (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {sortedAvailable.length > 0 ? (
                            <>
                              <select
                                className="field select"
                                style={{ fontSize: 12, padding: '5px 10px', maxWidth: 320 }}
                                value={addObjectiveCodeForSelectedLp}
                                onChange={(e) => setAddObjectiveCodeForSelectedLp(e.target.value)}
                              >
                                <option value="">-- Add Uncovered Objective from Work Plan --</option>
                                {sortedAvailable.map((o, idx) => {
                                  const isPred = predictedCodes.has(o.code_snapshot)
                                  return (
                                    <option key={idx} value={o.code_snapshot}>
                                      {isPred ? '✨ [RECOMMENDED NEXT] ' : ''}[W{o.week_sequence}] {o.code_snapshot}: {o.text_snapshot.substring(0, 35)}...
                                    </option>
                                  )
                                })}
                              </select>
                              <button
                                type="button"
                                className="btn btn-secondary btn-small"
                                style={{ fontSize: 12, padding: '5px 10px', fontWeight: 700 }}
                                disabled={!addObjectiveCodeForSelectedLp}
                                onClick={() => {
                                  const targetObj = sortedAvailable.find((o) => o.code_snapshot === addObjectiveCodeForSelectedLp)
                                  if (targetObj) {
                                    const updated = [...(selectedLessonPlan.objectives || [])]
                                    updated.push({
                                      id: `lpo-${Date.now()}`,
                                      lesson_plan_id: selectedLessonPlan.id,
                                      objective_id: targetObj.objective_id,
                                      code_snapshot: targetObj.code_snapshot,
                                      text_snapshot: targetObj.text_snapshot
                                    })
                                    setSelectedLessonPlan({ ...selectedLessonPlan, objectives: updated })
                                    setAddObjectiveCodeForSelectedLp('')
                                  }
                                }}
                              >
                                + Attach
                              </button>
                            </>
                          ) : (
                            <span style={{ fontSize: 11, color: '#166534', background: '#dcfce7', padding: '3px 8px', borderRadius: 4, fontWeight: 700 }}>
                              ✓ All Work Plan Objectives Covered
                            </span>
                          )}
                        </div>
                      )
                    })()}
                  </div>

                  {/* Smart Prediction Suggestion Banner if no objectives are attached yet */}
                  {smartPredictionForSelected && smartPredictionForSelected.predictedObjectives.length > 0 && (selectedLessonPlan.objectives || []).length === 0 && (
                    <div style={{ background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: 8, padding: '10px 14px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <span style={{ fontSize: 18 }}>✨</span>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 800, color: '#166534', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>Smart Default Prediction:</span>
                            <span style={{ background: '#16a34a', color: '#fff', fontSize: 11, padding: '1px 6px', borderRadius: 4 }}>
                              Week {smartPredictionForSelected.weekSequence} · {smartPredictionForSelected.predictedObjectives[0].code_snapshot}
                            </span>
                          </div>
                          <div style={{ fontSize: 11.5, color: '#15803d', marginTop: 2 }}>
                            {smartPredictionForSelected.predictedObjectives[0].text_snapshot}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary btn-small"
                        style={{ fontSize: 12, padding: '5px 12px', fontWeight: 700 }}
                        onClick={() => {
                          const targetObj = smartPredictionForSelected.predictedObjectives[0]
                          const updated = [...(selectedLessonPlan.objectives || [])]
                          updated.push({
                            id: `lpo-${Date.now()}`,
                            lesson_plan_id: selectedLessonPlan.id,
                            objective_id: targetObj.objective_id || null,
                            code_snapshot: targetObj.code_snapshot,
                            text_snapshot: targetObj.text_snapshot
                          })
                          setSelectedLessonPlan({ ...selectedLessonPlan, objectives: updated })
                        }}
                      >
                        + Attach Predicted Objective
                      </button>
                    </div>
                  )}

                  {(selectedLessonPlan.objectives || []).length === 0 ? (
                    <div style={{ fontSize: 12.5, color: '#64748b', fontStyle: 'italic', background: '#fff', padding: 12, borderRadius: 6, border: '1.5px dashed #cbd5e1' }}>
                      No specific learning objectives attached yet. In the PDF, general curriculum objectives will appear, or you can attach uncovered objectives above.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {(selectedLessonPlan.objectives || []).map((obj, idx) => (
                        <div
                          key={idx}
                          style={{
                            background: '#fff',
                            border: '1.5px solid #cbd5e1',
                            borderRadius: 6,
                            padding: '8px 12px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: 13
                          }}
                        >
                          <div>
                            <span className="chip" style={{ fontSize: 10.5, padding: '1px 6px', background: '#fef3c7', color: '#b45309', marginRight: 8, fontWeight: 700 }}>
                              ⏳ UNCOVERED
                            </span>
                            <strong style={{ color: '#0f172a' }}>{obj.code_snapshot}:</strong>{' '}
                            <span style={{ color: '#334155' }}>{obj.text_snapshot}</span>
                          </div>
                          <button
                            type="button"
                            className="btn btn-ghost btn-small"
                            style={{ color: '#dc2626', padding: '2px 8px', fontSize: 12 }}
                            title="Remove objective from lesson plan"
                            onClick={() => {
                              const updated = [...(selectedLessonPlan.objectives || [])]
                              updated.splice(idx, 1)
                              setSelectedLessonPlan({ ...selectedLessonPlan, objectives: updated })
                            }}
                          >
                            ✕ Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── MAIN TEACHING ACTIVITIES & INQUIRY (4 Dedicated Sub-Sections) ── */}
                <div style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: 16, backgroundColor: '#ffffff', boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <label className="field-label" style={{ fontSize: 14, color: '#4C2570', fontWeight: 800, margin: 0, textTransform: 'uppercase' }}>
                        Main Teaching Activities &amp; Inquiry
                      </label>
                      <span style={{ fontSize: 11.5, color: '#64748b' }}>
                        4 instructional stages rendered directly into the PDF: Starter, Exposition, Learners Activity, and Plenary
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-small"
                        disabled={generatingAllStages}
                        onClick={handleGenerateAllForSelectedLp}
                        style={{
                          fontSize: 11.5,
                          fontWeight: 700,
                          background: generatingAllStages ? '#94a3b8' : 'linear-gradient(135deg, #7c3aed 0%, #4C2570 100%)',
                          color: '#ffffff',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6
                        }}
                      >
                        {generatingAllStages ? 'Generating All 4 Stages...' : '✨ Generate All 4 Stages (AI)'}
                      </button>
                    </div>
                  </div>

                  {(() => {
                    const stages = parseActivityStages(selectedLessonPlan.main_teaching_activity)

                    const updateStage = (key: keyof TeachingActivityStages, value: string) => {
                      const updatedStages = { ...stages, [key]: value }
                      const combined = formatActivityStages(updatedStages)
                      setSelectedLessonPlan({ ...selectedLessonPlan, main_teaching_activity: combined })
                    }

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {/* Sub-section 1: Starter */}
                        <div style={{ border: '1.5px solid #cbd5e1', borderRadius: 6, padding: 12, backgroundColor: '#f8fafc' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <label className="field-label" style={{ fontWeight: 800, margin: 0, color: '#15803d', fontSize: 13 }}>
                                1. Starter
                              </label>
                              <span style={{ fontSize: 11, color: '#15803d', background: '#dcfce7', padding: '1px 8px', borderRadius: 10, fontWeight: 700 }}>
                                Inquiry Hook / Warm-up
                              </span>
                            </div>
                            <AiStageButton
                              stage="starter"
                              onGenerated={(text) => updateStage('starter', text)}
                              getContext={getContextForSelectedLp}
                              onPromptApiKey={() => setShowGeminiApiKeyModal(true)}
                              onError={(msg) => setError(msg)}
                            />
                          </div>
                          <textarea
                            rows={3}
                            className="field"
                            style={{ width: '100%', backgroundColor: '#ffffff', lineHeight: 1.45 }}
                            placeholder="e.g. Torch ON/OFF demo — “Computers only see two states; how do they show numbers, pictures and words?”; introduce the lesson question."
                            value={stages.starter}
                            onChange={(e) => updateStage('starter', e.target.value)}
                          />
                        </div>

                        {/* Sub-section 2: Exposition */}
                        <div style={{ border: '1.5px solid #cbd5e1', borderRadius: 6, padding: 12, backgroundColor: '#f8fafc' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <label className="field-label" style={{ fontWeight: 800, margin: 0, color: '#0369a1', fontSize: 13 }}>
                                2. Exposition
                              </label>
                              <span style={{ fontSize: 11, color: '#0369a1', background: '#e0f2fe', padding: '1px 8px', borderRadius: 10, fontWeight: 700 }}>
                                Direct Instruction / Teacher Modeling
                              </span>
                            </div>
                            <AiStageButton
                              stage="exposition"
                              onGenerated={(text) => updateStage('exposition', text)}
                              getContext={getContextForSelectedLp}
                              onPromptApiKey={() => setShowGeminiApiKeyModal(true)}
                              onError={(msg) => setError(msg)}
                            />
                          </div>
                          <textarea
                            rows={3}
                            className="field"
                            style={{ width: '100%', backgroundColor: '#ffffff', lineHeight: 1.45 }}
                            placeholder="e.g. Explain network topologies (bus, ring, star) with board diagrams, demonstrate how packets flow through each layout, give solved examples comparing failure points, and check understanding with a quick hinge question."
                            value={stages.exposition}
                            onChange={(e) => updateStage('exposition', e.target.value)}
                          />
                        </div>

                        {/* Sub-section 3: Learners Activity */}
                        <div style={{ border: '1.5px solid #cbd5e1', borderRadius: 6, padding: 12, backgroundColor: '#f8fafc' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <label className="field-label" style={{ fontWeight: 800, margin: 0, color: '#6b21a8', fontSize: 13 }}>
                                3. Learners Activity
                              </label>
                              <span style={{ fontSize: 11, color: '#6b21a8', background: '#f3e8ff', padding: '1px 8px', borderRadius: 10, fontWeight: 700 }}>
                                Guided Tasks / Hands-on Practice
                              </span>
                            </div>
                            <AiStageButton
                              stage="learnersActivity"
                              onGenerated={(text) => updateStage('learnersActivity', text)}
                              getContext={getContextForSelectedLp}
                              onPromptApiKey={() => setShowGeminiApiKeyModal(true)}
                              onError={(msg) => setError(msg)}
                            />
                          </div>
                          <textarea
                            rows={3}
                            className="field"
                            style={{ width: '100%', backgroundColor: '#ffffff', lineHeight: 1.45 }}
                            placeholder="e.g. Three stations — (a) binary counting cards: hold up 0/1 cards to build given numbers and write binary patterns; (b) data-size ladder: order bit, byte, kilobyte, megabyte; (c) version control: edit a shared document..."
                            value={stages.learnersActivity}
                            onChange={(e) => updateStage('learnersActivity', e.target.value)}
                          />
                        </div>

                        {/* Sub-section 4: Plenary */}
                        <div style={{ border: '1.5px solid #cbd5e1', borderRadius: 6, padding: 12, backgroundColor: '#f8fafc' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <label className="field-label" style={{ fontWeight: 800, margin: 0, color: '#b45309', fontSize: 13 }}>
                                4. Plenary
                              </label>
                              <span style={{ fontSize: 11, color: '#b45309', background: '#fef3c7', padding: '1px 8px', borderRadius: 10, fontWeight: 700 }}>
                                Exit Ticket / Lesson Synthesis
                              </span>
                            </div>
                            <AiStageButton
                              stage="plenary"
                              onGenerated={(text) => updateStage('plenary', text)}
                              getContext={getContextForSelectedLp}
                              onPromptApiKey={() => setShowGeminiApiKeyModal(true)}
                              onError={(msg) => setError(msg)}
                            />
                          </div>
                          <textarea
                            rows={3}
                            className="field"
                            style={{ width: '100%', backgroundColor: '#ffffff', lineHeight: 1.45 }}
                            placeholder="e.g. Exit ticket — read one binary pattern, answer one data-size question, and state one benefit of version control; preview Friday’s new unit on networks."
                            value={stages.plenary}
                            onChange={(e) => updateStage('plenary', e.target.value)}
                          />
                        </div>
                      </div>
                    )
                  })()}
                </div>

                {/* ── ASSESSMENT IDEAS & RESOURCES (Two-Column Layout) ── */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
                  {/* Assessment Ideas */}
                  <div style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: 16, backgroundColor: '#ffffff', boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                      <div>
                        <label className="field-label" style={{ fontSize: 14, color: '#4C2570', fontWeight: 800, margin: 0, textTransform: 'uppercase' }}>
                          Assessment Ideas
                        </label>
                        <span style={{ fontSize: 11.5, color: '#64748b', display: 'block', marginTop: 2 }}>
                          Formative checks, marked sheets, observation rubrics, exit tickets
                        </span>
                      </div>
                      <AiStageButton
                        stage="assessmentIdeas"
                        onGenerated={(text) => setSelectedLessonPlan({ ...selectedLessonPlan, assessment_ideas: text })}
                        getContext={getContextForSelectedLp}
                        onPromptApiKey={() => setShowGeminiApiKeyModal(true)}
                        onError={(msg) => setError(msg)}
                      />
                    </div>
                    <textarea
                      rows={4}
                      className="field"
                      style={{ width: '100%' }}
                      placeholder="• Marked activity sheets and binary counting cards.&#10;• Completed data-size ladder and file-matching exercise.&#10;• Exit ticket checked and recorded."
                      value={selectedLessonPlan.assessment_ideas || ''}
                      onChange={(e) => setSelectedLessonPlan({ ...selectedLessonPlan, assessment_ideas: e.target.value })}
                    />
                  </div>

                  {/* Resources & Differentiation */}
                  <div style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: 16, backgroundColor: '#ffffff', boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)' }}>
                    <div style={{ marginBottom: 8 }}>
                      <label className="field-label" style={{ fontSize: 14, color: '#4C2570', fontWeight: 800, margin: 0, textTransform: 'uppercase' }}>
                        Resources &amp; Differentiation
                      </label>
                      <span style={{ fontSize: 11.5, color: '#64748b', display: 'block', marginTop: 2 }}>
                        Indicate any special resources, scaffolds, or differentiation strategies for learners
                      </span>
                    </div>
                    <textarea
                      rows={4}
                      className="field"
                      style={{ width: '100%' }}
                      placeholder="Lesson Notes&#10;Projector / Laptop&#10;Learner’s Book & Coursebook&#10;Whiteboard & Markers"
                      value={selectedLessonPlan.resources || ''}
                      onChange={(e) => setSelectedLessonPlan({ ...selectedLessonPlan, resources: e.target.value })}
                    />
                  </div>
                </div>

                {/* ── POST-LESSON DELIVERY & EVALUATION (Attendance & Reflections) ── */}
                <div style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, overflow: 'hidden', backgroundColor: '#ffffff', boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)' }}>
                  <div style={{ backgroundColor: '#f8fafc', padding: '10px 16px', borderBottom: '1.5px solid #cbd5e1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#4C2570', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Post-Lesson Delivery &amp; Evaluation
                    </span>
                    <span style={{ fontSize: 11.5, color: '#64748b' }}>Post-Lesson Attendance &amp; Teacher Reflections</span>
                  </div>

                  <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* Attendance Record */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <label className="field-label" style={{ fontWeight: 700, marginBottom: 0 }}>Attendance (Post-Lesson Record)</label>
                        <button
                          type="button"
                          onClick={handleSyncAttendanceForSelectedLp}
                          disabled={syncingAttendance}
                          className="btn btn-secondary btn-sm"
                          style={{
                            fontSize: 11,
                            padding: '3px 8px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            backgroundColor: '#f1f5f9',
                            borderColor: '#cbd5e1',
                            color: '#334155',
                            cursor: syncingAttendance ? 'not-allowed' : 'pointer'
                          }}
                          title="Auto-fill boys and girls attendance from the official daily register for this class & date"
                        >
                          <span style={{ fontSize: 12 }}>{syncingAttendance ? '⏳' : '🔄'}</span>
                          {syncingAttendance ? 'Syncing...' : 'Auto-fill from Daily Attendance'}
                        </button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <span style={{ fontSize: 11.5, color: '#334155', fontWeight: 700, display: 'block', marginBottom: 3 }}>Boys Present:</span>
                          <input
                            type="number"
                            min={0}
                            placeholder="0"
                            className="field"
                            style={{ width: '100%' }}
                            value={selectedLessonPlan.boys_attendance ?? ''}
                            onChange={(e) => setSelectedLessonPlan({ ...selectedLessonPlan, boys_attendance: e.target.value ? parseInt(e.target.value) : null })}
                          />
                        </div>
                        <div>
                          <span style={{ fontSize: 11.5, color: '#334155', fontWeight: 700, display: 'block', marginBottom: 3 }}>Girls Present:</span>
                          <input
                            type="number"
                            min={0}
                            placeholder="0"
                            className="field"
                            style={{ width: '100%' }}
                            value={selectedLessonPlan.girls_attendance ?? ''}
                            onChange={(e) => setSelectedLessonPlan({ ...selectedLessonPlan, girls_attendance: e.target.value ? parseInt(e.target.value) : null })}
                          />
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Rendered directly into the ATTENDANCE column of the PDF.</span>
                        <span style={{ color: '#0369a1', fontWeight: 600 }}>
                          Total: {((selectedLessonPlan.boys_attendance || 0) + (selectedLessonPlan.girls_attendance || 0))} present
                        </span>
                      </div>
                    </div>

                    {/* Teacher Reflections & Evaluation */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <label className="field-label" style={{ fontWeight: 700, margin: 0 }}>
                          Teacher Reflections &amp; Evaluation <span style={{ color: '#dc2626' }}>*</span>
                        </label>
                        {(() => {
                          const isPast = isLessonTimeInPast(selectedLessonPlan.lesson_date, selectedLessonPlan.end_time, selectedLessonPlan.start_time)
                          const remarksLength = (selectedLessonPlan.reflection_remarks || '').length
                          const hasRemarks = remarksLength >= 16
                          return (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: 4,
                                backgroundColor: !isPast ? '#fef3c7' : hasRemarks ? '#dcfce7' : '#fef3c7',
                                color: !isPast ? '#b45309' : hasRemarks ? '#15803d' : '#b45309',
                                border: !isPast ? '1px solid #fde68a' : hasRemarks ? '1px solid #bbf7d0' : '1px solid #fde68a',
                                transition: 'all 0.25s ease'
                              }}
                            >
                              {!isPast ? '🔒 Locked until Lesson Concludes' : hasRemarks ? '✅ Reflections Complete' : '⚠️ Reflections Required'}
                            </span>
                          )
                        })()}
                      </div>

                      {(() => {
                        const isPast = isLessonTimeInPast(selectedLessonPlan.lesson_date, selectedLessonPlan.end_time, selectedLessonPlan.start_time)
                        const remarksLength = (selectedLessonPlan.reflection_remarks || '').length
                        const hasRemarks = remarksLength >= 16

                        if (!isPast) {
                          return (
                            <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, padding: '8px 12px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, color: '#92400e', fontSize: 12 }}>
                              <span style={{ fontSize: 16 }}>🔒</span>
                              <span>
                                <strong>Locked until lesson concludes:</strong> Remarks (Teacher Reflections &amp; Evaluation) cannot be filled before the scheduled lesson time has passed ({selectedLessonPlan.lesson_date}{selectedLessonPlan.end_time ? ` at ${selectedLessonPlan.end_time}` : ''}).
                              </span>
                            </div>
                          )
                        }

                        if (!hasRemarks) {
                          return (
                            <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: '8px 12px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, color: '#92400e', fontSize: 12, transition: 'all 0.25s ease' }}>
                              <span style={{ fontSize: 16 }}>📝</span>
                              <span>
                                <strong>Required for Submission:</strong> The scheduled lesson time has concluded. Please provide your reflections and evaluation below to activate the Submit button.
                              </span>
                            </div>
                          )
                        }

                        return (
                          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '8px 12px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, color: '#166534', fontSize: 12, transition: 'all 0.25s ease' }}>
                            <span style={{ fontSize: 16 }}>✅</span>
                            <span>Reflections recorded. The Submit button is active.</span>
                          </div>
                        )
                      })()}

                      {(() => {
                        const isPast = isLessonTimeInPast(selectedLessonPlan.lesson_date, selectedLessonPlan.end_time, selectedLessonPlan.start_time)
                        const remarksLength = (selectedLessonPlan.reflection_remarks || '').length
                        const hasRemarks = remarksLength >= 16
                        return (
                          <div>
                            <textarea
                              rows={3}
                              className="field"
                              style={{
                                width: '100%',
                                backgroundColor: !isPast ? '#f8fafc' : '#ffffff',
                                cursor: !isPast ? 'not-allowed' : 'text',
                                color: !isPast ? '#64748b' : '#0f172a',
                                border: !isPast
                                  ? '1.5px solid #cbd5e1'
                                  : hasRemarks
                                  ? '1.5px solid #10b981'
                                  : '1.5px solid #f59e0b',
                                boxShadow: !isPast
                                  ? 'none'
                                  : hasRemarks
                                  ? '0 0 0 1px rgba(16, 185, 129, 0.25)'
                                  : '0 0 0 1px rgba(245, 158, 11, 0.25)',
                                transition: 'border-color 0.25s ease, box-shadow 0.25s ease'
                              }}
                              disabled={!isPast}
                              placeholder={
                                !isPast
                                  ? 'Locked: Teacher Reflections & Evaluation can only be recorded after the scheduled lesson has concluded...'
                                  : 'Reflections on lesson success, student understanding, scaffolds or pace adjustments for next session...'
                              }
                              value={selectedLessonPlan.reflection_remarks || ''}
                              onChange={(e) => setSelectedLessonPlan({ ...selectedLessonPlan, reflection_remarks: e.target.value })}
                            />
                            {isPast && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, fontSize: 11.5, fontWeight: 600, color: hasRemarks ? '#15803d' : '#b45309', transition: 'color 0.25s ease' }}>
                                <span
                                  style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: '50%',
                                    backgroundColor: hasRemarks ? '#10b981' : '#f59e0b',
                                    display: 'inline-block',
                                    transition: 'background-color 0.25s ease'
                                  }}
                                />
                                <span>
                                  {hasRemarks
                                    ? 'Reflections completed — Submit button active'
                                    : 'Reflections in progress — complete your reflection to activate Submit'}
                                </span>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* 3. TIMETABLE TAB                                                      */}
      {/* ===================================================================== */}
      {activeTab === 'timetable' && (
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16 }}>Weekly Timetable Schedule</h3>
              <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
                Your active schedule slots used to automatically set up prospective lesson plans.
              </p>
            </div>
            <label className="btn btn-primary btn-small" style={{ cursor: 'pointer', margin: 0 }}>
              <span>{parsingTimetable ? '⏳ Processing...' : '📄 Upload Timetable PDF'}</span>
              <input type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={handleTimetableFileUpload} />
            </label>
          </div>

          {renderWeeklyLessonGrid('timetable')}
        </div>
      )}

      {/* ===================================================================== */}
      {/* 4. CURRICULUM LIBRARY & PDF INGESTION TAB                             */}
      {/* ===================================================================== */}
      {activeTab === 'curriculum' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16 }}>Curriculum Frameworks & Schemes of Work</h3>
              <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
                Cambridge Primary, Lower Secondary, IGCSE, AS & A Level, and custom syllabuses.
              </p>
            </div>
            {canManageCurriculum && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {schemes.length > 0 && (
                  <button
                    className="btn btn-ghost btn-small"
                    style={{ color: '#dc2626', borderColor: '#fca5a5' }}
                    onClick={handleClearCurriculumLibrary}
                    title="Clear all curriculum schemes and start fresh"
                  >
                    🗑 Clear Library ({schemes.length})
                  </button>
                )}
                <label className="btn btn-primary btn-small" style={{ cursor: 'pointer', margin: 0 }}>
                  <span>{parsingPdf ? '⏳ Reading PDF...' : '📄 Upload Syllabus PDF'}</span>
                  <input type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={handleSyllabusFileUpload} />
                </label>
              </div>
            )}
          </div>

          {schemes.length === 0 ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📚</div>
              <h4 style={{ margin: '0 0 6px', color: '#1e293b' }}>Curriculum Library is Empty (0 Schemes)</h4>
              <p style={{ margin: '0 0 16px', fontSize: 13, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>
                No curriculum schemes have been loaded yet. As teachers and coordinators upload onboarding work plans or when the Head of School / Coordinators upload syllabus documents, schemes and learning objectives will populate here.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                {(isTeacher || canManageCurriculum) && (
                  <label className="btn btn-secondary" style={{ cursor: 'pointer', margin: 0 }}>
                    <span>{parsingWorkPlanPdf ? (workPlanParseProgress?.percent ? `⏳ Reading (${workPlanParseProgress.percent}%)…` : '⏳ Reading Work Plan…') : '📤 Upload Current Work Plan (Onboarding)'}</span>
                    <input type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={handleWorkPlanFileUpload} />
                  </label>
                )}
                {canManageCurriculum && (
                  <label className="btn btn-primary" style={{ cursor: 'pointer', margin: 0 }}>
                    <span>{parsingPdf ? '⏳ Reading PDF...' : '📄 Upload Syllabus PDF'}</span>
                    <input type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={handleSyllabusFileUpload} />
                  </label>
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
              {schemes.map((s) => (
                <div key={s.id} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#1f8a5f', textTransform: 'uppercase' }}>
                    {s.framework.replace(/_/g, ' ')}
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a' }}>
                    {s.subject_name}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {s.year_group} · Code: {s.subject_code} · {s.syllabus_years}
                  </div>

                  <div style={{ marginTop: 'auto', paddingTop: 8, borderTop: '1px solid #f1f5f9', display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary btn-small grow" onClick={() => handleViewSchemeDetail(s.id)}>
                      View Units & Objectives →
                    </button>
                    {canManageCurriculum && (
                      <button
                        className="btn btn-ghost btn-small"
                        style={{ color: '#dc2626' }}
                        onClick={() => handleDeleteScheme(s.id, s.title || s.subject_name)}
                        title="Delete this curriculum scheme"
                      >
                        🗑
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Scheme Detail View Modal / Section */}
          {selectedSchemeDetail && (
            <div className="card" style={{ marginTop: 24, padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16 }}>
                    {selectedSchemeDetail.scheme.title}
                  </h3>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {selectedSchemeDetail.scheme.framework.replace(/_/g, ' ')} · {selectedSchemeDetail.topics.length} Units/Challenges · {selectedSchemeDetail.objectives.length} Objectives
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {canManageCurriculum && (
                    <button
                      className="btn btn-ghost btn-small"
                      style={{ color: '#dc2626' }}
                      onClick={() => handleDeleteScheme(selectedSchemeDetail.scheme.id, selectedSchemeDetail.scheme.title)}
                    >
                      🗑 Delete Scheme
                    </button>
                  )}
                  <button className="btn btn-ghost btn-small" onClick={() => setSelectedSchemeDetail(null)}>✕ Close</button>
                </div>
              </div>

              {/* Topics / Challenges List */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginTop: 12 }}>
                {selectedSchemeDetail.topics.map((t) => (
                  <div key={t.id} style={{ background: '#f8fafc', padding: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: t.is_challenge ? '#0b4f8a' : '#0f172a' }}>
                      {t.is_challenge ? `🎯 CHALLENGE: ${t.title}` : t.title}
                    </div>
                    {t.description && (
                      <p style={{ margin: '4px 0 0', fontSize: 11.5, color: '#64748b' }}>{t.description}</p>
                    )}
                  </div>
                ))}
              </div>

              {/* Objectives Sample */}
              <h4 style={{ margin: '16px 0 8px', fontSize: 13 }}>Learning Objectives ({selectedSchemeDetail.objectives.length})</h4>
              {selectedSchemeDetail.objectives.length === 0 ? (
                <div style={{ padding: '18px 20px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 8, fontSize: 13, color: '#64748b', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>📄</div>
                  <strong style={{ color: '#1e293b', display: 'block', marginBottom: 4 }}>No learning objectives loaded yet</strong>
                  <p style={{ margin: '0 0 10px', fontSize: 12 }}>
                    Objectives are blank until the Head of School uploads the official syllabus PDF.
                  </p>
                  {canManageCurriculum && (
                    <label className="btn btn-primary btn-small" style={{ cursor: 'pointer', display: 'inline-block' }}>
                      <span>📄 Upload Syllabus PDF to Populate</span>
                      <input type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={handleSyllabusFileUpload} />
                    </label>
                  )}
                </div>
              ) : (
                <div style={{ maxHeight: 250, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6, padding: 10, fontSize: 12 }}>
                  {selectedSchemeDetail.objectives.map((o) => (
                    <div key={o.id} style={{ marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid #f1f5f9' }}>
                      <strong>[{o.code}]</strong> {o.text} {o.challenge_title ? `(${o.challenge_title})` : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* 5. REVIEW QUEUE TAB (HEAD OF SCHOOL, COORDINATOR, DIRECTOR)           */}
      {/* ===================================================================== */}
      {activeTab === 'review' && isLeadership && (
        <div>
          <h3 style={{ margin: '0 0 14px', fontSize: 16 }}>Submitted Plans Awaiting Leadership Review</h3>

          {reviewPlans.workPlans.length === 0 && reviewPlans.lessonPlans.length === 0 ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
              <h4 style={{ margin: '0 0 4px', color: '#1e293b' }}>Queue is Clear</h4>
              <p style={{ margin: 0, fontSize: 13 }}>All submitted Semester Work Plans and Lesson Plans have been reviewed.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Work Plans Pending Review */}
              {reviewPlans.workPlans.map((wp) => (
                <div key={wp.id} className="card" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <span className="chip" style={{ background: '#fef3c7', color: '#b45309', fontWeight: 700, marginRight: 8 }}>
                      Semester Work Plan
                    </span>
                    <strong style={{ fontSize: 15 }}>{wp.subject_name} · {wp.class_name}</strong>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                      Submitted by: <strong>{wp.teacher_name}</strong> · Semester {wp.semester} ({wp.academic_year})
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-secondary btn-small" onClick={() => handlePreviewWorkPlanPdf(wp)}>
                      📄 Preview PDF
                    </button>
                    <button
                      className="btn btn-small"
                      style={{ background: '#10b981', color: '#fff', fontWeight: 700 }}
                      onClick={() => {
                        setReviewTarget({ type: 'work_plan', id: wp.id })
                        handleReviewAction('approved')
                      }}
                    >
                      ✓ Approve
                    </button>
                    <button
                      className="btn btn-ghost btn-small"
                      style={{ color: '#b91c1c' }}
                      onClick={() => {
                        const feedback = prompt('Enter return feedback comment:')
                        if (feedback) {
                          setReviewTarget({ type: 'work_plan', id: wp.id })
                          api.reviewWorkPlan(wp.id, 'returned', feedback).then(() => {
                            setSuccess('Work plan returned with feedback.')
                            loadAllPlanningData()
                          })
                        }
                      }}
                    >
                      ↩ Return
                    </button>
                  </div>
                </div>
              ))}

              {/* Lesson Plans Pending Review */}
              {reviewPlans.lessonPlans.map((lp) => (
                <div key={lp.id} className="card" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <span className="chip" style={{ background: '#e0e7ff', color: '#3730a3', fontWeight: 700, marginRight: 8 }}>
                      Lesson Plan
                    </span>
                    <strong style={{ fontSize: 15 }}>{lp.subject_name} · {lp.class_name}</strong>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                      Date: {new Date(lp.lesson_date).toLocaleDateString()} · Teacher: <strong>{lp.teacher_name}</strong>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-secondary btn-small" onClick={() => handlePreviewLessonPlanPdf(lp)}>
                      📄 Preview PDF
                    </button>
                    <button
                      className="btn btn-small"
                      style={{ background: '#10b981', color: '#fff', fontWeight: 700 }}
                      onClick={() => {
                        setReviewTarget({ type: 'lesson_plan', id: lp.id })
                        handleReviewAction('approved')
                      }}
                    >
                      ✓ Approve
                    </button>
                    <button
                      className="btn btn-ghost btn-small"
                      style={{ color: '#b91c1c' }}
                      onClick={() => {
                        const feedback = prompt('Enter return feedback comment:')
                        if (feedback) {
                          setReviewTarget({ type: 'lesson_plan', id: lp.id })
                          api.reviewLessonPlan(lp.id, 'returned', feedback).then(() => {
                            setSuccess('Lesson plan returned with feedback.')
                            loadAllPlanningData()
                          })
                        }
                      }}
                    >
                      ↩ Return
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: INITIALIZE WORK PLAN                                           */}
      {/* ===================================================================== */}
      {showCreateWorkPlanModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div className="card" style={{ width: '100%', maxWidth: 480, padding: 24 }}>
            <h3 style={{ margin: '0 0 14px' }}>Initialize Semester Work Plan</h3>

            {!isLeadership && availableClasses.length === 0 && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '10px 14px', borderRadius: 6, color: '#991b1b', fontSize: 13, marginBottom: 14 }}>
                ⚠️ You are not currently assigned to teach any subjects in any classes. Please contact the Head of School or Academic Coordinator to assign your classes and subjects under <strong>Settings &gt; Classes</strong>.
              </div>
            )}

            <form onSubmit={handleCreateWorkPlan} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label className="field-label">Target Class</label>
                <select
                  name="class_id"
                  className="field select"
                  style={{ width: '100%' }}
                  value={createWpClassId}
                  onChange={(e) => {
                    const cid = e.target.value
                    setCreateWpClassId(cid)
                    const allowedSubs = getAllowedSubjectsForClass(cid)
                    setCreateWpSubjectId(allowedSubs.length === 1 ? allowedSubs[0].id : '')
                  }}
                  required
                >
                  <option value="">-- Choose Class --</option>
                  {availableClasses.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="field-label">Subject</label>
                <select
                  name="subject_id"
                  className="field select"
                  style={{ width: '100%' }}
                  value={createWpSubjectId}
                  onChange={(e) => setCreateWpSubjectId(e.target.value)}
                  disabled={!createWpClassId}
                  required
                >
                  {!createWpClassId ? (
                    <option value="">-- Choose Class First --</option>
                  ) : getAllowedSubjectsForClass(createWpClassId).length === 0 ? (
                    <option value="">No subjects assigned to you in this class</option>
                  ) : (
                    <>
                      <option value="">-- Choose Subject --</option>
                      {getAllowedSubjectsForClass(createWpClassId).map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </>
                  )}
                </select>
              </div>

              <div>
                <label className="field-label">Curriculum Scheme (Optional)</label>
                <select name="scheme_id" className="field select" style={{ width: '100%' }}>
                  <option value="">-- Choose Matching Curriculum Scheme --</option>
                  {schemes.map((sc) => (
                    <option key={sc.id} value={sc.id}>{sc.title} ({sc.framework.replace(/_/g, ' ')})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="field-label">Key Resources & Textbooks</label>
                <input type="text" name="resources" placeholder="e.g. Cambridge Checkpoint Science Coursebook 8" className="field" style={{ width: '100%' }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowCreateWorkPlanModal(false)}>Cancel</button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!createWpClassId || !createWpSubjectId || (!isLeadership && availableClasses.length === 0)}
                >
                  Initialize Plan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: WORK PLAN PARSING PROGRESS BAR                                 */}
      {/* ===================================================================== */}
      {parsingWorkPlanPdf && workPlanParseProgress && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 110,
            padding: 16
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 480,
              padding: '28px 24px',
              borderRadius: 16,
              boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.35)',
              border: '1px solid #cbd5e1',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              textAlign: 'center'
            }}
          >
            {/* Top Icon & Title */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
                  border: '1px solid #a7f3d0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 26
                }}
              >
                📑
              </div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                Parsing Work Plan PDF
              </h3>
              {workPlanParseProgress.fileName && (
                <div
                  style={{
                    fontSize: 12,
                    color: '#475569',
                    background: '#f1f5f9',
                    padding: '3px 10px',
                    borderRadius: 999,
                    maxWidth: 360,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  📄 {workPlanParseProgress.fileName}
                </div>
              )}
            </div>

            {/* Progress Bar & Stats */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                  {workPlanParseProgress.stage}
                </span>
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    color: '#10b981',
                    fontVariantNumeric: 'tabular-nums'
                  }}
                >
                  {workPlanParseProgress.percent}%
                </span>
              </div>

              {/* Progress Track */}
              <div
                style={{
                  width: '100%',
                  height: 10,
                  backgroundColor: '#e2e8f0',
                  borderRadius: 999,
                  overflow: 'hidden',
                  position: 'relative'
                }}
              >
                <div
                  style={{
                    width: `${Math.max(5, Math.min(100, workPlanParseProgress.percent))}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #10b981 0%, #059669 50%, #3b82f6 100%)',
                    borderRadius: 999,
                    transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                  }}
                />
              </div>

              {workPlanParseProgress.detail && (
                <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>
                  {workPlanParseProgress.detail}
                </div>
              )}
            </div>

            {/* Step Milestones */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 6,
                padding: '12px 10px',
                background: '#f8fafc',
                borderRadius: 10,
                border: '1px solid #e2e8f0',
                fontSize: 11
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: workPlanParseProgress.percent >= 25 ? '#10b981' : '#94a3b8' }}>
                <span>{workPlanParseProgress.percent >= 70 ? '✓' : '📄'}</span>
                <span style={{ fontWeight: workPlanParseProgress.percent < 70 ? 700 : 500 }}>PDF Pages</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: workPlanParseProgress.percent >= 75 ? '#10b981' : '#94a3b8' }}>
                <span>{workPlanParseProgress.percent >= 85 ? '✓' : '📐'}</span>
                <span style={{ fontWeight: workPlanParseProgress.percent >= 75 && workPlanParseProgress.percent < 85 ? 700 : 500 }}>Framework</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: workPlanParseProgress.percent >= 85 ? '#10b981' : '#94a3b8' }}>
                <span>{workPlanParseProgress.percent >= 95 ? '✓' : '🗓️'}</span>
                <span style={{ fontWeight: workPlanParseProgress.percent >= 85 && workPlanParseProgress.percent < 95 ? 700 : 500 }}>Table Weeks</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: workPlanParseProgress.percent >= 100 ? '#10b981' : '#94a3b8' }}>
                <span>{workPlanParseProgress.percent >= 100 ? '✓' : '🎯'}</span>
                <span style={{ fontWeight: workPlanParseProgress.percent >= 95 ? 700 : 500 }}>Objectives</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: IMPORT SEMESTER 1 WORK PLAN (ONBOARDING)                       */}
      {/* ===================================================================== */}
      {showImportWorkPlanModal && parsedWorkPlan && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div className="card" style={{ width: '100%', maxWidth: 760, padding: 24, maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <span className="chip" style={{ background: '#dbeafe', color: '#1d4ed8', fontWeight: 700 }}>
                  📋 Teacher Onboarding Ingestion
                </span>
                <h3 style={{ margin: '4px 0 0', fontSize: 18 }}>
                  Import Semester 1 Work Plan
                </h3>
              </div>
              <button className="btn btn-ghost btn-small" onClick={() => setShowImportWorkPlanModal(false)}>✕</button>
            </div>

            {/* Deduplication Guarantee Banner */}
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12.5, color: '#166534' }}>
              <strong>🔒 Safe Onboarding & Deduplication Guarantee:</strong>
              <div style={{ marginTop: 2 }}>
                Learning objectives extracted from this work plan will populate the curriculum library. If the Head of School later uploads the complete Cambridge syllabus PDF, existing objectives will be preserved with <strong>zero overwriting and no duplicates</strong>.
              </div>
            </div>

            {/* Educational Level Selection (Required for Teacher Onboarding) */}
            <div style={{ marginBottom: 14 }}>
              <label className="field-label" style={{ fontWeight: 700 }}>
                Educational Level / Framework *
              </label>
              <select
                className="field select"
                style={{ width: '100%', fontWeight: 600 }}
                value={importWpFramework}
                onChange={(e) => setImportWpFramework(e.target.value)}
                required
              >
                <option value="CAMBRIDGE_PRIMARY">Cambridge Primary (Stages 1–6)</option>
                <option value="CAMBRIDGE_LOWER_SECONDARY">Cambridge Lower Secondary (Stages 7–9)</option>
                <option value="CAMBRIDGE_IGCSE">Cambridge IGCSE (Years 10–11)</option>
                <option value="CAMBRIDGE_AS_A_LEVEL">Cambridge International AS & A Level (Years 12–13)</option>
              </select>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                Select the Cambridge level this onboarding work plan belongs to.
              </span>
            </div>

            {/* Target Class & Subject (Filtered to Assigned) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label className="field-label">Target Class (Assigned to You)</label>
                <select
                  className="field select"
                  style={{ width: '100%' }}
                  value={importWpClassId}
                  onChange={(e) => {
                    const cid = e.target.value
                    setImportWpClassId(cid)
                    const allowedSubs = getAllowedSubjectsForClass(cid)
                    setImportWpSubjectId(allowedSubs.length === 1 ? allowedSubs[0].id : '')
                  }}
                  required
                >
                  <option value="">-- Choose Class --</option>
                  {availableClasses.map((c) => {
                    const isAssigned = teacherAssignments.some((a) => a.class_id === c.id)
                    return (
                      <option key={c.id} value={c.id}>
                        {c.name}{isAssigned ? ' ★ (Assigned to You)' : ''}
                      </option>
                    )
                  })}
                </select>
                {parsedWorkPlan.class_name && (
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    Detected in PDF: <strong>{parsedWorkPlan.class_name}</strong>
                  </span>
                )}
              </div>

              <div>
                <label className="field-label">Subject</label>
                <select
                  className="field select"
                  style={{ width: '100%' }}
                  value={importWpSubjectId}
                  onChange={(e) => setImportWpSubjectId(e.target.value)}
                  disabled={!importWpClassId}
                  required
                >
                  {!importWpClassId ? (
                    <option value="">-- Choose Class First --</option>
                  ) : getAllowedSubjectsForClass(importWpClassId).length === 0 ? (
                    <option value="">No subjects assigned to you in this class</option>
                  ) : (
                    <>
                      <option value="">-- Choose Subject --</option>
                      {getAllowedSubjectsForClass(importWpClassId).map((s) => {
                        const isAssigned = teacherAssignments.some((a) => a.class_id === importWpClassId && a.subject_id === s.id)
                        return (
                          <option key={s.id} value={s.id}>
                            {s.name}{isAssigned ? ' ★ (Assigned to You)' : ''}
                          </option>
                        )
                      })}
                    </>
                  )}
                </select>
                {parsedWorkPlan.subject_name && (
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    Detected in PDF: <strong>{parsedWorkPlan.subject_name}</strong>
                  </span>
                )}
              </div>
            </div>

            {/* Cambridge Subject Code - Prominent Prompt */}
            <div style={{
              background: !importWpSubjectCode ? '#fffbeb' : '#f8fafc',
              border: !importWpSubjectCode ? '1.5px solid #f59e0b' : '1px solid #e2e8f0',
              borderRadius: 8,
              padding: 14,
              marginBottom: 14
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label className="field-label" style={{ fontWeight: 700, margin: 0, color: !importWpSubjectCode ? '#b45309' : '#0f172a' }}>
                  {!importWpSubjectCode ? '⚠️ Prompt: Cambridge Subject Code Required' : '✓ Cambridge Subject Code'}
                </label>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  Required to link objectives to Cambridge scheme
                </span>
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Enter 4-digit code (e.g. 0580, 0610, 0457, 1129, 9709)"
                  value={importWpSubjectCode}
                  onChange={(e) => setImportWpSubjectCode(e.target.value)}
                  className="field"
                  style={{ width: 220, fontWeight: 700, fontSize: 14 }}
                  required
                />
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  {!importWpSubjectCode ? 'Please select or enter the official code for this subject.' : 'Code set.'}
                </span>
              </div>

              {/* Quick Picks for Cambridge Subject Codes */}
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>Quick pick:</span>
                {[
                  { code: '0580', label: '0580 Maths' },
                  { code: '0610', label: '0610 Biology' },
                  { code: '0620', label: '0620 Chem' },
                  { code: '0625', label: '0625 Phys' },
                  { code: '0457', label: '0457 GP' },
                  { code: '0478', label: '0478 CS' },
                  { code: '0500', label: '0500 English' },
                  { code: '0862', label: '0862 LS Maths' },
                  { code: '0893', label: '0893 LS Sci' },
                  { code: '1129', label: '1129 LS GP' },
                  { code: '9709', label: '9709 A Level Maths' },
                  { code: '9239', label: '9239 A Level GP' },
                ].map((pick) => (
                  <button
                    key={pick.code}
                    type="button"
                    className="btn btn-ghost btn-small"
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      background: importWpSubjectCode === pick.code ? '#0b4f8a' : '#e2e8f0',
                      color: importWpSubjectCode === pick.code ? '#ffffff' : '#334155'
                    }}
                    onClick={() => setImportWpSubjectCode(pick.code)}
                  >
                    {pick.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Academic Year and Semester */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label className="field-label">Academic Year</label>
                <input
                  type="text"
                  className="field"
                  style={{ width: '100%' }}
                  value={importWpAcademicYear}
                  onChange={(e) => setImportWpAcademicYear(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">Semester / Term</label>
                <select
                  className="field select"
                  style={{ width: '100%' }}
                  value={importWpSemester}
                  onChange={(e) => setImportWpSemester(e.target.value)}
                >
                  <option value="1">Semester 1 (Onboarding Work Plan)</option>
                  <option value="2">Semester 2</option>
                  <option value="3">Semester 3 / Term 3</option>
                </select>
              </div>
            </div>

            {/* Weeks & Term Dates Extracted Summary & Preview with Coverage Breakdown */}
            <div style={{ marginBottom: 16 }}>
              {(() => {
                const allExtractedObjs = parsedWorkPlan.weeks.flatMap((w) => w.objectives || [])
                const coveredObjs = allExtractedObjs.filter((o) => o.is_met)
                const uncoveredObjs = allExtractedObjs.filter((o) => !o.is_met)

                return (
                  <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                      <h4 style={{ margin: 0, fontSize: 13, color: '#0f172a' }}>
                        Extracted Weeks ({parsedWorkPlan.weeks.length}) & Objectives Coverage Breakdown
                      </h4>
                      <div style={{ display: 'flex', gap: 8, fontSize: 12, flexWrap: 'wrap' }}>
                        <span className="chip" style={{ background: '#e2e8f0', color: '#1e293b', fontWeight: 700 }}>
                          {allExtractedObjs.length} Total Objectives
                        </span>
                        <span className="chip" style={{ background: '#dcfce7', color: '#166534', fontWeight: 800 }}>
                          ✓ {coveredObjs.length} Covered (From comments / marks)
                        </span>
                        <span className="chip" style={{ background: '#fef3c7', color: '#b45309', fontWeight: 800 }}>
                          ⏳ {uncoveredObjs.length} Uncovered (For Lesson Planning)
                        </span>
                      </div>
                    </div>

                    <div style={{ fontSize: 12, color: '#334155', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '8px 10px' }}>
                      💡 <strong>Coverage Indication from Work Plan:</strong> The comments/remarks section of your uploaded work plan has been evaluated to identify which objectives are <strong>Covered</strong> vs. <strong>Not Covered</strong>. Teachers will <strong>ONLY use the {uncoveredObjs.length} uncovered objectives</strong> to create prospective lesson plans. You can review or toggle coverage statuses below before confirming.
                    </div>
                  </div>
                )
              })()}

              <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#1f8a5f', color: '#ffffff', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                      <th style={{ padding: '8px 10px', width: 95 }}>Week & Dates</th>
                      <th style={{ padding: '8px 10px', width: 230 }}>Topic & Comments / Remarks</th>
                      <th style={{ padding: '8px 10px' }}>Learning Objectives & Coverage Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedWorkPlan.weeks.map((w, wIdx) => {
                      const weekObjs = w.objectives || []

                      return (
                        <tr key={w.sequence} style={{ borderBottom: '1px solid #e2e8f0', background: w.is_instructional ? '#ffffff' : '#fef2f2' }}>
                          <td style={{ padding: '8px 10px', verticalAlign: 'top' }}>
                            <div style={{ fontWeight: 800, color: '#0f172a' }}>{w.week_label}</div>
                            <div style={{ fontSize: 11, color: '#0b4f8a', fontWeight: 600, marginTop: 2 }}>
                              {w.term_dates || (w.start_date && w.end_date ? `${w.start_date} – ${w.end_date}` : '—')}
                            </div>
                            <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{w.month_label}</div>
                          </td>

                          <td style={{ padding: '8px 10px', verticalAlign: 'top' }}>
                            {!w.is_instructional ? (
                              <span style={{ color: '#b45309', fontWeight: 700 }}>{w.event_label || 'NON-INSTRUCTIONAL'}</span>
                            ) : (
                              <div>
                                <strong style={{ color: '#0f172a', fontSize: 12.5 }}>
                                  {w.topic_title || w.challenge_title || 'General Curriculum'}
                                </strong>
                                {w.subtopic_title && (
                                  <div style={{ fontSize: 11, color: '#475569' }}>Unit: {w.subtopic_title}</div>
                                )}

                                {/* Teacher's Comments / Remarks from Workplan */}
                                <div style={{
                                  marginTop: 6,
                                  fontSize: 11,
                                  background: '#f8fafc',
                                  border: '1px solid #e2e8f0',
                                  borderRadius: 4,
                                  padding: '4px 8px',
                                  color: '#334155'
                                }}>
                                  <strong>💬 Remarks:</strong> {w.remarks ? w.remarks : <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>None</span>}
                                </div>

                                {/* Week Quick Coverage Actions */}
                                <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                                  <button
                                    type="button"
                                    style={{ fontSize: 9.5, padding: '2px 6px', borderRadius: 4, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#166534', cursor: 'pointer', fontWeight: 600 }}
                                    title="Mark all objectives in this week as Covered"
                                    onClick={() => toggleParsedWeekCoverage(wIdx, true)}
                                  >
                                    ✓ All Covered
                                  </button>
                                  <button
                                    type="button"
                                    style={{ fontSize: 9.5, padding: '2px 6px', borderRadius: 4, border: '1px solid #fde68a', background: '#fffbeb', color: '#b45309', cursor: 'pointer', fontWeight: 600 }}
                                    title="Mark all objectives in this week as Not Covered"
                                    onClick={() => toggleParsedWeekCoverage(wIdx, false)}
                                  >
                                    ⏳ Not Covered
                                  </button>
                                </div>
                              </div>
                            )}
                          </td>

                          <td style={{ padding: '8px 10px', verticalAlign: 'top' }}>
                            {weekObjs.length === 0 ? (
                              <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>No objectives in this week</span>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {weekObjs.map((obj, oIdx) => (
                                  <div
                                    key={oIdx}
                                    style={{
                                      fontSize: 11,
                                      background: obj.is_met ? '#f0fdf4' : '#fffbeb',
                                      border: obj.is_met ? '1px solid #bbf7d0' : '1px solid #fde68a',
                                      borderRadius: 4,
                                      padding: '4px 8px',
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      gap: 8
                                    }}
                                  >
                                    <div style={{ flex: 1 }}>
                                      <strong style={{ color: '#0f172a' }}>{obj.code}:</strong>{' '}
                                      <span style={{ color: '#334155' }}>{obj.text}</span>
                                    </div>
                                    <button
                                      type="button"
                                      style={{
                                        border: 'none',
                                        borderRadius: 4,
                                        padding: '2px 8px',
                                        fontSize: 10,
                                        fontWeight: 800,
                                        cursor: 'pointer',
                                        background: obj.is_met ? '#166534' : '#b45309',
                                        color: '#ffffff',
                                        whiteSpace: 'nowrap'
                                      }}
                                      title="Click to toggle: Covered vs Not Covered"
                                      onClick={() => toggleParsedObjectiveCoverage(wIdx, oIdx)}
                                    >
                                      {obj.is_met ? '✓ Covered' : '⏳ Not Covered'}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowImportWorkPlanModal(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!importWpClassId || !importWpSubjectId || !importWpSubjectCode.trim() || loading}
                onClick={handleConfirmImportWorkPlan}
              >
                {loading ? '⏳ Ingesting Work Plan...' : '✓ Confirm & Ingest Work Plan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: CREATE LESSON PLAN                                             */}
      {/* ===================================================================== */}
      {showCreateLessonPlanModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div className="card" style={{ width: '100%', maxWidth: 520, padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 14px' }}>Create Prospective Lesson Plan</h3>

            {!isLeadership && availableClasses.length === 0 && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '10px 14px', borderRadius: 6, color: '#991b1b', fontSize: 13, marginBottom: 14 }}>
                ⚠️ You are not currently assigned to teach any subjects in any classes. Please contact the Head of School or Academic Coordinator to assign your classes and subjects under <strong>Settings &gt; Classes</strong>.
              </div>
            )}

            <form onSubmit={handleCreateLessonPlan} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="field-label">Class</label>
                  <select
                    name="class_id"
                    className="field select"
                    style={{ width: '100%' }}
                    value={createLpClassId}
                    onChange={(e) => {
                      const cid = e.target.value
                      setCreateLpClassId(cid)
                      const allowedSubs = getAllowedSubjectsForClass(cid)
                      setCreateLpSubjectId(allowedSubs.length === 1 ? allowedSubs[0].id : '')
                    }}
                    required
                  >
                    <option value="">-- Select Class --</option>
                    {availableClasses.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label">Subject</label>
                  <select
                    name="subject_id"
                    className="field select"
                    style={{ width: '100%' }}
                    value={createLpSubjectId}
                    onChange={(e) => setCreateLpSubjectId(e.target.value)}
                    disabled={!createLpClassId}
                    required
                  >
                    {!createLpClassId ? (
                      <option value="">-- Select Class First --</option>
                    ) : getAllowedSubjectsForClass(createLpClassId).length === 0 ? (
                      <option value="">No subjects assigned to you in this class</option>
                    ) : (
                      <>
                        <option value="">-- Select Subject --</option>
                        {getAllowedSubjectsForClass(createLpClassId).map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </>
                    )}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div>
                  <label className="field-label">Lesson Date</label>
                  <input
                    type="date"
                    name="lesson_date"
                    className="field"
                    value={createLpDate}
                    min={formatDateISO(new Date())}
                    onChange={(e) => setCreateLpDate(e.target.value)}
                    required
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label className="field-label">Start Time</label>
                  <input
                    type="time"
                    name="start_time"
                    className="field"
                    value={createLpStartTime}
                    onChange={(e) => setCreateLpStartTime(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label className="field-label">End Time</label>
                  <input
                    type="time"
                    name="end_time"
                    className="field"
                    value={createLpEndTime}
                    onChange={(e) => setCreateLpEndTime(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              {isPastLessonSlot(createLpDate, createLpStartTime, createLpEndTime) && (
                <div
                  style={{
                    background: '#fef2f2',
                    border: '1.5px solid #ef4444',
                    borderRadius: 6,
                    padding: '8px 12px',
                    fontSize: 12,
                    color: '#b91c1c',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8
                  }}
                >
                  <span style={{ fontSize: 16 }}>⚠️</span>
                  <div>
                    <strong>Past Date (Planning Closed):</strong> Lesson plans cannot be created for previous calendar dates. You can still plan any lesson scheduled for today, even if the slot has already passed on the clock.
                  </div>
                </div>
              )}

              {/* Topic / Unit Title (Above Learning Objectives) */}
              <div>
                <label className="field-label" style={{ fontWeight: 700, color: '#0f172a' }}>Topic / Unit Title *</label>
                <input
                  type="text"
                  name="topic_title"
                  placeholder="e.g. Chemical Bonding / Fractions"
                  className="field"
                  value={createLpTopicTitle}
                  onChange={(e) => setCreateLpTopicTitle(e.target.value)}
                  required
                  style={{ width: '100%' }}
                />
              </div>

              {isCreateLpGlobalPerspectives && (
                <div>
                  <label className="field-label">Challenge (For Global Perspectives)</label>
                  <input
                    type="text"
                    name="challenge_title"
                    placeholder="e.g. Keeping Healthy / Digital World"
                    className="field"
                    value={createLpChallengeTitle}
                    onChange={(e) => setCreateLpChallengeTitle(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
              )}

              {/* Learning Objectives Selection (Uncovered Only) - Placed directly below Topic / Unit */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                  <label className="field-label" style={{ fontWeight: 700, margin: 0 }}>
                    🎯 Learning Objectives (Uncovered Only) *
                  </label>
                  {matchingWorkPlanForLp && (
                    <span style={{ fontSize: 11, color: '#166534', background: '#dcfce7', padding: '2px 8px', borderRadius: 12, fontWeight: 600 }}>
                      {uncoveredLpObjectives.length} Uncovered · {coveredLpObjectives.length} Covered (Excluded)
                    </span>
                  )}
                </div>

                {loadingMatchingWp ? (
                  <div style={{ fontSize: 12, color: '#64748b', padding: 8 }}>
                    ⏳ Loading matching work plan objectives...
                  </div>
                ) : matchingWorkPlanForLp ? (
                  uncoveredLpObjectives.length === 0 ? (
                    coveredLpObjectives.length > 0 ? (
                      <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, padding: 12, fontSize: 12.5, color: '#92400e' }}>
                        <strong>🎉 All Learning Objectives are Covered!</strong>
                        <div style={{ marginTop: 4 }}>
                          All {coveredLpObjectives.length} objectives in this Semester Work Plan are marked as covered. Teachers can <strong>only create lesson plans for uncovered objectives</strong>. No prospective lesson plans can be scheduled for this work plan.
                        </div>
                      </div>
                    ) : (
                      <div style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, padding: 10, fontSize: 12, color: '#475569' }}>
                        ⚠️ No learning objectives found in this Work Plan yet. Please add or import objectives under the <strong>Work Plans</strong> tab first.
                      </div>
                    )
                  ) : (
                    <div>
                      {/* Smart Prediction Banner */}
                      {smartPredictionForCreate && smartPredictionForCreate.predictedObjectives.length > 0 && (
                        <div style={{ background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: 8, padding: '10px 12px', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                            <span style={{ fontSize: 18, marginTop: 1 }}>✨</span>
                            <div>
                              <div style={{ fontSize: 12.5, fontWeight: 800, color: '#166534', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span>Smart Default Prediction:</span>
                                <span style={{ background: '#16a34a', color: '#fff', fontSize: 11, padding: '1px 6px', borderRadius: 4 }}>
                                  Week {smartPredictionForCreate.weekSequence} · {smartPredictionForCreate.predictedObjectives[0].code_snapshot}
                                </span>
                              </div>
                              <div style={{ fontSize: 11, color: '#15803d', marginTop: 2 }}>
                                {smartPredictionForCreate.reason === 'date_matched_week'
                                  ? `Matched to Week ${smartPredictionForCreate.weekSequence} by scheduled lesson date.`
                                  : `Next sequential unused learning objective in Semester Work Plan.`}
                                {smartPredictionForCreate.weekTopic ? ` (Topic: ${smartPredictionForCreate.weekTopic})` : ''}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-small"
                              style={{ fontSize: 11, padding: '4px 8px', fontWeight: 700, backgroundColor: '#dcfce7', color: '#166534', borderColor: '#86efac' }}
                              onClick={() => {
                                const codes = smartPredictionForCreate.predictedObjectives.map((o) => o.code_snapshot)
                                setSelectedLpObjectiveCodes(codes)
                                if (smartPredictionForCreate.weekTopic) setCreateLpTopicTitle(smartPredictionForCreate.weekTopic)
                                if (smartPredictionForCreate.weekChallenge) setCreateLpChallengeTitle(smartPredictionForCreate.weekChallenge)
                              }}
                            >
                              ✓ Select All for Week {smartPredictionForCreate.weekSequence}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-small"
                              style={{ fontSize: 11, padding: '4px 6px', color: '#64748b' }}
                              onClick={() => setSelectedLpObjectiveCodes([])}
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                      )}

                      <div style={{ fontSize: 11, color: '#475569', marginBottom: 6 }}>
                        Select the uncovered objective(s) to teach in this lesson. Checking an objective auto-fills the topic:
                      </div>
                      <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {sortedUncoveredLpObjectives.map((obj, idx) => {
                          const isChecked = selectedLpObjectiveCodes.includes(obj.code_snapshot)
                          const isPredicted = predictedCodesSetForCreate.has(obj.code_snapshot)
                          const isPlannedInOther = plannedCodesForCreate.has(obj.code_snapshot)

                          return (
                            <label
                              key={idx}
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 8,
                                padding: 8,
                                borderRadius: 6,
                                background: isChecked ? '#f0fdf4' : (isPredicted ? '#fbfcfe' : '#ffffff'),
                                border: isChecked ? '1.5px solid #16a34a' : (isPredicted ? '1.5px solid #86efac' : '1px solid #e2e8f0'),
                                cursor: 'pointer',
                                fontSize: 12
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedLpObjectiveCodes((prev) => [...prev, obj.code_snapshot])
                                    if (!createLpTopicTitle) {
                                      setCreateLpTopicTitle(obj.week_topic || obj.text_snapshot)
                                    }
                                    if (!createLpChallengeTitle && obj.week_challenge) {
                                      setCreateLpChallengeTitle(obj.week_challenge)
                                    }
                                  } else {
                                    setSelectedLpObjectiveCodes((prev) => prev.filter((c) => c !== obj.code_snapshot))
                                  }
                                }}
                                style={{ marginTop: 2 }}
                              />
                              <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                  <strong style={{ color: '#0f172a' }}>{obj.code_snapshot}</strong>
                                  {isPredicted && (
                                    <span className="chip" style={{ fontSize: 9.5, padding: '1px 6px', background: '#dcfce7', color: '#166534', fontWeight: 800, border: '1px solid #86efac' }}>
                                      ✨ PREDICTED NEXT
                                    </span>
                                  )}
                                  <span className="chip" style={{ fontSize: 9.5, padding: '1px 5px', background: '#fef3c7', color: '#b45309', fontWeight: 700 }}>
                                    ⏳ UNCOVERED
                                  </span>
                                  {isPlannedInOther && (
                                    <span className="chip" style={{ fontSize: 9.5, padding: '1px 5px', background: '#f1f5f9', color: '#64748b', fontWeight: 600 }}>
                                      📋 Planned in another lesson
                                    </span>
                                  )}
                                  <span style={{ fontSize: 10, color: '#64748b' }}>
                                    Week {obj.week_sequence}
                                  </span>
                                </div>
                                <div style={{ fontSize: 11, color: '#334155', marginTop: 2 }}>
                                  {obj.text_snapshot}
                                </div>
                                {obj.week_topic && (
                                  <div style={{ fontSize: 10, color: '#059669', marginTop: 2 }}>
                                    Topic: {obj.week_topic}
                                  </div>
                                )}
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )
                ) : (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: 10, fontSize: 12, color: '#92400e' }}>
                    ℹ️ No Semester Work Plan found for this class and subject yet. Please upload or create a Work Plan under the <strong>Work Plans</strong> tab to track uncovered objectives.
                  </div>
                )}
              </div>

              <div style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: 12, backgroundColor: '#f8fafc' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                  <div>
                    <label className="field-label" style={{ fontWeight: 800, color: '#4C2570', textTransform: 'uppercase', margin: 0, fontSize: 13 }}>
                      Main Teaching Activities &amp; Inquiry
                    </label>
                    <span style={{ fontSize: 11, color: '#64748b' }}>
                      Starter, Exposition, Learners Activity, and Plenary
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={generatingAllStages}
                      onClick={handleGenerateAllForCreateLp}
                      style={{
                        fontSize: 10.5,
                        padding: '3px 9px',
                        fontWeight: 700,
                        background: generatingAllStages ? '#94a3b8' : 'linear-gradient(135deg, #7c3aed 0%, #4C2570 100%)',
                        color: '#ffffff'
                      }}
                    >
                      {generatingAllStages ? 'Generating...' : '✨ Generate All (AI)'}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                      <label className="field-label" style={{ fontSize: 11.5, fontWeight: 700, color: '#15803d', margin: 0 }}>
                        1. Starter
                      </label>
                      <AiStageButton
                        stage="starter"
                        onGenerated={(val) => setCreateLpStarter(val)}
                        getContext={getContextForCreateLp}
                        onPromptApiKey={() => setShowGeminiApiKeyModal(true)}
                        compact
                        onError={(msg) => setError(msg)}
                      />
                    </div>
                    <textarea
                      name="activity_starter"
                      rows={2}
                      className="field"
                      style={{ width: '100%', fontSize: 12, backgroundColor: '#ffffff' }}
                      placeholder="Inquiry hook, warm-up question..."
                      value={createLpStarter}
                      onChange={(e) => setCreateLpStarter(e.target.value)}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                      <label className="field-label" style={{ fontSize: 11.5, fontWeight: 700, color: '#0369a1', margin: 0 }}>
                        2. Exposition
                      </label>
                      <AiStageButton
                        stage="exposition"
                        onGenerated={(val) => setCreateLpExposition(val)}
                        getContext={getContextForCreateLp}
                        onPromptApiKey={() => setShowGeminiApiKeyModal(true)}
                        compact
                        onError={(msg) => setError(msg)}
                      />
                    </div>
                    <textarea
                      name="activity_exposition"
                      rows={2}
                      className="field"
                      style={{ width: '100%', fontSize: 12, backgroundColor: '#ffffff' }}
                      placeholder="Explain concepts, board modeling, solved examples..."
                      value={createLpExposition}
                      onChange={(e) => setCreateLpExposition(e.target.value)}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                      <label className="field-label" style={{ fontSize: 11.5, fontWeight: 700, color: '#6b21a8', margin: 0 }}>
                        3. Learners Activity
                      </label>
                      <AiStageButton
                        stage="learnersActivity"
                        onGenerated={(val) => setCreateLpLearners(val)}
                        getContext={getContextForCreateLp}
                        onPromptApiKey={() => setShowGeminiApiKeyModal(true)}
                        compact
                        onError={(msg) => setError(msg)}
                      />
                    </div>
                    <textarea
                      name="activity_learners"
                      rows={2}
                      className="field"
                      style={{ width: '100%', fontSize: 12, backgroundColor: '#ffffff' }}
                      placeholder="Stations, tasks, collaborative practice..."
                      value={createLpLearners}
                      onChange={(e) => setCreateLpLearners(e.target.value)}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                      <label className="field-label" style={{ fontSize: 11.5, fontWeight: 700, color: '#b45309', margin: 0 }}>
                        4. Plenary
                      </label>
                      <AiStageButton
                        stage="plenary"
                        onGenerated={(val) => setCreateLpPlenary(val)}
                        getContext={getContextForCreateLp}
                        onPromptApiKey={() => setShowGeminiApiKeyModal(true)}
                        compact
                        onError={(msg) => setError(msg)}
                      />
                    </div>
                    <textarea
                      name="activity_plenary"
                      rows={2}
                      className="field"
                      style={{ width: '100%', fontSize: 12, backgroundColor: '#ffffff' }}
                      placeholder="Exit ticket, learning review, preview..."
                      value={createLpPlenary}
                      onChange={(e) => setCreateLpPlenary(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Assessment Ideas (with AI stage generation) */}
              <div style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: 12, backgroundColor: '#ffffff', marginTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                  <div>
                    <label className="field-label" style={{ fontSize: 12, color: '#4C2570', fontWeight: 800, margin: 0, textTransform: 'uppercase' }}>
                      Assessment Ideas
                    </label>
                    <span style={{ fontSize: 11, color: '#64748b', display: 'block' }}>
                      Formative checks, marked sheets, rubrics, exit tickets
                    </span>
                  </div>
                  <AiStageButton
                    stage="assessmentIdeas"
                    onGenerated={(val) => setCreateLpAssessmentIdeas(val)}
                    getContext={getContextForCreateLp}
                    onPromptApiKey={() => setShowGeminiApiKeyModal(true)}
                    compact
                    onError={(msg) => setError(msg)}
                  />
                </div>
                <textarea
                  name="assessment_ideas"
                  rows={2}
                  className="field"
                  style={{ width: '100%', fontSize: 12, backgroundColor: '#ffffff' }}
                  placeholder="• Formative task/sheet...&#10;• Exit ticket checked and recorded."
                  value={createLpAssessmentIdeas}
                  onChange={(e) => setCreateLpAssessmentIdeas(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowCreateLessonPlanModal(false)}>Cancel</button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={
                    !createLpClassId ||
                    !createLpSubjectId ||
                    (!isLeadership && availableClasses.length === 0) ||
                    (matchingWorkPlanForLp && uncoveredLpObjectives.length === 0 && coveredLpObjectives.length > 0) ||
                    isPastLessonSlot(createLpDate, createLpStartTime, createLpEndTime) ||
                    loading
                  }
                >
                  Create Lesson Plan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: SYLLABUS PDF INGESTION PREVIEW (FOR HEAD OF SCHOOL)            */}
      {/* ===================================================================== */}
      {showPdfIngestModal && extractedSyllabus && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div className="card" style={{ width: '100%', maxWidth: 700, padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <span className="chip" style={{ background: '#dcfce7', color: '#15803d', fontWeight: 700 }}>
                  ✓ Extracted from PDF ({extractedSyllabus.pageCount} Pages)
                </span>
                <h3 style={{ margin: '4px 0 0', fontSize: 17 }}>
                  {extractedSyllabus.is_global_perspectives ? 'Global Perspectives Challenges & Objectives' : 'Curriculum Units & Objectives'}
                </h3>
              </div>
              <button className="btn btn-ghost btn-small" onClick={() => setShowPdfIngestModal(false)}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 0.8fr', gap: 10, marginBottom: 14 }}>
              <div>
                <label className="field-label" style={{ fontWeight: 700 }}>Educational Level / Framework *</label>
                <select
                  className="field select"
                  value={extractedSyllabus.framework}
                  onChange={(e) => setExtractedSyllabus({ ...extractedSyllabus, framework: e.target.value })}
                  style={{ width: '100%', fontWeight: 600 }}
                  required
                >
                  <option value="CAMBRIDGE_PRIMARY">Cambridge Primary (Stages 1–6)</option>
                  <option value="CAMBRIDGE_LOWER_SECONDARY">Cambridge Lower Secondary (Stages 7–9)</option>
                  <option value="CAMBRIDGE_IGCSE">Cambridge IGCSE (Years 10–11)</option>
                  <option value="CAMBRIDGE_AS_A_LEVEL">Cambridge International AS & A Level (Years 12–13)</option>
                </select>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  Target Cambridge qualification level
                </span>
              </div>
              <div>
                <label className="field-label" style={{ fontWeight: 700 }}>Subject Name *</label>
                <input
                  type="text"
                  className="field"
                  value={extractedSyllabus.subject_name}
                  onChange={(e) => setExtractedSyllabus({ ...extractedSyllabus, subject_name: e.target.value })}
                  style={{ width: '100%' }}
                  required
                />
              </div>
              <div>
                <label className="field-label" style={{ fontWeight: 700 }}>Subject Code *</label>
                <input
                  type="text"
                  className="field"
                  value={extractedSyllabus.subject_code}
                  onChange={(e) => setExtractedSyllabus({ ...extractedSyllabus, subject_code: e.target.value })}
                  placeholder="e.g. 0580, 0610, 0457"
                  style={{ width: '100%', fontWeight: 700 }}
                  required
                />
              </div>
            </div>

            {/* Global Perspectives Challenges or Standard Topics */}
            <h4 style={{ margin: '12px 0 6px', fontSize: 13, color: '#1e293b' }}>
              {extractedSyllabus.is_global_perspectives ? '🎯 Identified Challenges:' : 'Topics & Units:'}
            </h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {extractedSyllabus.topics.map((t, idx) => (
                <span key={idx} className="chip" style={{ background: t.is_challenge ? '#e0f2fe' : '#f1f5f9', color: t.is_challenge ? '#0369a1' : '#334155', fontWeight: 600 }}>
                  {t.is_challenge ? `🎯 ${t.title}` : t.title}
                </span>
              ))}
            </div>

            {/* Extracted Learning Objectives */}
            <h4 style={{ margin: '12px 0 6px', fontSize: 13, color: '#1e293b' }}>
              Extracted Learning Objectives ({extractedSyllabus.objectives.length}):
            </h4>
            <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6, padding: 8, fontSize: 11.5 }}>
              {extractedSyllabus.objectives.map((o, idx) => (
                <div key={idx} style={{ marginBottom: 4 }}>
                  <strong>[{o.code}]</strong> {o.text} {o.challenge_title ? `— (${o.challenge_title})` : ''}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => setShowPdfIngestModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveExtractedCurriculum}>
                ✓ Save to School Curriculum Library
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: TIMETABLE CONFIRMATION (TEACHER)                               */}
      {/* ===================================================================== */}
      {showUploadTimetableModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div className="card" style={{ width: '100%', maxWidth: 860, padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17 }}>Confirm Timetable Periods ({parsedTimetablePreview.length} Detected)</h3>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
                  Review and verify the detected subjects, classes, and timings below. You can adjust any assignment before saving.
                </p>
              </div>
              <button className="btn btn-ghost btn-small" onClick={() => setShowUploadTimetableModal(false)}>✕</button>
            </div>

            <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', position: 'sticky', top: 0, zIndex: 1 }}>
                    <th style={{ padding: '8px 6px', width: 110 }}>Day & Period</th>
                    <th style={{ padding: '8px 6px', width: 120 }}>Time Range</th>
                    <th style={{ padding: '8px 6px' }}>Subject Assignment</th>
                    <th style={{ padding: '8px 6px' }}>Class</th>
                    <th style={{ padding: '8px 6px', width: 90 }}>Room</th>
                    <th style={{ padding: '8px 6px', width: 40, textAlign: 'center' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {parsedTimetablePreview.map((slot, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: 6, verticalAlign: 'middle' }}>
                        <strong style={{ color: '#0f172a' }}>{DAYS_NAMES[slot.day_of_week]}</strong>
                        <div style={{ fontSize: 11, color: '#64748b' }}>Period {slot.period_number}</div>
                      </td>
                      <td style={{ padding: 6, verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                        <span style={{ fontWeight: 600, color: '#0b4f8a' }}>{slot.start_time} – {slot.end_time}</span>
                      </td>
                      <td style={{ padding: 6, verticalAlign: 'middle' }}>
                        <select
                          className="field select"
                          style={{ width: '100%', fontSize: 12, padding: '4px 8px' }}
                          value={slot.subject_id || ''}
                          onChange={(e) => {
                            const newSubId = e.target.value
                            const subObj = subjects.find((s) => s.id === newSubId)
                            const updated = [...parsedTimetablePreview]
                            updated[idx] = {
                              ...updated[idx],
                              subject_id: newSubId || null,
                              subject_name: subObj ? subObj.name : slot.subject_name
                            }
                            setParsedTimetablePreview(updated)
                          }}
                        >
                          <option value="">{slot.subject_name || '— Select Subject —'}</option>
                          {subjects.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: 6, verticalAlign: 'middle' }}>
                        <select
                          className="field select"
                          style={{ width: '100%', fontSize: 12, padding: '4px 8px' }}
                          value={slot.class_id || ''}
                          onChange={(e) => {
                            const newClassId = e.target.value
                            const clsObj = classes.find((c) => c.id === newClassId)
                            const updated = [...parsedTimetablePreview]
                            updated[idx] = {
                              ...updated[idx],
                              class_id: newClassId || null,
                              class_name: clsObj ? clsObj.name : slot.class_name
                            }
                            setParsedTimetablePreview(updated)
                          }}
                        >
                          <option value="">{slot.class_name || '— Select Class —'}</option>
                          {classes.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: 6, verticalAlign: 'middle' }}>
                        <input
                          type="text"
                          className="field"
                          style={{ width: '100%', fontSize: 12, padding: '4px 6px' }}
                          value={slot.room || ''}
                          placeholder="e.g. Lab 1"
                          onChange={(e) => {
                            const updated = [...parsedTimetablePreview]
                            updated[idx] = { ...updated[idx], room: e.target.value }
                            setParsedTimetablePreview(updated)
                          }}
                        />
                      </td>
                      <td style={{ padding: 6, textAlign: 'center', verticalAlign: 'middle' }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-small"
                          style={{ padding: '2px 6px', color: '#ef4444' }}
                          title="Remove slot"
                          onClick={() => {
                            setParsedTimetablePreview((prev) => prev.filter((_, i) => i !== idx))
                          }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => {
                  setParsedTimetablePreview((prev) => [
                    ...prev,
                    {
                      day_of_week: 0,
                      period_number: prev.length + 1,
                      start_time: '08:00',
                      end_time: '08:45',
                      class_id: null,
                      subject_id: null,
                      class_name: 'Year 9',
                      subject_name: 'ICT',
                      room: ''
                    }
                  ])
                }}
              >
                + Add Period Slot Manually
              </button>

              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => setShowUploadTimetableModal(false)}>Cancel</button>
                <button
                  className="btn btn-primary"
                  onClick={handleConfirmTimetableSlots}
                  disabled={parsedTimetablePreview.length === 0}
                >
                  ✓ Confirm & Save Timetable ({parsedTimetablePreview.length} Lessons)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: PDF VIEWER PREVIEW                                             */}
      {/* ===================================================================== */}
      {showPdfPreviewModal && pdfPreviewUrl && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: 16 }}>
          <div className="card" style={{ width: '100%', maxWidth: 960, height: '90vh', display: 'flex', flexDirection: 'column', padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>{pdfPreviewTitle}</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <a href={pdfPreviewUrl} download={`${pdfPreviewTitle}.pdf`} className="btn btn-primary btn-small">
                  💾 Download PDF
                </a>
                <button className="btn btn-ghost btn-small" onClick={() => setShowPdfPreviewModal(false)}>
                  ✕ Close
                </button>
              </div>
            </div>
            <iframe src={pdfPreviewUrl} style={{ width: '100%', flex: 1, border: 'none', borderRadius: 8 }} title="PDF Preview" />
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: GEMINI API KEY CONFIGURATION                                   */}
      {/* ===================================================================== */}
      <GeminiApiKeyModal
        isOpen={showGeminiApiKeyModal}
        onClose={() => setShowGeminiApiKeyModal(false)}
      />
    </div>
  )
}
