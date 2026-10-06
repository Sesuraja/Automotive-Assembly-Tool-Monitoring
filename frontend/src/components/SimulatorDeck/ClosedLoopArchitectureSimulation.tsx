import React, { useState, useEffect } from 'react';
import type { LiveTelemetry, SimulatorState } from '../../types';
import { api } from '../../services/api';
import { useAppSettings } from '../../context/AppSettingsContext';
import {
  Activity,
  Wifi,
  Server,
  Cpu,
  ShieldAlert,
  Zap,
  RotateCw,
  Layers,
} from 'lucide-react';

interface ClosedLoopArchitectureSimulationProps {
  simState: SimulatorState | null;
  telemetry?: LiveTelemetry | null;
  onRefresh?: () => void;
}

export const ClosedLoopArchitectureSimulation: React.FC<ClosedLoopArchitectureSimulationProps> = ({
  simState,
  telemetry,
  onRefresh,
}) => {
  const { settings } = useAppSettings();
  const ratedRpm = Math.round(settings.motorRatedRpm || 1500);
  const reducedRpm = Math.round(ratedRpm * 0.5);

  const [isResetting, setIsResetting] = useState(false);
  const [localReading, setLocalReading] = useState<any>(null);

  useEffect(() => {
    if (telemetry) return;
    const pollTelemetry = async () => {
      try {
        const res = await api.getLatestReading();
        if (res) {
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

  const currentRpm = telemetry?.measured_rpm ?? localReading?.measured_rpm ?? simState?.virtual_rpm ?? ratedRpm;
  const commandedPct = telemetry?.commanded_speed_pct ?? (localReading?.status === 'OFF' ? 0 : localReading?.status === 'SLOW' ? 50 : 100);
  const state = telemetry?.state ?? (localReading?.status === 'OFF' ? 'STOPPED' : localReading?.status === 'SLOW' ? 'REDUCED_SPEED' : 'NORMAL');
  const indicatorLight = telemetry?.indicator_light ?? (localReading?.status === 'OFF' ? 'RED' : localReading?.status === 'SLOW' ? 'AMBER' : 'GREEN');
  const anomalyScore = telemetry?.smoothed_anomaly_score ?? (state === 'NORMAL' ? 0.04 : state === 'REDUCED_SPEED' ? 0.22 : 0.88);
  const rms = telemetry?.features?.rms ?? localReading?.rms_g ?? 0.48;
  const peak = telemetry?.features?.peak ?? (rms * 1.85);
  const dominantFreq = telemetry?.features?.dominant_freq ?? 333.3;
  const seq = telemetry?.seq ?? (localReading?.timestamp ? Math.floor(new Date(localReading.timestamp).getTime() / 1000) : 1001);

  const isStopped = currentRpm < 50 || state === 'STOPPED';
  const isSlow = !isStopped && (currentRpm < (ratedRpm * 0.65) || commandedPct <= 55 || state === 'REDUCED_SPEED');

  // Active status themes per stage
  const flowColor = isStopped ? '#ef4444' : isSlow ? '#f59e0b' : '#10b981';

  const handleRestart = async () => {
    setIsResetting(true);
    try {
      await api.commandMotor('RESET', ratedRpm);
      await api.resetStation('station-A', 'Operator', 'Restart from closed-loop simulation');
      if (onRefresh) onRefresh();
    } catch (e) {
      console.error('Failed to restart motor:', e);
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="b2b-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Layers size={18} color="#0284c7" />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
              End-to-End Closed-Loop AI Safety Pipeline
            </h3>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
            Real-time physical-to-digital signal chain: Vibration Sensor &rarr; BLE Gateway &rarr; Core Software &rarr; AI Anomaly Engine &rarr; Decision &rarr; Motor Controller &rarr; Spindle Deceleration
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {isStopped && (
            <button
              onClick={handleRestart}
              disabled={isResetting}
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
              <span>Restart Motor</span>
            </button>
          )}
          <span
            style={{
              padding: '0.25rem 0.65rem',
              borderRadius: 6,
              fontSize: '0.75rem',
              fontWeight: 700,
              background: isStopped ? '#fef2f2' : isSlow ? '#fffbeb' : '#ecfdf5',
              color: isStopped ? '#991b1b' : isSlow ? '#92400e' : '#065f46',
              border: `1px solid ${isStopped ? '#fecaca' : isSlow ? '#fde68a' : '#a7f3d0'}`,
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            <span className={`motor-pulse-dot ${isStopped ? 'red' : isSlow ? 'amber' : 'green'}`}></span>
            PIPELINE STATUS: {state.replace('_', ' ')}
          </span>
        </div>
      </div>

      {/* Interactive Architecture Flow Chain */}
      <div className="pipeline-flow-container">
        {/* Stage 1: Vibration Sensor Hardware */}
        <div className={`pipeline-node-card ${rms > 0.8 ? 'highlight-amber' : ''}`}>
          <div className="node-icon-header">
            <Activity size={18} color="#0284c7" />
            <span className="node-step-tag">STAGE 1</span>
          </div>
          <div className="node-title">Vibration Sensor</div>
          <div className="node-subtitle">Triaxial Hardware Node</div>

          <div className="node-metric-box">
            <div className="node-metric-row">
              <span>RMS:</span>
              <strong className="font-mono" style={{ color: rms > 0.8 ? '#d97706' : '#059669' }}>
                {rms.toFixed(3)}g
              </strong>
            </div>
            <div className="node-metric-row">
              <span>Peak:</span>
              <strong className="font-mono">{peak.toFixed(3)}g</strong>
            </div>
            <div className="node-metric-row">
              <span>Sampling:</span>
              <strong className="font-mono">1,000 Hz</strong>
            </div>
          </div>
          <div className="node-badge" style={{ background: '#e0f2fe', color: '#0369a1' }}>
            Sensors Active
          </div>
        </div>

        {/* Arrow 1: BLE 2.4 GHz */}
        <div className="pipeline-conduit">
          <div className="conduit-line" style={{ background: flowColor }}></div>
          <div className="conduit-pulse" style={{ background: flowColor }}></div>
          <div className="conduit-label">
            <Wifi size={12} />
            <span>BLE 2.4 GHz</span>
          </div>
        </div>

        {/* Stage 2: Industrial BLE Gateway */}
        <div className="pipeline-node-card">
          <div className="node-icon-header">
            <Server size={18} color="#0284c7" />
            <span className="node-step-tag">STAGE 2</span>
          </div>
          <div className="node-title">BLE Gateway</div>
          <div className="node-subtitle">Industrial Edge Hub</div>

          <div className="node-metric-box">
            <div className="node-metric-row">
              <span>RSSI:</span>
              <strong className="font-mono">-56 dBm</strong>
            </div>
            <div className="node-metric-row">
              <span>Rate:</span>
              <strong className="font-mono">10 Hz</strong>
            </div>
            <div className="node-metric-row">
              <span>Seq:</span>
              <strong className="font-mono">#{seq}</strong>
            </div>
          </div>
          <div className="node-badge" style={{ background: '#ecfdf5', color: '#065f46' }}>
            Gateway Online
          </div>
        </div>

        {/* Arrow 2: MQTT / JSON */}
        <div className="pipeline-conduit">
          <div className="conduit-line" style={{ background: flowColor }}></div>
          <div className="conduit-pulse" style={{ background: flowColor }}></div>
          <div className="conduit-label">
            <span>MQTT / JSON</span>
          </div>
        </div>

        {/* Stage 3: Core Monitoring Software */}
        <div className="pipeline-node-card">
          <div className="node-icon-header">
            <Layers size={18} color="#0284c7" />
            <span className="node-step-tag">STAGE 3</span>
          </div>
          <div className="node-title">Host Software</div>
          <div className="node-subtitle">Real-Time DSP Engine</div>

          <div className="node-metric-box">
            <div className="node-metric-row">
              <span>Latency:</span>
              <strong className="font-mono" style={{ color: '#059669' }}>&lt; 8 ms</strong>
            </div>
            <div className="node-metric-row">
              <span>Window:</span>
              <strong className="font-mono">1,000 pts</strong>
            </div>
            <div className="node-metric-row">
              <span>Dominant:</span>
              <strong className="font-mono" style={{ color: '#0284c7' }}>{dominantFreq.toFixed(0)} Hz</strong>
            </div>
          </div>
          <div className="node-badge" style={{ background: '#f1f5f9', color: '#334155' }}>
            Features Extracted
          </div>
        </div>

        {/* Arrow 3: Feature Vector */}
        <div className="pipeline-conduit">
          <div className="conduit-line" style={{ background: flowColor }}></div>
          <div className="conduit-pulse" style={{ background: flowColor }}></div>
          <div className="conduit-label">
            <span>DSP &rarr; AI</span>
          </div>
        </div>

        {/* Stage 4: AI Anomaly Detection */}
        <div className={`pipeline-node-card ${anomalyScore > 0.45 ? (anomalyScore > 0.7 ? 'highlight-red' : 'highlight-amber') : ''}`}>
          <div className="node-icon-header">
            <Cpu size={18} color={anomalyScore > 0.7 ? '#dc2626' : anomalyScore > 0.45 ? '#d97706' : '#0284c7'} />
            <span className="node-step-tag">STAGE 4</span>
          </div>
          <div className="node-title">AI Anomaly Engine</div>
          <div className="node-subtitle">Unsupervised Model</div>

          <div className="node-metric-box">
            <div className="node-metric-row">
              <span>Score:</span>
              <strong className="font-mono" style={{ color: anomalyScore > 0.7 ? '#dc2626' : anomalyScore > 0.45 ? '#d97706' : '#059669', fontSize: '0.9rem' }}>
                {anomalyScore.toFixed(3)}
              </strong>
            </div>
            <div className="node-metric-row">
              <span>Warn Ref:</span>
              <strong className="font-mono">0.45</strong>
            </div>
            <div className="node-metric-row">
              <span>Inference:</span>
              <strong className="font-mono">&lt; 2 ms</strong>
            </div>
          </div>
          <div
            className="node-badge"
            style={{
              background: anomalyScore > 0.7 ? '#fef2f2' : anomalyScore > 0.45 ? '#fffbeb' : '#ecfdf5',
              color: anomalyScore > 0.7 ? '#991b1b' : anomalyScore > 0.45 ? '#92400e' : '#065f46',
            }}
          >
            {anomalyScore > 0.7 ? 'Disturbance Trip' : anomalyScore > 0.45 ? 'Harmonic Disturbance' : 'Nominal Vibration'}
          </div>
        </div>

        {/* Arrow 4: Decision Loop */}
        <div className="pipeline-conduit">
          <div className="conduit-line" style={{ background: flowColor }}></div>
          <div className="conduit-pulse" style={{ background: flowColor }}></div>
          <div className="conduit-label">
            <span>Safety Rule</span>
          </div>
        </div>

        {/* Stage 5: Decision Engine */}
        <div className={`pipeline-node-card ${isStopped ? 'highlight-red' : isSlow ? 'highlight-amber' : ''}`}>
          <div className="node-icon-header">
            <ShieldAlert size={18} color={isStopped ? '#dc2626' : isSlow ? '#d97706' : '#10b981'} />
            <span className="node-step-tag">STAGE 5</span>
          </div>
          <div className="node-title">Decision Engine</div>
          <div className="node-subtitle">Dual-Layer State Machine</div>

          <div className="node-metric-box">
            <div className="node-metric-row">
              <span>State:</span>
              <strong style={{ color: isStopped ? '#dc2626' : isSlow ? '#d97706' : '#059669' }}>
                {state.replace('_', ' ')}
              </strong>
            </div>
            <div className="node-metric-row">
              <span>Beacon:</span>
              <strong style={{ color: indicatorLight === 'RED' ? '#dc2626' : indicatorLight === 'AMBER' ? '#d97706' : '#059669' }}>
                {indicatorLight}
              </strong>
            </div>
            <div className="node-metric-row">
              <span>Safety Logic:</span>
              <strong className="font-mono">ISO 10816</strong>
            </div>
          </div>
          <div
            className="node-badge"
            style={{
              background: isStopped ? '#fef2f2' : isSlow ? '#fffbeb' : '#ecfdf5',
              color: isStopped ? '#991b1b' : isSlow ? '#92400e' : '#065f46',
            }}
          >
            {isStopped ? 'Lockout Active' : isSlow ? 'Speed Reduced' : 'Normal Throughput'}
          </div>
        </div>

        {/* Arrow 5: Actuation PWM */}
        <div className="pipeline-conduit">
          <div className="conduit-line" style={{ background: flowColor }}></div>
          <div className="conduit-pulse" style={{ background: flowColor }}></div>
          <div className="conduit-label">
            <Zap size={12} />
            <span>Speed Command</span>
          </div>
        </div>

        {/* Stage 6: Edge Motor Controller */}
        <div className={`pipeline-node-card ${isStopped ? 'highlight-red' : isSlow ? 'highlight-amber' : ''}`}>
          <div className="node-icon-header">
            <Zap size={18} color={isStopped ? '#dc2626' : isSlow ? '#d97706' : '#0284c7'} />
            <span className="node-step-tag">STAGE 6</span>
          </div>
          <div className="node-title">Motor Controller</div>
          <div className="node-subtitle">Edge Actuator Interface</div>

          <div className="node-metric-box">
            <div className="node-metric-row">
              <span>Command:</span>
              <strong className="font-mono" style={{ color: isStopped ? '#dc2626' : isSlow ? '#d97706' : '#059669', fontSize: '0.9rem' }}>
                {commandedPct.toFixed(0)}%
              </strong>
            </div>
            <div className="node-metric-row">
              <span>Target:</span>
              <strong className="font-mono">{((commandedPct / 100) * ratedRpm).toFixed(0)} RPM</strong>
            </div>
            <div className="node-metric-row">
              <span>Action:</span>
              <strong>{isStopped ? 'SAFE STOP' : isSlow ? 'SLOW DOWN' : 'FULL SPEED'}</strong>
            </div>
          </div>
          <div
            className="node-badge"
            style={{
              background: isStopped ? '#fef2f2' : isSlow ? '#fffbeb' : '#ecfdf5',
              color: isStopped ? '#991b1b' : isSlow ? '#92400e' : '#065f46',
            }}
          >
            {isStopped ? '0% Brake Interlock' : isSlow ? '50% Throttled' : '100% Full Speed'}
          </div>
        </div>

        {/* Arrow 6: Motor Drive */}
        <div className="pipeline-conduit">
          <div className="conduit-line" style={{ background: flowColor }}></div>
          <div className="conduit-pulse" style={{ background: flowColor }}></div>
          <div className="conduit-label">
            <RotateCw size={12} />
            <span>Drive Shaft</span>
          </div>
        </div>

        {/* Stage 7: Spindle Motor */}
        <div className={`pipeline-node-card ${isStopped ? 'highlight-red' : isSlow ? 'highlight-amber' : 'highlight-green'}`}>
          <div className="node-icon-header">
            <RotateCw size={18} color={isStopped ? '#dc2626' : isSlow ? '#d97706' : '#059669'} className={!isStopped ? 'spin-smooth' : ''} />
            <span className="node-step-tag">STAGE 7</span>
          </div>
          <div className="node-title">Spindle Motor</div>
          <div className="node-subtitle">Fastening Spindle Rig</div>

          <div className="node-metric-box">
            <div className="node-metric-row">
              <span>Measured:</span>
              <strong className="font-mono" style={{ color: isStopped ? '#dc2626' : isSlow ? '#d97706' : '#059669', fontSize: '0.95rem' }}>
                {currentRpm.toFixed(0)} RPM
              </strong>
            </div>
            <div className="node-metric-row">
              <span>Rotation:</span>
              <strong>{isStopped ? 'STOPPED' : isSlow ? 'SLOW (50%)' : 'ROTATING (100%)'}</strong>
            </div>
            <div className="node-metric-row">
              <span>Brake:</span>
              <strong style={{ color: isStopped ? '#dc2626' : '#64748b' }}>
                {isStopped ? 'LOCKED' : 'RELEASED'}
              </strong>
            </div>
          </div>
          <div
            className="node-badge"
            style={{
              background: isStopped ? '#fef2f2' : isSlow ? '#fffbeb' : '#ecfdf5',
              color: isStopped ? '#991b1b' : isSlow ? '#92400e' : '#065f46',
            }}
          >
            {isStopped ? 'Motor Halted (0 RPM)' : isSlow ? `Motor Slowed (${reducedRpm} RPM)` : `Motor Running (${ratedRpm} RPM)`}
          </div>
        </div>
      </div>

    </div>
  );
};
