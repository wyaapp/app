'use client';
import { useId, useRef, useState } from 'react';
import { AtSign, Plus, X } from 'lucide-react';
import { mentionPlatforms, mentionText, type MentionPlatform } from '@/lib/bio';
import { BioText } from '../components/bio-text';

export function BioEditor({
  initial = '',
  disabled = false,
}: {
  initial?: string;
  disabled?: boolean;
}) {
  const [bio, setBio] = useState(initial);
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<MentionPlatform>('wya');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const selection = useRef({ start: initial.length, end: initial.length });
  const id = useId();
  function insert() {
    try {
      const token = mentionText(platform, username);
      const before = bio.slice(0, selection.current.start),
        after = bio.slice(selection.current.end);
      const addition = `${before && !/\s$/.test(before) ? ' ' : ''}${token}${after && !/^\s/.test(after) ? ' ' : ''}`;
      const next = before + addition + after;
      if (next.length > 280)
        throw new Error('This mention would exceed the 280-character bio limit.');
      setBio(next);
      setOpen(false);
      setUsername('');
      setError('');
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.setSelectionRange(
          before.length + addition.length,
          before.length + addition.length,
        );
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Check the username.');
    }
  }
  return (
    <div className="bio-editor">
      <label htmlFor={`${id}-bio`}>Bio</label>
      <textarea
        id={`${id}-bio`}
        ref={input}
        name="bio"
        value={bio}
        onChange={(e) => {
          setBio(e.target.value);
          selection.current = {
            start: e.currentTarget.selectionStart,
            end: e.currentTarget.selectionEnd,
          };
        }}
        onSelect={(e) => {
          selection.current = {
            start: e.currentTarget.selectionStart,
            end: e.currentTarget.selectionEnd,
          };
        }}
        rows={4}
        maxLength={280}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
      />
      <div className="bio-editor-toolbar">
        <button
          type="button"
          className="button button-small button-light"
          disabled={disabled}
          aria-expanded={open}
          aria-controls={`${id}-mention`}
          onClick={() => {
            if (!open && input.current)
              selection.current = {
                start: input.current.selectionStart,
                end: input.current.selectionEnd,
              };
            setOpen(!open);
            setError('');
          }}
        >
          <AtSign size={15} />
          Insert mention
        </button>
        <span>{bio.length}/280</span>
      </div>
      <p id={`${id}-hint`} className="bio-hint">
        Use @handle for Wya, github:username for GitHub, or paste a full https:// link.
      </p>
      {open && (
        <fieldset id={`${id}-mention`} className="bio-mention-panel" disabled={disabled}>
          <legend>Insert a mention</legend>
          <div className="form-row">
            <label>
              Platform
              <select
                value={platform}
                onChange={(e) => {
                  setPlatform(e.target.value as MentionPlatform);
                  setError('');
                }}
              >
                {Object.entries(mentionPlatforms).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Username
              <input
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError('');
                }}
                placeholder={platform === 'bluesky' ? 'yourname.bsky.social' : 'yourname'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    insert();
                  }
                }}
              />
            </label>
          </div>
          {error && (
            <p className="bio-insert-error" role="alert">
              {error}
            </p>
          )}
          <div className="bio-mention-actions">
            <button
              type="button"
              className="button button-small"
              onClick={insert}
              disabled={!username.trim()}
            >
              <Plus size={15} />
              Insert
            </button>
            <button
              type="button"
              className="button button-small button-light"
              onClick={() => {
                setOpen(false);
                setError('');
              }}
            >
              <X size={15} />
              Cancel
            </button>
          </div>
        </fieldset>
      )}
      {!!bio && (
        <div className="bio-draft-preview">
          <span className="eyebrow">Bio preview</span>
          <p>
            <BioText text={bio} />
          </p>
        </div>
      )}
    </div>
  );
}
