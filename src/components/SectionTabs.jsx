import React, { useEffect, useRef, useState } from 'react';
import { NavBadge } from './ui.jsx';

/**
 * A sticky jump bar for a page built from several stacked `.panel` blocks —
 * shortcuts to whatever is currently out of view, each one carrying the same
 * live badge the sidebar shows for that same number, so a count never means
 * two different things depending on where you're looking at it from.
 *
 * `sections`: `[{ id, label, icon, badge }]`. Every `id` must match an
 * element already on the page (typically the wrapping `.panel`) — this
 * generalises the hash-scroll-and-flash pattern `StrategyPage` already had
 * for jumping to one specific domain card, applied here at the level of a
 * whole page section instead of one card.
 */
export default function SectionTabs({ sections }) {
  const [active, setActive] = useState(sections[0]?.id);
  const flashTimer = useRef(null);

  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter(Boolean);
    if (!els.length) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (!visible.length) return;
        // The one nearest the top of the viewport is "where you are" — matches
        // how a table of contents tracks scroll position.
        const top = visible.reduce((a, b) =>
          a.boundingClientRect.top <= b.boundingClientRect.top ? a : b);
        setActive(top.target.id);
      },
      { rootMargin: '-72px 0px -60% 0px', threshold: 0 }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  function jump(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    clearTimeout(flashTimer.current);
    el.classList.add('section-flash');
    flashTimer.current = setTimeout(() => el.classList.remove('section-flash'), 1800);
    setActive(id);
  }

  return (
    <div className="section-tabs">
      {sections.map((s) => (
        <button
          key={s.id}
          className={'section-tab' + (active === s.id ? ' active' : '')}
          onClick={() => jump(s.id)}
          type="button"
        >
          {s.icon && <s.icon size={13} />}
          {s.label}
          {s.badge && <NavBadge {...s.badge} />}
        </button>
      ))}
    </div>
  );
}
