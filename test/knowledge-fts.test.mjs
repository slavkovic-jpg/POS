import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';

process.env.POS_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'pos-fts-'));

const { migrate } = await import('../server/migrations.mjs');
migrate();

const { addKnowledge, searchKnowledge } = await import('../server/knowledge.mjs');
const { buildSystemPrompt } = await import('../server/context.mjs');

test('search returns rows matching the question, not unrelated ones', () => {
  addKnowledge({ category: 'preferences', content: 'Prefers deep work in the morning before 11am' });
  addKnowledge({ category: 'habits', content: 'Runs three times a week for cardio' });

  const hits = searchKnowledge('morning deep work');
  assert.ok(hits.some((h) => h.content.includes('deep work')));
  assert.ok(!hits.some((h) => h.content.includes('cardio')));
});

test('a hundred knowledge rows do not grow the prompt once a question is asked', () => {
  for (let i = 0; i < 100; i++) {
    addKnowledge({ category: 'misc', content: `filler fact number ${i} about nothing in particular` });
  }
  const promptSmall = buildSystemPrompt({ question: 'deep work' });

  for (let i = 0; i < 100; i++) {
    addKnowledge({ category: 'misc', content: `another filler fact ${i} unrelated to anything` });
  }
  const promptAfterMore = buildSystemPrompt({ question: 'deep work' });

  assert.ok(Math.abs(promptSmall.length - promptAfterMore.length) < 200);
});

test('a question about a specific subject surfaces rows about that subject', () => {
  const prompt = buildSystemPrompt({ question: 'what do you know about my morning routine' });
  assert.ok(prompt.includes('deep work'));
});
