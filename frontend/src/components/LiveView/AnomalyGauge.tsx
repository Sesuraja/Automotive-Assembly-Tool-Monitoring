import React, { useState, useEffect } from 'react';

interface AnomalyGaugeProps {
  score: number;
  rawScore?: number;
  warnThreshold?: number;
  criticalThreshold?: number;
}

export const AnomalyGauge: React.FC<AnomalyGaugeProps> = ({
  score = 0,
  rawScore = 0,
  warnThreshold = 0.45,
  criticalThreshold = 0.70,
}) => {
  const size = 200;
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2 + 10;

  // Arc angles from 230 deg (bottom-left 0.0) to 490 deg (bottom-right 1.0)
  // Perfectly symmetric 260 deg clockwise sweep over the top
  const startAngle = 230;
  const endAngle = 490;
  const totalAngle = endAngle - startAngle;

  const polarToCartesian = (centerX: number, centerY: number, r: number, angleInDegrees: number) => {
    const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
    return {
      x: centerX + r * Math.cos(angleInRadians),
      y: centerY + r * Math.sin(angleInRadians),
    };
  };

  const describeArc = (x: number, y: number, r: number, start: number, end: number) => {
    const startPoint = polarToCartesian(x, y, r, start);
    const endPoint = polarToCartesian(x, y, r, end);
    const largeArcFlag = end - start <= 180 ? '0' : '1';
    // Draw clockwise (sweep-flag = 1) from start (bottom-left) to end (bottom-right)
    return ['M', startPoint.x, startPoint.y, 'A', r, r, 0, largeArcFlag, 1, endPoint.x, endPoint.y].join(' ');
  };

  const clampedScore = Math.max(0, Math.min(1, score));

  // Smoothly animated display score counter for continuous fluid transitions
  const [displayScore, setDisplayScore] = useState<number>(clampedScore);
  useEffect(() => {
    let animId: number;
    const startVal = displayScore;
    const endVal = clampedScore;
    const startTime = performance.now();
    const duration = 650; // ms

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      // cubic ease-out
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      setDisplayScore(startVal + (endVal - startVal) * easeProgress);

      if (progress < 1) {
        animId = requestAnimationFrame(step);
      }
    };

    animId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animId);
  }, [clampedScore]);

  // Arc circumference for 260 degree arc: (260/360) * 2 * PI * radius
  const arcLength = (totalAngle / 360) * 2 * Math.PI * radius;
  const strokeDashoffset = arcLength * (1 - clampedScore);

  const backgroundArc = describeArc(cx, cy, radius, startAngle, endAngle);

  const safeWarn = Math.max(0.01, Math.min(0.98, Number(warnThreshold) || 0.45));
  const safeCrit = Math.max(safeWarn + 0.01, Math.min(0.99, Number(criticalThreshold) || 0.70));

  // Threshold marker coordinates
  const warnAngle = startAngle + safeWarn * totalAngle;
  const critAngle = startAngle + safeCrit * totalAngle;
  const warnMarker = polarToCartesian(cx, cy, radius, warnAngle);
  const critMarker = polarToCartesian(cx, cy, radius, critAngle);

  // Status color
  const statusColor =
    clampedScore >= safeCrit
      ? '#ef4444'
      : clampedScore >= safeWarn
      ? '#f59e0b'
      : '#10b981';

  return (
    <div className="b2b-card" style={{ height: '100%' }}>
      <div className="b2b-card-header">
        <div>
          <div className="b2b-card-title">AI Anomaly Detection Score</div>
          <div className="b2b-card-subtitle">Calibrated probability index [0.00 – 1.00]</div>
        </div>
      </div>

      <div className="gauge-wrapper">
        <svg width={size} height={size * 0.85} style={{ overflow: 'visible' }}>
          {/* Background Track */}
          <path
            d={backgroundArc}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />

          {/* Value Arc with Smooth Continuous Animation */}
          <path
            d={backgroundArc}
            fill="none"
            stroke={statusColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${arcLength}`}
            strokeDashoffset={strokeDashoffset}
            style={{
              transition: 'stroke-dashoffset 0.75s cubic-bezier(0.34, 1.25, 0.64, 1), stroke 0.35s ease',
            }}
          />

          {/* Warn Threshold Tick */}
          <circle cx={warnMarker.x} cy={warnMarker.y} r={4} fill="#f59e0b" stroke="#ffffff" strokeWidth={1.5}>
            <title>{`Warn Threshold: ${safeWarn.toFixed(2)}`}</title>
          </circle>

          {/* Critical Threshold Tick */}
          <circle cx={critMarker.x} cy={critMarker.y} r={4} fill="#ef4444" stroke="#ffffff" strokeWidth={1.5}>
            <title>{`Critical Threshold: ${safeCrit.toFixed(2)}`}</title>
          </circle>

          {/* Threshold label text aligned right beneath arc endpoints */}
          <text x={34} y={182} fill="#64748b" fontSize="10" fontFamily="JetBrains Mono" fontWeight="bold">0.0</text>
          <text x={size - 34} y={182} fill="#64748b" fontSize="10" fontFamily="JetBrains Mono" fontWeight="bold" textAnchor="end">1.0</text>
        </svg>

        <div className="gauge-score-display" style={{ marginTop: '-1.0rem' }}>
          <div className="gauge-score-val" style={{ color: statusColor }}>
            {displayScore.toFixed(2)}
          </div>
          <div className="gauge-score-label">
            {clampedScore >= safeCrit
              ? 'CRITICAL ANOMALY'
              : clampedScore >= safeWarn
              ? 'ELEVATED WARNING'
              : 'NOMINAL OPERATION'}
          </div>
          <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 4 }}>
            Raw: <span className="font-mono">{rawScore.toFixed(2)}</span> &bull; Warn: <span className="font-mono">{safeWarn.toFixed(2)}</span> &bull; Crit: <span className="font-mono">{safeCrit.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
