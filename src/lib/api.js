const base = '/api';

async function req(path, opts = {}) {
  const r = await fetch(base + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.status === 204 ? null : r.json();
}

export const api = {
  chat: {
    messages: () => req('/chat/messages'),
    send: (text) => req('/chat/send', { method: 'POST', body: { text } }),
  },
  strategy: {
    get: () => req('/strategy'),
    update: (patch) => req('/strategy', { method: 'PATCH', body: patch }),
    updateDomain: (key, patch) => req(`/strategy/domains/${key}`, { method: 'PATCH', body: patch }),
  },
  knowledge: {
    list: (category) => req('/knowledge' + (category ? `?category=${encodeURIComponent(category)}` : '')),
    add: (data) => req('/knowledge', { method: 'POST', body: data }),
    update: (id, patch) => req(`/knowledge/${id}`, { method: 'PATCH', body: patch }),
    remove: (id) => req(`/knowledge/${id}`, { method: 'DELETE' }),
  },
  questions: {
    list: (status) => req('/open-questions' + (status ? `?status=${status}` : '')),
    add: (data) => req('/open-questions', { method: 'POST', body: data }),
    update: (id, patch) => req(`/open-questions/${id}`, { method: 'PATCH', body: patch }),
    resolve: (id, resolution) => req(`/open-questions/${id}/resolve`, { method: 'POST', body: { resolution } }),
  },
  decisions: {
    list: () => req('/decisions'),
    add: (data) => req('/decisions', { method: 'POST', body: data }),
    review: (id, patch) => req(`/decisions/${id}/review`, { method: 'POST', body: patch }),
  },
  tasks: {
    list: (status) => req('/tasks' + (status ? `?status=${status}` : '')),
    add: (data) => req('/tasks', { method: 'POST', body: data }),
    update: (id, patch) => req(`/tasks/${id}`, { method: 'PATCH', body: patch }),
  },
  briefing: {
    today: () => req('/briefing/today'),
    update: (patch) => req('/briefing/today', { method: 'PATCH', body: patch }),
  },
  onboarding: {
    profile: () => req('/onboarding/profile'),
    updateProfile: (patch) => req('/onboarding/profile', { method: 'PATCH', body: patch }),
    analyze: (cv_text) => req('/onboarding/analyze', { method: 'POST', body: { cv_text } }),
    accept: (hypotheses) => req('/onboarding/accept', { method: 'POST', body: { hypotheses } }),
    complete: () => req('/onboarding/complete', { method: 'POST' }),
  },
  reviews: {
    list: (kind) => req('/reviews' + (kind ? `?kind=${kind}` : '')),
    get: (id) => req(`/reviews/${id}`),
    start: (kind = 'weekly') => req('/reviews', { method: 'POST', body: { kind } }),
    update: (id, patch) => req(`/reviews/${id}`, { method: 'PATCH', body: patch }),
    generate: (id) => req(`/reviews/${id}/generate`, { method: 'POST' }),
    activity: (id) => req(`/reviews/${id}/activity`),
  },
};
