import * as pdfjsLib from 'pdfjs-dist'

// Configure worker using CDN fallback or local bundle
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
} catch {
  // worker fallback handled by pdfjs
}

export interface ExtractedTopic {
  code?: string
  title: string
  sequence: number
  is_challenge?: boolean
  description?: string
}

export interface ExtractedObjective {
  topic_title?: string
  code: string
  text: string
  subtopic?: string
  challenge_title?: string
  sequence: number
}

export interface ExtractedSyllabus {
  framework: string
  subject_code: string
  subject_name: string
  year_group: string
  title: string
  syllabus_years: string
  is_global_perspectives: boolean
  topics: ExtractedTopic[]
  objectives: ExtractedObjective[]
  rawTextPreview: string
  pageCount: number
}

// Global Perspectives recognized challenges keywords
const KNOWN_GP_CHALLENGES = [
  'Keeping Healthy',
  'Looking After Planet Earth',
  'Sport and Recreation',
  'Values and Beliefs',
  'Conflict and Peace',
  'Moving Goods and People',
  'The Right to Learn',
  'Water, Food and Farming',
  'Sustainable Living',
  'Digital World',
  'Employment & Work',
  'Disease & Health',
  'Human Rights',
  'Migration & Urbanisation',
  'Tradition, Culture & Identity',
  'Climate Change, Energy & Resources',
  'Poverty, Wealth Inequality & Food Security',
  'Artificial Intelligence, Ethics & Human Rights',
  'Medical Ethics, Bioengineering & Global Health',
  'Geopolitics, Sovereignty, Climate Security & Conflict',
  'Global Economics, Transnational Trade & Aid'
]

// Regex patterns for learning objectives and headers
const LO_PATTERN = /^(\*?[A-Za-z0-9\.\-]{2,12}[0-9]+[A-Za-z0-9\.\-]*)\s+(.*)/i
const TOPIC_PATTERN = /^(?:Topic|Unit|Chapter|Section|Strand|Theme)\s*(\d+|[A-Z])[:\.\-]?\s+(.*)/i
const CHALLENGE_PATTERN = /^(?:Challenge|Theme)\s*(\d+|[A-Z])?[:\.\-]?\s+(.*)/i

export async function extractTextFromPdf(file: File): Promise<{ pagesText: string[]; fullText: string }> {
  const arrayBuffer = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) })
  const pdf = await loadingTask.promise
  const pagesText: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageStrings = content.items
      .map((item: any) => item.str || '')
      .filter((s: string) => s.trim().length > 0)
    pagesText.push(pageStrings.join('\n'))
  }

  return {
    pagesText,
    fullText: pagesText.join('\n\n')
  }
}

export async function parseSyllabusPdf(file: File): Promise<ExtractedSyllabus> {
  const { pagesText, fullText } = await extractTextFromPdf(file)
  const lines = fullText.split('\n').map((l) => l.trim()).filter(Boolean)

  // 1. Detect Framework
  let framework = 'CAMBRIDGE_LOWER_SECONDARY'
  const textLower = fullText.toLowerCase()
  if (textLower.includes('as & a level') || textLower.includes('as and a level') || textLower.includes('a level')) {
    framework = 'CAMBRIDGE_AS_A_LEVEL'
  } else if (textLower.includes('igcse') || textLower.includes('years 10') || textLower.includes('years 11')) {
    framework = 'CAMBRIDGE_IGCSE'
  } else if (textLower.includes('primary') || textLower.includes('stage 1') || textLower.includes('stage 6')) {
    framework = 'CAMBRIDGE_PRIMARY'
  }

  // 2. Detect Subject Name & Code
  let subjectName = file.name.replace(/\.pdf$/i, '').replace(/[_\-]+/g, ' ')
  let subjectCode = ''

  const codeMatch = file.name.match(/\b(0\d{3}|1\d{3}|9\d{3})\b/) || fullText.match(/\b(0\d{3}|1\d{3}|9\d{3})\b/)
  if (codeMatch) {
    subjectCode = codeMatch[1]
  }

  const isGlobalPerspectives =
    subjectName.toLowerCase().includes('global perspective') ||
    textLower.includes('global perspectives') ||
    subjectCode === '0838' ||
    subjectCode === '1129' ||
    subjectCode === '0457' ||
    subjectCode === '9239'

  if (isGlobalPerspectives) {
    subjectName = 'Global Perspectives'
    if (!subjectCode) {
      if (framework === 'CAMBRIDGE_PRIMARY') subjectCode = '0838'
      else if (framework === 'CAMBRIDGE_LOWER_SECONDARY') subjectCode = '1129'
      else if (framework === 'CAMBRIDGE_IGCSE') subjectCode = '0457'
      else subjectCode = '9239'
    }
  } else {
    // Detect other known subjects
    if (textLower.includes('mathematics') || textLower.includes('maths')) subjectName = 'Mathematics'
    else if (textLower.includes('computer science')) subjectName = 'Computer Science'
    else if (textLower.includes('computing')) subjectName = 'Computing'
    else if (textLower.includes('biology')) subjectName = 'Biology'
    else if (textLower.includes('chemistry')) subjectName = 'Chemistry'
    else if (textLower.includes('physics')) subjectName = 'Physics'
    else if (textLower.includes('english')) subjectName = 'English'
    else if (textLower.includes('business')) subjectName = 'Business Studies'
    else if (textLower.includes('economics')) subjectName = 'Economics'
  }

  // 3. Detect Year Group / Stage
  let yearGroup = 'Stage 7'
  const stageMatch = fullText.match(/Stage\s*([1-9](?:\s*(?:to|and|\-)\s*[1-9])?)/i) || fullText.match(/Year\s*([0-9]{1,2})/i)
  if (stageMatch) {
    yearGroup = stageMatch[0]
  } else if (framework === 'CAMBRIDGE_IGCSE') {
    yearGroup = 'Years 10–11 (IGCSE)'
  } else if (framework === 'CAMBRIDGE_AS_A_LEVEL') {
    yearGroup = 'Years 12–13 (AS & A Level)'
  } else if (framework === 'CAMBRIDGE_PRIMARY') {
    yearGroup = 'Stage 3'
  }

  // 4. Extract Topics & Objectives (or Challenges for Global Perspectives)
  const topics: ExtractedTopic[] = []
  const objectives: ExtractedObjective[] = []

  if (isGlobalPerspectives) {
    // -------------------------------------------------------------
    // SPECIALIZED GLOBAL PERSPECTIVES CHALLENGES & OBJECTIVES PARSER
    // -------------------------------------------------------------
    const challengeSet = new Set<string>()

    // Search for explicitly mentioned challenges
    for (const challengeName of KNOWN_GP_CHALLENGES) {
      if (textLower.includes(challengeName.toLowerCase())) {
        challengeSet.add(challengeName)
      }
    }

    // Also look for CHALLENGE / THEME headers in lines
    for (const line of lines) {
      const match = line.match(CHALLENGE_PATTERN)
      if (match && match[2] && match[2].length > 3 && match[2].length < 80) {
        challengeSet.add(match[2].trim())
      }
    }

    // If none detected from text, seed standard default challenges for the framework
    if (challengeSet.size === 0) {
      if (framework === 'CAMBRIDGE_PRIMARY') {
        challengeSet.add('Keeping Healthy')
        challengeSet.add('Looking After Planet Earth')
        challengeSet.add('Sport and Recreation')
        challengeSet.add('Values and Beliefs')
        challengeSet.add('Conflict and Peace')
        challengeSet.add('Water, Food and Farming')
      } else {
        challengeSet.add('Sustainable Living')
        challengeSet.add('Digital World & Ethics')
        challengeSet.add('Health, Disease & Wellbeing')
        challengeSet.add('Employment, Automation & Future of Work')
        challengeSet.add('Migration, Urbanisation & Communities')
        challengeSet.add('Water, Food Security & Biodiversity')
      }
    }

    let seq = 1
    for (const ch of challengeSet) {
      topics.push({
        code: `GP-CH-${seq.toString().padStart(2, '0')}`,
        title: ch,
        sequence: seq,
        is_challenge: true,
        description: `Global Perspectives Inquiry Challenge: ${ch}`
      })
      seq++
    }

    // Extract objectives or skill statements
    let objSeq = 1
    for (const line of lines) {
      const loMatch = line.match(LO_PATTERN)
      if (loMatch && loMatch[2].length > 10) {
        const code = loMatch[1].trim()
        const text = loMatch[2].trim()
        objectives.push({
          topic_title: topics[0]?.title || 'Core Skills',
          code,
          text,
          challenge_title: 'Core Skills',
          sequence: objSeq++
        })
      } else if (
        line.startsWith('Research:') ||
        line.startsWith('Analysis:') ||
        line.startsWith('Evaluation:') ||
        line.startsWith('Reflection:') ||
        line.startsWith('Collaboration:') ||
        line.startsWith('Communication:')
      ) {
        const parts = line.split(':')
        const skill = parts[0].trim()
        const desc = parts.slice(1).join(':').trim()
        objectives.push({
          topic_title: topics[0]?.title || 'Core Skills',
          code: `GP.${skill.substring(0, 3).toUpperCase()}.${objSeq}`,
          text: desc || line,
          challenge_title: skill,
          sequence: objSeq++
        })
      }
    }

    // If few objectives found, supply standard Cambridge skill strand objectives
    if (objectives.length === 0) {
      const standardSkills = [
        { code: `${subjectCode}.R01`, skill: 'Research', text: 'Formulate focused questions and retrieve balanced evidence from diverse local and global sources.' },
        { code: `${subjectCode}.A01`, skill: 'Analysis', text: 'Analyse causes and consequences of issues from personal, national and global perspectives.' },
        { code: `${subjectCode}.E01`, skill: 'Evaluation', text: 'Evaluate sources and arguments for credibility, bias, validity and logical coherence.' },
        { code: `${subjectCode}.Ref01`, skill: 'Reflection', text: 'Reflect critically on own learning and how personal views and values have transformed.' },
        { code: `${subjectCode}.Com01`, skill: 'Communication', text: 'Communicate structured arguments clearly with persuasive evidence to varied audiences.' },
        { code: `${subjectCode}.Col01`, skill: 'Collaboration', text: 'Collaborate effectively in diverse teams to coordinate and achieve a purposeful project outcome.' }
      ]
      standardSkills.forEach((s, idx) => {
        objectives.push({
          topic_title: topics[0]?.title,
          code: s.code,
          text: s.text,
          challenge_title: s.skill,
          sequence: idx + 1
        })
      })
    }
  } else {
    // -------------------------------------------------------------
    // STANDARD SUBJECTS TOPICS & OBJECTIVES PARSER
    // -------------------------------------------------------------
    let currentTopicTitle = 'Unit 1: Overview & Foundation'
    let topicSeq = 1
    let objSeq = 1

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Check for topic header
      const topicMatch = line.match(TOPIC_PATTERN)
      if (topicMatch && topicMatch[2] && topicMatch[2].length > 2 && topicMatch[2].length < 100) {
        currentTopicTitle = topicMatch[0].trim()
        if (!topics.some((t) => t.title.toLowerCase() === currentTopicTitle.toLowerCase())) {
          topics.push({
            code: `T${topicSeq}`,
            title: currentTopicTitle,
            sequence: topicSeq++,
            is_challenge: false
          })
        }
        continue
      }

      // Check for learning objective pattern (e.g. 8Sc.01 or bulleted LO)
      const loMatch = line.match(LO_PATTERN)
      if (loMatch && loMatch[2].length > 8) {
        const code = loMatch[1].trim()
        const text = loMatch[2].trim()

        if (!topics.some((t) => t.title === currentTopicTitle)) {
          topics.push({
            code: `T${topicSeq}`,
            title: currentTopicTitle,
            sequence: topicSeq++,
            is_challenge: false
          })
        }

        objectives.push({
          topic_title: currentTopicTitle,
          code,
          text,
          subtopic: currentTopicTitle,
          sequence: objSeq++
        })
      }
    }

    // Fallback if no distinct topics were parsed
    if (topics.length === 0) {
      topics.push({
        code: 'T1',
        title: `${subjectName} Core Units`,
        sequence: 1,
        is_challenge: false
      })
    }
  }

  const title = `${subjectName} ${yearGroup}`.trim()
  const rawPreview = lines.slice(0, 30).join('\n')

  return {
    framework,
    subject_code: subjectCode,
    subject_name: subjectName,
    year_group: yearGroup,
    title,
    syllabus_years: '2023-2027',
    is_global_perspectives: isGlobalPerspectives,
    topics,
    objectives,
    rawTextPreview: rawPreview,
    pageCount: pagesText.length
  }
}
