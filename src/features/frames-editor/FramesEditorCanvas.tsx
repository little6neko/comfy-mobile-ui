import { useCallback, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  calculateContainRect,
  mapDisplayPointToImage,
  normalizeFramesEditorBox,
  type FramesEditorAnnotations,
  type FramesEditorPoint,
  type FramesEditorSize,
} from './model';

export type FramesEditorTool = 'positive' | 'negative' | 'box';

interface FramesEditorCanvasProps {
  imageUrl: string;
  annotations: FramesEditorAnnotations;
  tool: FramesEditorTool;
  disabled?: boolean;
  ariaLabel: string;
  onAddPoint: (kind: 'positive' | 'negative', point: FramesEditorPoint) => void;
  onAddBox: (box: ReturnType<typeof normalizeFramesEditorBox>) => void;
  onImageError?: () => void;
}

interface LoadedImage {
  url: string;
  size: FramesEditorSize;
}

interface BoxDrag {
  pointerId: number;
  startImage: FramesEditorPoint;
  currentImage: FramesEditorPoint;
}

const BOX_DRAG_THRESHOLD_CSS_PX = 6;

export const FramesEditorCanvas = ({
  imageUrl,
  annotations,
  tool,
  disabled = false,
  ariaLabel,
  onAddPoint,
  onAddBox,
  onImageError,
}: FramesEditorCanvasProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState<FramesEditorSize>({ width: 0, height: 0 });
  const [loadedImage, setLoadedImage] = useState<LoadedImage | null>(null);
  const [boxDrag, setBoxDrag] = useState<BoxDrag | null>(null);

  const imageSize = loadedImage?.url === imageUrl ? loadedImage.size : null;
  const displayRect = useMemo(() => (
    imageSize ? calculateContainRect(containerSize, imageSize) : null
  ), [containerSize, imageSize]);

  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const handleContainerRef = useCallback((element: HTMLDivElement | null) => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    containerRef.current = element;
    if (!element) return;
    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };
    updateSize();
    resizeObserverRef.current = new ResizeObserver(updateSize);
    resizeObserverRef.current.observe(element);
  }, []);

  const getDisplayPoint = (event: ReactPointerEvent): FramesEditorPoint | null => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || !displayRect || !imageSize) return;
    const displayPoint = getDisplayPoint(event);
    if (!displayPoint) return;
    const imagePoint = mapDisplayPointToImage(displayPoint, displayRect, imageSize);
    if (!imagePoint) return;

    if (tool === 'box') {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setBoxDrag({
        pointerId: event.pointerId,
        startImage: imagePoint,
        currentImage: imagePoint,
      });
      return;
    }

    let kind: 'positive' | 'negative';
    if (event.button === 2) kind = 'negative';
    else if (event.button === 0) kind = tool;
    else return;

    event.preventDefault();
    onAddPoint(kind, imagePoint);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!boxDrag || boxDrag.pointerId !== event.pointerId || !displayRect || !imageSize) return;
    const displayPoint = getDisplayPoint(event);
    if (!displayPoint) return;
    const imagePoint = mapDisplayPointToImage(displayPoint, displayRect, imageSize, true);
    if (!imagePoint) return;
    event.preventDefault();
    setBoxDrag(current => current && current.pointerId === event.pointerId
      ? { ...current, currentImage: imagePoint }
      : current);
  };

  const finishBoxDrag = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    if (!boxDrag || boxDrag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    let completedDrag = boxDrag;
    const endDisplayPoint = getDisplayPoint(event);
    if (!cancelled && endDisplayPoint && displayRect && imageSize) {
      const endImagePoint = mapDisplayPointToImage(
        endDisplayPoint,
        displayRect,
        imageSize,
        true,
      );
      if (endImagePoint) completedDrag = { ...completedDrag, currentImage: endImagePoint };
    }
    setBoxDrag(null);
    if (cancelled) return;

    const width = Math.abs(completedDrag.currentImage.x - completedDrag.startImage.x)
      * (displayRect?.scale ?? 0);
    const height = Math.abs(completedDrag.currentImage.y - completedDrag.startImage.y)
      * (displayRect?.scale ?? 0);
    if (width < BOX_DRAG_THRESHOLD_CSS_PX || height < BOX_DRAG_THRESHOLD_CSS_PX) return;
    onAddBox(normalizeFramesEditorBox(completedDrag.startImage, completedDrag.currentImage));
  };

  const dragBox = boxDrag
    ? normalizeFramesEditorBox(boxDrag.startImage, boxDrag.currentImage)
    : null;
  const scale = Math.max(displayRect?.scale ?? 1, 0.0001);
  const pointRadius = 7 / scale;
  const strokeWidth = 2 / scale;

  return (
    <div
      ref={handleContainerRef}
      className={`relative h-full w-full overflow-hidden bg-black select-none ${disabled ? 'cursor-default' : 'cursor-crosshair'}`}
      style={{ touchAction: 'none', WebkitTouchCallout: 'none' }}
      role="application"
      aria-label={ariaLabel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={event => finishBoxDrag(event)}
      onPointerCancel={event => finishBoxDrag(event, true)}
      onContextMenu={event => event.preventDefault()}
    >
      <img
        src={imageUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full object-contain"
        onLoad={(event) => {
          setLoadedImage({
            url: imageUrl,
            size: {
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            },
          });
        }}
        onError={onImageError}
      />

      {displayRect && imageSize && (
        <svg
          className="pointer-events-none absolute overflow-hidden"
          style={{
            left: displayRect.x,
            top: displayRect.y,
            width: displayRect.width,
            height: displayRect.height,
          }}
          viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
          aria-hidden="true"
        >
          {annotations.bbox.map((box, index) => (
            <rect
              key={`box-${index}`}
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              fill="rgba(56, 189, 248, 0.12)"
              stroke="#38bdf8"
              strokeWidth={strokeWidth}
            />
          ))}

          {dragBox && (
            <rect
              x={dragBox.x}
              y={dragBox.y}
              width={dragBox.w}
              height={dragBox.h}
              fill="rgba(250, 204, 21, 0.14)"
              stroke="#facc15"
              strokeWidth={strokeWidth}
              strokeDasharray={`${6 / scale} ${4 / scale}`}
            />
          )}

          {annotations.positive_coords.map((point, index) => (
            <g key={`positive-${index}`}>
              <circle
                cx={point.x}
                cy={point.y}
                r={pointRadius}
                fill="#22c55e"
                stroke="white"
                strokeWidth={strokeWidth}
              />
              <path
                d={`M ${point.x - pointRadius * 0.45} ${point.y} H ${point.x + pointRadius * 0.45} M ${point.x} ${point.y - pointRadius * 0.45} V ${point.y + pointRadius * 0.45}`}
                stroke="white"
                strokeWidth={strokeWidth * 0.8}
                strokeLinecap="round"
              />
            </g>
          ))}

          {annotations.negative_coords.map((point, index) => (
            <g key={`negative-${index}`}>
              <circle
                cx={point.x}
                cy={point.y}
                r={pointRadius}
                fill="#ef4444"
                stroke="white"
                strokeWidth={strokeWidth}
              />
              <path
                d={`M ${point.x - pointRadius * 0.4} ${point.y - pointRadius * 0.4} L ${point.x + pointRadius * 0.4} ${point.y + pointRadius * 0.4} M ${point.x + pointRadius * 0.4} ${point.y - pointRadius * 0.4} L ${point.x - pointRadius * 0.4} ${point.y + pointRadius * 0.4}`}
                stroke="white"
                strokeWidth={strokeWidth * 0.8}
                strokeLinecap="round"
              />
            </g>
          ))}
        </svg>
      )}
    </div>
  );
};
