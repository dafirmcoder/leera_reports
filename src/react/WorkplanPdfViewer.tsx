import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { ParsedWorkplan } from '../lib/workplan'
import type { WorkPlan } from '../lib/types'
import {
  workplanPdfUrl,
  downloadWorkplanPdf,
  workPlanToParsedWorkplan,
  type RenderWorkplanOptions
} from '../lib/render'

export interface WorkplanPdfViewerProps {
  /** A parsed workplan, or an array of parsed workplans */
  doc?: ParsedWorkplan | ParsedWorkplan[] | null
  /** Or a Leera-Reports WorkPlan database object */
  plan?: WorkPlan | null
  /** Or an already-generated blob URL */
  url?: string | null
  title?: string
  schoolName?: string
  pdfOptions?: RenderWorkplanOptions
  showToolbar?: boolean
  height?: string | number
  className?: string
  style?: CSSProperties
  onClose?: () => void
  actions?: ReactNode
}

export function WorkplanPdfViewer({
  doc,
  plan,
  url: directUrl,
  title,
  schoolName,
  pdfOptions,
  showToolbar = true,
  height = '680px',
  className,
  style,
  onClose,
  actions
}: WorkplanPdfViewerProps) {
  const [createdUrl, setCreatedUrl] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  // Generate URL from doc or plan if not provided directly
  useEffect(() => {
    if (directUrl) {
      setCreatedUrl(null)
      return
    }

    let parsedDoc: ParsedWorkplan | ParsedWorkplan[] | null = null

    if (doc) {
      parsedDoc = doc
    } else if (plan) {
      parsedDoc = workPlanToParsedWorkplan(plan, schoolName ? { name: schoolName } : undefined)
    }

    if (parsedDoc) {
      const opts: RenderWorkplanOptions = {
        footer: true,
        ...(schoolName ? { schoolName } : {}),
        ...pdfOptions
      }
      const newUrl = workplanPdfUrl(parsedDoc, opts)
      setCreatedUrl(newUrl)

      return () => {
        URL.revokeObjectURL(newUrl)
      }
    } else {
      setCreatedUrl(null)
    }
  }, [doc, plan, directUrl, schoolName, pdfOptions])

  const activeUrl = directUrl || createdUrl

  const displayTitle = useMemo(() => {
    if (title) return title
    if (plan) return `Work Plan — ${plan.subject_name || 'Subject'} (${plan.class_name || 'Class'})`
    if (doc) {
      if (Array.isArray(doc)) {
        return doc.length === 1 ? (doc[0].fileName || 'Work Plan') : `${doc.length} Work Plans`
      }
      return doc.fileName || `${doc.subject || 'Subject'} ${doc.levelLabel || ''} Work Plan`
    }
    return 'Work Plan PDF'
  }, [title, plan, doc])

  const handleDownload = () => {
    if (doc) {
      downloadWorkplanPdf(doc, pdfOptions)
    } else if (plan) {
      const pDoc = workPlanToParsedWorkplan(plan, schoolName ? { name: schoolName } : undefined)
      downloadWorkplanPdf(pDoc, pdfOptions)
    } else if (activeUrl) {
      const a = document.createElement('a')
      a.href = activeUrl
      a.download = `${displayTitle.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`
      a.click()
    }
  }

  const handlePrint = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.focus()
      iframeRef.current.contentWindow.print()
    }
  }

  const handleOpenNewTab = () => {
    if (activeUrl) {
      window.open(activeUrl, '_blank')
    }
  }

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: '#ffffff',
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
        border: '1px solid #e2e8f0',
        height: '100%',
        ...style
      }}
    >
      {showToolbar && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 20px',
            background: '#ffffff',
            borderBottom: '1px solid #e2e8f0',
            gap: 12,
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: '#eff6ff',
                color: '#2563eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                flexShrink: 0
              }}
            >
              📄
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 15,
                  color: '#0f172a',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {displayTitle}
              </div>
              <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 1 }}>
                Cambridge International Standard • Official Format
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {actions}

            <button
              type="button"
              className="btn btn-primary btn-small"
              onClick={handleDownload}
              title="Download PDF"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <span>⬇</span> Download PDF
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={handlePrint}
              title="Print PDF"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <span>🖨</span> Print
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={handleOpenNewTab}
              title="Open PDF in new window"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <span>↗</span> Popout
            </button>

            {onClose && (
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={onClose}
                style={{
                  color: '#64748b',
                  fontSize: 18,
                  padding: '4px 8px',
                  borderRadius: 6,
                  marginLeft: 4
                }}
                title="Close Modal"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, position: 'relative', background: '#f8fafc' }}>
        {activeUrl ? (
          <iframe
            ref={iframeRef}
            src={activeUrl}
            title={displayTitle}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              display: 'block'
            }}
          />
        ) : (
          <div
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#64748b',
              fontSize: 14,
              gap: 12
            }}
          >
            <div className="leera-loader-spinner" style={{ width: 32, height: 32 }} />
            <div>Generating PDF document preview...</div>
          </div>
        )}
      </div>
    </div>
  )
}
