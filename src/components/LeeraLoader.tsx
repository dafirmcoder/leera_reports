import React from 'react'

interface LeeraLoaderProps {
  message?: string
  subMessage?: string
  variant?: 'card' | 'fullscreen' | 'inline'
  size?: 'small' | 'medium' | 'large'
}

export default function LeeraLoader({
  message = 'Loading Leera Reports…',
  subMessage = 'Learn • Evolve • Rise',
  variant = 'card',
  size = 'medium'
}: LeeraLoaderProps) {
  const logoDimensions = size === 'small' ? 56 : size === 'large' ? 100 : 76

  const content = (
    <div className={`leera-loader-content leera-loader-${size}`}>
      {/* Animated Glowing Ring & Logo Container */}
      <div className="leera-loader-logo-wrap" style={{ width: logoDimensions + 24, height: logoDimensions + 24 }}>
        <div className="leera-loader-glow-ring" />
        <div className="leera-loader-glow-ring-2" />
        <div className="leera-loader-logo-card">
          <img
            src="/icons/icon-192.png"
            alt="Leera School Logo"
            className="leera-loader-logo-img"
            width={logoDimensions}
            height={logoDimensions}
          />
        </div>
      </div>

      {/* Message & Animated Progress */}
      <div className="leera-loader-text-group">
        <h4 className="leera-loader-message">
          {message}
          <span className="leera-loader-dots">
            <span>.</span><span>.</span><span>.</span>
          </span>
        </h4>
        {subMessage && (
          <p className="leera-loader-submessage">{subMessage}</p>
        )}
      </div>

      {/* Shimmering Line */}
      <div className="leera-loader-shimmer-track">
        <div className="leera-loader-shimmer-bar" />
      </div>
    </div>
  )

  if (variant === 'fullscreen') {
    return (
      <div className="leera-loader-fullscreen">
        {content}
      </div>
    )
  }

  if (variant === 'inline') {
    return (
      <div className="leera-loader-inline">
        {content}
      </div>
    )
  }

  return (
    <div className="card leera-loader-card">
      {content}
    </div>
  )
}
