import React, { useEffect, useState } from 'react';

interface SmoothNumberProps {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number; // ms, default 550ms
  className?: string;
  style?: React.CSSProperties;
}

export const SmoothNumber: React.FC<SmoothNumberProps> = ({
  value,
  decimals = 2,
  prefix = '',
  suffix = '',
  duration = 550,
  className = '',
  style = {},
}) => {
  const [displayVal, setDisplayVal] = useState<number>(() => {
    const num = Number(value);
    return isNaN(num) ? 0 : num;
  });

  useEffect(() => {
    const targetVal = Number(value);
    if (isNaN(targetVal)) return;

    const startVal = displayVal;
    if (Math.abs(targetVal - startVal) < 0.000001) return;

    let animId: number;
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      // Cubic ease-out deceleration curve for industrial instrumentation
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = startVal + (targetVal - startVal) * ease;
      setDisplayVal(current);

      if (progress < 1) {
        animId = requestAnimationFrame(step);
      }
    };

    animId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animId);
  }, [value, duration]);

  return (
    <span
      className={className}
      style={{
        fontVariantNumeric: 'tabular-nums',
        transition: 'color 0.3s ease',
        ...style,
      }}
    >
      {prefix}
      {displayVal.toFixed(decimals)}
      {suffix}
    </span>
  );
};
