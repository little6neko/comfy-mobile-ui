import { useCallback, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  calculateContainRect,
  mapDisplayPointToImage,
  normalizeFramesEditorBox,
  type FramesEditorAnnotations,
  type FramesEditorPoint,
  type FramesEditorRect,
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
const TAP_THRESHOLD_CSS_PX = 8;
const MAX_ZOOM = 6;

type CanvasView = { zoom: number; x: number; y: number };
const DEFAULT_VIEW: CanvasView = { zoom: 1, x: 0, y: 0 };

const getViewRect = (fit: FramesEditorRect, container: FramesEditorSize, view: CanvasView): FramesEditorRect => {
  if (view.zoom === 1) return fit;
  const width = fit.width * view.zoom;
  const height = fit.height * view.zoom;
  const position = (offset: number, viewport: number, size: number) => size <= viewport
    ? (viewport - size) / 2
    : Math.max(viewport - size, Math.min(0, offset));
  return {
    x: position(view.x, container.width, width),
    y: position(view.y, container.height, height),
    width,
    height,
    scale: fit.scale * view.zoom,
  };
};

const getPinch = (touches: Map<number, FramesEditorPoint>) => {
  const points = touches.values();
  const first = points.next().value;
  const second = points.next().value;
  if (!first || !second) return null;
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
    distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
  };
};

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
  const [view, setView] = useState(DEFAULT_VIEW);
  const [boxDrag, setBoxDrag] = useState<BoxDrag | null>(null);
  const boxDragRef = useRef<BoxDrag | null>(null);
  const touches = useRef(new Map<number, FramesEditorPoint>());
  const pinching = useRef(false);
  const pendingTap = useRef<{
    start: FramesEditorPoint;
    kind: 'positive' | 'negative';
  } | null>(null);

  const updateBoxDrag = (drag: BoxDrag | null) => {
    boxDragRef.current = drag;
    setBoxDrag(drag);
  };

  const imageSize = loadedImage?.url === imageUrl ? loadedImage.size : null;
  const fitRect = useMemo(() => (
    imageSize ? calculateContainRect(containerSize, imageSize) : null
  ), [containerSize, imageSize]);
  const displayRect = fitRect ? getViewRect(fitRect, containerSize, view) : null;

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

    if (event.pointerType === 'touch') {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      touches.current.set(event.pointerId, displayPoint);
      if (touches.current.size > 1 || pinching.current) {
        // Once a pinch starts, neither finger may finish an annotation.
        pinching.current = true;
        pendingTap.current = null;
        if (boxDragRef.current) updateBoxDrag(null);
        return;
      }
    } else if (touches.current.size > 0) {
      return;
    }

    const imagePoint = mapDisplayPointToImage(displayPoint, displayRect, imageSize);
    if (!imagePoint) return;

    if (tool === 'box') {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      updateBoxDrag({
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
    if (event.pointerType === 'touch') {
      pendingTap.current = { start: displayPoint, kind };
    } else {
      onAddPoint(kind, imagePoint);
    }
  };

  const isTapPosition = (point: FramesEditorPoint, start: FramesEditorPoint) => (
    Math.hypot(point.x - start.x, point.y - start.y) <= TAP_THRESHOLD_CSS_PX
  );

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const displayPoint = getDisplayPoint(event);
    if (!displayPoint) return;
    if (event.pointerType === 'touch') {
      if (!touches.current.has(event.pointerId)) return;
      const previous = getPinch(touches.current);
      touches.current.set(event.pointerId, displayPoint);
      if (pinching.current) {
        const next = getPinch(touches.current);
        if (fitRect && previous && next) {
          setView(current => {
            const zoom = Math.max(1, Math.min(MAX_ZOOM, current.zoom * next.distance / previous.distance));
            if (zoom === 1) return DEFAULT_VIEW;
            const rect = getViewRect(fitRect, containerSize, current);
            const ratio = zoom / current.zoom;
            // Keep the image point under the old midpoint at the new midpoint.
            return {
              zoom,
              x: next.x - (previous.x - rect.x) * ratio,
              y: next.y - (previous.y - rect.y) * ratio,
            };
          });
        }
        return;
      }
      if (pendingTap.current && !isTapPosition(displayPoint, pendingTap.current.start)) {
        pendingTap.current = null;
      }
    }

    const drag = boxDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !displayRect || !imageSize) return;
    const imagePoint = mapDisplayPointToImage(displayPoint, displayRect, imageSize, true);
    if (!imagePoint) return;
    event.preventDefault();
    updateBoxDrag({ ...drag, currentImage: imagePoint });
  };

  const finishBoxDrag = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = boxDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    updateBoxDrag(null);
    if (cancelled || disabled) return;
    let completedDrag = drag;
    const endDisplayPoint = getDisplayPoint(event);
    if (endDisplayPoint && displayRect && imageSize) {
      const endImagePoint = mapDisplayPointToImage(
        endDisplayPoint,
        displayRect,
        imageSize,
        true,
      );
      if (endImagePoint) completedDrag = { ...completedDrag, currentImage: endImagePoint };
    }
    const width = Math.abs(completedDrag.currentImage.x - completedDrag.startImage.x)
      * (displayRect?.scale ?? 0);
    const height = Math.abs(completedDrag.currentImage.y - completedDrag.startImage.y)
      * (displayRect?.scale ?? 0);
    if (width < BOX_DRAG_THRESHOLD_CSS_PX || height < BOX_DRAG_THRESHOLD_CSS_PX) return;
    onAddBox(normalizeFramesEditorBox(completedDrag.startImage, completedDrag.currentImage));
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    if (event.pointerType === 'touch') {
      if (!touches.current.delete(event.pointerId)) return;
      if (pinching.current) {
        if (touches.current.size === 0) pinching.current = false;
        return;
      }
      const tap = pendingTap.current;
      pendingTap.current = null;
      if (tap && !cancelled && !disabled && displayRect && imageSize) {
        const displayPoint = getDisplayPoint(event);
        if (displayPoint && isTapPosition(displayPoint, tap.start)) {
          const point = mapDisplayPointToImage(displayPoint, displayRect, imageSize);
          if (point) onAddPoint(tap.kind, point);
        }
      }
    }
    finishBoxDrag(event, cancelled);
  };

  const dragBox = boxDrag
    ? normalizeFramesEditorBox(boxDrag.startImage, boxDrag.currentImage)
    : null;
  const scale = Math.max(displayRect?.scale ?? 1, 0.0001);
  const pointRadius = 7 / scale;
  const strokeWidth = 2 / scale;
  const displayStyle = displayRect ? {
    left: displayRect.x,
    top: displayRect.y,
    width: displayRect.width,
    height: displayRect.height,
  } : undefined;

  return (
    <div
      ref={handleContainerRef}
      className={`relative h-full w-full overflow-hidden bg-black select-none ${disabled ? 'cursor-default' : 'cursor-crosshair'}`}
      style={{ touchAction: 'none', WebkitTouchCallout: 'none' }}
      role="application"
      aria-label={ariaLabel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={event => finishPointer(event)}
      onPointerCancel={event => finishPointer(event, true)}
      onLostPointerCapture={event => finishPointer(event, true)}
      onContextMenu={event => event.preventDefault()}
    >
      <img
        src={imageUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={`pointer-events-none absolute max-w-none ${displayStyle ? '' : 'inset-0 h-full w-full object-contain'}`}
        style={displayStyle}
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
          style={displayStyle}
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
