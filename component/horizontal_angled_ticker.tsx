import * as React from "react";
import {
  addPropertyControls,
  ControlType,
  motion,
  useAnimationFrame,
} from "framer";

type Props = {
  items: React.ReactNode[];
  direction: boolean;
  angle: number;
  gap: number;
  hoverGap: number;
  speed: number;
  width: number;
  height: number;
};

type Size = { width: number; height: number };

// Pre-computed constants
const DEG_TO_RAD = Math.PI / 180;
const MIN_COS_VALUE = 0.0001;
const MAX_DT_CLAMP = 0.1; // Increased for smoother high-speed animation
const CYCLES = 3;
const Z_INDEX_BASE = 10000;
const VIEWPORT_BUFFER = 2; // Render extra items outside viewport

const mod = (v: number, m: number) => ((v % m) + m) % m;
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

function useMeasure<T extends HTMLElement>(): [React.RefObject<T>, Size] {
  const ref = React.useRef<T>(null);
  const [size, set] = React.useState<Size>({ width: 0, height: 0 });
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect;
      set({ width: r.width, height: r.height });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

// Memoized slot component to prevent unnecessary re-renders
const Slot = React.memo(
  ({
    virtIndex,
    itemW,
    itemH,
    angle,
    push,
    zIndex,
    transform,
    onMouseEnter,
    onMouseLeave,
    children,
  }: {
    virtIndex: number;
    itemW: number;
    itemH: number;
    angle: number;
    push: number;
    zIndex: number;
    transform: string;
    onMouseEnter: (virtI: number) => void;
    onMouseLeave: () => void;
    children: React.ReactNode;
  }) => {
    const handleMouseEnter = React.useCallback(() => {
      onMouseEnter(virtIndex);
    }, [onMouseEnter, virtIndex]);

    return (
      <div
        data-slot={virtIndex}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={onMouseLeave}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          transform,
          zIndex,
          willChange: push !== 0 ? "transform" : "auto",
        }}
      >
        <motion.div
          animate={{ x: push }}
          transition={{
            type: "tween",
            ease: "easeInOut",
            duration: 0.18,
          }}
        >
          <div style={{ display: "inline-block" }}>{children}</div>
        </motion.div>
      </div>
    );
  }
);

function AngledTicker({
  items,
  direction,
  angle,
  gap,
  hoverGap,
  speed,
  width,
  height,
}: Props) {
  const dir = direction ? 1 : -1;
  const total = items.length;

  const [wrapRef, wrap] = useMeasure<HTMLDivElement>();
  const [probeRef, probe] = useMeasure<HTMLDivElement>();

  const [hoveredSlot, setHoveredSlot] = React.useState<number | null>(null);
  const [progress, setProgress] = React.useState(0);
  const isAnimatingRef = React.useRef(true);
  const lastFrameRef = React.useRef(0);

  // Batch all size calculations
  const sizes = React.useMemo(() => {
    const safeWrapW = wrap.width || width || 1;
    const safeWrapH = wrap.height || height || 1;
    const itemW = probe.width || 120;
    const itemH = probe.height || 180;
    return { safeWrapW, safeWrapH, itemW, itemH };
  }, [wrap.width, wrap.height, width, height, probe.width, probe.height]);

  // Batch all mathematical calculations
  const calculations = React.useMemo(() => {
    const theta = angle * DEG_TO_RAD;
    const cosT = Math.max(Math.abs(Math.cos(theta)), MIN_COS_VALUE);
    const step = (sizes.itemW + gap) / cosT;
    const hoverDeltaRail = (hoverGap - gap) / cosT;
    const loopSpan = Math.max(step * Math.max(total, 1), 1);
    const railW = loopSpan * CYCLES + sizes.safeWrapW + step * 2;
    const cx = railW / 2;
    const cy = Math.max(sizes.itemH / 2, 0.5);

    return {
      step,
      hoverDeltaRail,
      loopSpan,
      railW,
      cx,
      cy,
    };
  }, [angle, sizes.itemW, sizes.itemH, sizes.safeWrapW, gap, hoverGap, total]);

  // Optimized animation callback with pause on hover
  const animationCallback = React.useCallback(
    (time, dt) => {
      if (total === 0 || !isAnimatingRef.current) return;

      // Skip if tab is hidden
      if (document.hidden) {
        lastFrameRef.current = time;
        return;
      }

      // Handle resume after long pause more smoothly
      if (lastFrameRef.current && time - lastFrameRef.current > 200) {
        lastFrameRef.current = time;
        return;
      }

      // Use smoother delta time calculation for high speeds
      const dts = Math.min(dt / 1000, MAX_DT_CLAMP);
      const delta = dir * speed * dts;

      // Update progress with higher precision
      setProgress((p) => {
        const next = p + delta;
        // Wrap around more smoothly
        if (next < 0) return next + calculations.loopSpan;
        if (next >= calculations.loopSpan) return next - calculations.loopSpan;
        return next;
      });

      lastFrameRef.current = time;
    },
    [total, dir, speed, calculations.loopSpan]
  );

  useAnimationFrame(animationCallback);

  // Update animation state on hover
  React.useEffect(() => {
    isAnimatingRef.current = hoveredSlot === null;
  }, [hoveredSlot]);

  const slots = React.useMemo(() => {
    if (total === 0) return [];
    const len = total * CYCLES;
    const start = -total;
    return Array.from({ length: len }, (_, k) => start + k);
  }, [total]);

  const hoveredCenter = React.useMemo(
    () =>
      hoveredSlot != null
        ? hoveredSlot * calculations.step - progress + sizes.itemW / 2
        : null,
    [hoveredSlot, calculations.step, progress, sizes.itemW]
  );

  // Stable event handlers
  const handleMouseLeave = React.useCallback(() => setHoveredSlot(null), []);
  const handleMouseEnter = React.useCallback(
    (virtI: number) => setHoveredSlot(virtI),
    []
  );

  // Calculate visible slots for viewport culling
  const visibleSlots = React.useMemo(() => {
    // Very generous buffer to ensure no gaps ever appear
    // Keep rendering until the NEXT element is completely out of view
    const bufferItems = 5; // Render 5 extra items on each side
    const buffer = sizes.itemW * bufferItems + calculations.step;

    return slots.filter((virtI) => {
      const base = virtI * calculations.step - progress;

      // Calculate bounds with extra margin for the next element
      const itemLeft = base - calculations.step; // Include previous item space
      const itemRight = base + sizes.itemW + calculations.step; // Include next item space

      // Render if any part is within the very extended viewport
      return itemRight >= -buffer && itemLeft <= sizes.safeWrapW + buffer;
    });
  }, [slots, calculations.step, progress, sizes.itemW, sizes.safeWrapW]);

  // Pre-calculate static styles
  const staticStyles = React.useMemo(
    () => ({
      wrapper: {
        width: "100%",
        height: "100%",
        minWidth: width,
        minHeight: height,
        display: "block" as const,
        position: "relative" as const,
        overflow: "visible" as const,
      },
      probe: {
        position: "absolute" as const,
        left: 0,
        top: 0,
        opacity: 0,
        pointerEvents: "none" as const,
      },
      probeInner: {
        display: "inline-block" as const,
      },
      rail: {
        position: "absolute" as const,
        width: calculations.railW,
        height: Math.max(sizes.itemH, 1),
        transform: `rotate(${angle}deg)`,
        transformOrigin: "50% 50%",
        top: "50%",
        left: "50%",
        marginTop: -Math.max(sizes.itemH, 1) / 2,
        marginLeft: -calculations.railW / 2,
      },
    }),
    [width, height, calculations.railW, sizes.itemH, angle]
  );

  // Pre-calculate transforms for visible slots
  const slotData = React.useMemo(() => {
    return visibleSlots.map((virtI) => {
      const dataI = ((virtI % total) + total) % total;
      const base = virtI * calculations.step - progress;
      const center = base + sizes.itemW / 2;

      const push =
        hoveredCenter == null || virtI === hoveredSlot
          ? 0
          : (Math.sign(center - hoveredCenter) || 1) *
            calculations.hoverDeltaRail;

      // Use subpixel precision for smoother animation at high speeds
      const x = calculations.cx + center;
      const y = calculations.cy;
      const offsetX = -sizes.itemW / 2;
      const offsetY = -sizes.itemH / 2;

      const transform = `translate(${x}px, ${y}px) rotate(${-angle}deg) translate(${offsetX}px, ${offsetY}px)`;
      const zIndex = Z_INDEX_BASE - Math.round(center * 100);

      return {
        virtI,
        dataI,
        center,
        push,
        transform,
        zIndex,
      };
    });
  }, [
    visibleSlots,
    total,
    calculations,
    progress,
    sizes.itemW,
    sizes.itemH,
    hoveredCenter,
    hoveredSlot,
    angle,
  ]);

  return (
    <div ref={wrapRef} style={staticStyles.wrapper}>
      <div ref={probeRef} style={staticStyles.probe}>
        <div style={staticStyles.probeInner}>{items?.[0]}</div>
      </div>

      <div style={staticStyles.rail}>
        {slotData.map(({ virtI, dataI, push, transform, zIndex }) => (
          <Slot
            key={`slot-${virtI}`}
            virtIndex={virtI}
            itemW={sizes.itemW}
            itemH={sizes.itemH}
            angle={angle}
            push={push}
            zIndex={zIndex}
            transform={transform}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {items[dataI]}
          </Slot>
        ))}
      </div>
    </div>
  );
}

AngledTicker.defaultProps = {
  width: 800,
  height: 400,
  items: [],
  direction: true,
  angle: 0,
  gap: 20,
  hoverGap: 40,
  speed: 120,
};

addPropertyControls(AngledTicker, {
  items: {
    type: ControlType.Array,
    title: "Items",
    propertyControl: { type: ControlType.ComponentInstance },
  },
  direction: {
    type: ControlType.Boolean,
    title: "Direction",
    enabledTitle: "←",
    disabledTitle: "→",
  },
  angle: {
    type: ControlType.Number,
    title: "Angle°",
    min: -45,
    max: 45,
    // step: 1,
  },
  gap: {
    type: ControlType.Number,
    title: "Gap",
    min: -400,
    max: 400,
    step: 1,
  },
  hoverGap: {
    type: ControlType.Number,
    title: "Hover-Gap",
    min: 0,
    max: 400,
    step: 10,
  },
});

export default AngledTicker;
