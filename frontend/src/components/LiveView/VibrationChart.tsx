import React, { useState } from 'react';
import { useAppSettings } from '../../context/AppSettingsContext';

interface VibrationDataPoint {
  time: string;
  rms: number;
  peak: number;
}

interface VibrationChartProps {
  data: VibrationDataPoint[];
  hardLimitRms?: number;
  maxScaleY?: number;
  sampleCount?: number;
}

export const VibrationChart: React.FC<VibrationChartProps> = ({
  data: rawData,
  hardLimitRms,
  maxScaleY,
  sampleCount,
}) => {
  const { settings } = useAppSettings();
  const data = Array.isArray(rawData) ? rawData : [];
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const limitVal = hardLimitRms ?? settings.vibrationLimitG ?? 1.25;
  const userScaleVal = maxScaleY ?? settings.vibrationMaxScaleG ?? 2.50;
  const samplesCount = sampleCount ?? settings.rollingSamplesCount ?? 60;

  const width = 640;
  const height = 220;
  const padding = { top: 20, right: 30, bottom: 30, left: 45 };

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // Compute scale dynamically based strictly on data, configured limit, and user scale
  const maxVal = Math.max(
    limitVal * 1.15,
    userScaleVal,
    ...(data.length > 0 ? data.map((d) => Math.max(d.peak, d.rms)) : [userScaleVal])
  );

  const getX = (index: number) => {
    if (data.length <= 1) return padding.left;
    return padding.left + (index / (data.length - 1)) * plotWidth;
  };

  const getY = (val: number) => {
    const clamped = Math.max(0, Math.min(maxVal, val));
    return padding.top + plotHeight - (clamped / maxVal) * plotHeight;
  };

  // Generate SVG paths
  const rmsPath =
    data.length > 0
      ? data.map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(p.rms)}`).join(' ')
      : '';

  const peakPath =
    data.length > 0
      ? data.map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(p.peak)}`).join(' ')
      : '';

  const rmsArea =
    data.length > 0
      ? `${rmsPath} L ${getX(data.length - 1)} ${padding.top + plotHeight} L ${padding.left} ${padding.top + plotHeight} Z`
      : '';

  const hardLimitY = getY(limitVal);

  const currentPoint =
    hoverIndex !== null && data[hoverIndex]
      ? data[hoverIndex]
      : data[data.length - 1] || null;

  return (
    <div className="b2b-card" style={{ height: '100%' }}>
      <div className="b2b-card-header">
        <div>
          <div className="b2b-card-title">Live Vibration Rolling Profile ({samplesCount} Samples)</div>
          <div className="b2b-card-subtitle">
            {hoverIndex !== null && data[hoverIndex] ? (
              <span style={{ color: '#0284c7', fontWeight: 600 }}>
                Sample @ {data[hoverIndex].time} &bull; RMS: {data[hoverIndex].rms.toFixed(3)}g &bull; Peak: {data[hoverIndex].peak.toFixed(3)}g
              </span>
            ) : (
              'Triaxial accelerometer RMS & Peak acceleration (g-force)'
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.85rem', fontSize: '0.75rem', fontWeight: 600, alignItems: 'center' }}>
          <span style={{ color: '#0284c7', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: 10, height: 3, background: '#0284c7', display: 'inline-block' }}></span>
            RMS: {currentPoint ? `${currentPoint.rms.toFixed(3)}g` : '—'}
          </span>
          <span style={{ color: '#8b5cf6', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: 10, height: 2, background: '#8b5cf6', display: 'inline-block' }}></span>
            Peak: {currentPoint ? `${currentPoint.peak.toFixed(3)}g` : '—'}
          </span>
          <span style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: 10, height: 2, borderTop: '2px dashed #ef4444', display: 'inline-block' }}></span>
            Limit: {limitVal.toFixed(2)}g
          </span>
        </div>
      </div>

      <div className="chart-container" style={{ position: 'relative' }}>
        {data.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8' }}>
            Collecting vibration samples...
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="svg-chart"
            preserveAspectRatio="none"
            onMouseLeave={() => setHoverIndex(null)}
          >
            <defs>
              <linearGradient id="rms-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0284c7" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#0284c7" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Dynamic Grid lines based on maxVal */}
            {(() => {
              const step = maxVal / 3;
              const ticks = [0, step, step * 2, maxVal];
              return ticks.map((val, idx) => {
                const y = getY(val);
                return (
                  <g key={idx}>
                    <line
                      x1={padding.left}
                      y1={y}
                      x2={width - padding.right}
                      y2={y}
                      className="chart-grid-line"
                    />
                    <text x={padding.left - 8} y={y + 3} textAnchor="end" className="chart-axis-text">
                      {val.toFixed(1)}g
                    </text>
                  </g>
                );
              });
            })()}

            {/* Hard Limit Reference Line */}
            <line
              x1={padding.left}
              y1={hardLimitY}
              x2={width - padding.right}
              y2={hardLimitY}
              className="threshold-line-crit"
            />
            <text
              x={width - padding.right}
              y={hardLimitY - 4}
              textAnchor="end"
              style={{ fill: '#ef4444', fontSize: '9px', fontWeight: 700, fontFamily: 'JetBrains Mono' }}
            >
              FIXED SAFETY LIMIT ({limitVal.toFixed(2)}g)
            </text>

            {/* Area & Curves */}
            {rmsArea && <path d={rmsArea} className="chart-area-rms" style={{ transition: 'all 0.45s ease-out' }} />}
            {rmsPath && <path d={rmsPath} className="chart-line-rms" style={{ transition: 'all 0.45s ease-out' }} />}
            {peakPath && <path d={peakPath} className="chart-line-peak" style={{ transition: 'all 0.45s ease-out' }} />}

            {/* Hover Crosshair & Data Pointers */}
            {hoverIndex !== null && data[hoverIndex] && (
              <g style={{ pointerEvents: 'none' }}>
                <line
                  x1={getX(hoverIndex)}
                  y1={padding.top}
                  x2={getX(hoverIndex)}
                  y2={padding.top + plotHeight}
                  stroke="#64748b"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                {/* Point on RMS */}
                <circle
                  cx={getX(hoverIndex)}
                  cy={getY(data[hoverIndex].rms)}
                  r={4.5}
                  fill="#0284c7"
                  stroke="#ffffff"
                  strokeWidth={2}
                />
                {/* Point on Peak */}
                <circle
                  cx={getX(hoverIndex)}
                  cy={getY(data[hoverIndex].peak)}
                  r={4.5}
                  fill="#8b5cf6"
                  stroke="#ffffff"
                  strokeWidth={2}
                />

                {/* Floating Tooltip Box */}
                {(() => {
                  const hp = data[hoverIndex];
                  const targetX = getX(hoverIndex);
                  const targetY = getY(hp.rms);

                  const tooltipWidth = 145;
                  const tooltipHeight = 64;
                  const isRightHalf = targetX > width - padding.right - tooltipWidth - 10;
                  const boxX = isRightHalf ? targetX - tooltipWidth - 12 : targetX + 12;
                  const boxY = Math.max(
                    padding.top + 4,
                    Math.min(padding.top + plotHeight - tooltipHeight - 4, targetY - 30)
                  );

                  return (
                    <g>
                      <rect
                        x={boxX}
                        y={boxY}
                        width={tooltipWidth}
                        height={tooltipHeight}
                        rx={6}
                        fill="#0f172a"
                        stroke="#38bdf8"
                        strokeWidth={1}
                        opacity={0.96}
                      />
                      <text x={boxX + 10} y={boxY + 16} fill="#94a3b8" fontSize="9px" fontWeight="600">
                        {hp.time}
                      </text>
                      <circle cx={boxX + 14} cy={boxY + 30} r={3} fill="#38bdf8" />
                      <text
                        x={boxX + 22}
                        y={boxY + 33}
                        fill="#ffffff"
                        fontSize="10.5px"
                        fontWeight="700"
                        fontFamily="ui-monospace, monospace"
                      >
                        RMS: {hp.rms.toFixed(3)} g
                      </text>
                      <circle cx={boxX + 14} cy={boxY + 47} r={3} fill="#c084fc" />
                      <text
                        x={boxX + 22}
                        y={boxY + 50}
                        fill="#ffffff"
                        fontSize="10.5px"
                        fontWeight="700"
                        fontFamily="ui-monospace, monospace"
                      >
                        Peak: {hp.peak.toFixed(3)} g
                      </text>
                    </g>
                  );
                })()}
              </g>
            )}

            {/* Transparent hover capture rects */}
            {data.map((_, i) => (
              <rect
                key={i}
                x={getX(i) - plotWidth / (data.length * 2)}
                y={padding.top}
                width={Math.max(4, plotWidth / data.length)}
                height={plotHeight}
                fill="transparent"
                onMouseEnter={() => setHoverIndex(i)}
                style={{ cursor: 'crosshair' }}
              />
            ))}
          </svg>
        )}
      </div>
    </div>
  );
};
