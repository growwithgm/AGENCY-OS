import { describe, expect, it } from 'vitest';
import { AI_JOBS } from './jobs.config';

describe('AI job config', () => {
  it('never uses max effort — no job in this system justifies the cost', () => {
    for (const [name, cfg] of Object.entries(AI_JOBS)) {
      expect(cfg.effort, name).not.toBe('max');
    }
  });

  it('sets effort explicitly on every k3 job — the provider default is max', () => {
    for (const [name, cfg] of Object.entries(AI_JOBS)) {
      if (cfg.model === 'kimi-k3') expect(cfg.effort, name).toBeDefined();
    }
  });

  it('caps tokens on every job — the provider default is 131,072', () => {
    for (const [name, cfg] of Object.entries(AI_JOBS)) {
      expect(cfg.maxTokens, name).toBeGreaterThan(0);
      expect(cfg.maxTokens, name).toBeLessThanOrEqual(4000);
    }
  });

  it('does not pass a reasoning effort to the non-reasoning tier', () => {
    for (const [name, cfg] of Object.entries(AI_JOBS)) {
      if (cfg.model === 'kimi-k2.5') expect(cfg.effort, name).toBeUndefined();
    }
  });
});
