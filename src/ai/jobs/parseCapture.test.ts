import { describe, it, expect } from 'vitest';
import { parseCaptureSchema, fallbackParse } from './parseCapture';

/**
 * The capture schema is the thing that decides whether a mode can ever come
 * back from the model. The report found every capture classified
 * "operational"; the cause was these three fields missing from the strict
 * schema, so the model was forbidden from returning them. Guard that.
 */

const itemSchema = parseCaptureSchema.properties.items.items;

describe('parse_capture schema', () => {
  it('requires the fields the interpretation panel reads back', () => {
    for (const field of ['mode', 'client_title', 'confidence']) {
      expect(itemSchema.required, `missing ${field}`).toContain(field);
    }
  });

  it('constrains mode to the four real modes', () => {
    expect(itemSchema.properties.mode).toMatchObject({
      enum: ['creative', 'technical', 'analytical', 'operational'],
    });
  });

  it('keeps every required field also declared as a property (strict mode needs both)', () => {
    for (const field of itemSchema.required) {
      expect(itemSchema.properties, `${field} required but not a property`).toHaveProperty(field);
    }
  });
});

describe('capture fallback', () => {
  const clients = [{ id: 'c1', name: 'ibBan' }, { id: 'c2', name: 'Don Cabello' }];

  it('returns one operational item and never sets priority (INV-1)', () => {
    const { items } = fallbackParse('do the ibBan thing', clients);
    expect(items).toHaveLength(1);
    expect(items[0].priority).toBeNull();
    expect(items[0].mode).toBe('operational');
  });

  it('matches a named client without inventing one', () => {
    const { items } = fallbackParse('update ibBan shipping', clients);
    expect(items[0].clientId).toBe('c1');
    const { items: none } = fallbackParse('generic task', clients);
    expect(none[0].clientId).toBeNull();
  });
});
