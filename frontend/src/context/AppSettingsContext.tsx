import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

export interface AppSettings {
  timezone: string;
  stationId: string;
  stationName: string;
  companyName: string;
  brandName: string;
  companyLogo: string;
  // Live Vibration Rolling Profile
  vibrationLimitG: number;
  vibrationMaxScaleG: number;
  rollingSamplesCount: number;
  // FFT Frequency Spectrum Range
  fftMaxFreqHz: number;
  fftExciterStartHz: number;
  fftExciterEndHz: number;
  // Motor Speed & Drive Telemetry Limits
  motorMaxRpm: number;
  motorRatedRpm: number;
  motorRatedCurrentAmps: number;
  // Threshold Tuning & Model Training
  warnThreshold: number;
  criticalThreshold: number;
  persistenceWindows: number;
  // Motor Auto Stop / Manual Stop & Restart Control
  motorTripMode: 'AUTO' | 'MANUAL';
  autoRestartEnabled: boolean;
}

export interface AppSettingsContextType {
  settings: AppSettings;
  updateSettings: (newSettings: Partial<AppSettings>) => Promise<void>;
  formatTime: (dateInput: string | number | Date | null | undefined) => string;
  formatDate: (dateInput: string | number | Date | null | undefined) => string;
  formatDateTime: (dateInput: string | number | Date | null | undefined) => string;
  allTimezones: string[];
  isLoading: boolean;
}

const STORAGE_KEY = 'aperture_app_settings';

const DEFAULT_SETTINGS: AppSettings = {
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
  motorTripMode: 'AUTO',
  autoRestartEnabled: false,
};

// All standard IANA timezones supported by browser
const getAllSupportedTimezones = (): string[] => {
  try {
    if (typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl) {
      return (Intl as any).supportedValuesOf('timeZone');
    }
  } catch (e) {
    // fallback
  }
  return [
    'UTC',
    'Asia/Kolkata',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Sao_Paulo',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Paris',
    'Europe/Moscow',
    'Asia/Dubai',
    'Asia/Singapore',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Asia/Seoul',
    'Australia/Sydney',
    'Pacific/Auckland',
  ];
};

const AppSettingsContext = createContext<AppSettingsContextType | undefined>(undefined);

export const AppSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(cached) };
      }
    } catch (e) {
      // ignore
    }
    return DEFAULT_SETTINGS;
  });

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const allTimezones = getAllSupportedTimezones();

  // Hydrate settings from backend on startup
  useEffect(() => {
    const fetchRemoteSettings = async () => {
      try {
        const remote = await api.getSystemSettings();
        if (remote && typeof remote === 'object') {
          // Read cached settings from localStorage for fallback preservation
          let cachedSettings: Partial<AppSettings> | null = null;
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) cachedSettings = JSON.parse(raw);
          } catch (e) {
            // ignore
          }

          // Authoritative resolution of motorTripMode:
          // If remote DB specifically has MANUAL or AUTO, use it; otherwise preserve local cached setting; fallback to 'AUTO'
          let resolvedTripMode: 'AUTO' | 'MANUAL' = settings.motorTripMode || 'AUTO';
          if (remote.motor_trip_mode === 'MANUAL' || remote.motor_trip_mode === 'AUTO') {
            resolvedTripMode = remote.motor_trip_mode;
          } else if (cachedSettings?.motorTripMode === 'MANUAL' || cachedSettings?.motorTripMode === 'AUTO') {
            resolvedTripMode = cachedSettings.motorTripMode;
          }

          let resolvedAutoRestart: boolean = settings.autoRestartEnabled;
          if (remote.auto_restart_enabled !== undefined && remote.auto_restart_enabled !== null) {
            resolvedAutoRestart = remote.auto_restart_enabled === true || remote.auto_restart_enabled === 'true';
          } else if (cachedSettings?.autoRestartEnabled !== undefined) {
            resolvedAutoRestart = Boolean(cachedSettings.autoRestartEnabled);
          }

          const merged: AppSettings = {
            timezone: remote.timezone || settings.timezone,
            stationId: remote.station_id || settings.stationId,
            stationName: remote.station_name || settings.stationName,
            companyName: remote.company_name || settings.companyName,
            brandName: remote.brand_name || settings.brandName,
            companyLogo: remote.company_logo || settings.companyLogo,
            vibrationLimitG: parseFloat(remote.vibration_limit_g ?? settings.vibrationLimitG),
            vibrationMaxScaleG: parseFloat(remote.vibration_max_scale_g ?? settings.vibrationMaxScaleG),
            rollingSamplesCount: parseInt(remote.rolling_samples_count ?? settings.rollingSamplesCount, 10),
            fftMaxFreqHz: parseFloat(remote.fft_max_freq_hz ?? settings.fftMaxFreqHz),
            fftExciterStartHz: parseFloat(remote.fft_exciter_start_hz ?? settings.fftExciterStartHz),
            fftExciterEndHz: parseFloat(remote.fft_exciter_end_hz ?? settings.fftExciterEndHz),
            motorMaxRpm: parseFloat(remote.motor_max_rpm ?? settings.motorMaxRpm),
            motorRatedRpm: parseFloat(remote.motor_rated_rpm ?? settings.motorRatedRpm),
            motorRatedCurrentAmps: parseFloat(remote.motor_rated_current_amps ?? settings.motorRatedCurrentAmps),
            warnThreshold: parseFloat(remote.warn_threshold ?? settings.warnThreshold),
            criticalThreshold: parseFloat(remote.critical_threshold ?? settings.criticalThreshold),
            persistenceWindows: parseInt(remote.persistence_windows ?? settings.persistenceWindows, 10),
            motorTripMode: resolvedTripMode,
            autoRestartEnabled: resolvedAutoRestart,
          };
          setSettings(merged);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        }
      } catch (e) {
        // Backend not ready or offline - retain local cache
      } finally {
        setIsLoading(false);
      }
    };
    fetchRemoteSettings();
  }, []);

  const updateSettings = async (newSettings: Partial<AppSettings>) => {
    // Immediate state and localStorage update for instantaneous UI reactivity
    const merged: AppSettings = { ...settings, ...newSettings };
    setSettings(merged);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch (e) {
      console.warn('[AppSettings] localStorage write error:', e);
    }

    // Sync to backend API for database persistence & audit logging
    try {
      await api.saveSystemSettings({
        timezone: merged.timezone,
        station_id: merged.stationId,
        station_name: merged.stationName,
        company_name: merged.companyName,
        brand_name: merged.brandName,
        company_logo: merged.companyLogo,
        vibration_limit_g: merged.vibrationLimitG,
        vibration_max_scale_g: merged.vibrationMaxScaleG,
        rolling_samples_count: merged.rollingSamplesCount,
        fft_max_freq_hz: merged.fftMaxFreqHz,
        fft_exciter_start_hz: merged.fftExciterStartHz,
        fft_exciter_end_hz: merged.fftExciterEndHz,
        motor_max_rpm: merged.motorMaxRpm,
        motor_rated_rpm: merged.motorRatedRpm,
        motor_rated_current_amps: merged.motorRatedCurrentAmps,
        warn_threshold: merged.warnThreshold,
        critical_threshold: merged.criticalThreshold,
        persistence_windows: merged.persistenceWindows,
        motor_trip_mode: merged.motorTripMode,
        auto_restart_enabled: merged.autoRestartEnabled,
      });
    } catch (err) {
      console.warn('[AppSettings] Remote sync failed, saved locally:', err);
    }
  };

  /**
   * Robust date parser that strictly treats naive ISO or database timestamps as UTC.
   */
  const parseToDate = useCallback((dateInput: string | number | Date | null | undefined): Date | null => {
    if (!dateInput) return null;
    if (dateInput instanceof Date) return isNaN(dateInput.getTime()) ? null : dateInput;
    if (typeof dateInput === 'number') {
      const d = new Date(dateInput);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof dateInput === 'string') {
      let s = dateInput.trim();
      if (!s) return null;
      // Numeric timestamp string
      if (/^\d{10,13}$/.test(s)) {
        const num = parseInt(s, 10);
        const d = new Date(num > 1e11 ? num : num * 1000);
        return isNaN(d.getTime()) ? null : d;
      }
      // If it's an ISO timestamp without timezone designator (no 'Z' and no +/- offset), treat as UTC
      if (s.includes('T') && !s.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(s)) {
        s += 'Z';
      } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s) && !s.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(s)) {
        s = s.replace(' ', 'T') + 'Z';
      }
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }, []);

  const formatTime = useCallback((dateInput: string | number | Date | null | undefined): string => {
    const d = parseToDate(dateInput);
    if (!d) return '—';
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: settings.timezone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(d);
    } catch (e) {
      try {
        return d.toLocaleTimeString();
      } catch {
        return String(dateInput);
      }
    }
  }, [settings.timezone, parseToDate]);

  const formatDate = useCallback((dateInput: string | number | Date | null | undefined): string => {
    const d = parseToDate(dateInput);
    if (!d) return '—';
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: settings.timezone,
        year: 'numeric',
        month: 'short',
        day: '2-digit',
      }).format(d);
    } catch (e) {
      return String(dateInput);
    }
  }, [settings.timezone, parseToDate]);

  const formatDateTime = useCallback((dateInput: string | number | Date | null | undefined): string => {
    const d = parseToDate(dateInput);
    if (!d) return '—';
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: settings.timezone,
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(d);
    } catch (e) {
      try {
        return d.toLocaleString();
      } catch {
        return String(dateInput);
      }
    }
  }, [settings.timezone, parseToDate]);

  return (
    <AppSettingsContext.Provider
      value={{
        settings,
        updateSettings,
        formatTime,
        formatDate,
        formatDateTime,
        allTimezones,
        isLoading,
      }}
    >
      {children}
    </AppSettingsContext.Provider>
  );
};

export const useAppSettings = (): AppSettingsContextType => {
  const context = useContext(AppSettingsContext);
  if (!context) {
    throw new Error('useAppSettings must be used within an AppSettingsProvider');
  }
  return context;
};
