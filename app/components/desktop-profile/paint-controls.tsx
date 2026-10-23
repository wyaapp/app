'use client';

import { DropdownMenu } from 'radix-ui';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { CaretDownIcon } from '@phosphor-icons/react/dist/ssr/CaretDown';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/ssr/DownloadSimple';
import { EraserIcon } from '@phosphor-icons/react/dist/ssr/Eraser';
import { FilePlusIcon } from '@phosphor-icons/react/dist/ssr/FilePlus';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/ssr/SquaresFour';
import { DotsThreeIcon } from '@phosphor-icons/react/dist/ssr/DotsThree';
import { PaletteIcon } from '@phosphor-icons/react/dist/ssr/Palette';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/ssr/PencilSimple';
import { ArrowUUpRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowUUpRight';
import { ArrowUUpLeftIcon } from '@phosphor-icons/react/dist/ssr/ArrowUUpLeft';
import { useTranslation } from '../language-provider';
import type { PaintStroke } from '@/lib/paint';

const colors = [
  { value: '#1c1b1a', label: 'Black', light: true },
  { value: '#ffffff', label: 'White' },
  { value: '#ed5050', label: 'Red' },
  { value: '#ffe45e', label: 'Yellow' },
  { value: '#c9f779', label: 'Lime' },
  { value: '#6cdbd0', label: 'Turquoise' },
  { value: '#4f83ed', label: 'Blue' },
  { value: '#c3a6ff', label: 'Lilac' },
];

export type PaintZoom = 'fit' | 100 | 150 | 200;

export function PaintToolbar({
  tool,
  color,
  size,
  grid,
  drawing,
  hasDrawing,
  onTool,
  onColor,
  onSize,
  onGrid,
  onClear,
  onDownload,
}: {
  tool: PaintStroke['tool'];
  color: string;
  size: number;
  grid: boolean;
  drawing: boolean;
  hasDrawing: boolean;
  onTool: (tool: PaintStroke['tool']) => void;
  onColor: (color: string) => void;
  onSize: (size: number) => void;
  onGrid: (grid: boolean) => void;
  onClear: () => void;
  onDownload: () => void;
}) {
  const { t } = useTranslation();
  const customColor = !colors.some((choice) => choice.value === color);
  return (
    <div className="paint-toolbar">
      <div className="paint-tools" role="group" aria-label={t('Drawing tools')}>
        <button
          type="button"
          className="paint-control"
          aria-label={t('Pencil')}
          title={t('Pencil')}
          aria-pressed={tool === 'pencil'}
          disabled={drawing}
          onClick={() => onTool('pencil')}
        >
          <PencilSimpleIcon weight="regular" aria-hidden="true" size={20} />
        </button>
        <button
          type="button"
          className="paint-control"
          aria-label={t('Eraser')}
          title={t('Eraser')}
          aria-pressed={tool === 'eraser'}
          disabled={drawing}
          onClick={() => onTool('eraser')}
        >
          <EraserIcon weight="regular" aria-hidden="true" size={20} />
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            className="paint-control paint-size"
            disabled={drawing}
            aria-label={t('{size} pixel brush', { size })}
            title={t('Brush size')}
          >
            <span
              className="paint-size-dot"
              aria-hidden="true"
              style={{ width: Math.max(3, size / 2), height: Math.max(3, size / 2) }}
            />
            <span>{size}</span>
            <CaretDownIcon weight="regular" aria-hidden="true" size={12} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="paint-menu"
              align="start"
              sideOffset={8}
              collisionPadding={8}
            >
              <DropdownMenu.Label className="paint-menu-label">
                {t('Brush size')}
              </DropdownMenu.Label>
              <DropdownMenu.RadioGroup
                value={String(size)}
                onValueChange={(value) => onSize(Number(value))}
              >
                {[2, 6, 14, 28].map((value) => (
                  <DropdownMenu.RadioItem value={String(value)} key={value}>
                    <span
                      className="paint-brush-sample"
                      aria-hidden="true"
                      style={{ height: Math.max(1, value / 2) }}
                    />
                    {value} px
                    <DropdownMenu.ItemIndicator className="paint-menu-check">
                      <CheckIcon weight="regular" aria-hidden="true" size={16} />
                    </DropdownMenu.ItemIndicator>
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <div className="paint-colors" role="group" aria-label={t('Paint colors')}>
        <div className="paint-palette">
          {colors.map((choice) => (
            <button
              type="button"
              key={choice.value}
              aria-label={t(choice.label)}
              title={t(choice.label)}
              aria-pressed={color === choice.value && tool === 'pencil'}
              disabled={drawing}
              onClick={() => onColor(choice.value)}
            >
              <span
                style={{ background: choice.value, color: choice.light ? '#ffffff' : '#1c1b1a' }}
              >
                {color === choice.value && tool === 'pencil' && (
                  <CheckIcon weight="regular" aria-hidden="true" size={14} />
                )}
              </span>
            </button>
          ))}
        </div>
        <label
          className={`paint-custom-color${customColor && tool === 'pencil' ? ' is-selected' : ''}`}
          title={t('Edit colors')}
        >
          {customColor ? (
            <span
              className="paint-custom-swatch"
              style={{ background: color }}
              aria-hidden="true"
            />
          ) : (
            <PaletteIcon weight="regular" size={20} aria-hidden="true" />
          )}
          <input
            type="color"
            value={color}
            aria-label={t('Edit colors')}
            disabled={drawing}
            onInput={(e) => onColor(e.currentTarget.value)}
          />
        </label>
      </div>
      <div className="paint-actions">
        <button
          type="button"
          className="paint-download"
          aria-label={t('Download PNG')}
          title={t('Download PNG')}
          disabled={drawing || !hasDrawing}
          onClick={onDownload}
        >
          <DownloadSimpleIcon weight="regular" aria-hidden="true" size={18} />
          <span>{t('Download PNG')}</span>
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            className="paint-control"
            disabled={drawing}
            aria-label={t('Paint options')}
            title={t('Paint options')}
          >
            <DotsThreeIcon weight="regular" aria-hidden="true" size={20} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="paint-menu"
              align="end"
              sideOffset={8}
              collisionPadding={8}
            >
              <DropdownMenu.CheckboxItem checked={grid} onCheckedChange={onGrid}>
                <SquaresFourIcon weight="regular" aria-hidden="true" size={18} />
                {t('Gridlines')}
                <DropdownMenu.ItemIndicator className="paint-menu-check">
                  <CheckIcon weight="regular" aria-hidden="true" size={16} />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.CheckboxItem>
              <DropdownMenu.Separator />
              <DropdownMenu.Item disabled={!hasDrawing} onSelect={onClear}>
                <FilePlusIcon weight="regular" aria-hidden="true" size={18} />
                {t('New drawing')}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}

export function PaintStatusbar({
  zoom,
  drawing,
  canUndo,
  canRedo,
  onZoom,
  onUndo,
  onRedo,
}: {
  zoom: PaintZoom;
  drawing: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onZoom: (zoom: PaintZoom) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="paint-statusbar">
      <div className="paint-history" role="group" aria-label={t('Drawing actions')}>
        <button
          type="button"
          className="paint-control"
          aria-label={t('Undo')}
          title={t('Undo')}
          disabled={drawing || !canUndo}
          onClick={onUndo}
        >
          <ArrowUUpLeftIcon weight="regular" aria-hidden="true" size={18} />
        </button>
        <button
          type="button"
          className="paint-control"
          aria-label={t('Redo')}
          title={t('Redo')}
          disabled={drawing || !canRedo}
          onClick={onRedo}
        >
          <ArrowUUpRightIcon weight="regular" aria-hidden="true" size={18} />
        </button>
      </div>
      <span
        className="paint-session-note"
        title={t('Just for this visit. Download your drawing to keep it.')}
      >
        {t('Temporary drawing')}
      </span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          className="paint-control paint-zoom"
          disabled={drawing}
          aria-label={t('Zoom')}
          title={t('Zoom')}
        >
          {zoom === 'fit' ? t('Fit') : `${zoom}%`}
          <CaretDownIcon weight="regular" aria-hidden="true" size={12} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="paint-menu"
            align="end"
            side="top"
            sideOffset={8}
            collisionPadding={8}
          >
            <DropdownMenu.Label className="paint-menu-label">{t('Zoom')}</DropdownMenu.Label>
            <DropdownMenu.RadioGroup
              value={String(zoom)}
              onValueChange={(value) =>
                onZoom(value === 'fit' ? 'fit' : (Number(value) as PaintZoom))
              }
            >
              {(['fit', 100, 150, 200] as const).map((value) => (
                <DropdownMenu.RadioItem value={String(value)} key={value}>
                  {value === 'fit' ? t('Fit') : `${value}%`}
                  <DropdownMenu.ItemIndicator className="paint-menu-check">
                    <CheckIcon weight="regular" aria-hidden="true" size={16} />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
