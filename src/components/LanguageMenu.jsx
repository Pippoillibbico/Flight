import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { validateProps } from '../utils/validateProps';

const LanguageMenuPropsSchema = z
  .object({
    language: z.string(),
    setLanguage: z.any(),
    options: z.array(z.object({ value: z.string(), label: z.string() })),
    title: z.string()
  })
  .passthrough();

function LanguageMenu(props) {
  const { language, setLanguage, options, title } = validateProps(LanguageMenuPropsSchema, props, 'LanguageMenu');
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    const onClickOutside = (event) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target)) setOpen(false);
    };
    const onEsc = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  return (
    <div className={`landing-ctrl-btn landing-lang-btn${open ? ' open' : ''}`} title={title} ref={rootRef}>
      <button type="button" className="landing-lang-trigger" onClick={() => setOpen((prev) => !prev)} aria-expanded={open} aria-haspopup="listbox">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <span className="landing-ctrl-label">{language.toUpperCase()}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open ? (
        <div className="landing-lang-popover" role="listbox" aria-label={title}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`landing-lang-option${option.value === language ? ' active' : ''}`}
              onClick={() => {
                setLanguage(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default LanguageMenu;

