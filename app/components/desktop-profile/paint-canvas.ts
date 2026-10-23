import { PAINT_WIDTH, PAINT_HEIGHT, type PaintPoint, type PaintStroke } from '@/lib/paint';

export function paintSegment(
  context: CanvasRenderingContext2D,
  stroke: PaintStroke,
  from: PaintPoint,
  to = from,
) {
  context.fillStyle = context.strokeStyle = stroke.tool === 'eraser' ? '#ffffff' : stroke.color;
  context.lineWidth = stroke.size;
  context.lineCap = context.lineJoin = 'round';
  context.beginPath();
  if (from.x === to.x && from.y === to.y) {
    context.arc(to.x, to.y, stroke.size / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }
}

export function renderPainting(
  canvas: HTMLCanvasElement,
  strokes: PaintStroke[],
  background = true,
) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(canvas.width / PAINT_WIDTH, 0, 0, canvas.height / PAINT_HEIGHT, 0, 0);
  context.clearRect(0, 0, PAINT_WIDTH, PAINT_HEIGHT);
  if (background) {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, PAINT_WIDTH, PAINT_HEIGHT);
  }
  for (const stroke of strokes) {
    stroke.points.forEach((point, index) =>
      paintSegment(context, stroke, stroke.points[index - 1] ?? point, point),
    );
  }
}
