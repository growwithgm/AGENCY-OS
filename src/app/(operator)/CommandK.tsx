'use client';

/**
 * ⌘K — the assistant, from wherever you happen to be.
 *
 * The same chat surface as the assistant screen, in a compact panel, so
 * there is one place the assistant lives and one set of rules it follows.
 * The shortcut is never taken while the operator is typing: a person mid
 * sentence in a title field means the letter K, not a command.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Chat } from './assistant/Chat';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function CommandK({ transcription = false }: { transcription?: boolean }) {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);

  useEffect(() => { openRef.current = open; }, [open]);

  const onKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape' && openRef.current) {
      setOpen(false);
      return;
    }

    const shortcut = (event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K');
    if (!shortcut) return;
    if (!openRef.current && isTyping(event.target)) return;

    event.preventDefault();
    setOpen((previous) => !previous);
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        background: 'rgba(16, 24, 32, .35)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '10vh 16px 16px',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Assistant"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 680,
          maxHeight: '80vh',
          overflowY: 'auto',
          background: '#fff',
          border: '1px solid var(--paper-300)',
          borderRadius: 10,
          padding: '16px 18px 18px',
          boxShadow: '0 24px 60px -20px rgba(16, 24, 32, .55)',
        }}
      >
        <div className="spread" style={{ marginBottom: 10 }}>
          <span className="eyebrow">Assistant</span>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>

        <Chat transcription={transcription} compact autoFocus />

        <p className="tiny dim" style={{ marginTop: 12 }}>
          Press Escape to close. Nothing that reaches a client happens here without your tap.
        </p>
      </div>
    </div>
  );
}
