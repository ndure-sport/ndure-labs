export function Header({ steps, current }: { steps?: string[]; current?: number }) {
  return (
    <header className="hdr">
      <div className="hdr-in">
        <a className="brand" href="https://www.ndure.dk/labs" aria-label="NDURE Labs">
          <span className="brand-dot" aria-hidden="true" />
          <span>Labs</span>
        </a>
        {steps && (
          <ol className="steps" aria-label="Sign up steps">
            {steps.map((s, i) => (
              <li key={s} className={i === current ? 'now' : i < (current ?? 0) ? 'done' : ''} aria-current={i === current ? 'step' : undefined}>
                {String(i + 1).padStart(2, '0')} {s}
              </li>
            ))}
          </ol>
        )}
      </div>
    </header>
  );
}
