import React, { useState } from 'react';
import { useAppSettings } from '../../context/AppSettingsContext';

interface SpeedDataPoint {
  time: string;
  commandedPct: number;
  measuredRpm: number;
}

interface MotorSpeedChartProps {
  data: SpeedDataPoint[];
  maxRpm?: number;
  ratedRpm?: number;
}

export const MotorSpeedChart: React.FC<MotorSpeedChartProps> = ({
  data: rawData,
  maxRpm: propMaxRpm,
  ratedRpm: propRatedRpm,
}) => {
  const { settings } = useAppSettings();
  const data = Array.isArray(rawData) ? rawData : [];
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const ratedSpeed = propRatedRpm ?? settings.motorRatedRpm ?? 1500;
  const maxRpm = propMaxRpm ?? settings.motorMaxRpm ?? 2000;

  const width = 640;
  const height = 200;
  const padding = { top: 20, right: 30, bottom: 30, left: 45 };

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const getX = (index: number) => {
    if (data.length <= 1) return padding.left;
    return padding.left + (index / (data.length - 1)) * plotWidth;
  };

  const getY = (rpm: number) => {
    const clamped = Math.max(0, Math.min(maxRpm, rpm));
    return padding.top + plotHeight - (clamped / maxRpm) * plotHeight;
  };

  const cmdPath =
    data.length > 0
      ? data.map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY((p.commandedPct / 100) * ratedSpeed)}`).join(' ')
      : '';

  const measuredPath =
    data.length > 0
      ? data.map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(p.measuredRpm)}`).join(' ')
      : '';

  const currentPoint =
    hoverIndex !== null && data[hoverIndex]
      ? data[hoverIndex]
      : data[data.length - 1] || null;

  // Compute 4 dynamic ticks
  const ticks = [0, maxRpm * 0.33, maxRpm * 0.66, maxRpm];

  return (
    <div className="b2b-card" style={{ height: '100%' }}>
      <div className="b2b-card-header">
        <div>
          <div className="b2b-card-title">Motor Speed & Drive Telemetry</div>
          <div className="b2b-card-subtitle">
            {hoverIndex !== null && data[hoverIndex] ? (
              <span style={{ color: '#0284c7', fontWeight: 600 }}>
                Sample @ {data[hoverIndex].time} &bull; Commanded:{' '}
                {((data[hoverIndex].commandedPct / 100) * ratedSpeed).toFixed(0)} RPM &bull; Measured:{' '}
                {data[hoverIndex].measuredRpm.toFixed(0)} RPM
              </span>
            ) : (
              `Commanded Target Speed vs Measured Tachometer (0 - ${maxRpm.toFixed(0)} RPM)`
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem', fontWeight: 600, alignItems: 'center' }}>
          <span style={{ color: '#059669', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: 10, height: 2, background: '#059669', display: 'inline-block' }}></span>
            Command:{' '}
            {currentPoint
              ? `${currentPoint.commandedPct.toFixed(0)}% (${((currentPoint.commandedPct / 100) * ratedSpeed).toFixed(0)} RPM)`
              : '—'}
          </span>
          <span style={{ color: '#2563eb', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: 10, height: 2, background: '#2563eb', display: 'inline-block' }}></span>
            Measured: {currentPoint ? `${currentPoint.measuredRpm.toFixed(0)} RPM` : '—'}
          </span>
        </div>
      </div>

      <div className="chart-container" style={{ position: 'relative' }}>
        {data.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8' }}>
            Awaiting motor telemetry packets...
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="svg-chart"
            preserveAspectRatio="none"
            onMouseLeave={() => setHoverIndex(null)}
          >
            {/* Grid lines */}
            {ticks.map((val) => {
              const y = getY(val);
              return (
                <g key={val}>
                  <line
                    x1={padding.left}
                    y1={y}
                    x2={width - padding.right}
                    y2={y}
                    className="chart-grid-line"
                  />
                  <text x={padding.left - 8} y={y + 3} textAnchor="end" className="chart-axis-text">
                    {val.toFixed(0)}
                  </text>
                </g>
              );
            })}

            {/* Commanded Step Line */}
            {cmdPath && (
              <path
                d={cmdPath}
                fill="none"
                stroke="#10b981"
                strokeWidth={2}
                strokeDasharray="4 2"
                style={{ transition: 'all 0.45s ease-out' }}
              />
            )}

            {/* Measured RPM Line */}
            {measuredPath && (
              <path
                d={measuredPath}
                fill="none"
                stroke="#2563eb"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transition: 'all 0.45s ease-out' }}
              />
            )}

            {/* Hover Crosshair & Data Points */}
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
                {/* Marker on Commanded */}
                <circle
                  cx={getX(hoverIndex)}
                  cy={getY((data[hoverIndex].commandedPct / 100) * ratedSpeed)}
                  r={4.5}
                  fill="#10b981"
                  stroke="#ffffff"
                  strokeWidth={2}
                />
                {/* Marker on Measured */}
                <circle
                  cx={getX(hoverIndex)}
                  cy={getY(data[hoverIndex].measuredRpm)}
                  r={4.5}
                  fill="#2563eb"
                  stroke="#ffffff"
                  strokeWidth={2}
                />

                {/* Floating Tooltip Box */}
                {(() => {
                  const hp = data[hoverIndex];
                  const cmdRpm = (hp.commandedPct / 100) * ratedSpeed;
                  const targetX = getX(hoverIndex);
                  const targetY = getY(hp.measuredRpm);

                  const tooltipWidth = 155;
                  const tooltipHeight = 66;
                  const isRightHalf = targetX > width - padding.right - tooltipWidth - 10;
                  const boxX = isRightHalf ? targetX - tooltipWidth - 12 : targetX + 12;
                  const boxY = Math.max(
                    padding.top + 4,
                    Math.min(padding.top + plotHeight - tooltipHeight - 4, targetY - 30)
                  );

                  const delta = Math.abs(hp.measuredRpm - cmdRpm);

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
                        {hp.time} {delta > 400 ? '• ⚠️ Deviation' : ''}
                      </text>
                      <circle cx={boxX + 14} cy={boxY + 31} r={3} fill="#10b981" />
                      <text
                        x={boxX + 22}
                        y={boxY + 34}
                        fill="#ffffff"
                        fontSize="10px"
                        fontWeight="700"
                        fontFamily="ui-monospace, monospace"
                      >
                        Target: {cmdRpm.toFixed(0)} RPM ({hp.commandedPct.toFixed(0)}%)
                      </text>
                      <circle cx={boxX + 14} cy={boxY + 48} r={3} fill="#60a5fa" />
                      <text
                        x={boxX + 22}
                        y={boxY + 51}
                        fill="#ffffff"
                        fontSize="10px"
                        fontWeight="700"
                        fontFamily="ui-monospace, monospace"
                      >
                        Measured: {hp.measuredRpm.toFixed(0)} RPM
                      </text>
                    </g>
                  );
                })()}
              </g>
            )}

            {/* Hover capture areas */}
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
