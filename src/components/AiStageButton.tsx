import React, { useState } from 'react'
import {
  InstructionalStage,
  LessonContext,
  generateStageContent,
  hasGeminiApiKey
} from '../lib/gemini'

interface AiStageButtonProps {
  stage: InstructionalStage
  onGenerated: (text: string) => void
  getContext: () => LessonContext
  onPromptApiKey?: () => void
  compact?: boolean
  onError?: (msg: string) => void
}

export const AiStageButton: React.FC<AiStageButtonProps> = ({
  stage,
  onGenerated,
  getContext,
  onPromptApiKey,
  compact = false,
  onError
}) => {
  const [loading, setLoading] = useState(false)

  const handleGenerate = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (!hasGeminiApiKey()) {
      onPromptApiKey?.()
      return
    }

    try {
      setLoading(true)
      const context = getContext()
      const generated = await generateStageContent(stage, context)
      onGenerated(generated)
    } catch (err: any) {
      if (
        err?.message === 'MISSING_API_KEY' ||
        err?.message?.includes('Authentication Error') ||
        err?.message?.includes('INVALID_API_KEY') ||
        err?.message?.includes('invalid authentication credentials')
      ) {
        onPromptApiKey?.()
      } else {
        const message = err?.message || 'Failed to generate stage activity with Gemini AI.'
        if (onError) {
          onError(message)
        } else {
          alert(`Gemini AI: ${message}`)
        }
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleGenerate}
      disabled={loading}
      title={loading ? 'Generating with Gemini AI...' : 'Generate with Gemini AI *'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: loading
          ? '#94a3b8'
          : 'linear-gradient(135deg, #7c3aed 0%, #4C2570 100%)',
        color: '#ffffff',
        border: '1px solid rgba(124, 58, 237, 0.4)',
        borderRadius: 6,
        padding: compact ? '2px 7px' : '3px 9px',
        fontSize: compact ? 10.5 : 11.5,
        fontWeight: 700,
        letterSpacing: '0.02em',
        cursor: loading ? 'not-allowed' : 'pointer',
        boxShadow: '0 1px 3px rgba(76, 37, 112, 0.25)',
        transition: 'all 0.15s ease-in-out',
        whiteSpace: 'nowrap'
      }}
      onMouseEnter={(e) => {
        if (!loading) {
          e.currentTarget.style.filter = 'brightness(1.15)'
          e.currentTarget.style.transform = 'translateY(-1px)'
        }
      }}
      onMouseLeave={(e) => {
        if (!loading) {
          e.currentTarget.style.filter = 'none'
          e.currentTarget.style.transform = 'translateY(0)'
        }
      }}
    >
      {loading ? (
        <>
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              border: '2px solid rgba(255, 255, 255, 0.3)',
              borderTopColor: '#ffffff',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite'
            }}
          />
          <span>Generating...</span>
        </>
      ) : (
        <>
          <span style={{ fontSize: compact ? 11 : 12, lineHeight: 1 }}>✨</span>
          <span>AI *</span>
        </>
      )}
    </button>
  )
}
