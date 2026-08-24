import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Scroll to and briefly flash whatever element matches the URL's `#hash`,
 * once `ready` (the page's data) has loaded.
 *
 * Generalises what `StrategyPage` used to do only for one case (a domain
 * badge linking to `/strategy#health`) into something any page with
 * per-row ids can reuse — the calendar links to `/tasks#task-42`,
 * `/decisions#decision-7`, `/questions#question-3` the same way. One
 * mechanism, not a fifth bespoke copy of it.
 */
export function useHashFlash(ready) {
  const { hash } = useLocation();
  const timer = useRef(null);

  useEffect(() => {
    if (!ready || !hash) return undefined;
    const el = document.getElementById(hash.slice(1));
    if (!el) return undefined;

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('section-flash');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => el.classList.remove('section-flash'), 1800);
    return () => clearTimeout(timer.current);
  }, [ready, hash]);
}
