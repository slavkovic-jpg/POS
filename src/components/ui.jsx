import React from 'react';
import { Link } from 'react-router-dom';
import { domainMeta } from '../lib/domains.js';

/**
 * Shared primitives. The point of centralising these is consistency across
 * nine pages — a domain looks and behaves the same wherever it appears, and
 * every badge is a working link rather than a dead label.
 */

/** Domain badge. Always navigates to that domain in the strategy scaffold. */
export function DomainBadge({ domainKey, size = 'md', link = true }) {
  const meta = domainMeta(domainKey);
  const Icon = meta.icon;
  const body = (
    <>
      <Icon size={size === 'sm' ? 10 : 12} />
      {meta.label}
    </>
  );
  const cls = `badge domain hue-${meta.hue}`;
  if (!link || !domainKey) return <span className={cls}>{body}</span>;
  return (
    <Link to={`/strategy#${domainKey}`} className={cls} title={`Open ${meta.label} in your strategy`}>
      {body}
    </Link>
  );
}

/** Wrapper that scopes a domain's hue to everything inside it. */
export function HueScope({ domainKey, as: As = 'div', className = '', children, ...rest }) {
  const meta = domainMeta(domainKey);
  return (
    <As className={`hue-${meta.hue} ${className}`.trim()} {...rest}>{children}</As>
  );
}

export function Stat({ label, value, icon: Icon, tone, hint }) {
  return (
    <div className="stat" title={hint}>
      <div className="stat-label">{Icon && <Icon size={11} />}{label}</div>
      <div className={`stat-value${tone ? ' ' + tone : ''}`}>{value}</div>
    </div>
  );
}

export function Callout({ tone = 'warn', icon: Icon, title, children }) {
  return (
    <div className={`callout ${tone}`}>
      {Icon && <Icon size={16} />}
      <div>
        {title && <strong style={{ display: 'block', marginBottom: 2 }}>{title}</strong>}
        <span style={{ color: 'var(--text-dim)' }}>{children}</span>
      </div>
    </div>
  );
}

export function SectionHead({ icon: Icon, title, action, children }) {
  return (
    <div className="section-head">
      <h2>{Icon && <Icon size={15} />}{title}</h2>
      {action || children}
    </div>
  );
}

/** Empty state that tells you where to go, rather than just saying "none". */
export function EmptyState({ children, to, cta }) {
  return (
    <div className="empty">
      {children}
      {to && cta && <> <Link to={to} style={{ fontStyle: 'normal', fontWeight: 550 }}>{cta} →</Link></>}
    </div>
  );
}
