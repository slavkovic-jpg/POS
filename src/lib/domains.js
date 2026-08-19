import {
  Briefcase, HeartPulse, GraduationCap, Users,
  Wallet, HandHeart, Compass, Sprout, Circle,
} from 'lucide-react';

/**
 * The shared visual language for the eight life domains.
 *
 * This is the backbone of cross-page navigation, not decoration. A task, a
 * knowledge item, a review row and a strategy card that belong to "health"
 * carry the same colour and the same icon everywhere they appear, so you can
 * follow one thread of your life across the whole app by eye. Every domain
 * badge is also a link back to that domain in the strategy scaffold.
 */
export const DOMAIN_META = {
  career:        { label: 'Career',        icon: Briefcase,     hue: 'blue'   },
  health:        { label: 'Health',        icon: HeartPulse,    hue: 'rose'   },
  learning:      { label: 'Learning',      icon: GraduationCap, hue: 'violet' },
  relationships: { label: 'Relationships', icon: Users,         hue: 'emerald'},
  finances:      { label: 'Finances',      icon: Wallet,        hue: 'amber'  },
  contribution:  { label: 'Contribution',  icon: HandHeart,     hue: 'cyan'   },
  enjoyment:     { label: 'Enjoyment',     icon: Compass,       hue: 'orange' },
  personal_dev:  { label: 'Personal',      icon: Sprout,        hue: 'indigo' },
};

export const FALLBACK_DOMAIN = { label: 'Unassigned', icon: Circle, hue: 'slate' };

export function domainMeta(key) {
  return DOMAIN_META[key] || FALLBACK_DOMAIN;
}

/** Energy states, mirrored from the server so the UI can colour them. */
export const ENERGY_META = {
  peak:        { label: 'Peak focus', hue: 'amber',   short: 'Peak' },
  medium:      { label: 'Moderate',   hue: 'blue',    short: 'Moderate' },
  low:         { label: 'Low energy', hue: 'slate',   short: 'Low' },
  overwhelmed: { label: 'Overwhelmed',hue: 'rose',    short: 'Overwhelmed' },
};
