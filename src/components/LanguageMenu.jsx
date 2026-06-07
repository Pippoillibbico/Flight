import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const [popoverStyle, setPopoverStyle] = useState(null);
  const rootRef = useRef(null);
  const popoverRef = useRef(null);
  const activeOption = useMemo(
    () => options.find((option) => option.value === language) || options[0] || { value: language, label: String(language || '').toUpperCase() },
    [options, language]
  );

  const updatePopoverPosition = useCallback(() => {
    if (typeof window === 'undefined' || !rootRef.current) return;
    const trigger = rootRef.current.querySelector('.landing-lang-trigger');
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const popover = popoverRef.current;
    const viewportPadding = 12;
    const gap = 8;
    const width = Math.min(Math.max(rect.width, 200), Math.min(240, window.innerWidth - viewportPadding * 2));
    const left = Math.min(Math.max(viewportPadding, rect.right - width), window.innerWidth - width - viewportPadding);
    const desiredHeight = Math.min(popover?.scrollHeight || options.length * 42 + 12, 360);
    const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPadding;
    const spaceAbove = rect.top - gap - viewportPadding;
    const openAbove = spaceBelow < desiredHeight && spaceAbove >= desiredHeight;
    const top = openAbove ? rect.top - gap - desiredHeight : rect.bottom + gap;

    setPopoverStyle({
      position: 'fixed',
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`,
      right: 'auto',
      width: `${Math.round(width)}px`,
      maxHeight: 'none',
      overflowY: 'visible',
      zIndex: 1300
    });
  }, [options.length]);

  useEffect(() => {
    if (!open) return undefined;
    updatePopoverPosition();
    window.addEventListener('resize', updatePopoverPosition);
    window.addEventListener('scroll', updatePopoverPosition, true);
    return () => {
      window.removeEventListener('resize', updatePopoverPosition);
      window.removeEventListener('scroll', updatePopoverPosition, true);
    };
  }, [open, updatePopoverPosition]);

  useEffect(() => {
    const onPointerDown = (event) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target) && !popoverRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div className={`landing-lang-btn${open ? ' open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="landing-ctrl-btn landing-theme-btn landing-lang-trigger app-header-control-btn"
        aria-label={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <span className="landing-ctrl-label landing-lang-current">{activeOption.label}</span>
        <svg className="landing-ctrl-caret" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
        <div ref={popoverRef} className="landing-lang-popover" role="listbox" aria-label={title} style={popoverStyle || undefined}>
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
              <span className="landing-lang-name">{option.label}</span>
              <span className="landing-lang-check" aria-hidden="true">
                {option.value === language ? '\u2713' : ''}
              </span>
            </button>
          ))}
        </div>,
        document.body
          )
        : null}
    </div>
  );
}

export default LanguageMenu;
