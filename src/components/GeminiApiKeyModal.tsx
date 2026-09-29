import React, { useState, useEffect } from 'react'
import { getGeminiApiKey, setGeminiApiKey, clearGeminiApiKey } from '../lib/gemini'

interface GeminiApiKeyModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved?: (apiKey: string) => void
}

export const GeminiApiKeyModal: React.FC<GeminiApiKeyModalProps> = ({ isOpen, onClose, onSaved }) => {
  const [apiKey, setApiKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      const existing = getGeminiApiKey()
      setApiKeyInput(existing)
      setStatusMsg(null)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSave = () => {
    const trimmed = apiKey.trim()
    if (!trimmed) {
      clearGeminiApiKey()
      setStatusMsg('API key cleared.')
      onSaved?.('')
      setTimeout(() => onClose(), 600)
      return
    }

    setGeminiApiKey(trimmed)
    setStatusMsg('API key saved successfully!')
    onSaved?.(trimmed)
    setTimeout(() => onClose(), 600)
  }

  const handleClear = () => {
    clearGeminiApiKey()
    setApiKeyInput('')
    setStatusMsg('API key removed.')
    onSaved?.('')
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
          maxWidth: 500,
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
                Google Gemini API Key
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
            Provide your Google Gemini API key to automatically generate <strong>Starter</strong>, <strong>Exposition Methods</strong>, <strong>Learners Activity</strong>, and <strong>Plenary</strong> stages directly aligned with your Cambridge syllabus.
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
            </div>
          </div>

          {statusMsg && (
            <div
              style={{
                fontSize: 12,
                padding: '8px 12px',
                borderRadius: 6,
                backgroundColor: statusMsg.includes('success') ? '#dcfce7' : '#f1f5f9',
                color: statusMsg.includes('success') ? '#166534' : '#475569',
                marginBottom: 16,
                fontWeight: 600
              }}
            >
              {statusMsg}
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
              marginBottom: 20
            }}
          >
            <div style={{ fontWeight: 700, color: '#334155', marginBottom: 4 }}>
              💡 Don't have an API key yet?
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
              Key is stored locally in your browser. Alternatively, configure <code>VITE_GEMINI_API_KEY</code> in your <code>.env</code> file.
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {getGeminiApiKey() ? (
              <button
                type="button"
                className="btn btn-danger"
                style={{ fontSize: 12, padding: '6px 12px' }}
                onClick={handleClear}
              >
                Remove Key
              </button>
            ) : <div />}

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
