'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/ssr/ArrowCounterClockwise';
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowUpRight';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/ssr/PencilSimple';
import { normalizeP5Embed, p5EditorProject, p5EmbedUrl, type P5Embed } from '@/lib/p5';
import { useTranslation } from './language-provider';

function Sketch({ sketch, onEdit }: { sketch: P5Embed; onEdit?: (anchor: HTMLElement) => void }) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [nativeNavigation, setNativeNavigation] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const keyboardEntry = useRef(false);
  const author = p5EditorProject(sketch.url)?.username;

  useEffect(() => {
    let pending = 0;
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Tab') keyboardEntry.current = true;
    }
    function pointerdown() {
      keyboardEntry.current = false;
    }
    function blur() {
      // Focus inside a cross-origin document does not match iframe:focus-visible.
      // Only inspect our own active element; never read the hosted document.
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        if (document.activeElement === frame.current) {
          setNativeNavigation(keyboardEntry.current);
        }
      });
    }
    function focusin(event: FocusEvent) {
      if (event.target !== frame.current) setNativeNavigation(false);
    }
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('pointerdown', pointerdown, true);
    document.addEventListener('focusin', focusin);
    window.addEventListener('blur', blur);
    return () => {
      cancelAnimationFrame(pending);
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('pointerdown', pointerdown, true);
      document.removeEventListener('focusin', focusin);
      window.removeEventListener('blur', blur);
    };
  }, []);

  function reload() {
    setLoaded(false);
    setError(false);
    setNativeNavigation(false);
    setAttempt((value) => value + 1);
  }
  return (
    <figure className="p5-embed" data-native-navigation={nativeNavigation || undefined}>
      <figcaption className="p5-embed-controls">
        <div className="p5-embed-heading">
          <span className="p5-embed-title" title={sketch.title}>
            {sketch.title}
          </span>
          <span className="p5-embed-attribution" title={author}>
            p5.js{author && ` · ${author}`}
          </span>
        </div>
        <div className="p5-embed-actions">
          <button
            type="button"
            onClick={reload}
            aria-label={t('Reload sketch')}
            title={t('Reload sketch')}
          >
            <ArrowCounterClockwiseIcon size={18} />
          </button>
          {onEdit && (
            <button
              type="button"
              onClick={(event) => onEdit(event.currentTarget)}
              aria-label={t('Edit sketch')}
              title={t('Edit sketch')}
            >
              <PencilSimpleIcon size={18} />
            </button>
          )}
          <a
            href={sketch.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            aria-label={t('Open original sketch')}
            title={t('Open original sketch')}
          >
            <ArrowUpRightIcon size={18} />
          </a>
        </div>
      </figcaption>
      <div className="p5-embed-stage" aria-busy={!loaded && !error}>
        <iframe
          key={attempt}
          ref={frame}
          className="p5-embed-frame"
          src={p5EmbedUrl(sketch.url)}
          title={sketch.title}
          loading="lazy"
          // The fixed p5 origin needs its own origin for assets and libraries.
          // It is cross-origin from Wya; popups and top navigation stay blocked.
          sandbox="allow-scripts allow-same-origin allow-pointer-lock"
          allow="fullscreen"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          onPointerEnter={() => {
            keyboardEntry.current = false;
          }}
        />
        {(!loaded || error) && (
          <div className="p5-embed-status" role="status">
            {error ? (
              <>
                <span>{t('Could not load this sketch.')}</span>
                <button type="button" onClick={reload}>
                  {t('Try again')}
                </button>
              </>
            ) : (
              <span>{t('Loading sketch…')}</span>
            )}
          </div>
        )}
      </div>
    </figure>
  );
}

export function P5EmbedView({
  sketch,
  onEdit,
}: {
  sketch: P5Embed;
  onEdit?: (anchor: HTMLElement) => void;
}) {
  const validated = normalizeP5Embed(sketch);
  return validated ? <Sketch key={validated.url} sketch={validated} onEdit={onEdit} /> : null;
}
