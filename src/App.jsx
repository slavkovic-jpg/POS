import React from 'react';
import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import {
  LayoutDashboard, Mic, MessageSquare, ListTodo, Sun, Compass,
  Brain, HelpCircle, CalendarCheck, TrendingUp, UserCog, Settings,
} from 'lucide-react';

import DashboardPage from './pages/DashboardPage.jsx';
import CopilotPage from './pages/CopilotPage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import TasksPage from './pages/TasksPage.jsx';
import BriefingPage from './pages/BriefingPage.jsx';
import StrategyPage from './pages/StrategyPage.jsx';
import KnowledgePage from './pages/KnowledgePage.jsx';
import OpenQuestionsPage from './pages/OpenQuestionsPage.jsx';
import DecisionsPage from './pages/DecisionsPage.jsx';
import ReviewsPage from './pages/ReviewsPage.jsx';
import OnboardingPage from './pages/OnboardingPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

/** Grouped by what you're doing, not by which table it touches. */
const NAV = [
  { section: 'Today', items: [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/copilot',   label: 'Copilot',   icon: Mic },
    { to: '/chat',      label: 'Chat',      icon: MessageSquare },
    { to: '/tasks',     label: 'Tasks',     icon: ListTodo },
    { to: '/briefing',  label: 'Briefing',  icon: Sun },
  ]},
  { section: 'Direction', items: [
    { to: '/strategy',  label: 'Strategy',       icon: Compass },
    { to: '/knowledge', label: 'Knowledge',      icon: Brain },
    { to: '/questions', label: 'Open Questions', icon: HelpCircle },
    { to: '/decisions', label: 'Decisions',      icon: CalendarCheck },
    { to: '/reviews',   label: 'Reviews',        icon: TrendingUp },
  ]},
  { section: 'System', items: [
    { to: '/onboarding', label: 'Onboarding', icon: UserCog },
    { to: '/settings',   label: 'Settings',   icon: Settings },
  ]},
];

export default function App() {
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
              {group.items.map((n) => (
                <NavLink key={n.to} to={n.to}
                  className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
                  <n.icon size={15} />{n.label}
                </NavLink>
              ))}
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
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/tasks" element={<TasksPage />} />
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
