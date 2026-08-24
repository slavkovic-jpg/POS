import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, ListTodo, Handshake,
  FolderKanban, CalendarCheck, HelpCircle, Users, Battery,
} from 'lucide-react';
import { api } from '../lib/api.js';

const LEVELS = ['quarter', 'month', 'week', 'day'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_START = 6;
const HOUR_END = 23;
const HOUR_PX = 30;

const KIND_ICON = {
  task: ListTodo, commitment: Handshake, project: FolderKanban,
  decision: CalendarCheck, open_question: HelpCircle,
  dependency: Users, health_signal: Battery,
};

const iso = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const addMonths = (d, n) => { const r = new Date(d); r.setMonth(r.getMonth() + n); return r; };
const sameDay = (a, b) => iso(a) === iso(b);
// Monday-start week.
const startOfWeek = (d) => addDays(d, -((d.getDay() + 6) % 7));
const toneClass = (t) => (t === 'danger' ? 'danger' : t === 'warn' ? 'awaiting' : '');

function computeRange(granularity, anchor) {
  if (granularity === 'day') {
    return { start: anchor, end: anchor, label: anchor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) };
  }
  if (granularity === 'week') {
    const start = startOfWeek(anchor);
    const end = addDays(start, 6);
    // Deliberately always {month, day} on both ends, year appended as plain
    // text — {day, year} with no month, in isolation, renders nonsense in at
    // least one environment encountered here ("2026 (day: 23)"). Including
    // month on both sides sidesteps that entirely rather than chasing why.
    const startLabel = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const endLabel = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return { start, end, label: `${startLabel} – ${endLabel}, ${end.getFullYear()}` };
  }
  if (granularity === 'month') {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    return { start, end, label: anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) };
  }
  // quarter
  const qStartMonth = Math.floor(anchor.getMonth() / 3) * 3;
  const start = new Date(anchor.getFullYear(), qStartMonth, 1);
  const end = new Date(anchor.getFullYear(), qStartMonth + 3, 0);
  return { start, end, label: `Q${qStartMonth / 3 + 1} ${anchor.getFullYear()}` };
}

function step(anchor, granularity, dir) {
  if (granularity === 'day') return addDays(anchor, dir);
  if (granularity === 'week') return addDays(anchor, dir * 7);
  if (granularity === 'month') return addMonths(anchor, dir);
  return addMonths(anchor, dir * 3);
}

/** Weeks of {date, inMonth} cells, Monday-start, padded to full weeks. */
function monthMatrix(year, month) {
  const first = new Date(year, month, 1);
  const start = startOfWeek(first);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    cells.push({ date: d, inMonth: d.getMonth() === month });
    if (i >= 34 && d.getMonth() !== month && i % 7 === 6) break;
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * Zoomable overview of everything with a date. Week by default; zoom in past
 * a day reaches the hour grid, zoom out reaches month and a quarter beyond.
 * Every chip links to its source row (`/tasks#task-42` etc.) and flashes it
 * on arrival via `useHashFlash` on the destination page.
 *
 * `scope` filters which kinds this instance cares about — 'all' on the
 * Dashboard, 'tasks' embedded in Tasks, 'commitments' embedded in
 * Commitments. One component, one data feed (`GET /api/calendar`), not three
 * separate implementations.
 */
export default function Timeline({ scope = 'all' }) {
  const [granularity, setGranularity] = useState('week');
  const [anchor, setAnchor] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [floating, setFloating] = useState(false);
  const containerRef = useRef(null);

  // Docked full-width at the top of the page; once the page actually scrolls
  // past this widget's own docked height, it shrinks into a translucent
  // corner widget instead of sitting in the document flow — back to full
  // width and full opacity the moment you scroll to the top again.
  //
  // The threshold is measured on mount, not guessed as a fixed pixel count:
  // a threshold shorter than this element's actual docked height left it
  // fixed-positioned (floating) while SectionTabs — right after it in the
  // flow — hadn't yet reflowed into the space that left behind, so the two
  // visibly overlapped for a stretch of scroll.
  const dockedHeight = useRef(null);
  useEffect(() => {
    if (containerRef.current && !floating) dockedHeight.current = containerRef.current.offsetHeight;
  });

  useEffect(() => {
    const scroller = document.querySelector('.main');
    if (!scroller) return undefined;
    const onScroll = () => setFloating(scroller.scrollTop > (dockedHeight.current || 100));
    scroller.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  const range = useMemo(() => computeRange(granularity, anchor), [granularity, anchor]);
  // Quarter/month need a little padding either side so the grid's leading/
  // trailing days from neighbouring months still show their events.
  const fetchStart = granularity === 'month' || granularity === 'quarter' ? addDays(range.start, -7) : range.start;
  const fetchEnd = granularity === 'month' || granularity === 'quarter' ? addDays(range.end, 7) : range.end;

  useEffect(() => {
    api.calendar(iso(fetchStart), iso(fetchEnd)).then(setEvents).catch(() => setEvents([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso(fetchStart), iso(fetchEnd)]);

  const filtered = useMemo(() => {
    if (scope === 'tasks') return events.filter((e) => e.kind === 'task');
    if (scope === 'commitments') return events.filter((e) => e.kind === 'commitment');
    return events;
  }, [events, scope]);

  async function scheduleNow(ev) {
    if (!ev.id.startsWith('task-')) return;
    const time = prompt('Schedule at what time today? (e.g. 09:30)');
    if (!time?.trim()) return;
    const taskId = ev.id.replace('task-', '');
    await api.tasks.update(taskId, { scheduled_at: `${ev.date}T${time.trim()}` });
    api.calendar(iso(fetchStart), iso(fetchEnd)).then(setEvents).catch(() => {});
  }

  const levelIdx = LEVELS.indexOf(granularity);

  function zoomBy(delta) {
    setGranularity((g) => {
      const i = LEVELS.indexOf(g) + delta;
      return i >= 0 && i < LEVELS.length ? LEVELS[i] : g;
    });
  }

  // Ctrl/Cmd+wheel zooms; a trackpad pinch is reported by the browser as
  // exactly this (wheel + ctrlKey), so this covers both without extra code.
  // Plain scrolling is left alone — it only zooms with the modifier held, so
  // scrolling past the calendar on the page still just scrolls the page.
  //
  // A native listener, not React's onWheel: React attaches wheel handlers as
  // passive by default, so `preventDefault()` inside a JSX onWheel silently
  // fails (and logs a console error) — the zoom would still work, but the
  // page would also scroll underneath it at the same time. {passive:false}
  // here is what actually stops that.
  const bodyRef = useRef(null);
  const lastWheelZoom = useRef(0);
  const zoomByRef = useRef(zoomBy);
  zoomByRef.current = zoomBy;

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;
    const handler = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const now = Date.now();
      if (now - lastWheelZoom.current < 250) return;
      lastWheelZoom.current = now;
      zoomByRef.current(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // Real touchscreen pinch (two fingers) — trackpad pinch is handled above.
  const pinch = useRef({ dist: 0, at: 0 });
  function touchDist(touches) {
    const [a, b] = touches;
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }
  function onTouchStart(e) {
    if (e.touches.length === 2) pinch.current.dist = touchDist(e.touches);
  }
  function onTouchMove(e) {
    if (e.touches.length !== 2) return;
    const dist = touchDist(e.touches);
    const delta = dist - pinch.current.dist;
    const now = Date.now();
    if (Math.abs(delta) > 36 && now - pinch.current.at > 350) {
      zoomBy(delta > 0 ? 1 : -1);
      pinch.current = { dist, at: now };
    }
  }

  return (
    <div ref={containerRef} className={'timeline' + (floating ? ' floating' : '')}>
      <div className="timeline-header">
        <div className="row-flex" style={{ gap: 4 }}>
          <button className="ghost sm" onClick={() => setAnchor((a) => step(a, granularity, -1))}>
            <ChevronLeft size={14} />
          </button>
          <button className="ghost sm" onClick={() => setAnchor(new Date())}>Today</button>
          <button className="ghost sm" onClick={() => setAnchor((a) => step(a, granularity, 1))}>
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="timeline-label">{range.label}</div>
        <div className="row-flex" style={{ gap: 4 }}>
          <button className="ghost sm" disabled={levelIdx === 0} onClick={() => zoomBy(-1)} title="Zoom out (or Ctrl/Cmd+scroll, or pinch)">
            <ZoomOut size={14} />
          </button>
          <span className="item-meta" style={{ textTransform: 'capitalize', minWidth: 46, textAlign: 'center' }}>
            {granularity}
          </span>
          <button className="ghost sm" disabled={levelIdx === LEVELS.length - 1} onClick={() => zoomBy(1)} title="Zoom in (or Ctrl/Cmd+scroll, or pinch)">
            <ZoomIn size={14} />
          </button>
        </div>
      </div>

      <div className="timeline-body" ref={bodyRef} onTouchStart={onTouchStart} onTouchMove={onTouchMove}>
        {granularity === 'quarter' && <QuarterView anchor={anchor} events={filtered} onDrill={(d) => { setAnchor(d); setGranularity('month'); }} />}
        {granularity === 'month' && <MonthView anchor={anchor} events={filtered} onDrill={(d) => { setAnchor(d); setGranularity('day'); }} />}
        {granularity === 'week' && <WeekView anchor={anchor} events={filtered} onDrill={(d) => { setAnchor(d); setGranularity('day'); }} />}
        {granularity === 'day' && <DayView anchor={anchor} events={filtered} onScheduleNow={scheduleNow} />}
      </div>
    </div>
  );
}

function EventChip({ ev }) {
  const Icon = KIND_ICON[ev.kind] || ListTodo;
  return (
    <Link to={ev.link} className={`badge cal-chip ${toneClass(ev.tone)}`} title={ev.title}>
      <Icon size={9} />
      {ev.time && <span className="cal-chip-time">{ev.time}</span>}
      <span className="cal-chip-title">{ev.title}</span>
    </Link>
  );
}

// ---- Quarter --------------------------------------------------------------
function QuarterView({ anchor, events, onDrill }) {
  const qStartMonth = Math.floor(anchor.getMonth() / 3) * 3;
  const months = [0, 1, 2].map((i) => new Date(anchor.getFullYear(), qStartMonth + i, 1));
  const countByDate = useMemo(() => {
    const m = {};
    for (const e of events) m[e.date] = (m[e.date] || 0) + 1;
    return m;
  }, [events]);

  return (
    <div className="cal-quarter">
      {months.map((m) => (
        <div key={m.getMonth()} className="cal-quarter-month">
          <div className="cal-quarter-month-label">{m.toLocaleDateString(undefined, { month: 'long' })}</div>
          <div className="cal-mini-grid">
            {monthMatrix(m.getFullYear(), m.getMonth()).flat().map(({ date, inMonth }, i) => {
              const count = countByDate[iso(date)] || 0;
              return (
                <button key={i} className={'cal-mini-cell' + (inMonth ? '' : ' out') + (sameDay(date, new Date()) ? ' today' : '')}
                  onClick={() => onDrill(date)} disabled={!inMonth}>
                  <span>{date.getDate()}</span>
                  {count > 0 && <span className="cal-mini-dot" />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Month ------------------------------------------------------------------
function MonthView({ anchor, events, onDrill }) {
  const byDate = useMemo(() => {
    const m = {};
    for (const e of events) (m[e.date] ??= []).push(e);
    return m;
  }, [events]);
  const weeks = monthMatrix(anchor.getFullYear(), anchor.getMonth());

  return (
    <div className="cal-month">
      <div className="cal-month-dow">
        {DOW.map((d) => <div key={d}>{d}</div>)}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="cal-month-row">
          {week.map(({ date, inMonth }) => {
            const dayEvents = byDate[iso(date)] || [];
            return (
              <div key={iso(date)} className={'cal-month-cell' + (inMonth ? '' : ' out') + (sameDay(date, new Date()) ? ' today' : '')}>
                <button className="cal-month-daynum" onClick={() => onDrill(date)}>{date.getDate()}</button>
                <div className="cal-month-chips">
                  {dayEvents.slice(0, 3).map((e) => <EventChip key={e.id} ev={e} />)}
                  {dayEvents.length > 3 && (
                    <button className="item-meta cal-more" onClick={() => onDrill(date)}>
                      +{dayEvents.length - 3} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ---- Week -------------------------------------------------------------------
function WeekView({ anchor, events, onDrill }) {
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const byDate = useMemo(() => {
    const m = {};
    for (const e of events) (m[e.date] ??= []).push(e);
    for (const k in m) m[k].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    return m;
  }, [events]);

  return (
    <div className="cal-week">
      {days.map((d) => {
        const dayEvents = byDate[iso(d)] || [];
        return (
          <div key={iso(d)} className={'cal-week-col' + (sameDay(d, new Date()) ? ' today' : '')}>
            <button className="cal-week-daylabel" onClick={() => onDrill(d)}>
              <span>{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <span className="cal-week-daynum">{d.getDate()}</span>
            </button>
            <div className="cal-week-chips">
              {dayEvents.length === 0 && <div className="item-meta" style={{ fontSize: 11 }}>—</div>}
              {dayEvents.map((e) => <EventChip key={e.id} ev={e} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Day / hour ---------------------------------------------------------
function DayView({ anchor, events, onScheduleNow }) {
  const dayEvents = events.filter((e) => e.date === iso(anchor));
  const allDay = dayEvents.filter((e) => !e.time);
  const timed = dayEvents.filter((e) => e.time);
  const now = new Date();
  const showNowLine = sameDay(anchor, now);
  const nowOffset = ((now.getHours() - HOUR_START) + now.getMinutes() / 60) * HOUR_PX;

  return (
    <div>
      {allDay.length > 0 && (
        <div className="cal-day-allday">
          {allDay.map((e) => (
            <div key={e.id} className="row-flex" style={{ justifyContent: 'space-between', gap: 8 }}>
              <EventChip ev={e} />
              {e.kind === 'task' && (
                <button className="ghost sm" onClick={() => onScheduleNow(e)}>Schedule</button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="cal-hour-grid" style={{ height: (HOUR_END - HOUR_START + 1) * HOUR_PX }}>
        {Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i).map((h) => (
          <div key={h} className="cal-hour-row" style={{ height: HOUR_PX }}>
            <span className="cal-hour-label">{h % 12 === 0 ? 12 : h % 12}{h < 12 ? 'am' : 'pm'}</span>
          </div>
        ))}
        {showNowLine && nowOffset >= 0 && nowOffset <= (HOUR_END - HOUR_START + 1) * HOUR_PX && (
          <div className="cal-now-line" style={{ top: nowOffset }} />
        )}
        {timed.map((e) => {
          const [h, m] = e.time.split(':').map(Number);
          const top = ((h - HOUR_START) + m / 60) * HOUR_PX;
          const height = Math.max(20, ((e.duration_minutes || 30) / 60) * HOUR_PX);
          return (
            <Link key={e.id} to={e.link} className={`cal-block ${toneClass(e.tone)}`}
              style={{ top, height }} title={e.title}>
              <span className="cal-block-time">{e.time}</span> {e.title}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
