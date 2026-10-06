import React, { useState } from 'react';
import type { SpectrumBin } from '../../types';
import { useAppSettings } from '../../context/AppSettingsContext';

interface SpectrumChartProps {
  spectrum?: SpectrumBin[];
  dominantFreq?: number;
  maxFreqHz?: number;
  exciterStartHz?: number;
  exciterEndHz?: number;
}

export const SpectrumChart: React.FC<SpectrumChartProps> = ({
  spectrum: rawSpectrum,
  dominantFreq = 0,
  maxFreqHz,
  exciterStartHz,
  exciterEndHz,
}) => {
  const { settings } = useAppSettings();
  const spectrum = Array.isArray(rawSpectrum) ? rawSpectrum : [];
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const maxF = maxFreqHz ?? settings.fftMaxFreqHz ?? 500.0;
  const bandStart = exciterStartHz ?? settings.fftExciterStartHz ?? 150.0;
  const bandEnd = exciterEndHz ?? settings.fftExciterEndHz ?? 250.0;

  const width = 360;
  const height = 220;
  const padding = { top: 20, right: 20, bottom: 30, left: 35 };

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const maxMag = Math.max(0.5, ...(spectrum.length > 0 ? spectrum.map((b) => b.magnitude) : [0.5]));
  const numBins = spectrum.length || 1;
  const barWidth = Math.max(2, plotWidth / numBins - 2);

  const hoveredBin = hoverIndex !== null && spectrum[hoverIndex] ? spectrum[hoverIndex] : null;

  return (
    <div className="b2b-card" style={{ height: '100%' }}>
      <div className="b2b-card-header">
        <div>
          <div className="b2b-card-title">FFT Frequency Spectrum</div>
          <div className="b2b-card-subtitle">
            {hoveredBin ? (
              <span style={{ color: '#0284c7', fontWeight: 600 }}>
                {hoveredBin.freq.toFixed(1)} Hz &bull; {hoveredBin.magnitude.toFixed(4)} g
              </span>
            ) : (
              `Real-time spectrum (0 - ${maxF.toFixed(0)} Hz)`
            )}
          </div>
        </div>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#0284c7' }}>
          Dominant: <span className="font-mono">{dominantFreq?.toFixed(1) || '0.0'} Hz</span>
        </div>
      </div>

      <div className="chart-container" style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="svg-chart"
          onMouseLeave={() => setHoverIndex(null)}
        >
          {/* Exciter Resonance Danger Zone Highlight */}
          {spectrum.length > 0 && bandStart < maxF && (
            <rect
              x={padding.left + (bandStart / maxF) * plotWidth}
              y={padding.top}
              width={Math.min(plotWidth, ((Math.min(maxF, bandEnd) - bandStart) / maxF) * plotWidth)}
              height={plotHeight}
              fill="#fffbeb"
              stroke="#fde68a"
              strokeDasharray="2 2"
              opacity={0.7}
            />
          )}

          {/* Grid lines */}
          {[0, 0.25, 0.5].map((val) => (
            <line
              key={val}
              x1={padding.left}
              y1={padding.top + plotHeight - (val / maxMag) * plotHeight}
              x2={width - padding.right}
              y2={padding.top + plotHeight - (val / maxMag) * plotHeight}
              className="chart-grid-line"
            />
          ))}

          {/* Spectrum Bars */}
          {spectrum.map((bin, i) => {
            const barHeight = (bin.magnitude / maxMag) * plotHeight;
            const x = padding.left + (i / numBins) * plotWidth;
            const y = padding.top + plotHeight - barHeight;
            const isExciterBand = bin.freq >= bandStart && bin.freq <= bandEnd;
            const isHovered = hoverIndex === i;

            return (
              <g key={i}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  className={`spectrum-bar ${isExciterBand && bin.magnitude > 0.2 ? 'exciter-zone' : ''}`}
                  style={{
                    fill: isHovered ? '#38bdf8' : undefined,
                    filter: isHovered ? 'drop-shadow(0 0 3px #0284c7)' : undefined,
                    cursor: 'pointer',
                    transition: 'height 0.45s cubic-bezier(0.34, 1.25, 0.64, 1), y 0.45s cubic-bezier(0.34, 1.25, 0.64, 1), fill 0.15s ease',
                  }}
                  rx={1}
                />
              </g>
            );
          })}

          {/* Dynamic Axis Labels */}
          <text x={padding.left} y={height - 10} className="chart-axis-text">
            0 Hz
          </text>
          <text x={padding.left + plotWidth * 0.5} y={height - 10} textAnchor="middle" className="chart-axis-text" fill="#64748b">
            {(maxF * 0.5).toFixed(0)} Hz
          </text>
          <text x={width - padding.right} y={height - 10} textAnchor="end" className="chart-axis-text">
            {maxF.toFixed(0)} Hz
          </text>

          {/* Floating Hover Tooltip for Spectrum */}
          {hoveredBin && hoverIndex !== null && (() => {
            const targetX = padding.left + (hoverIndex / numBins) * plotWidth;
            const barHeight = (hoveredBin.magnitude / maxMag) * plotHeight;
            const targetY = padding.top + plotHeight - barHeight;

            const tooltipWidth = 125;
            const tooltipHeight = 48;
            const isRightHalf = targetX > width - padding.right - tooltipWidth - 10;
            const boxX = isRightHalf ? targetX - tooltipWidth - 8 : targetX + barWidth + 8;
            const boxY = Math.max(
              padding.top + 4,
              Math.min(padding.top + plotHeight - tooltipHeight - 4, targetY - 20)
            );

            return (
              <g style={{ pointerEvents: 'none' }}>
                <rect
                  x={boxX}
                  y={boxY}
                  width={tooltipWidth}
                  height={tooltipHeight}
                  rx={5}
                  fill="#0f172a"
                  stroke="#38bdf8"
                  strokeWidth={1}
                  opacity={0.96}
                />
                <text x={boxX + 8} y={boxY + 16} fill="#94a3b8" fontSize="8.5px" fontWeight="600">
                  Frequency
                </text>
                <text
                  x={boxX + 8}
                  y={boxY + 34}
                  fill="#ffffff"
                  fontSize="11px"
                  fontWeight="700"
                  fontFamily="ui-monospace, monospace"
                >
                  {hoveredBin.freq.toFixed(1)} Hz
                </text>
                <text
                  x={boxX + tooltipWidth - 8}
                  y={boxY + 34}
                  fill="#38bdf8"
                  fontSize="10.5px"
                  fontWeight="700"
                  textAnchor="end"
                  fontFamily="ui-monospace, monospace"
                >
                  {hoveredBin.magnitude.toFixed(3)}g
                </text>
              </g>
            );
          })()}

          {/* Transparent Hover Interceptor Rects */}
          {spectrum.map((_, i) => (
            <rect
              key={i}
              x={padding.left + (i / numBins) * plotWidth}
              y={padding.top}
              width={plotWidth / numBins}
              height={plotHeight}
              fill="transparent"
              onMouseEnter={() => setHoverIndex(i)}
              style={{ cursor: 'pointer' }}
            />
          ))}
        </svg>
      </div>
    </div>
  );
};
