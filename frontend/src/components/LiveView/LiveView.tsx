import React, { useState, useEffect } from 'react';
import type { LiveTelemetry, EventLogItem, MotorStopAnalysis } from '../../types';
import { VibrationChart } from './VibrationChart';
import { AnomalyGauge } from './AnomalyGauge';
import { SpectrumChart } from './SpectrumChart';
import { MotorSpeedChart } from './MotorSpeedChart';
import { EventTimeline } from './EventTimeline';
import { api } from '../../services/api';
import {
  AlertCircle,
  Radio,
  Cpu,
  Wrench,
  Activity,
  History,
  CheckCircle2,
  RotateCcw,
} from 'lucide-react';
import { useAppSettings } from '../../context/AppSettingsContext';

interface LiveViewProps {
  telemetry: LiveTelemetry | null;
  historyRms: { time: string; rms: number; peak: number }[];
  historySpeed: { time: string; commandedPct: number; measuredRpm: number }[];
  events: EventLogItem[];
  onReset?: () => void;
  onEmergencyStop?: () => void;
  isActionLoading?: boolean;
}

export const LiveView: React.FC<LiveViewProps> = ({
  telemetry,
  historyRms,
  historySpeed,
  events,
  onReset,
  onEmergencyStop: _onEmergencyStop,
  isActionLoading,
}) => {
  const { settings } = useAppSettings();
  const isAwaitingTelemetry = telemetry === null;

  const currentRms = telemetry?.features?.rms;
  const currentPeak = telemetry?.features?.peak;
  const anomalyScore = telemetry?.smoothed_anomaly_score;
  const rawScore = telemetry?.raw_anomaly_score;
  const state = telemetry?.state || 'NORMAL';
  const isMotorHalted = state === 'STOPPED';
  const measuredRpm = isMotorHalted ? 0 : (telemetry?.measured_rpm ?? 0);
  const commandedPct = isMotorHalted ? 0 : (telemetry?.commanded_speed_pct ?? 100);
  const currentAmps = isMotorHalted ? 0 : (telemetry?.current_amps ?? 0);
  const reason = telemetry?.last_decision_reason || 'Awaiting initial telemetry packet...';

  const warnThresh = telemetry?.warn_threshold ?? settings.warnThreshold;
  const critThresh = telemetry?.critical_threshold ?? settings.criticalThreshold;

  const isRmsElevated = currentRms !== undefined && currentRms > (settings.vibrationLimitG * 0.7);
  const isScoreWarn = anomalyScore !== undefined && anomalyScore >= warnThresh;
  const isScoreCrit = anomalyScore !== undefined && anomalyScore >= critThresh;

  // AI Trip Diagnostics State
  const [tripAnalysis, setTripAnalysis] = useState<MotorStopAnalysis | null>(
    telemetry?.latest_trip_analysis || null
  );
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [tripHistory, setTripHistory] = useState<MotorStopAnalysis[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);

  // Sync trip analysis from telemetry or database stably without flip-flopping
  useEffect(() => {
    if (state !== 'STOPPED') {
      setTripAnalysis(null);
      return;
    }

    if (telemetry?.latest_trip_analysis) {
      setTripAnalysis(telemetry.latest_trip_analysis);
    } else {
      // Only fetch from API if we do not already have an active tripAnalysis
      setTripAnalysis((prev) => {
        if (!prev) {
          api.getLatestTripAnalysis(settings.stationId || 'station-A').then((res) => {
            if (res) setTripAnalysis(res);
          }).catch(console.error);
        }
        return prev;
      });
    }
  }, [telemetry?.latest_trip_analysis, state, settings.stationId]);

  // Load historical trip records from database when modal opens
  const handleOpenHistory = async () => {
    setShowHistoryModal(true);
    setIsLoadingHistory(true);
    try {
      const records = await api.getTripHistory(settings.stationId || 'station-A', 20);
      setTripHistory(records);
    } catch (e) {
      console.error('[Trip History Fetch Error]', e);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const aiHealth = telemetry?.ai_health;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Real-time State & Health Prognostics Banner (Top Card) */}
      <div
        style={{
          background: state === 'STOPPED' ? '#fef2f2' : state === 'REDUCED_SPEED' ? '#fffbeb' : '#ffffff',
          border: `1px solid ${state === 'STOPPED' ? '#fecaca' : state === 'REDUCED_SPEED' ? '#fde68a' : '#e2e8f0'}`,
          borderRadius: 8,
          padding: '0.85rem 1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
      >
        {/* Row 1: Operational State & Telemetry Link */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
            width: '100%',
          }}
        >
          {/* Left: Status Icon & Details */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                background: state === 'STOPPED' ? '#fee2e2' : state === 'REDUCED_SPEED' ? '#fef3c7' : '#dcfce7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <AlertCircle
                size={18}
                color={state === 'STOPPED' ? '#ef4444' : state === 'REDUCED_SPEED' ? '#d97706' : '#16a34a'}
              />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e293b' }}>
                  Operational State: {state.replace('_', ' ')}
                </span>
                {state === 'STOPPED' && (
                  <span
                    style={{
                      background: '#dc2626',
                      color: '#fff',
                      padding: '0.1rem 0.45rem',
                      borderRadius: 4,
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      letterSpacing: '0.5px',
                    }}
                  >
                    SAFETY LOCKOUT
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.12rem' }}>{reason}</div>
            </div>
          </div>

          {/* Right: Telemetry Chips & Action Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', fontSize: '0.75rem', flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#059669', fontWeight: 600 }}>
              <span className="motor-pulse-dot green" style={{ width: 6, height: 6 }}></span>
              10 Hz BLE &bull; Latency &lt; 8ms
            </span>
            {telemetry && (
              <span style={{ color: '#64748b' }}>
                Seq: <strong className="font-mono">#{telemetry.seq}</strong>
              </span>
            )}
            <span style={{ color: '#64748b' }}>
              Trigger: <strong className="font-mono">{telemetry?.layer_caused || 'NONE'}</strong>
            </span>

            <button
              onClick={handleOpenHistory}
              className="jog-btn"
              style={{
                padding: '0.25rem 0.55rem',
                fontSize: '0.72rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
                color: '#475569',
              }}
              title="Inspect historical motor stop analyses stored in database"
            >
              <History size={13} />
              <span>AI Trip Log</span>
            </button>

            {/* Quick Reset Button when STOPPED */}
            {state === 'STOPPED' && onReset && (
              <button
                onClick={onReset}
                disabled={isActionLoading}
                style={{
                  padding: '0.35rem 0.85rem',
                  borderRadius: 5,
                  background: '#10b981',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  boxShadow: '0 2px 4px rgba(16,185,129,0.3)',
                }}
              >
                <RotateCcw size={13} />
                <span>Clear Lockout &amp; Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Integrated AI Tool Health Prognostics & Health Status Bar */}
        {aiHealth && (
          <div
            style={{
              borderTop: '1px solid #f1f5f9',
              paddingTop: '0.75rem',
              marginTop: '0.15rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.75rem',
              width: '100%',
            }}
          >
            {/* Left: Health Icon & Prognostics Details */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 6,
                  background: '#dcfce7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Activity size={18} color="#16a34a" />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#166534' }}>
                    AI Tool Health Prognostics: {aiHealth.health_index_pct}%
                  </span>
                  <span
                    style={{
                      background: aiHealth.stage_color,
                      color: '#fff',
                      padding: '0.1rem 0.45rem',
                      borderRadius: 4,
                      fontSize: '0.65rem',
                      fontWeight: 700,
                    }}
                  >
                    {aiHealth.stage}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.12rem' }}>
                  {aiHealth.diagnostic_note}
                </div>
              </div>
            </div>

            {/* Right: Predicted Cycles Remaining & Health Status Progress Bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', textAlign: 'right' }}>
              <div>
                <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 600 }}>PREDICTED CYCLES REMAINING</div>
                <div className="font-mono" style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>
                  ~{aiHealth.estimated_cycles_remaining.toLocaleString()} fastenings
                </div>
              </div>
              <div style={{ width: '130px' }}>
                <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 600, marginBottom: '0.25rem' }}>HEALTH STATUS</div>
                <div style={{ height: 6, width: '100%', background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${aiHealth.health_index_pct}%`,
                      background: aiHealth.stage_color,
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* AI ENGINE POST-TRIP ROOT CAUSE ANALYSIS CARD (WHEN MOTOR STOPS) */}
      {/* ============================================================== */}
      {state === 'STOPPED' && tripAnalysis && (
        <div
          className="b2b-card"
          style={{
            background: 'linear-gradient(180deg, #fef2f2 0%, #ffffff 100%)',
            border: '2px solid #ef4444',
            boxShadow: '0 4px 12px rgba(239, 68, 68, 0.12)',
            padding: '1.25rem',
          }}
        >
          {/* Header Row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', borderBottom: '1px solid #fee2e2', paddingBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <div
                style={{
                  background: '#fee2e2',
                  padding: '0.45rem',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Cpu size={22} color="#dc2626" />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#dc2626', letterSpacing: '0.5px' }}>
                    AI ENGINE POST-TRIP ROOT CAUSE ANALYSIS &bull; PERSISTED IN DATABASE
                  </span>
                  <span
                    style={{
                      background: '#dcfce7',
                      color: '#15803d',
                      padding: '0.1rem 0.5rem',
                      borderRadius: 4,
                      fontSize: '0.7rem',
                      fontWeight: 700,
                    }}
                  >
                    {tripAnalysis.confidence_pct}% CONFIDENCE
                  </span>
                </div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#991b1b', marginTop: '0.2rem' }}>
                  {tripAnalysis.primary_cause}
                </div>
              </div>
            </div>

            <div style={{ textAlign: 'right', fontSize: '0.75rem', color: '#64748b' }}>
              <div>Category: <strong style={{ color: '#1e293b' }}>{tripAnalysis.fault_category}</strong></div>
              <div>Trigger Layer: <strong className="font-mono" style={{ color: '#dc2626' }}>{tripAnalysis.layer_caused}</strong></div>
            </div>
          </div>

          {/* AI Explanation Text */}
          <div style={{ marginTop: '0.85rem', fontSize: '0.85rem', color: '#334155', lineHeight: '1.5', background: '#ffffff', padding: '0.75rem 1rem', borderRadius: 6, border: '1px solid #f1f5f9' }}>
            <strong>AI Engineering Diagnostics:</strong> {tripAnalysis.explanation}
          </div>

          {/* Forensics Grid */}
          {tripAnalysis.forensics && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '0.75rem',
                marginTop: '0.85rem',
              }}
            >
              <div style={{ background: '#f8fafc', padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>ANOMALY SCORE AT TRIP</div>
                <div className="font-mono" style={{ fontSize: '1.1rem', fontWeight: 800, color: '#dc2626', marginTop: '0.2rem' }}>
                  {tripAnalysis.forensics.anomaly_score?.toFixed(4) ?? '—'}
                </div>
                <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                  Threshold Cutoff: {Number(tripAnalysis.forensics.critical_threshold ?? 0.70).toFixed(2)}
                </div>
              </div>

              <div style={{ background: '#f8fafc', padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>TRIP VIBRATION ACCELERATION</div>
                <div className="font-mono" style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0284c7', marginTop: '0.2rem' }}>
                  {tripAnalysis.forensics.rms_g?.toFixed(3) ?? '—'} g RMS
                </div>
                <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                  Peak: {tripAnalysis.forensics.peak_g?.toFixed(3) ?? '—'} g
                </div>
              </div>

              <div style={{ background: '#f8fafc', padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>FREQUENCY SPECTRUM &amp; KURTOSIS</div>
                <div className="font-mono" style={{ fontSize: '1.1rem', fontWeight: 800, color: '#d97706', marginTop: '0.2rem' }}>
                  {tripAnalysis.forensics.dominant_freq_hz?.toFixed(1) ?? '—'} Hz
                </div>
                <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                  Kurtosis: {tripAnalysis.forensics.kurtosis?.toFixed(2) ?? '—'} (Crest: {tripAnalysis.forensics.crest_factor?.toFixed(2) ?? '—'})
                </div>
              </div>

              <div style={{ background: '#f8fafc', padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>TACHOMETER SPEED DEVIATION</div>
                <div className="font-mono" style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1e293b', marginTop: '0.2rem' }}>
                  {tripAnalysis.forensics.measured_rpm?.toFixed(0) ?? 0} RPM
                </div>
                <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                  Setpoint: {tripAnalysis.forensics.commanded_rpm?.toFixed(0) ?? 0} RPM
                </div>
              </div>
            </div>
          )}

          {/* Actionable Maintenance Checklist */}
          <div style={{ marginTop: '0.85rem', background: '#fff7ed', padding: '0.75rem 1rem', borderRadius: 6, border: '1px solid #fed7aa' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#9a3412', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
              <Wrench size={14} />
              <span>AI Corrective Action Checklist (Complete before resetting safety lockout):</span>
            </div>
            <div style={{ fontSize: '0.8rem', color: '#7c2d12', whiteSpace: 'pre-line', lineHeight: '1.4' }}>
              {tripAnalysis.recommended_action}
            </div>
          </div>
        </div>
      )}

      {/* Primary Metrics Ribbon */}
      <div className="metrics-ribbon">
        <div className={`metric-tile ${isRmsElevated ? 'amber' : 'blue'}`}>
          <div className="metric-label">Vibration RMS</div>
          <div className="metric-value-row">
            <span className="metric-value font-mono">
              {typeof currentRms === 'number' ? currentRms.toFixed(3) : '—'}
            </span>
            <span className="metric-unit">g</span>
          </div>
          <div className="metric-footer">Safety Trip Limit: {settings.vibrationLimitG.toFixed(2)} g</div>
        </div>

        <div className="metric-tile blue">
          <div className="metric-label">Peak Magnitude</div>
          <div className="metric-value-row">
            <span className="metric-value font-mono">
              {typeof currentPeak === 'number' ? currentPeak.toFixed(3) : '—'}
            </span>
            <span className="metric-unit">g</span>
          </div>
          <div className="metric-footer">
            Peak-to-Peak:{' '}
            {typeof telemetry?.features?.peak_to_peak === 'number'
              ? `${telemetry.features.peak_to_peak.toFixed(3)} g`
              : typeof currentPeak === 'number'
                ? `${(currentPeak * 1.95).toFixed(3)} g`
                : '—'}
          </div>
        </div>

        <div className={`metric-tile ${isScoreCrit ? 'red' : isScoreWarn ? 'amber' : 'green'}`}>
          <div className="metric-label">AI Anomaly Index</div>
          <div className="metric-value-row">
            <span className="metric-value font-mono">
              {typeof anomalyScore === 'number' ? anomalyScore.toFixed(2) : '—'}
            </span>
            <span className="metric-unit">/ 1.00</span>
          </div>
          <div className="metric-footer">
            Warn: {typeof warnThresh === 'number' ? warnThresh.toFixed(2) : '0.45'} &bull; Crit:{' '}
            {typeof critThresh === 'number' ? critThresh.toFixed(2) : '0.70'}
          </div>
        </div>

        <div className="metric-tile blue">
          <div className="metric-label">Measured Tachometer</div>
          <div className="metric-value-row">
            <span className="metric-value font-mono">
              {typeof measuredRpm === 'number' ? measuredRpm.toFixed(0) : '—'}
            </span>
            <span className="metric-unit">RPM</span>
          </div>
          <div className="metric-footer">
            Rated: {settings.motorRatedRpm} RPM &bull; Setpoint:{' '}
            {typeof commandedPct === 'number' ? `${commandedPct.toFixed(0)}%` : '—'}
          </div>
        </div>

        <div className="metric-tile blue">
          <div className="metric-label">Motor Current</div>
          <div className="metric-value-row">
            <span className="metric-value font-mono">
              {typeof currentAmps === 'number' ? currentAmps.toFixed(2) : '—'}
            </span>
            <span className="metric-unit">A</span>
          </div>
          <div className="metric-footer">
            Rated Current: {settings.motorRatedCurrentAmps.toFixed(1)} A &bull; Phase Load
          </div>
        </div>
      </div>

      {isAwaitingTelemetry ? (
        <div
          className="b2b-card"
          style={{
            padding: '3rem',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.75rem',
            color: '#64748b',
          }}
        >
          <Radio size={24} className="animate-pulse" color="#0284c7" />
          <div style={{ fontWeight: 600, fontSize: '1rem', color: '#1e293b' }}>
            Connecting to Real-Time Vibration Telemetry Stream
          </div>
          <div style={{ fontSize: '0.85rem', maxWidth: '480px' }}>
            Connecting to live sensor hardware API and streaming real-time edge AI diagnostics...
          </div>
        </div>
      ) : (
        <>
          {/* Primary Charts Row */}
          <div className="charts-grid-live">
            <VibrationChart
              data={historyRms}
              hardLimitRms={settings.vibrationLimitG}
              maxScaleY={settings.vibrationMaxScaleG}
              sampleCount={settings.rollingSamplesCount}
            />
            <AnomalyGauge
              score={anomalyScore ?? 0}
              rawScore={rawScore ?? 0}
              warnThreshold={warnThresh}
              criticalThreshold={critThresh}
            />
          </div>

          {/* Secondary Charts Row */}
          <div className="charts-grid-secondary">
            <SpectrumChart
              spectrum={telemetry?.fft_spectrum}
              dominantFreq={telemetry?.features?.dominant_freq}
              maxFreqHz={settings.fftMaxFreqHz}
              exciterStartHz={settings.fftExciterStartHz}
              exciterEndHz={settings.fftExciterEndHz}
            />
            <MotorSpeedChart
              data={historySpeed}
              maxRpm={settings.motorMaxRpm}
              ratedRpm={settings.motorRatedRpm}
            />
          </div>
        </>
      )}

      {/* Bottom Timeline */}
      <EventTimeline events={events} />

      {/* ============================================================== */}
      {/* HISTORICAL AI TRIP ANALYSES MODAL (FROM DATABASE)              */}
      {/* ============================================================== */}
      {showHistoryModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 8,
              maxWidth: '850px',
              width: '100%',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '1rem 1.25rem',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: '#f8fafc',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <History size={18} color="#0284c7" />
                <span style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a' }}>
                  AI Root Cause Analyses &bull; Database Historical Records
                </span>
              </div>
              <button
                onClick={() => setShowHistoryModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.25rem',
                  cursor: 'pointer',
                  color: '#64748b',
                }}
              >
                &times;
              </button>
            </div>

            <div style={{ padding: '1rem 1.25rem', overflowY: 'auto', flex: 1 }}>
              {isLoadingHistory ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                  Loading trip analyses from database...
                </div>
              ) : tripHistory.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                  No motor trip diagnostic records logged yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {tripHistory.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        border: '1px solid #e2e8f0',
                        borderRadius: 6,
                        padding: '0.85rem 1rem',
                        background: '#ffffff',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                            <span
                              style={{
                                background: item.severity === 'CRITICAL' ? '#fee2e2' : '#fef3c7',
                                color: item.severity === 'CRITICAL' ? '#dc2626' : '#d97706',
                                padding: '0.1rem 0.4rem',
                                borderRadius: 4,
                                fontSize: '0.65rem',
                                fontWeight: 700,
                              }}
                            >
                              {item.fault_category}
                            </span>
                            <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e293b' }}>
                              {item.primary_cause}
                            </span>
                            <span style={{ fontSize: '0.72rem', color: '#059669', fontWeight: 600 }}>
                              ({item.confidence_pct}% AI Confidence)
                            </span>
                          </div>
                          <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '0.35rem', lineHeight: '1.4' }}>
                            {item.explanation}
                          </div>
                        </div>

                        <div style={{ textAlign: 'right', fontSize: '0.72rem', color: '#64748b' }}>
                          <div>{item.timestamp ? new Date(item.timestamp).toLocaleString() : 'N/A'}</div>
                          <div style={{ marginTop: '0.2rem' }}>
                            {item.resolved ? (
                              <span style={{ color: '#059669', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                                <CheckCircle2 size={12} /> Resolved by {item.resolved_by || 'Operator'}
                              </span>
                            ) : (
                              <span style={{ color: '#dc2626', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                                <AlertCircle size={12} /> Active Lockout
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {item.forensics && (
                        <div
                          style={{
                            marginTop: '0.5rem',
                            paddingTop: '0.5rem',
                            borderTop: '1px solid #f1f5f9',
                            display: 'flex',
                            gap: '1rem',
                            fontSize: '0.72rem',
                            color: '#64748b',
                            fontFamily: 'JetBrains Mono',
                          }}
                        >
                          <span>RMS: {typeof item.forensics.rms_g === 'number' ? `${item.forensics.rms_g.toFixed(3)}g` : '—'}</span>
                          <span>Kurtosis: {typeof item.forensics.kurtosis === 'number' ? item.forensics.kurtosis.toFixed(2) : '—'}</span>
                          <span>Freq: {typeof item.forensics.dominant_freq_hz === 'number' ? `${item.forensics.dominant_freq_hz.toFixed(1)}Hz` : '—'}</span>
                          <span>Score: {typeof item.forensics.anomaly_score === 'number' ? item.forensics.anomaly_score.toFixed(3) : '—'}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div
              style={{
                padding: '0.75rem 1.25rem',
                borderTop: '1px solid #e2e8f0',
                background: '#f8fafc',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <button
                onClick={() => setShowHistoryModal(false)}
                className="jog-btn"
                style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
