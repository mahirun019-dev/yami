import { Check } from 'lucide-react';
import { planCopy } from './i18n';
import './plans.css';

export function PlanSettings({ locale, mobile = false }: { locale: string; mobile?: boolean }) {
  const copy = planCopy[locale === 'ja' ? 'ja' : 'zh'];
  return <section className={`settings-section settings-plan-page${mobile ? ' mobile-settings-subpage' : ''}`} aria-label={copy.title}>
    {mobile && <h2>{copy.title}</h2>}
    <div className="plan-intro"><p>{copy.experiment}</p></div>
    <div className="plan-grid">
      <article className="plan-option" aria-labelledby={`plan-free-${mobile ? 'mobile' : 'desktop'}`}>
        <header className="plan-heading"><h3 id={`plan-free-${mobile ? 'mobile' : 'desktop'}`}>Yami Free</h3><span className="plan-status">{copy.current}</span></header>
        <div className="plan-price"><strong>¥0</strong><span>{copy.freePriceHint}</span></div>
        <p className="plan-caption">{copy.freeHint}</p>
        <ul className="plan-features">{copy.freeFeatures.map(feature => <li key={feature}><Check aria-hidden="true" /><span>{feature}</span></li>)}</ul>
      </article>
      <article className="plan-option plan-pro" aria-labelledby={`plan-pro-${mobile ? 'mobile' : 'desktop'}`}>
        <header className="plan-heading"><h3 id={`plan-pro-${mobile ? 'mobile' : 'desktop'}`}>Yami Pro</h3><span className="plan-status plan-status-pro">{copy.preparing}</span></header>
        <div className="plan-price"><strong>¥490</strong><span>{copy.monthly}</span></div>
        <p className="plan-price-hint">{copy.testPrice}</p>
        <p className="plan-caption">{copy.proHint}</p>
        <ul className="plan-features plan-future">{copy.proFeatures.map(feature => <li key={feature}><span className="plan-future-mark" aria-hidden="true" /><span>{feature}</span></li>)}</ul>
        <p className="plan-footnote">{copy.proNote}</p>
        <p className="plan-footnote">{copy.priceNote}</p>
        <p className="plan-unavailable">{copy.noPurchase}</p>
      </article>
    </div>
  </section>;
}
