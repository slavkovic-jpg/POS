import React from 'react';
import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import ChatPage from './pages/ChatPage.jsx';
import BriefingPage from './pages/BriefingPage.jsx';
import StrategyPage from './pages/StrategyPage.jsx';
import KnowledgePage from './pages/KnowledgePage.jsx';
import DecisionsPage from './pages/DecisionsPage.jsx';
import OpenQuestionsPage from './pages/OpenQuestionsPage.jsx';
import OnboardingPage from './pages/OnboardingPage.jsx';
import ReviewsPage from './pages/ReviewsPage.jsx';
import TasksPage from './pages/TasksPage.jsx';
import CopilotPage from './pages/CopilotPage.jsx';

const NAV = [
  { to: '/copilot', label: 'Copilot' },
  { to: '/chat', label: 'Chat' },
  { to: '/briefing', label: 'Briefing' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/strategy', label: 'Strategy' },
  { to: '/knowledge', label: 'Knowledge' },
  { to: '/questions', label: 'Open Questions' },
  { to: '/decisions', label: 'Decisions' },
  { to: '/reviews', label: 'Reviews' },
  { to: '/onboarding', label: 'Onboarding' },
];

export default function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">◈</span>
          <span className="brand-name">Personal OS</span>
        </div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <footer className="sidebar-footer">
          <small>v0.1 · stubbed LLM</small>
        </footer>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/copilot" replace />} />
          <Route path="/copilot" element={<CopilotPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/briefing" element={<BriefingPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/strategy" element={<StrategyPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/questions" element={<OpenQuestionsPage />} />
          <Route path="/decisions" element={<DecisionsPage />} />
          <Route path="/reviews" element={<ReviewsPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
        </Routes>
      </main>
    </div>
  );
}
