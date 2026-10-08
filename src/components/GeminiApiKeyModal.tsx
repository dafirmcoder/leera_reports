import React, { useState, useEffect } from 'react'
import { getGeminiApiKey, setGeminiApiKey, clearGeminiApiKey, testGeminiApiKey, isKnownInvalidKey } from '../lib/gemini'

interface GeminiApiKeyModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved?: (apiKey: string) => void
  onUseTemplates?: () => void
}

export const GeminiApiKeyModal: React.FC<GeminiApiKeyModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  onUseTemplates
}) => {
  const [apiKey, setApiKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{ text: string; isError?: boolean; isSuccess?: boolean } | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (isOpen) {
      const existing = getGeminiApiKey()
      setApiKeyInput(existing)
      setStatusMsg(null)
      setTesting(false)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleTestConnection = async () => {
    const trimmed = apiKey.trim()
    if (!trimmed) {
      setStatusMsg({ text: 'Please enter a Gemini API key first.', isError: true })
      return
    }

    if (isKnownInvalidKey(trimmed)) {
      setStatusMsg({
        text: 'The key format is invalid. Google Gemini API keys from Google AI Studio begin with "AIzaSy" and are ~39 characters long.',
        isError: true
      })
      return
    }

    setTesting(true)
    setStatusMsg({ text: 'Testing connection to Google Gemini API...' })
    try {
      const res = await testGeminiApiKey(trimmed)
      if (res.success) {
        setStatusMsg({ text: res.message, isSuccess: true })
      } else {
        setStatusMsg({ text: res.message, isError: true })
      }
    } catch (err: any) {
      setStatusMsg({ text: err?.message || 'Connection test failed.', isError: true })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = () => {
    const trimmed = apiKey.trim()
    if (!trimmed) {
      clearGeminiApiKey()
      setStatusMsg({ text: 'API key cleared.', isSuccess: true })
      onSaved?.('')
      setTimeout(() => onClose(), 600)
      return
    }

    if (isKnownInvalidKey(trimmed)) {
      setStatusMsg({
        text: 'Warning: This does not look like a valid Gemini API key. Gemini API keys begin with "AIzaSy".',
        isError: true
      })
      return
    }

    setGeminiApiKey(trimmed)
    setStatusMsg({ text: 'API key saved successfully!', isSuccess: true })
    onSaved?.(trimmed)
    setTimeout(() => onClose(), 600)
  }

  const handleClear = () => {
    clearGeminiApiKey()
    setApiKeyInput('')
    setStatusMsg({ text: 'API key removed.', isSuccess: true })
    onSaved?.('')
  }

  const handleTriggerTemplates = () => {
    onClose()
    onUseTemplates?.()
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: 16
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 12,
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
          maxWidth: 520,
          width: '100%',
          overflow: 'hidden',
          border: '1px solid #e2e8f0'
        }}
      >
        {/* Header */}
        <div
          style={{
            background: 'linear-gradient(135deg, #4C2570 0%, #6b21a8 100%)',
            padding: '16px 20px',
            color: '#ffffff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>✨</span>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#ffffff' }}>
                Google Gemini AI Configuration
              </h3>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.85 }}>
                Powering AI generation for Lesson Plan activities
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#ffffff',
              fontSize: 20,
              cursor: 'pointer',
              lineHeight: 1,
              padding: 4
            }}
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 20 }}>
          <p style={{ fontSize: 13, color: '#475569', marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>
            Provide your Google Gemini API key to automatically generate <strong>Starter</strong>, <strong>Exposition Methods</strong>, <strong>Learners Activity</strong>, <strong>Plenary</strong>, and <strong>Assessment Ideas</strong> directly aligned with your Cambridge syllabus.
          </p>

          <div style={{ marginBottom: 16 }}>
            <label
              className="field-label"
              style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 6, display: 'block' }}
            >
              Gemini API Key
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type={showKey ? 'text' : 'password'}
                className="field"
                style={{
                  flex: 1,
                  fontFamily: 'monospace',
                  fontSize: 13,
                  padding: '8px 12px',
                  border: '1.5px solid #cbd5e1',
                  borderRadius: 6
                }}
                placeholder="AIzaSy..."
                value={apiKey}
                onChange={(e) => setApiKeyInput(e.target.value)}
                autoFocus
              />
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '7px 12px', fontSize: 12 }}
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '7px 12px', fontSize: 12, fontWeight: 600, color: '#4C2570' }}
                disabled={testing || !apiKey.trim()}
                onClick={handleTestConnection}
              >
                {testing ? 'Testing...' : 'Test'}
              </button>
            </div>
          </div>

          {statusMsg && (
            <div
              style={{
                fontSize: 12,
                padding: '10px 12px',
                borderRadius: 6,
                backgroundColor: statusMsg.isSuccess ? '#dcfce7' : statusMsg.isError ? '#fee2e2' : '#f1f5f9',
                color: statusMsg.isSuccess ? '#166534' : statusMsg.isError ? '#991b1b' : '#334155',
                border: `1px solid ${statusMsg.isSuccess ? '#bbf7d0' : statusMsg.isError ? '#fecaca' : '#e2e8f0'}`,
                marginBottom: 16,
                fontWeight: 600,
                lineHeight: 1.4
              }}
            >
              {statusMsg.isSuccess ? '✓ ' : statusMsg.isError ? '⚠️ ' : 'ℹ️ '}
              {statusMsg.text}
            </div>
          )}

          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: 12,
              fontSize: 11.5,
              color: '#64748b',
              lineHeight: 1.5,
              marginBottom: 18
            }}
          >
            <div style={{ fontWeight: 700, color: '#334155', marginBottom: 4 }}>
              💡 Don't have a Gemini API key yet?
            </div>
            You can generate a free Gemini API key in seconds from Google AI Studio:{' '}
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#6b21a8', fontWeight: 700, textDecoration: 'underline' }}
            >
              Get Free Key from Google AI Studio &rarr;
            </a>
            <div style={{ marginTop: 6 }}>
              Keys start with <code>AIzaSy...</code> and are stored securely in your browser's local storage.
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {getGeminiApiKey() ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  style={{ fontSize: 12, padding: '6px 12px' }}
                  onClick={handleClear}
                >
                  Remove Key
                </button>
              ) : null}

              {onUseTemplates && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: '6px 12px', background: '#f8fafc', borderColor: '#cbd5e1', color: '#0f766e', fontWeight: 600 }}
                  onClick={handleTriggerTemplates}
                  title="Generate structured Cambridge lesson plan activities immediately without calling external AI"
                >
                  ⚡ Use Cambridge Templates
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onClose}
                style={{ fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSave}
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  background: 'linear-gradient(135deg, #4C2570 0%, #7c3aed 100%)',
                  borderColor: '#4C2570'
                }}
              >
                Save Key
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

