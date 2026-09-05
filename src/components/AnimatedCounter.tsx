import { useEffect, useRef, useState } from 'react';
import { useInView, useMotionValue, useSpring } from 'motion/react';
import { playEloCounterTick } from '../utils/tactileAudio';

export function AnimatedCounter({
  value,
  direction = "up",
  className = "",
  playTickSound = false,
}: {
  value: number;
  direction?: "up" | "down";
  className?: string;
  playTickSound?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(direction === "down" ? value : 0);
  const springValue = useSpring(motionValue, {
    damping: 15,
    stiffness: 100,
  });
  // Changed: removed `once: true` so counters re-trigger if the value changes
  // (e.g. after a vote updates the ELO). Also removed margin so it triggers
  // even if the element is at the edge of the viewport.
  const isInView = useInView(ref, { margin: "0px" });
  const [displayValue, setDisplayValue] = useState(direction === "down" ? value : 0);

  const lastTargetVal = useRef(value);
  const startVal = useRef(direction === "down" ? value : 0);

  useEffect(() => {
    if (isInView) {
      startVal.current = displayValue;
      lastTargetVal.current = value;
      motionValue.set(value);
    }
  }, [motionValue, isInView, value]);

  useEffect(() => {
    const unsubscribe = springValue.on("change", (latest) => {
      const rounded = Math.round(latest);
      if (rounded !== displayValue) {
        setDisplayValue(rounded);
        if (playTickSound) {
          const totalDiff = lastTargetVal.current - startVal.current;
          const currentDiff = rounded - startVal.current;
          let progress = 0.5;
          if (totalDiff !== 0) {
            progress = Math.max(0, Math.min(1, currentDiff / totalDiff));
          }
          playEloCounterTick(totalDiff >= 0, progress);
        }
      }
    });
    return () => unsubscribe();
  }, [springValue, displayValue, playTickSound]);

  return <span ref={ref} className={className}>{displayValue}</span>;
}

