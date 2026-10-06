import React, { useState, useEffect } from 'react';
import { useAppSettings } from '../../context/AppSettingsContext';
import { api } from '../../services/api';
import { ModelStudio } from '../ModelStudio/ModelStudio';
import type { MLModel, RecordingItem, UserRole } from '../../types';
import {
  Clock,
  Building,
  Tag,
  Radio,
  Upload,
  CheckCircle,
  RefreshCw,
  Globe,
  Sliders,
  Sparkles,
  Activity,
  BarChart2,
  Gauge,
  ShieldCheck,
  Power,
  Play,
  Square,
  AlertOctagon,
  Database,
  Trash2,
  HardDrive,
  Shield,
} from 'lucide-react';

const PRESET_TIMEZONES = [
  { id: 'Asia/Kolkata', label: 'India Standard Time (IST)', offset: '+05:30' },
  { id: 'UTC', label: 'Coordinated Universal Time (UTC)', offset: '+00:00' },
  { id: 'America/New_York', label: 'US Eastern Time (EST/EDT)', offset: '-05:00' },
  { id: 'America/Chicago', label: 'US Central Time (CST/CDT)', offset: '-06:00' },
  { id: 'America/Los_Angeles', label: 'US Pacific Time (PST/PDT)', offset: '-08:00' },
  { id: 'Europe/London', label: 'London / GMT / BST', offset: '+00:00' },
  { id: 'Europe/Berlin', label: 'Central European Time (CET)', offset: '+01:00' },
  { id: 'Asia/Tokyo', label: 'Japan Standard Time (JST)', offset: '+09:00' },
  { id: 'Asia/Singapore', label: 'Singapore Time (SGT)', offset: '+08:00' },
  { id: 'Australia/Sydney', label: 'Australian Eastern Time (AEST)', offset: '+10:00' },
];

const PRESET_STATIONS = [
  { id: 'station-A', name: 'Station 4A - Multi-Spindle Angle Nutrunner' },
  { id: 'station-B', name: 'Station 4B - Cylinder Head Torque Spindle' },
  { id: 'station-C', name: 'Station 4C - Camshaft Fastening Rig' },
  { id: 'station-D', name: 'Station 4D - Transmission Case Bolting Deck' },
];

const PRESET_LOGOS = [
  { id: 'aperture', label: 'Aperture Default HD', url: '/aperture-logo-hd.png' },
  { id: 'icon', label: 'Aperture Minimal Icon', url: '/aperture-icon.png' },
];

export interface SettingsPageProps {
  models?: MLModel[];
  recordings?: RecordingItem[];
  currentUserRole?: UserRole;
  onRefresh?: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  models = [],
  recordings = [],
  currentUserRole = 'Admin',
  onRefresh = () => {},
}) => {
  const { settings, updateSettings, formatTime, formatDateTime, allTimezones } = useAppSettings();

  // Basic platform identity state
  const [timezone, setTimezone] = useState<string>(settings.timezone);
  const [stationId, setStationId] = useState<string>(settings.stationId);
  const [stationName, setStationName] = useState<string>(settings.stationName);
  const [companyName, setCompanyName] = useState<string>(settings.companyName);
  const [brandName, setBrandName] = useState<string>(settings.brandName);
  const [companyLogo, setCompanyLogo] = useState<string>(settings.companyLogo);

  // Live Vibration Rolling Profile Tuning
  const [vibrationLimitG, setVibrationLimitG] = useState<number>(settings.vibrationLimitG ?? 1.25);
  const [vibrationMaxScaleG, setVibrationMaxScaleG] = useState<number>(settings.vibrationMaxScaleG ?? 2.50);
  const [rollingSamplesCount, setRollingSamplesCount] = useState<number>(settings.rollingSamplesCount ?? 60);

  // FFT Frequency Spectrum Range
  const [fftMaxFreqHz, setFftMaxFreqHz] = useState<number>(settings.fftMaxFreqHz ?? 500.0);
  const [fftExciterStartHz, setFftExciterStartHz] = useState<number>(settings.fftExciterStartHz ?? 150.0);
  const [fftExciterEndHz, setFftExciterEndHz] = useState<number>(settings.fftExciterEndHz ?? 250.0);

  // Motor Speed & Drive Telemetry Limits
  const [motorMaxRpm, setMotorMaxRpm] = useState<number>(settings.motorMaxRpm ?? 2000.0);
  const [motorRatedRpm, setMotorRatedRpm] = useState<number>(settings.motorRatedRpm ?? 1500.0);
  const [motorRatedCurrentAmps, setMotorRatedCurrentAmps] = useState<number>(settings.motorRatedCurrentAmps ?? 6.5);

  // Threshold Tuning & Model Training
  const [warnThreshold, setWarnThreshold] = useState<number>(settings.warnThreshold ?? 0.45);
  const [criticalThreshold, setCriticalThreshold] = useState<number>(settings.criticalThreshold ?? 0.70);
  const [persistenceWindows, setPersistenceWindows] = useState<number>(settings.persistenceWindows ?? 3);

  // Motor Auto Stop / Manual Stop & Restart Control
  const [motorTripMode, setMotorTripMode] = useState<'AUTO' | 'MANUAL'>(settings.motorTripMode ?? 'AUTO');
  const [autoRestartEnabled, setAutoRestartEnabled] = useState<boolean>(settings.autoRestartEnabled ?? false);
  const [policySaveStatus, setPolicySaveStatus] = useState<string | null>(null);
  const [motorCmdFeedback, setMotorCmdFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isExecutingMotorCmd, setIsExecutingMotorCmd] = useState<boolean>(false);

  // Immediate persistence handlers for motor control policy so changes persist permanently without waiting for form submit
  const handleSelectMotorMode = async (mode: 'AUTO' | 'MANUAL') => {
    setMotorTripMode(mode);
    setPolicySaveStatus(`Saving policy: ${mode === 'MANUAL' ? 'MANUAL STOP (Operator Advisory)' : 'AUTO STOP (Autonomous AI)'}...`);
    try {
      await updateSettings({ motorTripMode: mode });
      setPolicySaveStatus(
        `✓ Permanent Policy Saved: ${mode === 'MANUAL' ? 'MANUAL STOP (Operator Advisory)' : 'AUTO STOP (Autonomous AI)'} active. Persisted across all restarts.`
      );
    } catch (err: any) {
      setPolicySaveStatus(`Saved locally: ${mode === 'MANUAL' ? 'MANUAL STOP' : 'AUTO STOP'}`);
    }
    setTimeout(() => setPolicySaveStatus(null), 5000);
  };

  const handleToggleAutoRestart = async (enabled: boolean) => {
    setAutoRestartEnabled(enabled);
    setPolicySaveStatus(`Updating auto-restart: ${enabled ? 'ENABLED' : 'MANUAL REQUIRED'}...`);
    try {
      await updateSettings({ autoRestartEnabled: enabled });
      setPolicySaveStatus(
        `✓ Permanent Auto-Restart Policy Saved: ${enabled ? 'AUTO-RESTART ENABLED' : 'MANUAL RESTART REQUIRED'}.`
      );
    } catch (err: any) {
      setPolicySaveStatus(`Saved locally: ${enabled ? 'ENABLED' : 'MANUAL REQUIRED'}`);
    }
    setTimeout(() => setPolicySaveStatus(null), 5000);
  };

  const [tzSearch, setTzSearch] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [currentTick, setCurrentTick] = useState<Date>(new Date());

  // Database Storage & Retention Management State
  const [dbStats, setDbStats] = useState<any>(null);
  const [retentionChoice, setRetentionChoice] = useState<string>('1_month');
  const [isCleaningDb, setIsCleaningDb] = useState<boolean>(false);
  const [isVacuumingDb, setIsVacuumingDb] = useState<boolean>(false);
  const [dbCleanFeedback, setDbCleanFeedback] = useState<{ type: 'success' | 'error'; text: string; details?: any } | null>(null);

  const fetchDbMetrics = async () => {
    try {
      const stats = await api.getDatabaseStats();
      setDbStats(stats);
      if (stats.current_retention_policy) {
        setRetentionChoice(stats.current_retention_policy);
      }
    } catch (err) {
      console.error('[DB Stats Error]', err);
    }
  };

  useEffect(() => {
    fetchDbMetrics();
  }, []);

  const handleExecuteDbCleanup = async () => {
    setIsCleaningDb(true);
    setDbCleanFeedback(null);
    try {
      const res = await api.cleanupDatabase(retentionChoice, true);
      setDbCleanFeedback({
        type: 'success',
        text: `Successfully purged ${res.total_records_deleted} old records. Reclaimed ${res.reclaimed_mb} MB of physical storage. Database size compacted from ${res.initial_size_mb} MB to ${res.final_size_mb} MB.`,
        details: res,
      });
      await fetchDbMetrics();
    } catch (err: any) {
      setDbCleanFeedback({
        type: 'error',
        text: `Database cleanup failed: ${err.message || err}`,
      });
    } finally {
      setIsCleaningDb(false);
      setTimeout(() => setDbCleanFeedback(null), 10000);
    }
  };

  const handleExecuteVacuumOnly = async () => {
    setIsVacuumingDb(true);
    setDbCleanFeedback(null);
    try {
      const res = await api.vacuumDatabase();
      setDbCleanFeedback({
        type: 'success',
        text: `Database VACUUM complete. Freed ${res.reclaimed_mb} MB of disk space. Current file size: ${res.final_size_mb} MB.`,
        details: res,
      });
      await fetchDbMetrics();
    } catch (err: any) {
      setDbCleanFeedback({
        type: 'error',
        text: `VACUUM failed: ${err.message || err}`,
      });
    } finally {
      setIsVacuumingDb(false);
      setTimeout(() => setDbCleanFeedback(null), 8000);
    }
  };



  // Live ticking clock in selected timezone
  useEffect(() => {
    const timer = setInterval(() => setCurrentTick(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Sync state if external settings change
  useEffect(() => {
    setTimezone(settings.timezone);
    setStationId(settings.stationId);
    setStationName(settings.stationName);
    setCompanyName(settings.companyName);
    setBrandName(settings.brandName);
    setCompanyLogo(settings.companyLogo);
    setVibrationLimitG(settings.vibrationLimitG ?? 1.25);
    setVibrationMaxScaleG(settings.vibrationMaxScaleG ?? 2.50);
    setRollingSamplesCount(settings.rollingSamplesCount ?? 60);
    setFftMaxFreqHz(settings.fftMaxFreqHz ?? 500.0);
    setFftExciterStartHz(settings.fftExciterStartHz ?? 150.0);
    setFftExciterEndHz(settings.fftExciterEndHz ?? 250.0);
    setMotorMaxRpm(settings.motorMaxRpm ?? 2000.0);
    setMotorRatedRpm(settings.motorRatedRpm ?? 1500.0);
    setMotorRatedCurrentAmps(settings.motorRatedCurrentAmps ?? 6.5);
    setWarnThreshold(settings.warnThreshold ?? 0.45);
    setCriticalThreshold(settings.criticalThreshold ?? 0.70);
    setPersistenceWindows(settings.persistenceWindows ?? 3);
    setMotorTripMode(settings.motorTripMode ?? 'AUTO');
    setAutoRestartEnabled(settings.autoRestartEnabled ?? false);
  }, [settings]);

  // Handle station preset select
  const handleStationSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const chosen = e.target.value;
    setStationId(chosen);
    const match = PRESET_STATIONS.find((s) => s.id === chosen);
    if (match) {
      setStationName(match.name);
    }
  };

  // Handle custom image upload
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert('File size exceeds 2 MB. Please select a smaller logo image.');
        return;
      }
      const reader = new FileReader();
      reader.onload = (uploadEvent) => {
        if (uploadEvent.target?.result) {
          setCompanyLogo(uploadEvent.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Immediate API Motor Stop test
  const handleTestMotorStop = async () => {
    setIsExecutingMotorCmd(true);
    setMotorCmdFeedback(null);
    try {
      await api.stopMotor(stationId, `Manual emergency motor stop commanded via Settings Console for ${stationId}`);
      setMotorCmdFeedback({
        type: 'success',
        text: `Motor STOP executed via API for ${stationId}. Motor status switched to OFF / STOPPED (0 RPM). Interlock engaged.`,
      });
    } catch (err: any) {
      setMotorCmdFeedback({
        type: 'error',
        text: `Motor STOP API failed: ${err.message || err}`,
      });
    } finally {
      setIsExecutingMotorCmd(false);
      setTimeout(() => setMotorCmdFeedback(null), 7000);
    }
  };

  // Immediate API Motor Restart test
  const handleTestMotorRestart = async () => {
    setIsExecutingMotorCmd(true);
    setMotorCmdFeedback(null);
    try {
      await api.restartMotor(stationId, `Motor restarted via Settings Console for ${stationId}`);
      setMotorCmdFeedback({
        type: 'success',
        text: `Motor RESTART executed via API for ${stationId}. Restored to NORMAL (100% rated speed / GREEN light).`,
      });
    } catch (err: any) {
      setMotorCmdFeedback({
        type: 'error',
        text: `Motor RESTART API failed: ${err.message || err}`,
      });
    } finally {
      setIsExecutingMotorCmd(false);
      setTimeout(() => setMotorCmdFeedback(null), 7000);
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      await updateSettings({
        timezone,
        stationId,
        stationName,
        companyName,
        brandName,
        companyLogo,
        vibrationLimitG,
        vibrationMaxScaleG,
        rollingSamplesCount,
        fftMaxFreqHz,
        fftExciterStartHz,
        fftExciterEndHz,
        motorMaxRpm,
        motorRatedRpm,
        motorRatedCurrentAmps,
        warnThreshold,
        criticalThreshold,
        persistenceWindows,
        motorTripMode,
        autoRestartEnabled,
      });

      // Synchronize thresholds with active model in database and station decision engine
      const activeModel = models.find((m) => m.active_flag) || models[0];
      if (activeModel?.version) {
        try {
          await api.editModel(activeModel.version, {
            warn_threshold: warnThreshold,
            critical_threshold: criticalThreshold,
          });
        } catch (mErr) {
          console.warn('[SettingsPage] editModel sync error:', mErr);
        }
      }
      try {
        await api.updateStationThresholds(stationId || 'station-A', {
          warn_threshold: warnThreshold,
          critical_threshold: criticalThreshold,
          persistence_windows: persistenceWindows,
        });
      } catch (sErr) {
        console.warn('[SettingsPage] updateStationThresholds error:', sErr);
      }
      onRefresh();

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err) {
      alert('Failed to save settings: ' + err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetDefaults = async () => {
    if (window.confirm('Reset all branding, telemetry scales, and model thresholds to factory defaults?')) {
      const defaults = {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
        stationId: 'station-A',
        stationName: 'Station 4A - Multi-Spindle Angle Nutrunner',
        companyName: 'Apex Dynamics Powertrain',
        brandName: 'Aperture',
        companyLogo: '/aperture-logo-hd.png',
        vibrationLimitG: 1.25,
        vibrationMaxScaleG: 2.50,
        rollingSamplesCount: 60,
        fftMaxFreqHz: 500.0,
        fftExciterStartHz: 150.0,
        fftExciterEndHz: 250.0,
        motorMaxRpm: 2000.0,
        motorRatedRpm: 1500.0,
        motorRatedCurrentAmps: 6.5,
        warnThreshold: 0.45,
        criticalThreshold: 0.70,
        persistenceWindows: 3,
        motorTripMode: 'AUTO' as const,
        autoRestartEnabled: false,
      };
      setTimezone(defaults.timezone);
      setStationId(defaults.stationId);
      setStationName(defaults.stationName);
      setCompanyName(defaults.companyName);
      setBrandName(defaults.brandName);
      setCompanyLogo(defaults.companyLogo);
      setVibrationLimitG(defaults.vibrationLimitG);
      setVibrationMaxScaleG(defaults.vibrationMaxScaleG);
      setRollingSamplesCount(defaults.rollingSamplesCount);
      setFftMaxFreqHz(defaults.fftMaxFreqHz);
      setFftExciterStartHz(defaults.fftExciterStartHz);
      setFftExciterEndHz(defaults.fftExciterEndHz);
      setMotorMaxRpm(defaults.motorMaxRpm);
      setMotorRatedRpm(defaults.motorRatedRpm);
      setMotorRatedCurrentAmps(defaults.motorRatedCurrentAmps);
      setWarnThreshold(defaults.warnThreshold);
      setCriticalThreshold(defaults.criticalThreshold);
      setPersistenceWindows(defaults.persistenceWindows);
      setMotorTripMode(defaults.motorTripMode);
      setAutoRestartEnabled(defaults.autoRestartEnabled);

      await updateSettings(defaults);

      const activeModel = models.find((m) => m.active_flag) || models[0];
      if (activeModel?.version) {
        try {
          await api.editModel(activeModel.version, {
            warn_threshold: defaults.warnThreshold,
            critical_threshold: defaults.criticalThreshold,
          });
        } catch (mErr) {
          console.warn('[SettingsPage] editModel sync error:', mErr);
        }
      }
      try {
        await api.updateStationThresholds(defaults.stationId || 'station-A', {
          warn_threshold: defaults.warnThreshold,
          critical_threshold: defaults.criticalThreshold,
          persistence_windows: defaults.persistenceWindows,
        });
      } catch (sErr) {
        console.warn('[SettingsPage] updateStationThresholds error:', sErr);
      }
      onRefresh();

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    }
  };

  const filteredTimezones = allTimezones.filter((tz) =>
    tz.toLowerCase().includes(tzSearch.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
      {/* Top Banner & Action Controls */}
      <div className="b2b-card" style={{ background: '#f8fafc', borderLeft: '4px solid #0284c7' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Sliders size={20} color="#0284c7" />
              <h2 className="b2b-card-title" style={{ fontSize: '1.25rem', margin: 0 }}>
                Enterprise System & Station Calibration
              </h2>
            </div>
            <div className="b2b-card-subtitle" style={{ marginTop: '0.35rem' }}>
              Dynamically customize global World Timezone, Active Station, Live Vibration Scaling, FFT Range, Motor Limits, and AI Model Thresholds.
              All modifications apply dynamically in real-time to the Live Dashboard, Model Studio, Audit Trail, and History.
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={handleResetDefaults}
              className="btn-b2b"
              style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#475569', fontSize: '0.8rem' }}
            >
              <RefreshCw size={14} />
              <span>Reset Defaults</span>
            </button>
            <button
              type="button"
              onClick={() => handleSave()}
              disabled={isSaving}
              className="btn-b2b"
              style={{
                background: '#0284c7',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                fontSize: '0.85rem',
                padding: '0.5rem 1.25rem',
              }}
            >
              <CheckCircle size={15} />
              <span>{isSaving ? 'Applying Globally...' : 'Save & Apply Globally'}</span>
            </button>
          </div>
        </div>

        {saveSuccess && (
          <div
            style={{
              marginTop: '1rem',
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              borderRadius: 6,
              padding: '0.65rem 1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              color: '#065f46',
              fontSize: '0.85rem',
              fontWeight: 600,
            }}
          >
            <CheckCircle size={16} color="#10b981" />
            <span>
              Settings saved &amp; applied globally! Live Vibration scale, FFT frequency range, Motor speed/current, and AI Model thresholds have been updated in the runtime decision engine and across all dashboard views.
            </span>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* ROW 1: DYNAMIC TELEMETRY SCALING & HIGH-SPEED/HIGH-HZ CALIBRATION         */}
      {/* ========================================================================= */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1.5rem' }}>
        
        {/* Card 1: Live Vibration Rolling Profile */}
        <div className="b2b-card">
          <div className="b2b-card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={18} color="#0284c7" />
            <span>Live Vibration Rolling Profile Tuning</span>
          </div>
          <div className="b2b-card-subtitle">
            Configure triaxial accelerometer safety trip limit, chart maximum g-scale, and rolling buffer depth.
          </div>

          <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Safety Limit (g) */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>
                  FIXED SAFETY TRIP LIMIT (g)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <input
                    type="number"
                    min="0.1"
                    max="15.0"
                    step="0.05"
                    value={vibrationLimitG}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val)) setVibrationLimitG(val);
                    }}
                    style={{
                      width: '75px',
                      padding: '0.2rem 0.45rem',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      color: '#ef4444',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      textAlign: 'right',
                      background: '#ffffff',
                    }}
                  />
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#ef4444' }}>g</span>
                </div>
              </div>
              <input
                type="range"
                min="0.5"
                max="10.0"
                step="0.05"
                value={vibrationLimitG}
                onChange={(e) => setVibrationLimitG(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: '#ef4444', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#94a3b8' }}>
                <span>0.50 g (Ultra-Sensitive)</span>
                <span>1.25 g (ISO 10816 Std)</span>
                <span>10.00 g (Extreme Press)</span>
              </div>
            </div>

            {/* Max Y-Axis Scale (g) */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>
                  CHART MAX Y-AXIS SCALE (g)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <input
                    type="number"
                    min="0.5"
                    max="25.0"
                    step="0.1"
                    value={vibrationMaxScaleG}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val)) setVibrationMaxScaleG(val);
                    }}
                    style={{
                      width: '75px',
                      padding: '0.2rem 0.45rem',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      color: '#0284c7',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      textAlign: 'right',
                      background: '#ffffff',
                    }}
                  />
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0284c7' }}>g</span>
                </div>
              </div>
              <input
                type="range"
                min="1.0"
                max="20.0"
                step="0.5"
                value={vibrationMaxScaleG}
                onChange={(e) => setVibrationMaxScaleG(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: '#0284c7', cursor: 'pointer' }}
              />
            </div>

            {/* Rolling Samples Window */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>
                  ROLLING SAMPLE BUFFER DEPTH
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <input
                    type="number"
                    min="10"
                    max="300"
                    step="5"
                    value={rollingSamplesCount}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val)) setRollingSamplesCount(val);
                    }}
                    style={{
                      width: '75px',
                      padding: '0.2rem 0.45rem',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      color: '#0284c7',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      textAlign: 'right',
                      background: '#ffffff',
                    }}
                  />
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>samples</span>
                </div>
              </div>
              <input
                type="range"
                min="30"
                max="200"
                step="10"
                value={rollingSamplesCount}
                onChange={(e) => setRollingSamplesCount(parseInt(e.target.value, 10))}
                style={{ width: '100%', accentColor: '#0284c7', cursor: 'pointer' }}
              />
            </div>

            {/* Vibration Quick Presets */}
            <div>
              <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '0.4rem' }}>
                QUICK VIBRATION PRESETS
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {[
                  { label: 'Precision Assembly', limit: 1.0, scale: 2.0, count: 60 },
                  { label: 'Standard Angle Tool', limit: 1.25, scale: 2.5, count: 60 },
                  { label: 'Heavy Torque Spindle', limit: 2.5, scale: 5.0, count: 90 },
                  { label: 'Heavy Stamping Press', limit: 5.0, scale: 10.0, count: 120 },
                ].map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setVibrationLimitG(p.limit);
                      setVibrationMaxScaleG(p.scale);
                      setRollingSamplesCount(p.count);
                    }}
                    className="filter-pill"
                    style={{ fontSize: '0.75rem' }}
                  >
                    {p.label} ({p.limit}g)
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: FFT Frequency Spectrum */}
        <div className="b2b-card">
          <div className="b2b-card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <BarChart2 size={18} color="#0284c7" />
            <span>FFT Frequency Spectrum &amp; High Hz Range</span>
          </div>
          <div className="b2b-card-subtitle">
            Calibrate maximum frequency bandwidth (Hz) and dangerous resonance exciter band.
          </div>

          <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Max Frequency (Hz) */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>
                  MAXIMUM FFT FREQUENCY (Hz)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <input
                    type="number"
                    min="100"
                    max="15000"
                    step="50"
                    value={fftMaxFreqHz}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val)) setFftMaxFreqHz(val);
                    }}
                    style={{
                      width: '80px',
                      padding: '0.2rem 0.45rem',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      color: '#0284c7',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      textAlign: 'right',
                      background: '#ffffff',
                    }}
                  />
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0284c7' }}>Hz</span>
                </div>
              </div>
              <input
                type="range"
                min="200"
                max="10000"
                step="100"
                value={fftMaxFreqHz}
                onChange={(e) => setFftMaxFreqHz(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: '#0284c7', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#94a3b8' }}>
                <span>200 Hz (Low Speed)</span>
                <span>500 Hz (Default)</span>
                <span>2,000 Hz (High Speed)</span>
                <span>10,000 Hz (Ultra High Hz)</span>
              </div>
            </div>

            {/* Resonance Danger Band Start & End */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569' }}>
                    RESONANCE START (Hz)
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                    <input
                      type="number"
                      min="0"
                      max={fftMaxFreqHz}
                      step="10"
                      value={fftExciterStartHz}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val)) setFftExciterStartHz(val);
                      }}
                      style={{
                        width: '68px',
                        padding: '0.15rem 0.35rem',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        fontFamily: 'monospace',
                        color: '#0f172a',
                        border: '1px solid #cbd5e1',
                        borderRadius: 6,
                        textAlign: 'right',
                        background: '#ffffff',
                      }}
                    />
                    <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Hz</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max={fftMaxFreqHz}
                  step="10"
                  value={fftExciterStartHz}
                  onChange={(e) => setFftExciterStartHz(parseFloat(e.target.value) || 0)}
                  style={{ width: '100%', accentColor: '#0284c7', cursor: 'pointer' }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569' }}>
                    RESONANCE END (Hz)
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                    <input
                      type="number"
                      min="0"
                      max={fftMaxFreqHz}
                      step="10"
                      value={fftExciterEndHz}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val)) setFftExciterEndHz(val);
                      }}
                      style={{
                        width: '68px',
                        padding: '0.15rem 0.35rem',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        fontFamily: 'monospace',
                        color: '#0f172a',
                        border: '1px solid #cbd5e1',
                        borderRadius: 6,
                        textAlign: 'right',
                        background: '#ffffff',
                      }}
                    />
                    <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Hz</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max={fftMaxFreqHz}
                  step="10"
                  value={fftExciterEndHz}
                  onChange={(e) => setFftExciterEndHz(parseFloat(e.target.value) || 0)}
                  style={{ width: '100%', accentColor: '#0284c7', cursor: 'pointer' }}
                />
              </div>
            </div>

            {/* FFT Quick Presets */}
            <div>
              <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '0.4rem' }}>
                HIGH HZ &amp; MOTOR BAND PRESETS
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {[
                  { label: 'Low Frequency (200 Hz)', max: 200, start: 50, end: 90 },
                  { label: 'Standard Assembly (500 Hz)', max: 500, start: 150, end: 250 },
                  { label: 'High-Speed Spindle (2,000 Hz)', max: 2000, start: 600, end: 1100 },
                  { label: 'Ultra High Hz (5,000 Hz)', max: 5000, start: 1200, end: 2400 },
                  { label: 'Aero Turbine (10,000 Hz)', max: 10000, start: 2500, end: 4500 },
                ].map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setFftMaxFreqHz(p.max);
                      setFftExciterStartHz(p.start);
                      setFftExciterEndHz(p.end);
                    }}
                    className="filter-pill"
                    style={{ fontSize: '0.75rem' }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Card 3: Motor Speed & Drive Telemetry */}
        <div className="b2b-card">
          <div className="b2b-card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Gauge size={18} color="#0284c7" />
            <span>Motor Speed &amp; High RPM Calibration</span>
          </div>
          <div className="b2b-card-subtitle">
            Configure dynamic default operating speed (100% rated RPM) and tachometer scale. Whatever RPM is set here dynamically becomes the system-wide default.
          </div>

          <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Max RPM Scale */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>
                  MAX TACHOMETER SCALE (RPM)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <input
                    type="number"
                    min="500"
                    max="35000"
                    step="250"
                    value={motorMaxRpm}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val)) setMotorMaxRpm(val);
                    }}
                    style={{
                      width: '90px',
                      padding: '0.2rem 0.45rem',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      color: '#2563eb',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      textAlign: 'right',
                      background: '#ffffff',
                    }}
                  />
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#2563eb' }}>RPM</span>
                </div>
              </div>
              <input
                type="range"
                min="500"
                max="30000"
                step="250"
                value={motorMaxRpm}
                onChange={(e) => setMotorMaxRpm(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: '#2563eb', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#94a3b8' }}>
                <span>500 RPM</span>
                <span>2,000 RPM</span>
                <span>6,000 RPM</span>
                <span>30,000 RPM (High-Speed)</span>
              </div>
            </div>

            {/* Rated Baseline RPM & Rated Amps */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569' }}>
                    DEFAULT OPERATING SPEED (RPM)
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                    <input
                      type="number"
                      min="200"
                      max="30000"
                      step="50"
                      value={motorRatedRpm}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val)) setMotorRatedRpm(val);
                      }}
                      style={{
                        width: '80px',
                        padding: '0.15rem 0.35rem',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        fontFamily: 'monospace',
                        color: '#0284c7',
                        border: '1px solid #cbd5e1',
                        borderRadius: 6,
                        textAlign: 'right',
                        background: '#ffffff',
                      }}
                    />
                    <span style={{ fontSize: '0.72rem', color: '#64748b' }}>RPM</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="200"
                  max="30000"
                  step="50"
                  value={motorRatedRpm}
                  onChange={(e) => setMotorRatedRpm(parseFloat(e.target.value) || 0)}
                  style={{ width: '100%', accentColor: '#0284c7', cursor: 'pointer' }}
                />
                <span style={{ fontSize: '0.68rem', color: '#64748b', display: 'block', marginTop: '0.2rem' }}>
                  50% mitigation speed: {(motorRatedRpm * 0.5).toFixed(0)} RPM
                </span>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569' }}>
                    RATED CURRENT (AMPS)
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                    <input
                      type="number"
                      min="0.5"
                      max="100.0"
                      step="0.5"
                      value={motorRatedCurrentAmps}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val)) setMotorRatedCurrentAmps(val);
                      }}
                      style={{
                        width: '65px',
                        padding: '0.15rem 0.35rem',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        fontFamily: 'monospace',
                        color: '#0f172a',
                        border: '1px solid #cbd5e1',
                        borderRadius: 6,
                        textAlign: 'right',
                        background: '#ffffff',
                      }}
                    />
                    <span style={{ fontSize: '0.72rem', color: '#64748b' }}>A</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="100.0"
                  step="0.5"
                  value={motorRatedCurrentAmps}
                  onChange={(e) => setMotorRatedCurrentAmps(parseFloat(e.target.value) || 0)}
                  style={{ width: '100%', accentColor: '#0284c7', cursor: 'pointer' }}
                />
                <span style={{ fontSize: '0.68rem', color: '#64748b', display: 'block', marginTop: '0.2rem' }}>
                  Nominal baseline thermal current
                </span>
              </div>
            </div>

            {/* High-Speed Motor Presets */}
            <div>
              <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '0.4rem' }}>
                MOTOR TYPE PRESETS
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {[
                  { label: 'Standard Angle Tool', max: 2000, rated: 1500, amps: 6.5 },
                  { label: 'High-Speed Nutrunner', max: 4000, rated: 3200, amps: 12.0 },
                  { label: 'Robotic Torque Spindle', max: 8000, rated: 6000, amps: 22.0 },
                  { label: 'High-RPM Router/Mill', max: 25000, rated: 20000, amps: 40.0 },
                ].map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setMotorMaxRpm(p.max);
                      setMotorRatedRpm(p.rated);
                      setMotorRatedCurrentAmps(p.amps);
                    }}
                    className="filter-pill"
                    style={{ fontSize: '0.75rem' }}
                  >
                    {p.label} ({p.rated} RPM)
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* ========================================================================= */}
      {/* ROW 2: AI MODEL STUDIO, TRAINING CATALOG & THRESHOLD SYNCHRONIZATION      */}
      {/* ========================================================================= */}
      <ModelStudio
        models={models}
        recordings={recordings}
        currentUserRole={currentUserRole}
        onRefresh={onRefresh}
      />

      {/* ========================================================================= */}
      {/* ROW 2.5: MOTOR AUTO STOP / MANUAL STOP & RESTART CONTROL POLICY           */}
      {/* ========================================================================= */}
      <div className="b2b-card" style={{ borderLeft: motorTripMode === 'AUTO' ? '4px solid #10b981' : '4px solid #f59e0b' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Power size={20} color={motorTripMode === 'AUTO' ? '#10b981' : '#f59e0b'} />
              <h3 className="b2b-card-title" style={{ margin: 0, fontSize: '1.15rem' }}>
                Motor Auto Stop / Manual Stop &amp; Control Policy
              </h3>
            </div>
            <div className="b2b-card-subtitle" style={{ marginTop: '0.35rem' }}>
              Configure whether the AI Engine automatically issues API motor STOP commands upon detecting persistent disturbances, or provides advisory alerts requiring manual operator intervention. Includes auto-restart recovery controls.
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: motorTripMode === 'AUTO' ? '#ecfdf5' : '#fffbeb',
              border: motorTripMode === 'AUTO' ? '1px solid #a7f3d0' : '1px solid #fde68a',
              padding: '0.45rem 0.85rem',
              borderRadius: 6,
            }}
          >
            {motorTripMode === 'AUTO' ? (
              <ShieldCheck size={16} color="#059669" />
            ) : (
              <AlertOctagon size={16} color="#d97706" />
            )}
            <span
              style={{
                fontSize: '0.78rem',
                color: motorTripMode === 'AUTO' ? '#047857' : '#b45309',
                fontWeight: 700,
                letterSpacing: '0.04em',
              }}
            >
              {motorTripMode === 'AUTO'
                ? 'CLOSED-LOOP AI AUTO STOP ACTIVE (API CONTROLLER)'
                : 'OPEN-LOOP MANUAL ADVISORY ONLY (OPERATOR CONTROL)'}
            </span>
          </div>
        </div>

        {/* Dual Mode Selectable Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', marginTop: '1.25rem' }}>
          
          {/* Option A: Auto Stop */}
          <div
            onClick={() => handleSelectMotorMode('AUTO')}
            style={{
              border: motorTripMode === 'AUTO' ? '2px solid #10b981' : '1px solid #cbd5e1',
              background: motorTripMode === 'AUTO' ? '#f0fdf4' : '#ffffff',
              borderRadius: 8,
              padding: '1.1rem',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="radio"
                  id="mode-auto"
                  name="motorTripMode"
                  checked={motorTripMode === 'AUTO'}
                  onChange={() => handleSelectMotorMode('AUTO')}
                  style={{ accentColor: '#10b981', cursor: 'pointer' }}
                />
                <label htmlFor="mode-auto" style={{ fontWeight: 700, fontSize: '0.92rem', color: '#0f172a', cursor: 'pointer' }}>
                  Auto Stop (Autonomous AI Intervention)
                </label>
              </div>
              <span className="badge badge-success" style={{ fontSize: '0.68rem', padding: '0.15rem 0.45rem' }}>
                Recommended
              </span>
            </div>
            <p style={{ margin: '0.65rem 0 0 1.6rem', fontSize: '0.78rem', color: '#475569', lineHeight: 1.5 }}>
              When the AI engine detects vibration anomaly or persistent disturbance (score &ge; Warn / Crit), this software automatically issues an API motor control command to <strong>STOP the motor immediately</strong> to prevent spindle damage and defective fasteners.
            </p>
            {motorTripMode === 'AUTO' && (
              <div style={{ margin: '0.6rem 0 0 1.6rem', fontSize: '0.72rem', color: '#059669', fontWeight: 700 }}>
                ✓ PERMANENTLY SAVED: Auto Stop is active.
              </div>
            )}
          </div>

          {/* Option B: Manual Stop */}
          <div
            onClick={() => handleSelectMotorMode('MANUAL')}
            style={{
              border: motorTripMode === 'MANUAL' ? '2px solid #f59e0b' : '1px solid #cbd5e1',
              background: motorTripMode === 'MANUAL' ? '#fffbeb' : '#ffffff',
              borderRadius: 8,
              padding: '1.1rem',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="radio"
                  id="mode-manual"
                  name="motorTripMode"
                  checked={motorTripMode === 'MANUAL'}
                  onChange={() => handleSelectMotorMode('MANUAL')}
                  style={{ accentColor: '#f59e0b', cursor: 'pointer' }}
                />
                <label htmlFor="mode-manual" style={{ fontWeight: 700, fontSize: '0.92rem', color: '#0f172a', cursor: 'pointer' }}>
                  Manual Stop (Operator Advisory Mode)
                </label>
              </div>
              <span className="badge badge-warning" style={{ fontSize: '0.68rem', padding: '0.15rem 0.45rem' }}>
                Advisory Only
              </span>
            </div>
            <p style={{ margin: '0.65rem 0 0 1.6rem', fontSize: '0.78rem', color: '#475569', lineHeight: 1.5 }}>
              When the AI engine detects disturbance, it raises alarms, displays warning indicators, and logs incident forensics. The motor continues running until the human operator triggers a manual stop via physical E-Stop or API command.
            </p>
            {motorTripMode === 'MANUAL' && (
              <div style={{ margin: '0.6rem 0 0 1.6rem', fontSize: '0.72rem', color: '#b45309', fontWeight: 700 }}>
                ✓ PERMANENTLY SAVED: Manual Stop active. Software will NOT auto-stop motor and will NOT change on restart until you change it.
              </div>
            )}
          </div>
        </div>

        {/* Immediate Policy Feedback Banner */}
        {policySaveStatus && (
          <div
            style={{
              marginTop: '1rem',
              padding: '0.65rem 1rem',
              background: '#ecfdf5',
              border: '1px solid #10b981',
              borderRadius: 6,
              fontSize: '0.82rem',
              fontWeight: 600,
              color: '#065f46',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <CheckCircle size={16} color="#10b981" />
            <span>{policySaveStatus}</span>
          </div>
        )}

        {/* Auto-Restart Policy Toggle */}
        <div
          style={{
            marginTop: '1.25rem',
            padding: '1rem',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <RefreshCw size={20} color="#0284c7" />
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1e293b' }}>
                Enable Automatic Motor Restart on Disturbance Clearance
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
                If enabled, when a motor was automatically stopped due to AI disturbance, the software automatically executes an API restart back to nominal 100% speed once vibration clears and safety cooldown (3s) passes.
              </div>
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={autoRestartEnabled}
              onChange={(e) => handleToggleAutoRestart(e.target.checked)}
              style={{ width: '18px', height: '18px', accentColor: '#0284c7', cursor: 'pointer' }}
            />
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: autoRestartEnabled ? '#0284c7' : '#64748b' }}>
              {autoRestartEnabled ? 'AUTO-RESTART ENABLED' : 'MANUAL RESTART REQUIRED'}
            </span>
          </label>
        </div>

        {/* Live Motor API Direct Actions Test Panel */}
        <div style={{ marginTop: '1.25rem', borderTop: '1px solid #f1f5f9', paddingTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', letterSpacing: '0.05em' }}>
                LIVE MOTOR API CONTROL TEST PANEL (STATION: {stationId})
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                Test immediate motor control commands via REST API endpoints (/api/v1/stations/{stationId}/motor/stop &amp; /restart).
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button
                type="button"
                onClick={handleTestMotorStop}
                disabled={isExecutingMotorCmd}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.5rem 0.9rem',
                  background: '#ef4444',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 6,
                  fontWeight: 700,
                  fontSize: '0.78rem',
                  cursor: isExecutingMotorCmd ? 'not-allowed' : 'pointer',
                  opacity: isExecutingMotorCmd ? 0.6 : 1,
                  boxShadow: '0 2px 4px rgba(239, 68, 68, 0.25)',
                }}
              >
                <Square size={14} fill="#ffffff" />
                <span>Stop Motor Now (API)</span>
              </button>

              <button
                type="button"
                onClick={handleTestMotorRestart}
                disabled={isExecutingMotorCmd}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.5rem 0.9rem',
                  background: '#10b981',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 6,
                  fontWeight: 700,
                  fontSize: '0.78rem',
                  cursor: isExecutingMotorCmd ? 'not-allowed' : 'pointer',
                  opacity: isExecutingMotorCmd ? 0.6 : 1,
                  boxShadow: '0 2px 4px rgba(16, 185, 129, 0.25)',
                }}
              >
                <Play size={14} fill="#ffffff" />
                <span>Restart Motor (API)</span>
              </button>
            </div>
          </div>

          {/* Feedback banner */}
          {motorCmdFeedback && (
            <div
              style={{
                marginTop: '0.6rem',
                padding: '0.65rem 0.9rem',
                borderRadius: 6,
                fontSize: '0.78rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: motorCmdFeedback.type === 'success' ? '#ecfdf5' : '#fef2f2',
                border: motorCmdFeedback.type === 'success' ? '1px solid #a7f3d0' : '1px solid #fecaca',
                color: motorCmdFeedback.type === 'success' ? '#047857' : '#b91c1c',
              }}
            >
              {motorCmdFeedback.type === 'success' ? (
                <CheckCircle size={15} color="#059669" />
              ) : (
                <AlertOctagon size={15} color="#dc2626" />
              )}
              <span>{motorCmdFeedback.text}</span>
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* ROW 3: GLOBAL TIMEZONE, STATION IDENTIFIER & ENTERPRISE BRANDING          */}
      {/* ========================================================================= */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.5rem' }}>
        
        {/* Section: All Timezone Configuration */}
        <div className="b2b-card">
          <div className="b2b-card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Clock size={18} color="#0284c7" />
            <span>Global Timezone Configuration</span>
          </div>
          <div className="b2b-card-subtitle">
            Format all live timestamps, rolling chart x-axes, incident logs, audit trails, and history exports.
          </div>

          {/* Live Ticker Clock in Selected Timezone */}
          <div
            style={{
              marginTop: '1rem',
              padding: '0.85rem 1rem',
              background: '#0f172a',
              borderRadius: 8,
              color: '#f8fafc',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600, letterSpacing: '0.05em' }}>
                ACTIVE SYSTEM CLOCK ({timezone})
              </div>
              <div className="font-mono" style={{ fontSize: '1.35rem', fontWeight: 700, color: '#38bdf8', marginTop: 2 }}>
                {formatTime(currentTick)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#cbd5e1', marginTop: 2 }}>
                {formatDateTime(currentTick)}
              </div>
            </div>
            <Globe size={28} color="#38bdf8" />
          </div>

          {/* Quick Preset Timezones */}
          <div style={{ marginTop: '1.25rem' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.4rem' }}>
              POPULAR REGIONAL TIMEZONES
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {PRESET_TIMEZONES.map((p) => {
                const isActive = timezone === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setTimezone(p.id)}
                    className={`filter-pill ${isActive ? 'active' : ''}`}
                    style={{ fontSize: '0.75rem' }}
                  >
                    {p.label} <span style={{ opacity: 0.7, fontSize: '0.7rem' }}>({p.offset})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Searchable All Timezones Selector */}
          <div style={{ marginTop: '1.25rem' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.4rem' }}>
              ALL WORLD TIMEZONES ({allTimezones.length} SUPPORTED)
            </label>
            <input
              type="text"
              placeholder="Filter timezones (e.g. Kolkata, Tokyo, London, America)..."
              value={tzSearch}
              onChange={(e) => setTzSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '0.45rem 0.65rem',
                fontSize: '0.8rem',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                marginBottom: '0.5rem',
              }}
            />
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                fontSize: '0.85rem',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                background: '#ffffff',
                color: '#1e293b',
              }}
            >
              {filteredTimezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Section: Assembly Station Configuration & Enterprise Branding */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Station Identifier */}
          <div className="b2b-card">
            <div className="b2b-card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Radio size={18} color="#0284c7" />
              <span>Active Assembly Station Configuration</span>
            </div>
            <div className="b2b-card-subtitle">
              Select or assign the station ID and display name monitored by this terminal.
            </div>

            <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                  PRE-CONFIGURED ASSEMBLY STATIONS
                </label>
                <select
                  value={stationId}
                  onChange={handleStationSelect}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    fontSize: '0.85rem',
                    border: '1px solid #cbd5e1',
                    borderRadius: 6,
                    background: '#ffffff',
                  }}
                >
                  {PRESET_STATIONS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.id})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                    STATION ID
                  </label>
                  <input
                    type="text"
                    value={stationId}
                    onChange={(e) => setStationId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.45rem 0.6rem',
                      fontSize: '0.85rem',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      fontFamily: 'monospace',
                      fontWeight: 600,
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                    STATION DISPLAY NAME
                  </label>
                  <input
                    type="text"
                    value={stationName}
                    onChange={(e) => setStationName(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.45rem 0.6rem',
                      fontSize: '0.85rem',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Company & Brand Identity */}
          <div className="b2b-card">
            <div className="b2b-card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Building size={18} color="#0284c7" />
              <span>Company &amp; Brand Identity</span>
            </div>
            <div className="b2b-card-subtitle">
              Personalize enterprise branding displayed on top navigation, login screen, and compliance reports.
            </div>

            <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                  BRAND NAME
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    placeholder="e.g. Aperture, Apex Precision"
                    style={{
                      width: '100%',
                      padding: '0.5rem 0.65rem',
                      fontSize: '0.85rem',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                    }}
                  />
                  <Tag size={14} color="#94a3b8" style={{ position: 'absolute', right: 10, top: 12 }} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                  COMPANY / ENTERPRISE NAME
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="e.g. Apex Dynamics Powertrain Facility Alpha"
                    style={{
                      width: '100%',
                      padding: '0.5rem 0.65rem',
                      fontSize: '0.85rem',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                    }}
                  />
                  <Building size={14} color="#94a3b8" style={{ position: 'absolute', right: 10, top: 12 }} />
                </div>
              </div>

              {/* Company Logo Section */}
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                  COMPANY LOGO EMBLEM
                </label>

                {/* Preset Logos */}
                <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  {PRESET_LOGOS.map((pl) => (
                    <button
                      key={pl.id}
                      type="button"
                      onClick={() => setCompanyLogo(pl.url)}
                      style={{
                        padding: '0.4rem 0.75rem',
                        borderRadius: 6,
                        border: companyLogo === pl.url ? '1px solid #0284c7' : '1px solid #cbd5e1',
                        background: companyLogo === pl.url ? '#f0f9ff' : '#ffffff',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                      }}
                    >
                      <img src={pl.url} alt={pl.label} style={{ height: 16, objectFit: 'contain' }} />
                      <span>{pl.label}</span>
                    </button>
                  ))}
                </div>

                {/* Custom Logo URL / Upload */}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={companyLogo}
                    onChange={(e) => setCompanyLogo(e.target.value)}
                    placeholder="Enter image URL or upload file..."
                    style={{
                      flex: 1,
                      padding: '0.45rem 0.65rem',
                      fontSize: '0.8rem',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                    }}
                  />
                  <label
                    style={{
                      background: '#f1f5f9',
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      padding: '0.45rem 0.75rem',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#334155',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                    }}
                  >
                    <Upload size={14} />
                    <span>Upload Image</span>
                    <input type="file" accept="image/*" onChange={handleLogoUpload} style={{ display: 'none' }} />
                  </label>
                </div>
              </div>
            </div>
          </div>

        </div>

      </div>

      {/* ========================================================================= */}
      {/* ROW 4: DATABASE STORAGE MANAGEMENT & TELEMETRY RETENTION (1w, 2w, 1mo)    */}
      {/* ========================================================================= */}
      <div className="b2b-card" style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderLeft: '4px solid #6366f1' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div className="b2b-card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Database size={20} color="#6366f1" />
              <span>Database Storage Management &amp; Data Retention Policy</span>
            </div>
            <div className="b2b-card-subtitle" style={{ marginTop: '0.35rem' }}>
              Configure automatic telemetry lifecycle pruning (1 week, 2 weeks, 3 weeks, 1 month) to eliminate unused SQLite space
              and execute physical database compaction via <code style={{ background: '#e0e7ff', padding: '0.1rem 0.4rem', borderRadius: 4, color: '#3730a3', fontWeight: 600 }}>VACUUM</code>.
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={handleExecuteVacuumOnly}
              disabled={isCleaningDb || isVacuumingDb}
              className="btn-b2b"
              style={{ background: '#f8fafc', border: '1px solid #cbd5e1', color: '#475569', fontSize: '0.8rem' }}
              title="Runs SQLite VACUUM and WAL checkpoint to compact freelist pages without deleting recent data"
            >
              <HardDrive size={14} />
              <span>{isVacuumingDb ? 'Compacting...' : 'Compact (VACUUM Only)'}</span>
            </button>
            <button
              type="button"
              onClick={fetchDbMetrics}
              className="btn-b2b"
              style={{ background: '#f8fafc', border: '1px solid #cbd5e1', color: '#475569', fontSize: '0.8rem' }}
              title="Refresh live database file size and row statistics"
            >
              <RefreshCw size={14} />
              <span>Refresh Stats</span>
            </button>
          </div>
        </div>

        {/* Live Storage Metrics Overview */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '1.25rem' }}>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.85rem 1rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b' }}>TOTAL DATABASE FILE SIZE</div>
            <div className="font-mono" style={{ fontSize: '1.35rem', fontWeight: 700, color: '#0f172a', marginTop: '0.2rem' }}>
              {dbStats ? `${dbStats.file_size_mb} MB` : '6.08 MB'}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.2rem' }}>
              SQLite File: <span style={{ fontWeight: 600 }}>{dbStats?.database_file || 'tool_monitor.db'}</span>
            </div>
          </div>

          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.85rem 1rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b' }}>UNUSED RECLAIMABLE SPACE</div>
            <div className="font-mono" style={{ fontSize: '1.35rem', fontWeight: 700, color: dbStats?.unused_space_pct > 15 ? '#ef4444' : '#10b981', marginTop: '0.2rem' }}>
              {dbStats ? `${dbStats.unused_space_mb} MB (${dbStats.unused_space_pct}%)` : '0.00 MB (0.0%)'}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.2rem' }}>
              Freelist Pages: <span style={{ fontWeight: 600 }}>{dbStats?.freelist_pages ?? 0}</span>
            </div>
          </div>

          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.85rem 1rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b' }}>STORED TELEMETRY SAMPLES</div>
            <div className="font-mono" style={{ fontSize: '1.35rem', fontWeight: 700, color: '#0284c7', marginTop: '0.2rem' }}>
              {dbStats?.table_stats?.raw_windows ? `${dbStats.table_stats.raw_windows.toLocaleString()} Waveforms` : '3,000 Waveforms'}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.2rem' }}>
              Features &amp; Inference: <span style={{ fontWeight: 600 }}>{dbStats?.table_stats?.features?.toLocaleString() ?? '3,031'} rows</span>
            </div>
          </div>

          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.85rem 1rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b' }}>WAL JOURNAL &amp; COMPACTION</div>
            <div className="font-mono" style={{ fontSize: '1.35rem', fontWeight: 700, color: '#8b5cf6', marginTop: '0.2rem' }}>
              {dbStats ? `${dbStats.wal_size_mb} MB` : '0.00 MB'}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.2rem' }}>
              Journal Mode: <span style={{ fontWeight: 600, textTransform: 'uppercase' }}>{dbStats?.journal_mode || 'WAL'}</span>
            </div>
          </div>
        </div>

        {/* Protected Master Data Guarantee Banner */}
        <div
          style={{
            marginTop: '1.25rem',
            background: 'linear-gradient(90deg, #ecfdf5 0%, #f0fdf4 100%)',
            border: '1px solid #a7f3d0',
            borderRadius: 8,
            padding: '0.85rem 1.15rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
          }}
        >
          <Shield size={20} color="#059669" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#065f46' }}>
              CRITICAL MASTER DATA 100% PROTECTED
            </div>
            <div style={{ fontSize: '0.76rem', color: '#047857', marginTop: '0.25rem', lineHeight: 1.45 }}>
              Retention cleanup strictly targets transient vibration raw waveforms and rolling feature tables.
              <strong> Vendor API keys, GAO BLE Gateways, User Accounts &amp; Passwords, Trained AI Models, Station Topologies, and System Calibration Settings</strong> are never deleted.
            </div>
          </div>
        </div>

        {/* Retention Period Selection & Execution */}
        <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', background: '#f8fafc', padding: '1rem 1.25rem', borderRadius: 8, border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155' }}>
              PURGE OPERATIONAL DATA OLDER THAN:
            </label>
            <select
              value={retentionChoice}
              onChange={(e) => setRetentionChoice(e.target.value)}
              style={{
                padding: '0.45rem 0.85rem',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#1e293b',
                background: '#ffffff',
                cursor: 'pointer',
              }}
            >
              <option value="1_week">1 Week (Keep last 7 days of telemetry)</option>
              <option value="2_weeks">2 Weeks (Keep last 14 days of telemetry)</option>
              <option value="3_weeks">3 Weeks (Keep last 21 days of telemetry)</option>
              <option value="1_month">1 Month (Keep last 30 days of telemetry)</option>
              <option value="all_transient">All Transient Telemetry (Flush old waveforms, keep latest 100)</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={handleExecuteDbCleanup}
              disabled={isCleaningDb || isVacuumingDb}
              className="btn-b2b"
              style={{
                background: '#dc2626',
                color: '#ffffff',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.85rem',
                padding: '0.55rem 1.35rem',
                boxShadow: '0 2px 6px rgba(220, 38, 38, 0.25)',
                cursor: isCleaningDb ? 'not-allowed' : 'pointer',
              }}
            >
              <Trash2 size={15} />
              <span>{isCleaningDb ? 'Purging & Compacting...' : 'Clean Old Records & Reclaim Storage (VACUUM)'}</span>
            </button>
          </div>
        </div>

        {/* Feedback Message */}
        {dbCleanFeedback && (
          <div
            style={{
              marginTop: '1rem',
              background: dbCleanFeedback.type === 'success' ? '#ecfdf5' : '#fef2f2',
              border: `1px solid ${dbCleanFeedback.type === 'success' ? '#a7f3d0' : '#fecaca'}`,
              borderRadius: 6,
              padding: '0.75rem 1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              color: dbCleanFeedback.type === 'success' ? '#065f46' : '#991b1b',
              fontSize: '0.85rem',
              fontWeight: 600,
            }}
          >
            {dbCleanFeedback.type === 'success' ? (
              <CheckCircle size={16} color="#10b981" />
            ) : (
              <AlertOctagon size={16} color="#ef4444" />
            )}
            <span>{dbCleanFeedback.text}</span>
          </div>
        )}
      </div>


      {/* ========================================================================= */}
      {/* ROW 6: REAL-TIME VISUAL & ARCHITECTURAL PREVIEW                           */}
      {/* ========================================================================= */}
      <div className="b2b-card" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <div className="b2b-card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Sparkles size={18} color="#0284c7" />
          <span>Real-Time Visual &amp; Calibration Summary Preview</span>
        </div>
        <div className="b2b-card-subtitle">
          Live verification of active station, brand headers, rolling vibration safety, FFT max bandwidth, and model thresholds.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
          {/* Sidebar Brand Header Mock */}
          <div style={{ background: '#0f172a', padding: '1rem', borderRadius: 8, color: '#f8fafc' }}>
            <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 700, marginBottom: '0.5rem' }}>
              SIDEBAR BRAND HEADER PREVIEW
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <img
                src={companyLogo || '/aperture-logo-hd.png'}
                alt={brandName}
                style={{ height: '36px', maxWidth: '140px', objectFit: 'contain' }}
                onError={(e) => {
                  (e.target as any).src = '/aperture-logo-hd.png';
                }}
              />
              <div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f8fafc' }}>{brandName || 'Brand'}</div>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{companyName || 'Company Name'}</div>
              </div>
            </div>

            {/* Station Card Mock */}
            <div
              style={{
                marginTop: '0.85rem',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 6,
                padding: '0.6rem 0.75rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#e2e8f0' }}>{stationName}</span>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }}></span>
              </div>
              <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: 2 }}>
                {stationId} &bull; {timezone} &bull; {formatTime(currentTick)}
              </div>
            </div>
          </div>

          {/* Active Calibration Summary Card */}
          <div style={{ background: '#ffffff', padding: '1rem', borderRadius: 8, border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 700 }}>
              ACTIVE DYNAMIC CALIBRATION PARAMS
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.35rem' }}>
              <span style={{ color: '#64748b' }}>Vibration Trip Limit:</span>
              <span className="font-mono" style={{ fontWeight: 700, color: '#ef4444' }}>{vibrationLimitG.toFixed(2)} g</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.35rem' }}>
              <span style={{ color: '#64748b' }}>FFT Max Bandwidth:</span>
              <span className="font-mono" style={{ fontWeight: 700, color: '#0284c7' }}>{fftMaxFreqHz.toFixed(0)} Hz</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.35rem' }}>
              <span style={{ color: '#64748b' }}>Motor Max Speed:</span>
              <span className="font-mono" style={{ fontWeight: 700, color: '#2563eb' }}>{motorMaxRpm.toFixed(0)} RPM (Rated: {motorRatedRpm.toFixed(0)})</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
              <span style={{ color: '#64748b' }}>AI Anomaly Thresholds:</span>
              <span className="font-mono" style={{ fontWeight: 700, color: '#7c3aed' }}>
                Warn: {warnThreshold.toFixed(2)} &bull; Crit: {criticalThreshold.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
