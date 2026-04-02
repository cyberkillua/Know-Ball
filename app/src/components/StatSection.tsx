import type { ReactNode } from 'react'

type BadgeColor = 'green' | 'blue' | 'purple' | 'amber' | 'red' | 'coral'

interface StatSectionProps {
  title: string
  badgeValue?: number
  badgeColor?: BadgeColor
  headerRight?: ReactNode
  children: ReactNode
}

const BADGE_STYLES: Record<BadgeColor, { bg: string; text: string; darkBg: string; darkText: string }> = {
  green:  { bg: '#d4f0e2', text: '#0f6e56', darkBg: '#085041', darkText: '#9fe1cb' },
  blue:   { bg: '#e6f1fb', text: '#185fa5', darkBg: '#0c447c', darkText: '#b5d4f4' },
  purple: { bg: '#eeedfe', text: '#534ab7', darkBg: '#3c3489', darkText: '#cecbf6' },
  amber:  { bg: '#faeeda', text: '#854f0b', darkBg: '#633806', darkText: '#fac775' },
  red:    { bg: '#fcebeb', text: '#a32d2d', darkBg: '#791f1f', darkText: '#f7c1c1' },
  coral:  { bg: '#faece7', text: '#993c1d', darkBg: '#712b13', darkText: '#f5c4b3' },
}

export default function StatSection({
  title,
  badgeValue,
  badgeColor,
  headerRight,
  children,
}: StatSectionProps) {
  const badge = badgeColor && badgeValue !== undefined ? BADGE_STYLES[badgeColor] : null

  return (
    <div
      style={{
        background: 'var(--card)',
        border: '0.5px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '1.25rem',
        marginBottom: '1rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--foreground)' }}>{title}</span>
        {headerRight}
        {badge && badgeValue !== undefined && !headerRight && (
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              padding: '3px 10px',
              borderRadius: 'var(--radius-md)',
              background: badge.bg,
              color: badge.text,
            }}
          >
            {badgeValue}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}
