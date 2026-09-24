import { extractTextFromPdf } from './syllabusPdfParser'
import type { TeacherScheduleSlot } from './types'

const DAYS_MAP: Record<string, number> = {
  monday: 0,
  mon: 0,
  tuesday: 1,
  tue: 1,
  tues: 1,
  wednesday: 2,
  wed: 2,
  thursday: 3,
  thu: 3,
  thur: 3,
  friday: 4,
  fri: 4,
  saturday: 5,
  sat: 5,
  sunday: 6,
  sun: 6
}

const TIME_RANGE_REGEX = /(?:^|\s)(0?[7-9]|1[0-7])[:.]([0-5][0-9])\s*(?:am|pm)?\s*(?:-|–|to)\s*(0?[7-9]|1[0-7])[:.]([0-5][0-9])\s*(?:am|pm)?/i

// Common non-lesson keywords to filter out
const NON_LESSON_KEYWORDS = [
  'break',
  'lunch',
  'tea break',
  'assembly',
  'duty',
  'homeroom',
  'free',
  'planning',
  'meeting',
  'registration',
  'clubs'
]

export interface ParsedTimetableResult {
  slots: Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>>
  rawPreview: string
  warnings: string[]
}

export async function parseTeacherTimetablePdf(
  file: File,
  knownClasses: Array<{ id: string; name: string }>,
  knownSubjects: Array<{ id: string; name: string }>
): Promise<ParsedTimetableResult> {
  const { fullText } = await extractTextFromPdf(file)
  const lines = fullText.split('\n').map((l) => l.trim()).filter(Boolean)
  const slots: Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>> = []
  const warnings: string[] = []

  let currentDay = 0
  let periodCounter = 1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lower = line.toLowerCase()

    // 1. Detect Day of Week
    for (const [dayKey, dayIndex] of Object.entries(DAYS_MAP)) {
      if (lower === dayKey || lower.startsWith(dayKey + ' ') || lower.endsWith(' ' + dayKey)) {
        currentDay = dayIndex
        periodCounter = 1
        break
      }
    }

    // Skip non-instructional blocks
    if (NON_LESSON_KEYWORDS.some((kw) => lower.includes(kw))) {
      continue
    }

    // 2. Detect Time Range
    const timeMatch = line.match(TIME_RANGE_REGEX)
    if (timeMatch) {
      const startH = timeMatch[1].padStart(2, '0')
      const startM = timeMatch[2]
      const endH = timeMatch[3].padStart(2, '0')
      const endM = timeMatch[4]
      const startTime = `${startH}:${startM}`
      const endTime = `${endH}:${endM}`

      // Check next few lines for class & subject tokens
      let candidateSubject = 'General'
      let candidateClass = 'All'
      let candidateRoom = ''

      const contextLines = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 3))
      for (const cl of contextLines) {
        // Match against known subjects
        for (const s of knownSubjects) {
          if (cl.toLowerCase().includes(s.name.toLowerCase())) {
            candidateSubject = s.name
            break
          }
        }

        // Match against known classes
        for (const c of knownClasses) {
          if (cl.toLowerCase().includes(c.name.toLowerCase())) {
            candidateClass = c.name
            break
          }
        }

        // Match room / lab
        const roomMatch = cl.match(/\b(Lab\s*\d*|Room\s*\d+|Hall|[A-Z]\d{2})\b/i)
        if (roomMatch) {
          candidateRoom = roomMatch[0]
        }
      }

      // Find matched class_id and subject_id
      const matchedClass = knownClasses.find((c) => c.name.toLowerCase() === candidateClass.toLowerCase())
      const matchedSubject = knownSubjects.find((s) => s.name.toLowerCase() === candidateSubject.toLowerCase())

      slots.push({
        day_of_week: currentDay,
        period_number: periodCounter++,
        start_time: startTime,
        end_time: endTime,
        class_id: matchedClass?.id || null,
        subject_id: matchedSubject?.id || null,
        class_name: candidateClass,
        subject_name: candidateSubject,
        room: candidateRoom
      })
    }
  }

  // If no time regex matched (e.g. simple table or text layout), provide standard default schedule blocks
  if (slots.length === 0) {
    warnings.push('Could not detect exact timestamp ranges. Generated standard timetable periods for Monday to Friday.')
    const defaultPeriods = [
      { p: 1, start: '08:00', end: '08:45' },
      { p: 2, start: '08:50', end: '09:35' },
      { p: 3, start: '10:00', end: '10:45' },
      { p: 4, start: '10:50', end: '11:35' },
      { p: 5, start: '12:20', end: '13:05' }
    ]

    for (let day = 0; day < 5; day++) {
      for (const dp of defaultPeriods) {
        const cls = knownClasses[day % (knownClasses.length || 1)]?.name || 'Class 1'
        const sbj = knownSubjects[dp.p % (knownSubjects.length || 1)]?.name || 'Subject'
        slots.push({
          day_of_week: day,
          period_number: dp.p,
          start_time: dp.start,
          end_time: dp.end,
          class_id: knownClasses.find((c) => c.name === cls)?.id || null,
          subject_id: knownSubjects.find((s) => s.name === sbj)?.id || null,
          class_name: cls,
          subject_name: sbj,
          room: ''
        })
      }
    }
  }

  return {
    slots,
    rawPreview: lines.slice(0, 40).join('\n'),
    warnings
  }
}
