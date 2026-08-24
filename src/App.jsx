import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Mic, ListTodo, Sun, Compass,
  Brain, HelpCircle, CalendarCheck, TrendingUp, UserCog, Settings,
  Inbox, FolderKanban, Handshake,
} from 'lucide-react';
import { api } from './lib/api.js';
import { NavBadge } from './components/ui.jsx';

import DashboardPage from './pages/DashboardPage.jsx';
import CopilotPage from './pages/CopilotPage.jsx';
import TasksPage from './pages/TasksPage.jsx';
import BriefingPage from './pages/BriefingPage.jsx';
import StrategyPage from './pages/StrategyPage.jsx';
import KnowledgePage from './pages/KnowledgePage.jsx';
import OpenQuestionsPage from './pages/OpenQuestionsPage.jsx';
import DecisionsPage from './pages/DecisionsPage.jsx';
import ReviewsPage from './pages/ReviewsPage.jsx';
import OnboardingPage from './pages/OnboardingPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import InboxPage from './pages/InboxPage.jsx';
import ProjectsPage from './pages/ProjectsPage.jsx';
import CommitmentsPage from './pages/CommitmentsPage.jsx';

const POLL_MS = 30_000;
// How long an unread reply sits before the badge escalates from a nudge to a
// warning. Tracked client-side (see below) because "unread" is inherently
// what this browser has seen, not something the server can know on its own.
const UNREAD_DANGER_MS = 2 * 60 * 60 * 1000;

/**
 * Every badge function takes the compact `/api/nav-status` payload and
 * returns either `null` (nothing to say) or `{ count, total, tone, warn }`
 * for `<NavBadge>`. Kept next to the nav item it describes rather than in a
 * separate lookup table, so a badge and the link it decorates never drift
 * apart from having to stay in sync by hand.
 */
function badges(s, chatTone) {
  return {
    copilot: () => s && s.chat.unread > 0 ? { count: s.chat.unread, tone: chatTone } : null,
    inbox: () => s && s.inbox.open > 0 ? { count: s.inbox.open, tone: 'warn' } : null,
    tasks: () => {
      if (!s) return null;
      const { due_today, done_today, overdue } = s.tasks;
      if (due_today === 0 && overdue === 0) return null;
      return {
        count: done_today, total: Math.max(due_today, done_today),
        tone: overdue > 0 ? 'danger' : 'warn',
      };
    },
    projects: () => s && { count: s.projects.active, tone: s.projects.stalled > 0 ? 'warn' : 'neutral' },
    commitments: () => s && s.commitments.open > 0
      ? { count: s.commitments.open, tone: s.commitments.at_risk > 0 ? 'danger' : 'neutral' }
      : null,
    strategy: () => {
      if (!s) return null;
      const { filled, total } = s.strategy;
      if (filled >= total) return null;
      return { count: filled, total, tone: 'warn' };
    },
    questions: () => s && s.questions.open > 0 ? { count: s.questions.open, tone: 'warn' } : null,
    decisions: () => s && s.decisions.to_review > 0 ? { count: s.decisions.to_review, tone: 'warn' } : null,
    reviews: () => s && s.review.overdue ? { warn: true, tone: 'warn' } : null,
    onboarding: () => s && !s.onboarded ? { warn: true, tone: 'warn' } : null,
  };
}

/** Grouped by what you're doing, not by which table it touches. */
const NAV = [
  { section: 'Today', items: [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/copilot',   label: 'Copilot',   icon: Mic, badgeKey: 'copilot' },
    { to: '/inbox',     label: 'Inbox',     icon: Inbox, badgeKey: 'inbox' },
    { to: '/tasks',     label: 'Tasks',     icon: ListTodo, badgeKey: 'tasks' },
    { to: '/briefing',  label: 'Briefing',  icon: Sun },
  ]},
  { section: 'Work', items: [
    { to: '/projects',    label: 'Projects',    icon: FolderKanban, badgeKey: 'projects' },
    { to: '/commitments', label: 'Commitments', icon: Handshake, badgeKey: 'commitments' },
  ]},
  { section: 'Direction', items: [
    { to: '/strategy',  label: 'Strategy',       icon: Compass, badgeKey: 'strategy' },
    { to: '/knowledge', label: 'Knowledge',      icon: Brain },
    { to: '/questions', label: 'Open Questions', icon: HelpCircle, badgeKey: 'questions' },
    { to: '/decisions', label: 'Decisions',      icon: CalendarCheck, badgeKey: 'decisions' },
    { to: '/reviews',   label: 'Reviews',        icon: TrendingUp, badgeKey: 'reviews' },
  ]},
  { section: 'System', items: [
    { to: '/onboarding', label: 'Onboarding', icon: UserCog, badgeKey: 'onboarding' },
    { to: '/settings',   label: 'Settings',   icon: Settings },
  ]},
];

/** Read once per render; cheap, and keeps the polling logic below simple. */
function lastSeenMessageId() {
  return Number(localStorage.getItem('pos_last_seen_message_id')) || 0;
}

export default function App() {
  const [status, setStatus] = useState(null);
  const location = useLocation();
  const unreadSinceRef = useRef(null);

  const refresh = useCallback(async () => {
    try { setStatus(await api.navStatus(lastSeenMessageId())); }
    catch { /* the sidebar simply shows no badges until the next successful poll */ }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // Visiting Copilot is what actually clears its own badge (CopilotPage
  // advances the localStorage cursor as messages load) — this just makes the
  // sidebar reflect that immediately instead of waiting out the poll interval.
  useEffect(() => { if (location.pathname === '/copilot') refresh(); }, [location.pathname, refresh]);

  // Escalation is elapsed time since a reply first went unread, which only
  // this browser can know — tracked in localStorage so it survives a reload.
  let chatTone = 'warn';
  if (status?.chat.unread > 0) {
    let since = Number(localStorage.getItem('pos_unread_since_ts'));
    if (!since) {
      since = Date.now();
      localStorage.setItem('pos_unread_since_ts', String(since));
    }
    chatTone = Date.now() - since > UNREAD_DANGER_MS ? 'danger' : 'warn';
  } else {
    localStorage.removeItem('pos_unread_since_ts');
  }

  const badgeFns = badges(status, chatTone);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Compass size={19} /></div>
          <div>
            <div className="brand-name">Personal OS</div>
            <div className="brand-sub">Chief of staff</div>
          </div>
        </div>

        <nav>
          {NAV.map((group) => (
            <React.Fragment key={group.section}>
              <div className="nav-section">{group.section}</div>
              {group.items.map((n) => {
                const b = n.badgeKey ? badgeFns[n.badgeKey]?.() : null;
                return (
                  <NavLink key={n.to} to={n.to}
                    className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
                    <n.icon size={15} />
                    <span className="nav-link-label">{n.label}</span>
                    {b && <NavBadge {...b} />}
                  </NavLink>
                );
              })}
            </React.Fragment>
          ))}
        </nav>

        <footer className="sidebar-footer">v0.1</footer>
      </aside>

      <main className="main">
        <div className="main-inner">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/copilot" element={<CopilotPage />} />
            <Route path="/chat" element={<Navigate to="/copilot" replace />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/commitments" element={<CommitmentsPage />} />
            <Route path="/briefing" element={<BriefingPage />} />
            <Route path="/strategy" element={<StrategyPage />} />
            <Route path="/knowledge" element={<KnowledgePage />} />
            <Route path="/questions" element={<OpenQuestionsPage />} />
            <Route path="/decisions" element={<DecisionsPage />} />
            <Route path="/reviews" element={<ReviewsPage />} />
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
