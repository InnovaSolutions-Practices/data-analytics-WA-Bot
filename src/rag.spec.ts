import { describe, it, expect } from 'vitest';
import {
  buildContext,
  buildRAGPrompt,
  normalizeSearchText,
  resolveConversationState,
} from './rag';

describe('RAG helpers', () => {
  it('normalizes search terms consistently', () => {
    expect(normalizeSearchText('  Refund? Status!  ')).toBe('refund status');
  });

  it('builds contextual prompt text with retrieved knowledge', () => {
    const context = buildContext(
      [
        {
          title: 'Refund policy',
          content: 'Refunds are processed within 7 days after delivery.',
          source: 'knowledge-base',
        },
      ],
      'How long does refund take?'
    );

    expect(context).toContain('Source: knowledge-base');
    expect(context).toContain('Refund policy');
    expect(context).toContain('Question:');
    expect(context).toContain('How long does refund take?');
  });

  it('builds a response prompt with explicit instructions', () => {
    const prompt = buildRAGPrompt('What is your return policy?', [
      {
        title: 'Return policy',
        content: 'Returns are accepted within 7 days.',
        source: 'knowledge-base',
      },
    ]);

    expect(prompt).toContain('Use only the information in the context below');
    expect(prompt).toContain('Return policy');
  });

  it('resolves known conversation states', () => {
    expect(resolveConversationState('MAIN_MENU')).toBe('MAIN_MENU');
    expect(resolveConversationState('checkout')).toBe('CHECKOUT');
    expect(resolveConversationState('unknown state')).toBe('MAIN_MENU');
  });
});
