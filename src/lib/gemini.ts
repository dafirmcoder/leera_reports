/**
 * Gemini AI Integration for Cambridge Lesson Planning
 * Generates the 4 core instructional stages:
 * 1. Starter (10 min) - Inquiry Hook / Warm-up
 * 2. Exposition (15 min) - Direct Instruction / Teacher Modeling
 * 3. Learners Activity (35 min) - Guided Tasks / Hands-on Practice
 * 4. Plenary (10 min) - Exit Ticket / Lesson Synthesis
 */

const STORAGE_KEY = 'leera_gemini_api_key'
const FALLBACK_STORAGE_KEY = 'gemini_api_key'

export type InstructionalStage = 'starter' | 'exposition' | 'learnersActivity' | 'plenary' | 'assessmentIdeas'

export interface StageDefinition {
  key: InstructionalStage
  label: string
  fullName: string
  duration: string
  subtitle: string
  badgeColor: string
  badgeBg: string
  textColor: string
  description: string
  placeholder: string
}

export const INSTRUCTIONAL_STAGES: Record<InstructionalStage, StageDefinition> = {
  starter: {
    key: 'starter',
    label: '1. Starter',
    fullName: 'Starter Activities',
    duration: '',
    subtitle: 'Inquiry Hook / Warm-up',
    badgeColor: '#15803d',
    badgeBg: '#dcfce7',
    textColor: '#15803d',
    description: 'Inquiry hook, diagnostic warm-up, activating prior knowledge, engaging problem or demo.',
    placeholder: 'e.g. Torch ON/OFF demo — “Computers only see two states; how do they show numbers, pictures and words?”; introduce the lesson inquiry question.'
  },
  exposition: {
    key: 'exposition',
    label: '2. Exposition',
    fullName: 'Exposition Methods',
    duration: '',
    subtitle: 'Direct Instruction / Teacher Modeling',
    badgeColor: '#0369a1',
    badgeBg: '#e0f2fe',
    textColor: '#0369a1',
    description: 'Direct instruction, concept explanation, key vocabulary, worked examples, teacher modeling.',
    placeholder: 'e.g. Explain network topologies (bus, ring, star) with board diagrams, demonstrate how packets flow through each layout, give solved examples comparing failure points, and check understanding with a quick hinge question.'
  },
  learnersActivity: {
    key: 'learnersActivity',
    label: '3. Learners Activity',
    fullName: 'Learners Activity',
    duration: '',
    subtitle: 'Guided Tasks / Hands-on Practice',
    badgeColor: '#6b21a8',
    badgeBg: '#f3e8ff',
    textColor: '#6b21a8',
    description: 'Differentiated student tasks (support/core/extension), collaborative stations, practical application.',
    placeholder: 'e.g. Three stations — (a) binary counting cards: hold up 0/1 cards to build given numbers and write binary patterns; (b) data-size ladder: order bit, byte, kilobyte, megabyte; (c) version control: edit a shared document...'
  },
  plenary: {
    key: 'plenary',
    label: '4. Plenary',
    fullName: 'Plenary',
    duration: '',
    subtitle: 'Exit Ticket / Lesson Synthesis',
    badgeColor: '#b45309',
    badgeBg: '#fef3c7',
    textColor: '#b45309',
    description: 'Exit ticket, learning review, student self-reflection, preview next session.',
    placeholder: 'e.g. Exit ticket — read one binary pattern, answer one data-size question, and state one benefit of version control; preview Friday’s new unit on networks.'
  },
  assessmentIdeas: {
    key: 'assessmentIdeas',
    label: 'Assessment Ideas',
    fullName: 'Assessment Ideas',
    duration: '',
    subtitle: 'Formative Checks & Evidence',
    badgeColor: '#4C2570',
    badgeBg: '#f3e8ff',
    textColor: '#4C2570',
    description: 'At least 2 concrete assessment ideas (formative checks, marked sheets, rubric checks, exit tickets).',
    placeholder: '• Marked activity sheets checking accuracy of...\n• 2-question exit ticket requiring learners to explain...'
  }
}

export const DEFAULT_GEMINI_API_KEY = ''

/**
 * Checks whether an API key appears to be a known invalid placeholder or invalid format.
 */
export function isKnownInvalidKey(key: string): boolean {
  if (!key) return true
  const trimmed = key.trim()
  if (trimmed.toLowerCase().includes('placeholder')) return true
  if (trimmed.length < 15) return true
  return false
}

/**
 * Retrieves the Gemini API key from localStorage or environment variables.
 * LocalStorage takes first priority so user keys entered in the UI modal take immediate effect.
 */
export function getGeminiApiKey(): string {
  // 1. User configured or database cached key in localStorage
  try {
    const local = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(FALLBACK_STORAGE_KEY)
    if (local && local.trim() && !isKnownInvalidKey(local.trim())) {
      return local.trim()
    }
  } catch {
    // Ignore localStorage access restrictions
  }

  // 2. Environment variable
  const envKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || ''
  if (typeof envKey === 'string' && envKey.trim() && !isKnownInvalidKey(envKey.trim())) {
    return envKey.trim()
  }

  return ''
}

/**
 * Asynchronously ensures a Gemini API key is available.
 * If not already in localStorage, it fetches the shared key from the Supabase database.
 */
export async function ensureGeminiApiKey(customApiKey?: string): Promise<string> {
  if (customApiKey && !isKnownInvalidKey(customApiKey)) {
    return customApiKey.trim()
  }
  const cached = getGeminiApiKey()
  if (cached && !isKnownInvalidKey(cached)) {
    return cached
  }
  try {
    const { api } = await import('./api')
    if (api && typeof api.getGeminiApiKey === 'function') {
      const dbKey = await api.getGeminiApiKey()
      if (dbKey && !isKnownInvalidKey(dbKey)) {
        setGeminiApiKey(dbKey)
        return dbKey
      }
    }
  } catch {
    // Database lookup failed or table not migrated yet
  }
  return ''
}

/**
 * Saves the Gemini API key to localStorage.
 */
export function setGeminiApiKey(key: string): void {
  try {
    const cleaned = key.trim()
    if (cleaned && !isKnownInvalidKey(cleaned)) {
      localStorage.setItem(STORAGE_KEY, cleaned)
    } else {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(FALLBACK_STORAGE_KEY)
    }
  } catch {
    // Ignore localStorage access restrictions
  }
}

/**
 * Clears the stored Gemini API key from localStorage.
 */
export function clearGeminiApiKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(FALLBACK_STORAGE_KEY)
  } catch {
    // Ignore
  }
}

/**
 * Checks if a valid Gemini API key is available.
 */
export function hasGeminiApiKey(): boolean {
  const key = getGeminiApiKey()
  return Boolean(key && !isKnownInvalidKey(key))
}

export interface LessonContext {
  subject?: string
  className?: string
  topic?: string
  challenge?: string // Lesson inquiry / challenge question
  subtopic?: string
  objectives?: Array<{ code?: string; text?: string } | string>
  successCriteria?: string
  existingStages?: {
    starter?: string
    exposition?: string
    learnersActivity?: string
    plenary?: string
    assessmentIdeas?: string
  }
}

// Officially supported Google Gemini models in v1beta order of priority
const CANDIDATE_MODELS = [
  'gemini-flash-latest',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-flash-lite-latest',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash-lite'
]

/**
 * Tests whether an API key is valid and can connect to Google Gemini API.
 */
export async function testGeminiApiKey(apiKey: string): Promise<{ success: boolean; message: string }> {
  const cleaned = apiKey.trim()
  if (!cleaned) {
    return { success: false, message: 'Please provide a Gemini API key.' }
  }
  if (isKnownInvalidKey(cleaned)) {
    return {
      success: false,
      message: 'Invalid key format. Gemini API keys are ~39-53 characters.'
    }
  }

  try {
    const testModels = ['gemini-flash-latest', 'gemini-3.8-flash']
    let lastErr = ''

    for (const model of testModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cleaned)}`
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 12000)

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Respond with OK' }] }],
            generationConfig: { maxOutputTokens: 10 }
          }),
          signal: controller.signal
        })
        clearTimeout(timeoutId)

        if (response.ok) {
          return { success: true, message: `Connected successfully with ${model}! Your Gemini API key is valid.` }
        }

        const errData = await response.json().catch(() => null)
        const errMsg = errData?.error?.message || `HTTP ${response.status} ${response.statusText}`
        if (response.status === 400 || response.status === 401 || response.status === 403) {
          return { success: false, message: `Authentication Error (${response.status}): ${errMsg}` }
        }
        lastErr = errMsg
      } catch (e: any) {
        lastErr = e?.message || 'Connection failed'
      }
    }

    return { success: false, message: lastErr || 'Failed to connect to Google Gemini API.' }
  } catch (err: any) {
    return { success: false, message: err?.message || 'Connection failed.' }
  }
}

/**
 * Calls Gemini REST API using preferred models with fallback.
 */
async function callGeminiApi(
  prompt: string,
  apiKey: string,
  options?: { maxTokens?: number; jsonMode?: boolean }
): Promise<string> {
  let lastError: Error | null = null
  const maxOutputTokens = options?.maxTokens || 850

  for (const model of CANDIDATE_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)

      const generationConfig: Record<string, any> = {
        temperature: 0.7,
        maxOutputTokens
      }
      if (options?.jsonMode) {
        generationConfig.responseMimeType = 'application/json'
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }]
            }
          ],
          generationConfig
        }),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        const errMsg = errorData?.error?.message || `HTTP ${response.status} ${response.statusText}`

        // If model not found (404), high demand spike (503), or rate limited (429), try next fallback model
        if (response.status === 404 || response.status === 503 || response.status === 429) {
          lastError = new Error(`Model ${model} (${response.status}): ${errMsg}`)
          continue
        }

        // If auth error, throw immediately with clear message
        if (response.status === 400 || response.status === 401 || response.status === 403) {
          throw new Error(`Gemini API Authentication Error (${response.status}): ${errMsg}`)
        }

        lastError = new Error(`Gemini API returned error: ${errMsg}`)
        continue
      }

      const data = await response.json()
      const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text
      if (candidateText && typeof candidateText === 'string') {
        return cleanGeneratedText(candidateText)
      }

      lastError = new Error('No generated text received in Gemini response.')
    } catch (err: any) {
      if (err.name === 'AbortError') {
        lastError = new Error('Gemini API request timed out (30 seconds).')
      } else {
        lastError = err
      }
    }
  }

  throw lastError || new Error('Failed to generate content with Gemini AI.')
}

/**
 * Strips markdown code blocks, stage titles, or redundant conversational introductions.
 */
function cleanGeneratedText(raw: string): string {
  let text = raw.trim()

  // Remove markdown code fences if wrapped
  text = text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim()

  // Remove repeated stage prefixes like "Starter (10 min):", "Starter:", "Exposition Methods:", "Assessment Ideas:", etc.
  text = text.replace(/^(?:(?:\d+\.\s*)?(?:Starter(?:\s*Activity)?|Exposition(?:\s*Methods)?|Learners?\s*Activity|Plenary|Assessment\s*Ideas?)(?:\s*\([^)]*\))?[:—\-]\s*)/i, '')

  // Remove surrounding quotes if entire string is quoted
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    const inner = text.slice(1, -1).trim()
    if (!inner.includes('\n') && !inner.startsWith('"')) {
      text = inner
    }
  }

  return text.trim()
}

/**
 * Normalizes exposition text to imperative lesson planning action style (e.g. "Explain...").
 * Automatically strips passive meta-phrasing like "Direct instruction covers..." or "The teacher explains...".
 */
export function cleanExpositionText(raw: string): string {
  let text = cleanGeneratedText(raw).replace(/["“”]/g, '').trim()

  // Replace leading "Direct instruction covers/introduces/details/explores/focuses on (the)..." with "Explain "
  text = text.replace(/^Direct\s+instruction\s+(?:methods\s+)?(?:covers|details|outlines|focuses\s+on|introduces|explores)\s+(?:the\s+)?/i, 'Explain ')

  // Replace "The teacher [verb]..." with imperative verbs
  text = text.replace(/(?:^|\.\s+)The\s+teacher\s+(?:will\s+)?(?:explains?|breaks?\s+down|models?|demonstrates?)\s+/gi, (match) => {
    const isNewSent = match.startsWith('.')
    let verb = 'demonstrate '
    if (/break/i.test(match)) verb = 'demonstrate '
    else if (/model/i.test(match)) verb = 'model '
    else if (/demonstrat/i.test(match)) verb = 'demonstrate '
    else verb = 'explain '
    return isNewSent ? `, ${verb}` : verb.charAt(0).toUpperCase() + verb.slice(1)
  })

  // Replace "A rapid hinge check uses..." with "and check understanding with..."
  text = text.replace(/(?:^|\.\s+)(?:A\s+)?(?:rapid\s+)?hinge\s+check\s+uses\s+/gi, (match) => {
    return match.startsWith('.') ? ', and check understanding with ' : 'Check understanding with '
  })

  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1)
  }

  return text.trim()
}

/**
 * Builds the pedagogical prompt for a single instructional stage.
 */
function buildStagePrompt(stage: InstructionalStage, context: LessonContext): string {
  const stageDef = INSTRUCTIONAL_STAGES[stage]
  const objectivesFormatted = (context.objectives || [])
    .map((o) => (typeof o === 'string' ? o : `${o.code ? `[${o.code}] ` : ''}${o.text || ''}`))
    .filter(Boolean)
    .join('\n- ')

  let stageSpecificInstructions = ''
  if (stage === 'exposition') {
    stageSpecificInstructions = `CRITICAL GRAMMATICAL & STYLE REQUIREMENTS FOR EXPOSITION:
1. MUST BE IN IMPERATIVE MOOD (ACTION VERBS ONLY):
   - Start immediately with an imperative action verb: "Explain...", "Demonstrate...", "Model...", "Illustrate...", or "Give solved examples of...".
   - Follow this EXACT lesson plan action style:
     "Explain [concept] with [board diagrams/visuals], demonstrate [process/flow/steps], give solved examples [comparing/calculating/showing X], and check understanding with [a quick hinge question/mini-whiteboards]."
   - TARGET REAL-WORLD EXAMPLE:
     "Explain network topologies (bus, ring, star) with board diagrams, demonstrate how packets flow through each layout, give solved examples comparing failure points, and check understanding with a quick hinge question."
2. ABSOLUTELY FORBIDDEN PHRASES (DO NOT USE):
   - NEVER start with: "Direct instruction covers...", "Direct instruction introduces...", "In this stage...", "The lesson begins with...".
   - NEVER write in third person: "The teacher explains...", "The teacher breaks down...", "The teacher demonstrates...", "A rapid hinge check uses...".
   - NEVER use quotation marks or dialogue ("..." or '...' or “...”).
3. WHITEBOARD MODELING & SOLVED EXAMPLES: Explicitly include concrete worked/solved examples and visual board representations.
4. STRICT OBJECTIVE & GRADE ALIGNMENT: Explicitly teach the selected Cambridge objective(s) for ${context.className || 'the specified year level'}.
5. HINGE CHECK: Conclude with checking understanding with a quick hinge question before independent practice.`
  } else if (stage === 'starter') {
    stageSpecificInstructions = `CRITICAL REQUIREMENTS FOR STARTER:
1. CLASSROOM REALISM: A fast-paced, high-energy hook with minimal teacher talk and immediate pupil action.
2. CONCRETE HOOK: Use a real-world dilemma, a physical prop, an intriguing visual on the board, or a mystery question directly introducing the selected objective.
3. IMMEDIATE STUDENT ACTION: Prompt students to act within 2 minutes using mini-whiteboards, Think-Pair-Share, or quick sorting cards.
4. GRADE APPROPRIATE: Calibrated strictly for ${context.className || 'Secondary'} learners.`
  } else if (stage === 'learnersActivity') {
    stageSpecificInstructions = `CRITICAL REQUIREMENTS FOR LEARNERS ACTIVITY:
1. CLASSROOM REALISM: Highly practical, hands-on tasks with concrete classroom outputs (differentiated worksheets, stations, paired experiments, or problem cards).
2. DIRECT CURRICULUM ALIGNMENT: Tasks must directly practice and apply the skills defined in the selected learning objective(s).
3. EXPLICIT DIFFERENTIATION:
   - Support: Sentence stems, scaffolded hint cards, or guided templates for learners needing help.
   - Core: Main collaborative application task or practical investigation meeting the Cambridge objective.
   - Extension: Higher-order stretch challenge, counter-scenario, or critical analysis for advanced learners.
4. GRADE LEVEL RELEVANCE: Calibrated strictly for ${context.className || 'Secondary'} learners.`
  } else if (stage === 'plenary') {
    stageSpecificInstructions = `CRITICAL REQUIREMENTS FOR PLENARY:
1. CLASSROOM REALISM: Sharp synthesis assessing student mastery against the success criteria and selected objective(s).
2. CONCRETE ROUTINE: Use a definitive checking method (e.g., Mini-Whiteboard Showdown, 2-question Exit Ticket, or 3-2-1 Countdown).
3. INQUIRY CLOSURE: Learners state the answer to today's inquiry question, followed by a brief preview connecting to the next lesson.`
  } else if (stage === 'assessmentIdeas') {
    stageSpecificInstructions = `CRITICAL REQUIREMENTS FOR ASSESSMENT IDEAS:
1. AT LEAST 2 TO 3 ASSESSMENT IDEAS: Provide at least 2 distinct, concrete classroom assessment methods (format as bullet points starting with •).
2. DIRECT OBJECTIVE EVALUATION: Every assessment idea must explicitly measure whether students met the selected learning objective(s).
3. CONCRETE EVIDENCE ARTIFACTS: Include specific tangible artifacts, such as:
   - Formative marked task or worksheet (e.g. "• Marked student investigation sheet checking accuracy of...").
   - Exit ticket / hinge check (e.g. "• 2-question exit ticket requiring learners to explain/calculate...").
   - Peer evaluation or rubric checklist (e.g. "• Paired rubric check assessing whether...").
4. GRADE LEVEL RELEVANCE: Fully age-appropriate for ${context.className || 'Secondary'} learners.`
  }

  return `You are a veteran Cambridge International educator designing realistic, engaging classroom lesson activities.

STAGE TO GENERATE:
Stage: ${stageDef.fullName} ${stageDef.duration ? `(${stageDef.duration})` : ''}
Category: ${stageDef.subtitle}

LESSON CONTEXT:
- Subject: ${context.subject || 'General'}
- Class / Grade / Stage: ${context.className || 'Secondary'}
- Lesson Topic: ${context.topic || 'Inquiry Lesson'}
${context.challenge ? `- Lesson Inquiry / Challenge Question: "${context.challenge}"` : ''}
${context.subtopic ? `- Subtopic / Key Focus: ${context.subtopic}` : ''}
${objectivesFormatted ? `- MANDATORY CURRICULUM OBJECTIVES TO TEACH & ASSESS:\n- ${objectivesFormatted}` : ''}
${context.successCriteria ? `- Success Criteria: ${context.successCriteria}` : ''}

${context.existingStages ? `EXISTING STAGES IN THIS LESSON PLAN (Ensure seamless pedagogical alignment):
${context.existingStages.starter ? `Starter: ${context.existingStages.starter}` : ''}
${context.existingStages.exposition ? `Exposition: ${context.existingStages.exposition}` : ''}
${context.existingStages.learnersActivity ? `Learners Activity: ${context.existingStages.learnersActivity}` : ''}
${context.existingStages.plenary ? `Plenary: ${context.existingStages.plenary}` : ''}
${context.existingStages.assessmentIdeas ? `Assessment Ideas: ${context.existingStages.assessmentIdeas}` : ''}
` : ''}

MANDATORY RULES:
- The content MUST be strictly anchored to the selected learning objectives. Do NOT generate generic content.
- Must be fully age-appropriate and relevant for ${context.className || 'the specified grade level'}.
${stageSpecificInstructions}

GENERAL CONSTRAINTS:
- Length: 2 to 4 concise, action-packed sentences packed with concrete classroom reality.
- Output: Return ONLY the content. Do NOT include headings like "${stageDef.label}:" or "Teacher:".
`
}

/**
 * Generates pedagogically structured Cambridge International stages without requiring an external API.
 * Uses syllabus context (topic, challenge question, grade level, and learning objectives).
 */
export function generateOfflineStages(context: LessonContext): Record<InstructionalStage, string> {
  const topic = context.topic?.trim() || 'Unit Inquiry'
  const challenge = context.challenge?.trim() || `How do the core principles of ${topic} apply in real-world scenarios?`
  const grade = context.className?.trim() || 'Secondary'
  
  // Format objectives
  const objs = (context.objectives || [])
    .map((o) => (typeof o === 'string' ? o : `${o.code ? `[${o.code}] ` : ''}${o.text || ''}`))
    .filter(Boolean)
  const mainObj = objs.length > 0 ? objs[0] : topic

  // 1. Starter (10 min)
  const starter = `Diagnostic hook & inquiry question: Display "${challenge}" on the board with a visual prompt. Learners work in pairs for 3 minutes on mini-whiteboards to record their prior knowledge and predict solutions, followed by rapid whole-class sharing to activate key prerequisite concepts for ${topic}.`

  // 2. Exposition (15 min) - Must start with imperative verb, no quotes
  const exposition = `Explain core concepts and terminology of ${topic} with structured board diagrams and annotated models, demonstrate step-by-step worked examples directly addressing ${mainObj}, model common misconceptions and how to identify them, and check understanding with a quick diagnostic hinge question before transitioning to independent practice.`

  // 3. Learners Activity (35 min) - Differentiated Support / Core / Extension
  const learnersActivity = `Differentiated practical inquiry for ${grade} learners:
• Support: Provide scaffolded guidance cards with sentence stems, visual glossaries, and step-by-step problem templates for ${topic}.
• Core: Collaborative paired investigation applying key principles to solve structured problem sets and complete investigation sheets aligned with ${mainObj}.
• Extension: Independent higher-order challenge requiring students to analyze edge cases, evaluate real-world trade-offs, and justify their reasoning in writing.`

  // 4. Plenary (10 min)
  const plenary = `Synthesis & Exit Ticket: Conduct a rapid 3-2-1 reflection (3 key terms learned, 2 questions explored, 1 real-world connection made). Learners submit a 2-question exit ticket evaluating mastery against "${challenge}" and preview the upcoming session.`

  // 5. Assessment Ideas
  const assessmentIdeas = `• Marked student investigation sheet evaluating accuracy, working steps, and conceptual understanding of ${topic}.\n• 2-question exit ticket measuring individual student mastery against ${mainObj}.\n• Formative hinge check with mini-whiteboards during exposition to diagnose readiness before independent work.`

  return {
    starter,
    exposition,
    learnersActivity,
    plenary,
    assessmentIdeas
  }
}

/**
 * Generates content for a single instructional stage using Gemini AI.
 */
export async function generateStageContent(
  stage: InstructionalStage,
  context: LessonContext,
  customApiKey?: string
): Promise<string> {
  const apiKey = await ensureGeminiApiKey(customApiKey)
  if (!apiKey) {
    throw new Error('MISSING_API_KEY')
  }

  const prompt = buildStagePrompt(stage, context)
  try {
    const result = await callGeminiApi(prompt, apiKey, { maxTokens: 850 })
    return stage === 'exposition' ? cleanExpositionText(result) : cleanGeneratedText(result)
  } catch (err: any) {
    if (err?.message?.includes('Authentication Error') || err?.message?.includes('INVALID_API_KEY')) {
      throw err
    }
    console.warn(`Stage ${stage} AI generation failed; falling back to offline template:`, err)
    const offline = generateOfflineStages(context)
    return offline[stage] || ''
  }
}

/**
 * Generates all 4 instructional stages + Assessment Ideas at once.
 */
export async function generateAllStages(
  context: LessonContext,
  customApiKey?: string
): Promise<Record<InstructionalStage, string>> {
  const apiKey = await ensureGeminiApiKey(customApiKey)
  if (!apiKey) {
    throw new Error('MISSING_API_KEY')
  }

  const objectivesFormatted = (context.objectives || [])
    .map((o) => (typeof o === 'string' ? o : `${o.code ? `[${o.code}] ` : ''}${o.text || ''}`))
    .filter(Boolean)
    .join('\n- ')

  const prompt = `You are a veteran Cambridge International educator designing realistic, highly practical classroom lesson activities.

LESSON CONTEXT:
- Subject: ${context.subject || 'General'}
- Class / Grade / Stage: ${context.className || 'Secondary'}
- Lesson Topic: ${context.topic || 'Inquiry Lesson'}
${context.challenge ? `- Lesson Inquiry / Challenge Question: "${context.challenge}"` : ''}
${context.subtopic ? `- Subtopic / Key Focus: ${context.subtopic}` : ''}
${objectivesFormatted ? `- MANDATORY CURRICULUM OBJECTIVES TO TEACH & ASSESS:\n- ${objectivesFormatted}` : ''}
${context.successCriteria ? `- Success Criteria: ${context.successCriteria}` : ''}

MANDATORY INSTRUCTIONS:
- Every stage MUST strictly align with and teach the selected learning objectives above.
- Ensure all language, tasks, cognitive demand, and timing are perfectly calibrated for ${context.className || 'the specified grade level'}.

PEDAGOGICAL & STYLE REQUIREMENTS FOR EACH FIELD:
1. starter: Practical, high-energy warm-up. Concrete classroom hook (mini-whiteboard, physical prop or puzzling visual on board, think-pair-share). Fast-paced, low teacher talk, activates prerequisite knowledge.
2. exposition: Direct teacher exposition action instructions.
   - MANDATORY GRAMMATICAL FORM: Write in the IMPERATIVE MOOD starting immediately with action verbs: "Explain...", "Demonstrate...", "Model...", "Give solved examples of...".
   - EXACT TARGET PATTERN:
     "Explain network topologies (bus, ring, star) with board diagrams, demonstrate how packets flow through each layout, give solved examples comparing failure points, and check understanding with a quick hinge question."
   - STRICTLY FORBIDDEN (DO NOT WRITE):
     • NEVER write "Direct instruction covers..." or "Direct instruction introduces...".
     • NEVER write third-person summaries like "The teacher explains...", "The teacher breaks down...", or "A rapid hinge check uses...".
     • NEVER use quotation marks or dialogue.
3. learnersActivity: Differentiated hands-on classroom tasks. Realistic group work, stations, or tiered practice with explicit scaffolding: Support (scaffolded sentence frames/hints), Core (hands-on investigation/worksheet meeting Cambridge objective), and Extension (critical analysis/stretch challenge).
4. plenary: Sharp lesson synthesis & exit ticket. Concrete classroom check (mini-whiteboard showdown, 2-question exit ticket, or 3-2-1 summary) evaluating achievement against the lesson objective.
5. assessmentIdeas: At least 2 to 3 distinct, concrete classroom assessment methods (format with bullet points: • ...). Must directly evaluate student mastery of the selected learning objective (e.g. marked sheet, exit ticket, paired rubric).

Output must be in JSON format matching exactly this schema:
{
  "starter": "string (2 to 4 concise sentences)",
  "exposition": "string (MUST start with an imperative verb like 'Explain...'. E.g. 'Explain network topologies (bus, ring, star) with board diagrams, demonstrate how packets flow through each layout, give solved examples comparing failure points, and check understanding with a quick hinge question.' NO third-person 'The teacher explains' or 'Direct instruction covers'. NO quotation marks.)",
  "learnersActivity": "string (2 to 4 concise sentences with Support, Core, Extension differentiation)",
  "plenary": "string (2 to 4 concise sentences with concrete exit check)",
  "assessmentIdeas": "• Assessment idea 1...\\n• Assessment idea 2..."
}

Do NOT wrap with markdown other than \`\`\`json. Return only the valid JSON object.
`

  try {
    const rawJson = await callGeminiApi(prompt, apiKey, { maxTokens: 2048, jsonMode: true })
    let jsonStr = rawJson.trim()
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      jsonStr = jsonMatch[0]
    }
    const parsed = JSON.parse(jsonStr)
    return {
      starter: cleanGeneratedText(parsed.starter || ''),
      exposition: cleanExpositionText(parsed.exposition || ''),
      learnersActivity: cleanGeneratedText(parsed.learnersActivity || parsed.learners || ''),
      plenary: cleanGeneratedText(parsed.plenary || ''),
      assessmentIdeas: cleanGeneratedText(parsed.assessmentIdeas || parsed.assessment_ideas || '')
    }
  } catch (err: any) {
    if (err?.message?.includes('Authentication Error') || err?.message?.includes('INVALID_API_KEY')) {
      throw err
    }
    console.warn('AI generation failed or could not be parsed; falling back to offline template engine:', err)
    return generateOfflineStages(context)
  }
}

