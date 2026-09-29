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

export type InstructionalStage = 'starter' | 'exposition' | 'learnersActivity' | 'plenary'

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
    label: '1. Starter (10 min)',
    fullName: 'Starter Activities',
    duration: '10 min',
    subtitle: 'Inquiry Hook / Warm-up',
    badgeColor: '#15803d',
    badgeBg: '#dcfce7',
    textColor: '#15803d',
    description: 'Inquiry hook, diagnostic warm-up, activating prior knowledge, engaging problem or demo.',
    placeholder: 'e.g. Torch ON/OFF demo — “Computers only see two states; how do they show numbers, pictures and words?”; introduce the lesson inquiry question.'
  },
  exposition: {
    key: 'exposition',
    label: '2. Exposition (15 min)',
    fullName: 'Exposition Methods',
    duration: '15 min',
    subtitle: 'Direct Instruction / Teacher Modeling',
    badgeColor: '#0369a1',
    badgeBg: '#e0f2fe',
    textColor: '#0369a1',
    description: 'Direct instruction, concept explanation, key vocabulary, worked examples, teacher modeling.',
    placeholder: 'e.g. How computers represent data in binary (0,1) — patterns of switches; data measurement — bits, bytes, kilobytes and megabytes, making links to memory size and storage; version control...'
  },
  learnersActivity: {
    key: 'learnersActivity',
    label: '3. Learners Activity (35 min)',
    fullName: 'Learners Activity',
    duration: '35 min',
    subtitle: 'Guided Tasks / Hands-on Practice',
    badgeColor: '#6b21a8',
    badgeBg: '#f3e8ff',
    textColor: '#6b21a8',
    description: 'Differentiated student tasks (support/core/extension), collaborative stations, practical application.',
    placeholder: 'e.g. Three stations — (a) binary counting cards: hold up 0/1 cards to build given numbers and write binary patterns; (b) data-size ladder: order bit, byte, kilobyte, megabyte; (c) version control: edit a shared document...'
  },
  plenary: {
    key: 'plenary',
    label: '4. Plenary (10 min)',
    fullName: 'Plenary',
    duration: '10 min',
    subtitle: 'Exit Ticket / Lesson Synthesis',
    badgeColor: '#b45309',
    badgeBg: '#fef3c7',
    textColor: '#b45309',
    description: 'Exit ticket, learning review, student self-reflection, preview next session.',
    placeholder: 'e.g. Exit ticket — read one binary pattern, answer one data-size question, and state one benefit of version control; preview Friday’s new unit on networks.'
  }
}

/**
 * Retrieves the Gemini API key from environment variables or localStorage.
 */
export function getGeminiApiKey(): string {
  const envKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || ''
  if (typeof envKey === 'string' && envKey.trim()) {
    return envKey.trim()
  }

  try {
    const local = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(FALLBACK_STORAGE_KEY)
    if (local && local.trim()) {
      return local.trim()
    }
  } catch {
    // Ignore localStorage access restrictions
  }

  return ''
}

/**
 * Saves the Gemini API key to localStorage.
 */
export function setGeminiApiKey(key: string): void {
  try {
    const cleaned = key.trim()
    if (cleaned) {
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
 * Checks if a Gemini API key is available.
 */
export function hasGeminiApiKey(): boolean {
  return Boolean(getGeminiApiKey())
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
  }
}

const CANDIDATE_MODELS = [
  'gemini-flash-lite-latest',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3.8-flash'
]

/**
 * Calls Gemini REST API using preferred models with fallback.
 */
async function callGeminiApi(prompt: string, apiKey: string): Promise<string> {
  let lastError: Error | null = null

  for (const model of CANDIDATE_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 25000)

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
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 600
          }
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
          throw new Error(`Gemini API Error: ${errMsg}`)
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
        lastError = new Error('Gemini API request timed out (25 seconds).')
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

  // Remove repeated stage prefixes like "Starter (10 min):", "Starter:", "Exposition Methods:", etc.
  text = text.replace(/^(?:(?:\d+\.\s*)?(?:Starter(?:\s*Activity)?|Exposition(?:\s*Methods)?|Learners?\s*Activity|Plenary)(?:\s*\([^)]*\))?[:—\-]\s*)/i, '')

  // Remove surrounding quotes if entire string is quoted
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim()
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

  return `You are a master teacher and curriculum specialist for Cambridge International School education.
Your task is to write the pedagogical content for ONE instructional stage of a lesson plan:

STAGE TO GENERATE:
Stage: ${stageDef.fullName} (${stageDef.duration})
Stage Type: ${stageDef.subtitle}
Pedagogical Role: ${stageDef.description}

LESSON CONTEXT:
- Subject: ${context.subject || 'General'}
- Class / Grade: ${context.className || 'Secondary'}
- Lesson Topic: ${context.topic || 'Inquiry Lesson'}
${context.challenge ? `- Lesson Inquiry / Challenge Question: "${context.challenge}"` : ''}
${context.subtopic ? `- Subtopic / Key Focus: ${context.subtopic}` : ''}
${objectivesFormatted ? `- Curriculum Learning Objectives:\n- ${objectivesFormatted}` : ''}
${context.successCriteria ? `- Success Criteria: ${context.successCriteria}` : ''}

${context.existingStages ? `EXISTING STAGES IN THIS LESSON PLAN (Ensure alignment and smooth lesson flow):
${context.existingStages.starter ? `Starter: ${context.existingStages.starter}` : ''}
${context.existingStages.exposition ? `Exposition: ${context.existingStages.exposition}` : ''}
${context.existingStages.learnersActivity ? `Learners Activity: ${context.existingStages.learnersActivity}` : ''}
${context.existingStages.plenary ? `Plenary: ${context.existingStages.plenary}` : ''}
` : ''}

REQUIREMENTS:
1. Provide a direct, highly practical, engaging activity description tailored for a 50-60 minute lesson.
2. Tone: Professional Cambridge teacher lesson plan (active verbs, clear inquiry prompts, concrete student actions).
3. Format: Return ONLY the activity description (2 to 4 concise sentences or clear bullet points with practical steps).
4. DO NOT repeat the stage title (e.g. do NOT start with "${stageDef.label}:" or "Here is..."). Output ONLY the activity content.
`
}

/**
 * Generates content for a single instructional stage using Gemini AI.
 */
export async function generateStageContent(
  stage: InstructionalStage,
  context: LessonContext,
  customApiKey?: string
): Promise<string> {
  const apiKey = customApiKey || getGeminiApiKey()
  if (!apiKey) {
    throw new Error('MISSING_API_KEY')
  }

  const prompt = buildStagePrompt(stage, context)
  return await callGeminiApi(prompt, apiKey)
}

/**
 * Generates all 4 instructional stages at once.
 */
export async function generateAllStages(
  context: LessonContext,
  customApiKey?: string
): Promise<Record<InstructionalStage, string>> {
  const apiKey = customApiKey || getGeminiApiKey()
  if (!apiKey) {
    throw new Error('MISSING_API_KEY')
  }

  const objectivesFormatted = (context.objectives || [])
    .map((o) => (typeof o === 'string' ? o : `${o.code ? `[${o.code}] ` : ''}${o.text || ''}`))
    .filter(Boolean)
    .join('\n- ')

  const prompt = `You are a master teacher and curriculum specialist for Cambridge International School education.
Generate all 4 core instructional stages for the following Cambridge lesson plan:

LESSON CONTEXT:
- Subject: ${context.subject || 'General'}
- Class / Grade: ${context.className || 'Secondary'}
- Lesson Topic: ${context.topic || 'Inquiry Lesson'}
${context.challenge ? `- Lesson Inquiry / Challenge Question: "${context.challenge}"` : ''}
${context.subtopic ? `- Subtopic / Key Focus: ${context.subtopic}` : ''}
${objectivesFormatted ? `- Curriculum Learning Objectives:\n- ${objectivesFormatted}` : ''}
${context.successCriteria ? `- Success Criteria: ${context.successCriteria}` : ''}

Output must be in JSON format matching exactly this schema:
{
  "starter": "Inquiry hook / warm-up (10 min) - engaging demo, prior knowledge recap, or starter question.",
  "exposition": "Direct instruction / teacher modeling (15 min) - concept explanation, key vocabulary, worked examples.",
  "learnersActivity": "Differentiated guided practice (35 min) - hands-on tasks, stations, or collaborative inquiry.",
  "plenary": "Exit ticket / synthesis (10 min) - reflection against objectives, formative check, next session preview."
}

Do NOT wrap with markdown other than \`\`\`json. Return only the valid JSON object. Each value should be 2 to 4 concise sentences.
`

  const rawJson = await callGeminiApi(prompt, apiKey)
  try {
    let jsonStr = rawJson.trim()
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      jsonStr = jsonMatch[0]
    }
    const parsed = JSON.parse(jsonStr)
    return {
      starter: cleanGeneratedText(parsed.starter || ''),
      exposition: cleanGeneratedText(parsed.exposition || ''),
      learnersActivity: cleanGeneratedText(parsed.learnersActivity || parsed.learners || ''),
      plenary: cleanGeneratedText(parsed.plenary || '')
    }
  } catch {
    // If JSON parsing fails, generate each stage individually
    const [starter, exposition, learnersActivity, plenary] = await Promise.all([
      generateStageContent('starter', context, apiKey),
      generateStageContent('exposition', context, apiKey),
      generateStageContent('learnersActivity', context, apiKey),
      generateStageContent('plenary', context, apiKey)
    ])
    return { starter, exposition, learnersActivity, plenary }
  }
}
