import { describe, expect, it } from 'vitest';

import {
  isAffirmativeAnswer,
  isNegativeAnswer,
  isSupportSessionReady,
  normalizeSupportSessionAnswer,
  type SupportSessionRecord,
} from '../src/commerce';
import { resolveCommerceReferences } from '../src/commerce-memory';

describe('damaged-product support sessions', () => {
  it('normalizes common yes and no replies', () => {
    expect(normalizeSupportSessionAnswer('YES')).toBe('yes');
    expect(normalizeSupportSessionAnswer('  no  ')).toBe('no');
    expect(normalizeSupportSessionAnswer('I want a refund')).toBe('i want a refund');
  });

  it('recognizes affirmative and negative answers', () => {
    expect(isAffirmativeAnswer('yes')).toBe(true);
    expect(isAffirmativeAnswer('y')).toBe(true);
    expect(isAffirmativeAnswer('Yes, shoes')).toBe(true);
    expect(isAffirmativeAnswer('correct, that product')).toBe(true);
    expect(isNegativeAnswer('no')).toBe(true);
    expect(isNegativeAnswer('n')).toBe(true);
  });

  it('marks a support session ready only when required fields are complete', () => {
    const session: SupportSessionRecord = {
      id: 1,
      customer_phone: '+919999999999',
      customer_id: null,
      order_id: 42,
      issue_type: 'DAMAGED_PRODUCT',
      status: 'READY_FOR_ACTION',
      current_step: 'WAITING_USER_DECISION',
      product_name: 'Wireless Headphones',
      issue_description: 'Screen cracked',
      preferred_resolution: 'replacement',
      summary_text: 'Cracked screen on headphones',
      collected_data: {
        product_confirmed: true,
        issue_description: 'Screen cracked',
        preferred_resolution: 'replacement',
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    expect(isSupportSessionReady(session)).toBe(true);
  });

  it('resolves missing follow-up references from commerce context', () => {
    const context = {
      phone_number: '+919999999999',
      last_product: 'Apple Watch',
      last_order_id: 42,
      last_intent: 'ORDER_STATUS',
      updated_at: new Date().toISOString(),
    };

    expect(resolveCommerceReferences(context, {
      intent: 'INVENTORY_QUERY',
      orderId: null,
      productName: null,
    })).toMatchObject({
      productName: 'Apple Watch',
      orderId: null,
      usedContext: true,
    });

    expect(resolveCommerceReferences(context, {
      intent: 'PAYMENT_QUERY',
      orderId: null,
      productName: null,
    })).toMatchObject({
      productName: null,
      orderId: 42,
      usedContext: true,
    });
  });
});