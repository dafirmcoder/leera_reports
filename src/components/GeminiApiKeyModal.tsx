import React, { useState, useEffect } from 'react'
import {
  getGeminiApiKey,
  setGeminiApiKey,
  clearGeminiApiKey,
  testGeminiApiKey,
  isKnownInvalidKey,
  ensureGeminiApiKey
} from '../lib/gemini'

interface GeminiApiKeyModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved?: (apiKey: string) => void
  onUseTemplates?: () => void
}

const SUPABASE_APP_SETTINGS_SQL = `-- Run this in your Supabase Dashboard -> SQL Editor:
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_settings' AND policyname = 'Allow read app_settings'
  ) THEN
    CREATE POLICY "Allow read app_settings" ON public.app_settings FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_settings' AND policyname = 'Allow insert app_settings'
  ) THEN
    CREATE POLICY "Allow insert app_settings" ON public.app_settings FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_settings' AND policyname = 'Allow update app_settings'
  ) THEN
    CREATE POLICY "Allow update app_settings" ON public.app_settings FOR UPDATE USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_settings' AND policyname = 'Allow delete app_settings'
  ) THEN
    CREATE POLICY "Allow delete app_settings" ON public.app_settings FOR DELETE USING (true);
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;`

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
  const [saving, setSaving] = useState(false)
  const [dbMissing, setDbMissing] = useState(false)
  const [copiedSql, setCopiedSql] = useState(false)

  useEffect(() => {
    if (isOpen) {
      const existing = getGeminiApiKey()
      if (existing) {
        setApiKeyInput(existing)
      } else {
        ensureGeminiApiKey().then((k) => {
          if (k) setApiKeyInput(k)
        }).catch(() => {})
      }
      setStatusMsg(null)
      setTesting(false)
      setSaving(false)
      setDbMissing(false)
      setCopiedSql(false)
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
        text: 'Please enter a valid Gemini API key.',
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

  const handleSave = async () => {
    const trimmed = apiKey.trim()
    if (!trimmed) {
      clearGeminiApiKey()
      try {
        const { api } = await import('../lib/api')
        await api.saveGeminiApiKey('')
      } catch {}
      setStatusMsg({ text: 'API key cleared.', isSuccess: true })
      onSaved?.('')
      setTimeout(() => onClose(), 600)
      return
    }

    if (isKnownInvalidKey(trimmed)) {
      setStatusMsg({
        text: 'Warning: Please enter a valid Gemini API key.',
        isError: true
      })
      return
    }

    setSaving(true)
    setStatusMsg({ text: 'Saving Gemini API key to database...' })

    try {
      setGeminiApiKey(trimmed)
      const { api } = await import('../lib/api')
      const res = await api.saveGeminiApiKey(trimmed)

      if (res.inDb) {
        setDbMissing(false)
        setStatusMsg({
          text: 'API key saved to database successfully! All teachers and users can now use Gemini AI without being prompted for a key.',
          isSuccess: true
        })
        onSaved?.(trimmed)
        setTimeout(() => onClose(), 1200)
      } else {
        setDbMissing(true)
        setStatusMsg({
          text: 'Key saved for this browser, but database saving failed because table "app_settings" does not exist in Supabase yet. Run the SQL below in Supabase once to share it with ALL users.',
          isError: true
        })
        onSaved?.(trimmed)
      }
    } catch (err: any) {
      setStatusMsg({
        text: err?.message || 'Error saving API key to database.',
        isError: true
      })
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    clearGeminiApiKey()
    try {
      const { api } = await import('../lib/api')
      await api.saveGeminiApiKey('')
    } catch {}
    setApiKeyInput('')
    setStatusMsg({ text: 'API key removed.', isSuccess: true })
    setDbMissing(false)
    onSaved?.('')
  }

  const copySqlToClipboard = () => {
    try {
      navigator.clipboard.writeText(SUPABASE_APP_SETTINGS_SQL)
      setCopiedSql(true)
      setTimeout(() => setCopiedSql(false), 2500)
    } catch {
      alert('Unable to copy automatically. Please select the SQL text and copy manually.')
    }
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
          maxWidth: 540,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
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
                placeholder="AIzaSy... or AQ.Ab..."
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

          {/* Database Setup Helper if app_settings is not in Supabase */}
          {dbMissing && (
            <div
              style={{
                background: '#fffbeb',
                border: '1.5px solid #fde68a',
                borderRadius: 8,
                padding: '14px 16px',
                marginBottom: 16,
                fontSize: 12,
                color: '#92400e'
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, color: '#b45309', fontSize: 12.5 }}>
                <span>⚡ 1-Step Setup to Share This Key with ALL Users</span>
              </div>
              <p style={{ margin: '0 0 8px', lineHeight: 1.4, color: '#78350f' }}>
                Copy and run this query once in your <strong>Supabase Dashboard &rarr; SQL Editor</strong>. After running it, all teachers on all devices will share this Gemini key automatically:
              </p>
              <pre
                style={{
                  background: '#0f172a',
                  color: '#e2e8f0',
                  padding: '10px 12px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontFamily: 'monospace',
                  overflowX: 'auto',
                  maxHeight: '120px',
                  margin: '0 0 10px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all'
                }}
              >
                {SUPABASE_APP_SETTINGS_SQL}
              </pre>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    background: '#ffffff',
                    color: '#b45309',
                    borderColor: '#fcd34d'
                  }}
                  onClick={copySqlToClipboard}
                >
                  {copiedSql ? '✓ Copied SQL to Clipboard!' : '📋 Copy SQL to Clipboard'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    background: '#b45309',
                    borderColor: '#92400e'
                  }}
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Checking...' : '🔄 Verify & Save to Database'}
                </button>
              </div>
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
            <div style={{ marginTop: 6, color: '#475569' }}>
              🔑 When saved, this key is stored in your school database so <strong>all teachers and coordinators</strong> can automatically use Gemini AI without having to configure keys on their own devices.
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
                disabled={saving || !apiKey.trim()}
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  background: 'linear-gradient(135deg, #4C2570 0%, #7c3aed 100%)',
                  borderColor: '#4C2570'
                }}
              >
                {saving ? 'Saving...' : 'Save Key'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
