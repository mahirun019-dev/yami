import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { YamiAboutBrand } from '../brand/YamiLogo';
import { PRODUCT_UPDATES } from '../watch/productUpdates';
import { aboutCopy } from './i18n';
import { formatReleaseDate, isOfficialVersion, releaseHistory } from './releases';

type Panel = 'overview' | 'history' | 'privacy' | 'licenses';

export function AboutSettings({ locale, mobile = false }: { locale: string; mobile?: boolean }) {
  const language = locale === 'ja' ? 'ja' : 'zh';
  const copy = aboutCopy[language];
  const [panel, setPanel] = useState<Panel>('overview');
  const panelTitle = useRef<HTMLHeadingElement>(null);
  const history = releaseHistory(PRODUCT_UPDATES);
  useEffect(() => { if (panel !== 'overview') panelTitle.current?.focus(); }, [panel]);

  return <section className={`settings-section settings-about-page${mobile ? ' mobile-settings-subpage mobile-about' : ''}`}>
    {mobile ? <h2>{copy.title}</h2> : <h3>{copy.title}</h3>}
    {panel === 'overview' ? <>
      <div className="about-brand-intro"><YamiAboutBrand /></div>
      <nav className="about-links" aria-label={copy.title}>
        {(['history', 'privacy'] as const).map((name) => <button type="button" key={name} onClick={() => setPanel(name)}>
          <span><strong>{copy[name]}</strong><small>{copy[`${name}Hint`]}</small></span><ChevronRight aria-hidden="true" />
        </button>)}
      </nav>
    </> : <div className="about-detail">
      <button type="button" className="about-back" onClick={() => setPanel(panel === 'licenses' ? 'privacy' : 'overview')}><ArrowLeft aria-hidden="true" />{panel === 'licenses' ? copy.privacy : copy.back}</button>
      <h4 ref={panelTitle} tabIndex={-1}>{copy[panel]}</h4>
      {panel === 'history' && (history.length ? <ol className="about-history">{history.map((update) => <li key={update.id}>
        <div className="about-release-meta"><time dateTime={update.date}>{formatReleaseDate(update.date, language)}</time>{isOfficialVersion(update.version) && <span>v{update.version}</span>}</div>
        <h5>{update.title[language]}</h5><p>{update.summary[language]}</p><ul>{update.changes[language].map((change) => <li key={change}>{change}</li>)}</ul>
      </li>)}</ol> : <p className="about-muted">{copy.noHistory}</p>)}
      {panel === 'privacy' && <div className="about-prose">
        <section><h5>{copy.localTitle}</h5><p>{copy.localBody}</p></section>
        <section><h5>{copy.serverTitle}</h5><p>{copy.serverBody}</p><p>{copy.workerBody}</p></section>
        <section><h5>{copy.externalTitle}</h5><p>{copy.externalBody}</p></section>
        <section><h5>{copy.backupTitle}</h5><p>{copy.backupBody}</p></section>
        <button type="button" className="about-legal-link" onClick={() => setPanel('licenses')}>{copy.licenses}</button>
      </div>}
      {panel === 'licenses' && <div className="about-prose">
        <section><h5>{copy.projectLicense}</h5>{__YAMI_BUILD__.projectLicense
          ? <details className="about-license"><summary>{__YAMI_BUILD__.projectLicense.filename}</summary><pre>{__YAMI_BUILD__.projectLicense.text}</pre></details>
          : <><p className="about-license-status">{copy.noLicense}</p><p>{copy.noLicenseBody}</p></>}
        </section>
        <section><h5>{copy.dependencyLicenses}</h5><p>{copy.dependencyHint}</p>
          {__YAMI_BUILD__.dependencies.map((dependency) => <details className="about-license" key={dependency.name}>
            <summary><span>{dependency.name} <small>{dependency.version}</small></span><span className="about-license-type">{dependency.license}<ChevronRight aria-hidden="true" /></span></summary><pre>{dependency.text}</pre>
          </details>)}
        </section>
      </div>}
    </div>}
  </section>;
}
