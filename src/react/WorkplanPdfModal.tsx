import { useEffect } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { ParsedWorkplan } from '../lib/workplan'
import type { WorkPlan } from '../lib/types'
import { WorkplanPdfViewer } from './WorkplanPdfViewer'
import type { RenderWorkplanOptions } from '../lib/render'

export interface WorkplanPdfModalProps {
  isOpen: boolean
  onClose: () => void
  doc?: ParsedWorkplan | ParsedWorkplan[] | null
  plan?: WorkPlan | null
  url?: string | null
  title?: string
  schoolName?: string
  pdfOptions?: RenderWorkplanOptions
  actions?: ReactNode
}

export function WorkplanPdfModal({
  isOpen,
  onClose,
  doc,
  plan,
  url,
  title,
  schoolName,
  pdfOptions,
  actions
}: WorkplanPdfModalProps) {
  // ESC key listener
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 120,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '1150px',
          height: '92vh',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <WorkplanPdfViewer
          doc={doc}
          plan={plan}
          url={url}
          title={title}
          schoolName={schoolName}
          pdfOptions={pdfOptions}
          height="100%"
          style={{ flex: 1, minHeight: 0 }}
          onClose={onClose}
          actions={actions}
        />
      </div>
    </div>
  )
}
