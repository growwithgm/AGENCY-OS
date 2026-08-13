import { describe, it, expect } from 'vitest';
import {
  DIRECT_TOOLS, CONFIRM_TOOLS, isDirect, isConfirm, callable,
  CONFIRM_LABELS, CONFIRM_REASONS,
} from './registry';
import { TOOL_SCHEMAS, toolDefinitions } from './tools';

/**
 * The security property of the assistant, asserted rather than assumed:
 * no CONFIRM action is reachable from model output.
 *
 * These tests are the reason the separation is structural. If someone
 * later adds a fenced action to the executable list, this fails loudly
 * instead of quietly handing the model a way to promise a date.
 */

describe('the fence between DIRECT and CONFIRM', () => {
  it('shares no name between the two lists', () => {
    const overlap = DIRECT_TOOLS.filter((name) => (CONFIRM_TOOLS as readonly string[]).includes(name));
    expect(overlap).toEqual([]);
  });

  it('never offers a CONFIRM tool to the model', () => {
    const offered = new Set(toolDefinitions().map((t) => t.function.name));
    for (const fenced of CONFIRM_TOOLS) {
      expect(offered.has(fenced)).toBe(false);
    }
  });

  it('refuses to execute a CONFIRM name however it arrives', () => {
    for (const fenced of CONFIRM_TOOLS) {
      expect(callable(fenced)).toBe(false);
      expect(isDirect(fenced)).toBe(false);
      expect(isConfirm(fenced)).toBe(true);
    }
  });

  it('refuses a name it has never heard of rather than guessing', () => {
    expect(callable('set_priority_but_sneakier')).toBe(false);
    expect(callable('')).toBe(false);
    expect(callable('__proto__')).toBe(false);
  });

  it('fences every action that reaches a client or sets priority', () => {
    const mustBeFenced = [
      'set_priority', 'change_priority',
      'set_committed_date', 'change_committed_date',
      'approve_request', 'decline_request', 'publish_report',
      'archive_client', 'revoke_portal_access',
      'delete_task', 'cancel_task', 'change_zone_rules',
    ];
    for (const name of mustBeFenced) expect(isConfirm(name)).toBe(true);
  });

  it('can explain every refusal in the operator’s own terms', () => {
    for (const fenced of CONFIRM_TOOLS) {
      expect(CONFIRM_LABELS[fenced]).toBeTruthy();
      expect(CONFIRM_REASONS[fenced]).toBeTruthy();
      expect(CONFIRM_REASONS[fenced].length).toBeGreaterThan(20);
    }
  });
});

describe('the executable tool list', () => {
  it('describes every tool it offers', () => {
    for (const tool of toolDefinitions()) {
      expect(tool.function.description.length).toBeGreaterThan(10);
      expect(tool.function.parameters).toBeTruthy();
    }
  });

  it('only offers tools that are actually implemented', () => {
    const offered = toolDefinitions().map((t) => t.function.name);
    for (const name of offered) {
      expect(isDirect(name)).toBe(true);
      expect(TOOL_SCHEMAS[name]).toBeTruthy();
    }
  });

  it('offers the deterministic scheduling questions', () => {
    const offered = new Set(toolDefinitions().map((t) => t.function.name));
    for (const name of ['can_i_do_this_now', 'when_can_i_do', 'propose_placement', 'what_if']) {
      expect(offered.has(name)).toBe(true);
    }
  });
});
