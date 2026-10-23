'use client';

import { useEffect, useId, useReducer, useRef, useState, type PointerEvent } from 'react';
import { PaintToolbar, PaintStatusbar, type PaintZoom } from './paint-controls';
import { useTranslation } from '../language-provider';
import {
  emptyPaint,
  paintReducer,
  paintPoint,
  PAINT_WIDTH,
  PAINT_HEIGHT,
  MAX_PAINT_STROKES,
  MAX_STROKE_POINTS,
  type PaintStroke,
} from '@/lib/paint';
import { paintSegment, renderPainting } from './paint-canvas';

export function PaintApp({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const noteId = useId();
  const [state, dispatch] = useReducer(paintReducer, undefined, emptyPaint);
  const [tool, setTool] = useState<PaintStroke['tool']>('pencil');
  const [color, setColor] = useState('#1c1b1a');
  const [size, setSize] = useState(6);
  const [zoom, setZoom] = useState<PaintZoom>('fit');
  const [grid, setGrid] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [message, setMessage] = useState('');
  const base = useRef<HTMLCanvasElement>(null);
  const ink = useRef<HTMLCanvasElement>(null);
  const pending = useRef<{ pointerId: number; stroke: PaintStroke } | null>(null);

  useEffect(() => {
    if (base.current) renderPainting(base.current, state.strokes);
    if (ink.current) renderPainting(ink.current, [], false);
  }, [state.strokes]);

  function finishStroke() {
    const stroke = pending.current?.stroke;
    pending.current = null;
    if (stroke) dispatch({ type: 'stroke', stroke });
    setDrawing(false);
  }

  // Losing the window or browser focus commits the drawn part; no stuck brush on return.
  useEffect(() => {
    const finish = () => {
      const stroke = pending.current?.stroke;
      if (!stroke) return;
      pending.current = null;
      dispatch({ type: 'stroke', stroke });
      setDrawing(false);
    };
    if (!active) finish();
    window.addEventListener('blur', finish);
    return () => window.removeEventListener('blur', finish);
  }, [active]);

  function startStroke(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || !event.isPrimary || pending.current) return;
    if (state.strokes.length >= MAX_PAINT_STROKES) {
      setMessage('Canvas is full. Download your drawing, then clear it to start again.');
      return;
    }
    const canvas = event.currentTarget;
    const context = canvas.getContext('2d');
    if (!context) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    const point = paintPoint(event.clientX, event.clientY, canvas.getBoundingClientRect());
    const stroke: PaintStroke = { id: crypto.randomUUID(), tool, color, size, points: [point] };
    pending.current = { pointerId: event.pointerId, stroke };
    setMessage('');
    setDrawing(true);
    paintSegment(context, stroke, point);
  }

  function continueStroke(event: PointerEvent<HTMLCanvasElement>) {
    const current = pending.current;
    const context = event.currentTarget.getContext('2d');
    if (!current || current.pointerId !== event.pointerId || !context) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const samples = event.nativeEvent.getCoalescedEvents?.();
    for (const sample of samples?.length ? samples : [event.nativeEvent]) {
      if (current.stroke.points.length >= MAX_STROKE_POINTS) {
        setMessage('Lift your brush to continue this long stroke.');
        break;
      }
      const point = paintPoint(sample.clientX, sample.clientY, bounds);
      const previous = current.stroke.points.at(-1)!;
      if (Math.hypot(point.x - previous.x, point.y - previous.y) < 0.5) continue;
      current.stroke.points.push(point);
      // Draw only the new segment. Completed strokes are repainted on undo/redo.
      paintSegment(context, current.stroke, previous, point);
    }
  }

  async function download() {
    const canvas = document.createElement('canvas');
    canvas.width = PAINT_WIDTH;
    canvas.height = PAINT_HEIGHT;
    renderPainting(canvas, state.strokes);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      setMessage('Could not download your drawing. Try again.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'wya-paint.png';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="paint-app">
      <p id={noteId} className="sr-only">
        {t('Just for this visit. Download your drawing to keep it.')}
      </p>
      <PaintToolbar
        tool={tool}
        color={color}
        size={size}
        grid={grid}
        drawing={drawing}
        hasDrawing={!!state.strokes.length}
        onTool={setTool}
        onColor={(value) => {
          setColor(value);
          setTool('pencil');
        }}
        onSize={setSize}
        onGrid={setGrid}
        onClear={() => {
          dispatch({ type: 'clear' });
          setMessage('');
        }}
        onDownload={() => void download()}
      />
      <div className="paint-viewport">
        <div
          className={`paint-paper${grid ? ' has-grid' : ''}`}
          style={{ width: zoom === 'fit' ? undefined : (PAINT_WIDTH * zoom) / 100 }}
        >
          <canvas ref={base} width={PAINT_WIDTH * 2} height={PAINT_HEIGHT * 2} aria-hidden="true" />
          <canvas
            ref={ink}
            width={PAINT_WIDTH * 2}
            height={PAINT_HEIGHT * 2}
            tabIndex={0}
            role="img"
            aria-label={t('Drawing canvas. Draw with a mouse, touch, or pen.')}
            aria-describedby={noteId}
            onPointerDown={startStroke}
            onPointerMove={continueStroke}
            onPointerUp={(e) => {
              if (pending.current?.pointerId === e.pointerId) {
                continueStroke(e);
                finishStroke();
              }
            }}
            onPointerCancel={(e) => {
              if (pending.current?.pointerId === e.pointerId) finishStroke();
            }}
            onLostPointerCapture={(e) => {
              if (pending.current?.pointerId === e.pointerId) finishStroke();
            }}
            onKeyDown={(e) => {
              if (drawing || !(e.metaKey || e.ctrlKey) || !['z', 'y'].includes(e.key.toLowerCase()))
                return;
              e.preventDefault();
              dispatch({ type: e.shiftKey || e.key.toLowerCase() === 'y' ? 'redo' : 'undo' });
              setMessage('');
            }}
          />
        </div>
      </div>
      <PaintStatusbar
        zoom={zoom}
        drawing={drawing}
        canUndo={!!state.past.length}
        canRedo={!!state.future.length}
        onZoom={setZoom}
        onUndo={() => {
          dispatch({ type: 'undo' });
          setMessage('');
        }}
        onRedo={() => {
          dispatch({ type: 'redo' });
          setMessage('');
        }}
      />
      <span className="paint-status" role="status">
        {t(message)}
      </span>
    </div>
  );
}
