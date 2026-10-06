import React, { useEffect, useRef, useState } from 'react';
import type { LiveTelemetry, SimulatorState } from '../../types';
import { api } from '../../services/api';
import { Gauge, RotateCw } from 'lucide-react';
import { useAppSettings } from '../../context/AppSettingsContext';

interface MotorDriveVisualizerProps {
  simState?: SimulatorState | null;
  telemetry?: LiveTelemetry | null;
  onRefresh?: () => void;
}

export const MotorDriveVisualizer: React.FC<MotorDriveVisualizerProps> = ({
  simState: _simState,
  telemetry,
  onRefresh,
}) => {
  const { settings } = useAppSettings();
  const configuredRatedRpm = Math.round(settings.motorRatedRpm || 1500);
  const [localReading, setLocalReading] = useState<any>(null);

  useEffect(() => {
    // Only poll as fallback if parent does not provide live telemetry stream
    if (telemetry) return;
    const pollTelemetry = async () => {
      try {
        const res = await api.getLatestReading();
        if (res && res.measured_rpm !== undefined) {
          setLocalReading(res);
        }
      } catch (err) {
        // ignore
      }
    };
    pollTelemetry();
    const interval = setInterval(pollTelemetry, 1500);
    return () => clearInterval(interval);
  }, [telemetry]);

  // Use live telemetry prop, fallback to locally polled reading, fallback to nominal
  const currentRpm = telemetry?.measured_rpm ?? localReading?.measured_rpm ?? configuredRatedRpm;

  // Smoothly animated display RPM for continuous fluid transitions
  const [displayRpm, setDisplayRpm] = useState<number>(currentRpm);
  useEffect(() => {
    let animId: number;
    const startVal = displayRpm;
    const endVal = currentRpm;
    const startTime = performance.now();
    const duration = 650; // ms

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      setDisplayRpm(startVal + (endVal - startVal) * easeProgress);

      if (progress < 1) {
        animId = requestAnimationFrame(step);
      }
    };

    animId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animId);
  }, [currentRpm]);
  const commandedPct = telemetry?.commanded_speed_pct ?? localReading?.commanded_speed_pct ?? 100;
  const stationState = telemetry?.state ?? (localReading?.status === 'OFF' ? 'STOPPED' : localReading?.status === 'SLOW' ? 'REDUCED_SPEED' : 'NORMAL');
  const indicatorLight = telemetry?.indicator_light ?? (localReading?.status === 'OFF' ? 'RED' : localReading?.status === 'SLOW' ? 'AMBER' : 'GREEN');

  // Dynamic calculation: Derive nominal rated RPM and max scale from Settings and Measured Tachometer
  const observedRpm = Math.max(currentRpm, localReading?.measured_rpm ?? 0);
  const nominalRatedRpm = configuredRatedRpm;
  const maxScaleRpm = Math.max(settings.motorMaxRpm || 2000, Math.ceil((Math.max(observedRpm, nominalRatedRpm) * 1.33) / 500) * 500);

  // State determination
  const isStopped = currentRpm < 50 || stationState === 'STOPPED';
  const isSlow = !isStopped && (currentRpm < (0.65 * nominalRatedRpm) || commandedPct <= 55 || stationState === 'REDUCED_SPEED');
  const isRunning = !isStopped && currentRpm > 15;

  // Derived engineering metrics for telemetry displays
  const shaftFreqHz = (currentRpm / 60).toFixed(1);
  const angularVelocity = ((2 * Math.PI * currentRpm) / 60).toFixed(1);
  const phaseCurrent = (2.5 * (currentRpm / nominalRatedRpm) + 0.12).toFixed(2);
  const estTorque = (4.2 * (currentRpm / nominalRatedRpm)).toFixed(1);
  const estTemp = (27 + 5 * (currentRpm / nominalRatedRpm)).toFixed(1);
  const syncSpeed = nominalRatedRpm;
  const slipPct = currentRpm > 10 ? Math.max(0, ((syncSpeed - currentRpm) / syncSpeed) * 100).toFixed(1) : '0.0';

  // Visual rotation angle accumulator for continuous smooth 60fps rotation
  const [rotationAngle, setRotationAngle] = useState<number>(0);
  const animRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(performance.now());
  const [isApplying, setIsApplying] = useState<boolean>(false);

  useEffect(() => {
    const updateRotation = (now: number) => {
      const dt = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;

      if (isRunning && currentRpm > 15) {
        // Scale factor for pleasant, realistic visual rotation
        const visualDegPerSec = (currentRpm / 60) * 360 * 0.35;
        setRotationAngle((prev) => (prev + visualDegPerSec * dt) % 360);
      }

      animRef.current = requestAnimationFrame(updateRotation);
    };

    animRef.current = requestAnimationFrame(updateRotation);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [isRunning, currentRpm]);

  // Gauge needle calculation (dynamic scale from Measured Tachometer mapped to -120 deg to +120 deg)
  const clampedRpm = Math.min(maxScaleRpm, Math.max(0, currentRpm));
  const needleDeg = -120 + (clampedRpm / maxScaleRpm) * 240;
  const targetRpm = (commandedPct / 100) * nominalRatedRpm;



  // Dedicated one-click station reset and motor restart
  const handleRestartMotor = async () => {
    setIsApplying(true);
    try {
      await api.commandMotor('RESET', configuredRatedRpm);
      await api.resetStation('station-A', 'Operator', 'Manual operator restart and lockout clear');
      if (onRefresh) onRefresh();
    } catch (e) {
      console.error('Failed to restart motor:', e);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="b2b-card motor-deck-container">
      {/* Top Header & Annunciator */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.85rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <RotateCw size={18} color="#0284c7" className={!isStopped && isRunning ? 'spin-smooth' : ''} />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
              Industrial Spindle Motor & Closed-Loop Drive Dynamics
            </h3>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
            Real-time shaft angular velocity, synchronous rotor physics, and AI closed-loop deceleration feedback
          </div>
        </div>

        {/* Dynamic Mode Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {isStopped ? (
            <span className="motor-badge motor-badge-stopped">
              <span className="motor-pulse-dot red"></span>
              MOTOR STOPPED (0 RPM)
            </span>
          ) : isSlow ? (
            <span className="motor-badge motor-badge-slow">
              <span className="motor-pulse-dot amber"></span>
              SLOW SPEED (THROTTLED 50%)
            </span>
          ) : (
            <span className="motor-badge motor-badge-nominal">
              <span className="motor-pulse-dot green"></span>
              ROTATING (NOMINAL 100%)
            </span>
          )}

          <div
            style={{
              padding: '0.25rem 0.65rem',
              borderRadius: 6,
              fontSize: '0.75rem',
              fontWeight: 700,
              background: indicatorLight === 'GREEN' ? '#ecfdf5' : indicatorLight === 'AMBER' ? '#fffbeb' : '#fef2f2',
              color: indicatorLight === 'GREEN' ? '#065f46' : indicatorLight === 'AMBER' ? '#92400e' : '#991b1b',
              border: `1px solid ${indicatorLight === 'GREEN' ? '#a7f3d0' : indicatorLight === 'AMBER' ? '#fde68a' : '#fecaca'}`,
            }}
          >
            BEACON: {indicatorLight}
          </div>

          {isStopped && (
            <button
              onClick={handleRestartMotor}
              disabled={isApplying}
              style={{
                padding: '0.25rem 0.65rem',
                borderRadius: 6,
                border: 'none',
                background: '#10b981',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                cursor: 'pointer',
              }}
            >
              <RotateCw size={12} />
              <span>Clear Lockout</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Visualizer Grid */}
      <div className="motor-visualizer-grid">
        {/* Left: Animated Industrial Motor Cross-Section */}
        <div className="motor-schematic-card">
          <div className="motor-card-header">
            <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-main)' }}>
              Spindle Mechanical Cross-Section (3-Phase AC Induction)
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono' }}>
              ISO 10816 CLASS II RIG
            </span>
          </div>

          <div className="motor-svg-stage">
            <svg viewBox="0 0 460 210" className="motor-svg-canvas">
              <defs>
                {/* Metallic Gradients */}
                <linearGradient id="statorGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#334155" />
                  <stop offset="35%" stopColor="#475569" />
                  <stop offset="70%" stopColor="#1e293b" />
                  <stop offset="100%" stopColor="#0f172a" />
                </linearGradient>

                <linearGradient id="finGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#475569" />
                  <stop offset="50%" stopColor="#64748b" />
                  <stop offset="100%" stopColor="#334155" />
                </linearGradient>

                <linearGradient id="shaftGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#cbd5e1" />
                  <stop offset="50%" stopColor="#ffffff" />
                  <stop offset="100%" stopColor="#94a3b8" />
                </linearGradient>

                <linearGradient id="rotorGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#0284c7" />
                  <stop offset="50%" stopColor="#0ea5e9" />
                  <stop offset="100%" stopColor="#0369a1" />
                </linearGradient>

                <linearGradient id="rotorGradSlow" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#d97706" />
                  <stop offset="50%" stopColor="#f59e0b" />
                  <stop offset="100%" stopColor="#b45309" />
                </linearGradient>

                <linearGradient id="rotorGradStop" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#dc2626" />
                  <stop offset="50%" stopColor="#ef4444" />
                  <stop offset="100%" stopColor="#991b1b" />
                </linearGradient>

                {/* Drop shadow filter */}
                <filter id="shadowFilter" x="-10%" y="-10%" width="120%" height="120%">
                  <feDropShadow dx="0" dy="4" stdDeviation="4" floodOpacity="0.15" />
                </filter>
              </defs>

              {/* Mounting Base Plate */}
              <rect x="50" y="172" width="280" height="14" rx="3" fill="#64748b" />
              <rect x="40" y="184" width="300" height="8" rx="2" fill="#334155" />
              <circle cx="70" cy="180" r="3.5" fill="#1e293b" />
              <circle cx="310" cy="180" r="3.5" fill="#1e293b" />

              {/* Main Stator Body Housing */}
              <rect x="75" y="45" width="220" height="128" rx="10" fill="url(#statorGrad)" filter="url(#shadowFilter)" />

              {/* Stator Heat Sink Cooling Fins */}
              {[95, 115, 135, 155, 175, 195, 215, 235, 255, 275].map((x) => (
                <rect key={x} x={x} y="38" width="5" height="14" rx="2" fill="url(#finGrad)" />
              ))}

              {/* Terminal Junction Box (Top) */}
              <rect x="150" y="24" width="70" height="22" rx="3" fill="#1e293b" stroke="#475569" strokeWidth="1" />
              <circle cx="165" cy="35" r="3" fill="#f59e0b" />
              <circle cx="185" cy="35" r="3" fill="#f59e0b" />
              <circle cx="205" cy="35" r="3" fill="#f59e0b" />
              <text x="185" y="18" fill="#94a3b8" fontSize="8" fontWeight="bold" textAnchor="middle">
                3~ 400V 50Hz
              </text>

              {/* Non-Drive End (NDE) Bearing Housing */}
              <rect x="55" y="65" width="24" height="88" rx="4" fill="#475569" stroke="#334155" strokeWidth="1" />
              <text x="67" y="112" fill="#94a3b8" fontSize="8" fontWeight="bold" textAnchor="middle" transform="rotate(-90 67 112)">
                BEARING NDE
              </text>

              {/* Drive End (DE) Bearing Housing with Triaxial BLE Sensor */}
              <rect x="290" y="62" width="26" height="94" rx="4" fill="#475569" stroke="#334155" strokeWidth="1" />
              <text x="303" y="112" fill="#94a3b8" fontSize="8" fontWeight="bold" textAnchor="middle" transform="rotate(-90 303 112)">
                BEARING DE
              </text>

              {/* Triaxial BLE Sensor Pickup Node (Tagged) */}
              <rect x="294" y="42" width="18" height="16" rx="2" fill="#0284c7" stroke="#38bdf8" strokeWidth="1" />
              <circle cx="303" cy="50" r="2.5" fill="#ffffff" className={!isStopped ? 'pulse-sensor' : ''} />
              <text x="303" y="36" fill="#0284c7" fontSize="7.5" fontWeight="bold" textAnchor="middle">
                BLE NODE
              </text>

              {/* Drive Shaft (Through Core to Chuck) */}
              <rect x="30" y="103" width="370" height="14" rx="2" fill="url(#shaftGrad)" filter="url(#shadowFilter)" />

              {/* Machined Keyway on Drive Shaft */}
              <rect x="325" y="106" width="30" height="3" rx="1" fill="#475569" />

              {/* Rotating Rotor Spindle / Chuck / Flywheel Assembly */}
              <g transform={`translate(390, 110) rotate(${rotationAngle})`}>
                {/* Outer Rotor Wheel */}
                <circle
                  cx="0"
                  cy="0"
                  r="38"
                  fill={isStopped ? 'url(#rotorGradStop)' : isSlow ? 'url(#rotorGradSlow)' : 'url(#rotorGrad)'}
                  stroke="#ffffff"
                  strokeWidth="2"
                  filter="url(#shadowFilter)"
                />

                {/* Rotor Ventilation & Inspection Holes */}
                <circle cx="0" cy="-22" r="5" fill="#0f172a" opacity="0.85" />
                <circle cx="22" cy="0" r="5" fill="#0f172a" opacity="0.85" />
                <circle cx="0" cy="22" r="5" fill="#0f172a" opacity="0.85" />
                <circle cx="-22" cy="0" r="5" fill="#0f172a" opacity="0.85" />

                {/* 8 Radial Strobe Blades / Balancing Notches */}
                {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
                  <line
                    key={deg}
                    x1="0"
                    y1="-38"
                    x2="0"
                    y2="-28"
                    stroke="#ffffff"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    transform={`rotate(${deg})`}
                  />
                ))}

                {/* Center Arbor Nut & Shaft Pin */}
                <circle cx="0" cy="0" r="10" fill="#334155" stroke="#cbd5e1" strokeWidth="1.5" />
                <polygon points="0,-6 5,-3 5,3 0,6 -5,3 -5,-3" fill="#94a3b8" />
              </g>

              {/* Dynamic Rotation Velocity Overlay / Brake Caliper */}
              {isStopped ? (
                <g transform="translate(390, 110)">
                  {/* Mechanical Brake Caliper Clamp */}
                  <rect x="-42" y="-14" width="84" height="28" rx="4" fill="#991b1b" stroke="#fecaca" strokeWidth="1.5" opacity="0.95" />
                  <text x="0" y="5" fill="#ffffff" fontSize="9" fontWeight="bold" textAnchor="middle">
                    BRAKE LOCKED
                  </text>
                </g>
              ) : (
                <g transform="translate(390, 110)">
                  {/* Subtle Direction Arrow */}
                  <path
                    d="M -30,-48 A 54 54 0 0 1 30,-48"
                    fill="none"
                    stroke={isSlow ? '#f59e0b' : '#0284c7'}
                    strokeWidth="2.5"
                    strokeDasharray="4 2"
                  />
                  <polygon
                    points="32,-50 37,-43 30,-44"
                    fill={isSlow ? '#f59e0b' : '#0284c7'}
                  />
                  <text x="0" y="-55" fill={isSlow ? '#d97706' : '#0284c7'} fontSize="8.5" fontWeight="bold" textAnchor="middle">
                    {isSlow ? '50% THROTTLE (SLOW)' : '100% NOMINAL'}
                  </text>
                </g>
              )}

              {/* NDE Cooling Fan (Left) */}
              <g transform={`translate(42, 110) rotate(${rotationAngle * 1.2})`}>
                <rect x="-5" y="-30" width="10" height="60" rx="3" fill="#64748b" opacity="0.8" />
                <rect x="-30" y="-5" width="60" height="10" rx="3" fill="#64748b" opacity="0.8" />
              </g>
            </svg>
          </div>

          {/* Motor Status Summary Bar */}
          <div className="motor-schematic-footer">
            <div className="motor-metric-mini">
              <span className="mini-label">SHAFT SPEED:</span>
              <span className={`mini-value ${isStopped ? 'text-red' : isSlow ? 'text-amber' : 'text-green'}`}>
                {displayRpm.toFixed(0)} RPM
              </span>
            </div>
            <div className="motor-metric-mini">
              <span className="mini-label">ROTATION:</span>
              <span className="mini-value font-mono">
                {isStopped ? '0.0 rad/s (HALTED)' : `${angularVelocity} rad/s (CW)`}
              </span>
            </div>
            <div className="motor-metric-mini">
              <span className="mini-label">TORQUE:</span>
              <span className="mini-value font-mono">{isStopped ? '0.0 Nm' : `${estTorque} Nm`}</span>
            </div>
            <div className="motor-metric-mini">
              <span className="mini-label">STATOR CURRENT:</span>
              <span className="mini-value font-mono">{isStopped ? '0.00 A' : `${phaseCurrent} A`}</span>
            </div>
            <div className="motor-metric-mini">
              <span className="mini-label">EST. TEMP:</span>
              <span className="mini-value font-mono">{isStopped ? '28.0 °C' : `${estTemp} °C`}</span>
            </div>
          </div>
        </div>

        {/* Right: Precision Analog / Digital Tachometer & Controls */}
        <div className="tachometer-card">
          <div className="motor-card-header">
            <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Gauge size={15} color="#0284c7" />
              <span>Precision Shaft Tachometer</span>
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono' }}>
              0 - {maxScaleRpm.toLocaleString()} RPM SCALE
            </span>
          </div>

          {/* Circular Gauge Display */}
          <div className="tachometer-dial-container">
            <svg viewBox="0 0 240 155" className="tachometer-svg">
              {/* Outer Track Arc */}
              <path
                d="M 30,135 A 90 90 0 1 1 210,135"
                fill="none"
                stroke="#e2e8f0"
                strokeWidth="14"
                strokeLinecap="round"
              />

              {/* Slow / Safe Throttled Zone (0 to 65% of rated RPM) */}
              <path
                d="M 30,135 A 90 90 0 0 1 85,55"
                fill="none"
                stroke="#fde68a"
                strokeWidth="14"
              />

              {/* Nominal Full Speed Zone */}
              <path
                d="M 85,55 A 90 90 0 0 1 185,75"
                fill="none"
                stroke="#a7f3d0"
                strokeWidth="14"
              />

              {/* Overspeed Trip Zone */}
              <path
                d="M 185,75 A 90 90 0 0 1 210,135"
                fill="none"
                stroke="#fecaca"
                strokeWidth="14"
                strokeLinecap="round"
              />

              {/* Active Filled Arc */}
              <path
                d="M 30,135 A 90 90 0 1 1 210,135"
                fill="none"
                stroke={isStopped ? '#ef4444' : isSlow ? '#f59e0b' : '#10b981'}
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray="377"
                strokeDashoffset={Math.max(0, 377 - (377 * (clampedRpm / maxScaleRpm)))}
                style={{ transition: 'stroke-dashoffset 0.75s cubic-bezier(0.34, 1.25, 0.64, 1), stroke 0.35s ease' }}
              />

              {/* Dynamic Tick Marks & Scale Labels based on Measured Tachometer */}
              <text x="25" y="148" fill="#94a3b8" fontSize="8.5" fontWeight="bold">0</text>
              <text x="42" y="72" fill="#94a3b8" fontSize="8.5" fontWeight="bold">
                {maxScaleRpm >= 10000 ? `${(maxScaleRpm * 0.25 / 1000).toFixed(0)}k` : (maxScaleRpm * 0.25).toFixed(0)}
              </text>
              <text x="108" y="32" fill="#94a3b8" fontSize="8.5" fontWeight="bold">
                {maxScaleRpm >= 10000 ? `${(maxScaleRpm * 0.50 / 1000).toFixed(0)}k` : (maxScaleRpm * 0.50).toFixed(0)}
              </text>
              <text x="168" y="72" fill="#10b981" fontSize="8.5" fontWeight="bold">
                {nominalRatedRpm >= 10000 ? `${(nominalRatedRpm / 1000).toFixed(0)}k` : nominalRatedRpm.toFixed(0)}
              </text>
              <text x="195" y="148" fill="#ef4444" fontSize="8.5" fontWeight="bold">
                {maxScaleRpm >= 10000 ? `${(maxScaleRpm / 1000).toFixed(0)}k` : maxScaleRpm.toFixed(0)}
              </text>

              {/* Needle Indicator */}
              <g transform="translate(120, 135)">
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="-82"
                  stroke="#1e293b"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  transform={`rotate(${needleDeg})`}
                  style={{ transition: 'transform 0.75s cubic-bezier(0.34, 1.25, 0.64, 1)' }}
                />
                <circle cx="0" cy="0" r="8" fill="#1e293b" stroke="#cbd5e1" strokeWidth="2" />
                <circle cx="0" cy="0" r="3" fill="#ffffff" />
              </g>
            </svg>

            {/* High-Contrast Digital Readout */}
            <div className="tachometer-digital-display">
              <div className="digital-rpm-value font-mono">
                {displayRpm.toLocaleString('en-US', { maximumFractionDigits: 0, minimumFractionDigits: 0 })}
              </div>
              <div className="digital-rpm-unit">REVOLUTIONS / MINUTE (RPM)</div>

              <div className="target-tracking-line">
                <span>TARGET: <strong>{targetRpm.toFixed(0)} RPM</strong> ({commandedPct.toFixed(0)}%)</span>
                <span>•</span>
                <span>SLIP: <strong>{slipPct}%</strong></span>
                <span>•</span>
                <span>FREQ: <strong>{shaftFreqHz} Hz</strong></span>
              </div>
            </div>
          </div>


        </div>
      </div>

    </div>
  );
};
