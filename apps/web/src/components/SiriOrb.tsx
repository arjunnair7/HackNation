import type { AgentPresence } from '@apprentice/shared'
import './siri-orb.css'

interface Props {
  state: AgentPresence['state'] | 'idle'
  level?: number // 0..1
  size?: number // px
  label?: string
}

/** The apprentice's presence: coloured light that breathes while listening and swells with the voice. */
export function SiriOrb({ state, level = 0, size = 64, label }: Props) {
  const style = { '--size': `${size}px`, '--level': Math.max(0, Math.min(1, level)).toFixed(3) } as React.CSSProperties
  return (
    <div className={`orb-wrap orb-${state}`} style={style} aria-label={label ?? `Apprentice ${state}`} role="img">
      <div className="orb">
        <div className="orb-pulse">
          <span className="orb-blob orb-blob-1" />
          <span className="orb-blob orb-blob-2" />
          <span className="orb-blob orb-blob-3" />
          <span className="orb-blob orb-blob-4" />
          <span className="orb-core" />
        </div>
      </div>
    </div>
  )
}
