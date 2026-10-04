import { useEffect } from 'react'
import { SiriOrb } from '../components/SiriOrb.tsx'
import { openErpWindow, useErpWindow } from './lib/erpLayout.ts'
import './apprentice.css'

/** /apprentice: what this is, and the two ways in. */
export function IntroPage() {
  const erpOpen = useErpWindow()
  useEffect(() => {
    document.title = 'Apprentice'
  }, [])

  return (
    <div className="appr intro">
      <header className="intro-hero">
        <SiriOrb state="idle" size={168} label="Apprentice" />
        <h1>Apprentice</h1>
        <p className="intro-tagline">
          It watches your best people work, asks why at the moments that matter, and then coaches the next person through
          the same job.
        </p>
      </header>

      <div className="intro-choices">
        <a className="intro-choice" href="/apprentice?mode=capture">
          <span className="intro-kicker">Expert · Sabine</span>
          <strong>Teach the apprentice</strong>
          <span>Work through your invoices as usual. The apprentice watches the screen, asks short questions, and turns it into a Work Map.</span>
          <span className="intro-go">Start capturing →</span>
        </a>
        <a className="intro-choice intro-choice-teach" href="/apprentice?mode=teach">
          <span className="intro-kicker">New hire · Lena</span>
          <strong>Train a new hire</strong>
          <span>The apprentice coaches Lena live from Sabine's Work Map and steps in before a mistake is saved.</span>
          <span className="intro-go">Start training →</span>
        </a>
      </div>

      <section className="intro-how" aria-label="How it works">
        <div>
          <span className="intro-step">1</span>
          <strong>Capture</strong>
          <span>Shadow an expert: screen plus voice, with off-the-record whenever they want it.</span>
        </div>
        <div>
          <span className="intro-step">2</span>
          <strong>Map</strong>
          <span>Steps, rules and guardrails, each backed by a quote and a screen moment.</span>
        </div>
        <div>
          <span className="intro-step">3</span>
          <strong>Teach</strong>
          <span>Coach a new hire on real invoices and track what they have mastered.</span>
        </div>
      </section>

      <section className="appr-card intro-check">
        <h2>Before you start</h2>
        <ul>
          <li>
            <strong>Headphones on.</strong> The apprentice talks; headphones keep it from hearing itself.
          </li>
          <li>
            <strong>The ERP in its own window.</strong> That window is what you share; this one stays private.{' '}
            {erpOpen ? (
              <span className="intro-ok">ERP window detected ✓</span>
            ) : (
              <button type="button" className="appr-btn" onClick={() => openErpWindow('expert')}>
                Open ERP window
              </button>
            )}
          </li>
          <li>
            <strong>Share the ERP window when asked</strong>, not this tab. The apprentice's orb on the ERP is blanked out of
            what it sees.
          </li>
        </ul>
      </section>
    </div>
  )
}
