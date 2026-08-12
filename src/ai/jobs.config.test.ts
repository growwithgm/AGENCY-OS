import { describe, expect, it } from 'vitest';
import { AI_JOBS } from './jobs.config';

describe('AI job configuration', () => {
  it('never uses max effort — no job here justifies the cost', () => {
    for (const [name, cfg] of Object.entries(AI_JOBS)) {
      expect(cfg.effort, name).not.toBe('max');
    }
  });

  it('sets effort explicitly on every reasoning-tier job', () => {
    for (const [name, cfg] of Object.entries(AI_JOBS)) {
      if (cfg.model === 'kimi-k3') expect(cfg.effort, name).toBeDefined();
    }
  });

  it('caps output on every job — the provider default is 131,072', () => {
    for (const [name, cfg] of Object.entries(AI_JOBS)) {
      expect(cfg.maxTokens, name).toBeGreaterThan(0);
      expect(cfg.maxTokens, name).toBeLessThanOrEqual(2000);
    }
  });

  it('does not send a reasoning effort to the non-reasoning tier', () => {
    for (const [name, cfg] of Object.entries(AI_JOBS)) {
      if (cfg.model === 'kimi-k2.5') expect(cfg.effort, name).toBeUndefined();
    }
  });
});
