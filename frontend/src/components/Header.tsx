import React, { useState, useEffect } from 'react';
import type { StationState, IndicatorLightColor, UserRole } from '../types';
import {
  RotateCcw,
  AlertOctagon,
  Radio,
  Shield,
  LogOut,
  Settings,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { api } from '../services/api';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppSettings } from '../context/AppSettingsContext';

interface HeaderProps {
  stationState: StationState;
  indicatorLight: IndicatorLightColor;
  currentUserRole: UserRole;
  currentUsername: string;
  isWsConnected: boolean;
  onLoginSuccess: (username: string, role: UserRole) => void;
  onLogout: () => void;
  onOpenProfile?: () => void;
  onReset: () => void;
  onEmergencyStop: () => void;
  isActionLoading: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  stationState,
  indicatorLight,
  currentUserRole,
  currentUsername,
  isWsConnected,
  onLoginSuccess,
  onLogout,
  onOpenProfile,
  onReset,
  onEmergencyStop,
  isActionLoading,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { settings } = useAppSettings();
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
  const [loginUser, setLoginUser] = useState<string>('admin');
  const [loginPass, setLoginPass] = useState<string>('admin123');
  const [loginError, setLoginError] = useState<string>('');
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  const isStopped = stationState === 'STOPPED';

  // Persistent Siren Mute State (defaults to unmuted)
  const [isSirenMuted, setIsSirenMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem('aperture_siren_muted') === 'true';
    } catch {
      return false;
    }
  });

  // Selected Siren Sound Profile (defaults to authentic factory wail)
  const [sirenSound, setSirenSound] = useState<'factory_wail' | 'klaxon' | 'pulsed'>(() => {
    try {
      return (localStorage.getItem('aperture_siren_sound') as any) || 'factory_wail';
    } catch {
      return 'factory_wail';
    }
  });

  const toggleSirenMute = () => {
    setIsSirenMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('aperture_siren_muted', String(next));
      } catch {}
      return next;
    });
  };

  const changeSirenSound = (newSound: 'factory_wail' | 'klaxon' | 'pulsed') => {
    setSirenSound(newSound);
    try {
      localStorage.setItem('aperture_siren_sound', newSound);
    } catch {}
  };

  // Industrial Plant Warning Siren Synthesizer via Web Audio API
  useEffect(() => {
    if (!isStopped || isSirenMuted) {
      return;
    }

    let audioCtx: AudioContext | null = null;
    let isRunning = true;
    let timerId: any = null;

    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;
      audioCtx = new AudioCtxClass();

      if (audioCtx.state === 'suspended') {
        const resumeAudio = () => {
          if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
          }
          window.removeEventListener('click', resumeAudio);
          window.removeEventListener('keydown', resumeAudio);
        };
        window.addEventListener('click', resumeAudio);
        window.addEventListener('keydown', resumeAudio);
      }

      // Mode 1: Authentic Modulated Factory Safety Wail (sweeping between 580 Hz and 980 Hz through acoustic lowpass filter)
      const playFactoryWail = () => {
        if (!audioCtx || audioCtx.state === 'closed' || !isRunning) return;
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const filter = audioCtx.createBiquadFilter();
        const gain = audioCtx.createGain();

        // Resonant acoustic filter for deep plant horn body without ear-piercing harshness
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1900, now);
        filter.Q.setValueAtTime(2.2, now);

        osc.type = 'sawtooth';
        // Continuous upward-downward siren modulation
        osc.frequency.setValueAtTime(560, now);
        osc.frequency.linearRampToValueAtTime(960, now + 0.32);
        osc.frequency.linearRampToValueAtTime(560, now + 0.64);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.18, now + 0.04);
        gain.gain.setValueAtTime(0.18, now + 0.60);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.70);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start(now);
        osc.stop(now + 0.72);
      };

      // Mode 2: Industrial Two-Tone Klaxon (High-Low 820 Hz / 540 Hz)
      const playKlaxon = () => {
        if (!audioCtx || audioCtx.state === 'closed' || !isRunning) return;
        const now = audioCtx.currentTime;
        const playTone = (freq: number, start: number, dur: number) => {
          if (!audioCtx) return;
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(freq, start);
          gain.gain.setValueAtTime(0.001, start);
          gain.gain.linearRampToValueAtTime(0.12, start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(start);
          osc.stop(start + dur + 0.02);
        };
        playTone(820, now, 0.22);
        playTone(540, now + 0.24, 0.24);
      };

      // Mode 3: Rapid Emergency Warning Pulses (Triple Beep 920 Hz)
      const playPulsed = () => {
        if (!audioCtx || audioCtx.state === 'closed' || !isRunning) return;
        const now = audioCtx.currentTime;
        [0, 0.12, 0.24].forEach((offset) => {
          if (!audioCtx) return;
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(920, now + offset);
          gain.gain.setValueAtTime(0.001, now + offset);
          gain.gain.linearRampToValueAtTime(0.18, now + offset + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.08);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(now + offset);
          osc.stop(now + offset + 0.09);
        });
      };

      const executeSelectedSound = () => {
        if (sirenSound === 'klaxon') {
          playKlaxon();
        } else if (sirenSound === 'pulsed') {
          playPulsed();
        } else {
          playFactoryWail();
        }
      };

      executeSelectedSound();

      const loopInterval = sirenSound === 'pulsed' ? 950 : 750;
      timerId = setInterval(() => {
        if (isRunning) {
          executeSelectedSound();
        }
      }, loopInterval);
    } catch (err) {
      console.warn('[B2B Siren Notice]', err);
    }

    return () => {
      isRunning = false;
      if (timerId) clearInterval(timerId);
      try {
        if (audioCtx && audioCtx.state !== 'closed') {
          audioCtx.close();
        }
      } catch {}
    };
  }, [isStopped, isSirenMuted, sirenSound]);

  const getPageTitle = (pathname: string) => {
    if (pathname.startsWith('/gateway')) return 'BLE Gateway Integration';
    if (pathname.startsWith('/simulator')) return 'Motor Drive & AI Closed-Loop Guardian';
    if (pathname.startsWith('/models')) return 'AI Model Studio';
    if (pathname.startsWith('/recordings')) return 'Recordings Catalog';
    if (pathname.startsWith('/history')) return 'Telemetry & Event History';
    if (pathname.startsWith('/audit')) return 'Audit Trail & Compliance';
    if (pathname.startsWith('/settings')) return 'System & Station Settings';
    return 'Live Monitoring & Control';
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setIsLoggingIn(true);
    try {
      const res = await api.login(loginUser, loginPass);
      onLoginSuccess(res.username, 'Admin');
      setShowLoginModal(false);
    } catch (err: any) {
      setLoginError(err.message || 'Authentication failed');
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <header className="top-header">
      {/* Active View Title & Station Identifier */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
        <span style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a', letterSpacing: '-0.01em' }}>
          {getPageTitle(location.pathname)}
        </span>
        <span
          style={{
            fontSize: '0.72rem',
            background: '#f1f5f9',
            border: '1px solid #cbd5e1',
            padding: '0.15rem 0.5rem',
            borderRadius: 4,
            color: '#475569',
            fontWeight: 600,
          }}
          title={`Active Station: ${settings.stationName} (${settings.stationId})`}
        >
          {settings.stationName} &bull; {settings.stationId}
        </span>
      </div>

      {/* Station State & Industrial Light Tower */}
      <div className="station-header-center">
        {/* Physical 3-stack light tower beacon */}
        <div className="light-tower" title={`Industrial Light Tower: ${indicatorLight}`}>
          <div className={`beacon-bulb red ${indicatorLight === 'RED' ? 'active' : ''}`} />
          <div className={`beacon-bulb amber ${indicatorLight === 'AMBER' ? 'active' : ''}`} />
          <div className={`beacon-bulb green ${indicatorLight === 'GREEN' ? 'active' : ''}`} />
        </div>

        {/* State Badge */}
        <div className={`state-badge ${stationState}`}>
          <span>●</span>
          <span>{stationState.replace('_', ' ')}</span>
        </div>

        {/* Sleek B2B Industrial Siren Mute/Unmute Pill & Sound Selector */}
        {isStopped && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <button
              type="button"
              className={`btn-siren-pill ${isSirenMuted ? 'muted' : 'active'}`}
              onClick={toggleSirenMute}
              title={isSirenMuted ? 'Click to unmute siren audio' : 'Click to mute siren audio'}
            >
              {isSirenMuted ? (
                <>
                  <VolumeX size={13} />
                  <span>Alarm Muted</span>
                </>
              ) : (
                <>
                  <Volume2 size={13} className="siren-active-pulse" />
                  <span>Siren Active</span>
                </>
              )}
            </button>
            <select
              value={sirenSound}
              onChange={(e) => changeSirenSound(e.target.value as any)}
              className="siren-sound-select"
              title="Select Siren Sound Profile"
            >
              <option value="factory_wail">Factory Siren (Wail)</option>
              <option value="klaxon">Plant Klaxon (High-Lo)</option>
              <option value="pulsed">Pulsed Alert (3-Beep)</option>
            </select>
          </div>
        )}

        {/* Single Contextual Action Button: When STOPPED, show ONLY Mandatory Reset. When running, show E-Stop. */}
        {isStopped ? (
          <button
            type="button"
            className="btn-reset btn-reset-pulse"
            onClick={onReset}
            disabled={isActionLoading}
            style={{
              cursor: isActionLoading ? 'not-allowed' : 'pointer',
              boxShadow: '0 0 12px rgba(22, 163, 74, 0.6)',
            }}
            title="Execute mandatory administrator reset to clear emergency lockout and restore nominal operation"
          >
            <RotateCcw size={14} className={isActionLoading ? 'animate-spin' : ''} />
            <span>Mandatory Reset</span>
          </button>
        ) : (
          <button
            type="button"
            className="btn-stop"
            onClick={() => {
              if (!isActionLoading) {
                onEmergencyStop();
              }
            }}
            disabled={isActionLoading}
            style={{
              cursor: isActionLoading ? 'wait' : 'pointer',
            }}
            title="Trip machine immediately to STOPPED (Hard Limit / Safety Interlock)"
          >
            <AlertOctagon size={14} />
            <span>E-Stop</span>
          </button>
        )}
      </div>

      {/* Connection Status & Admin User Controls */}
      <div className="user-controls">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: '#64748b' }}>
          <Radio size={14} color={isWsConnected ? '#10b981' : '#ef4444'} />
          <span style={{ fontWeight: 500 }}>{isWsConnected ? 'Telemetry 1kHz' : 'Link Offline'}</span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            padding: '0.35rem 0.65rem',
            borderRadius: 6,
          }}
        >
          <div
            onClick={onOpenProfile}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              cursor: onOpenProfile ? 'pointer' : 'default',
            }}
            title="Click to view & edit profile"
          >
            <Shield size={15} color="#0284c7" />
            <div style={{ fontSize: '0.75rem', lineHeight: 1.2 }}>
              <div style={{ fontWeight: 700, color: '#1e293b' }}>{currentUsername}</div>
              <div style={{ color: '#0284c7', fontSize: '0.65rem', fontWeight: 600 }}>{currentUserRole}</div>
            </div>
          </div>
          {onOpenProfile && (
            <button
              onClick={onOpenProfile}
              style={{
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: 4,
                padding: '0.2rem 0.45rem',
                fontSize: '0.7rem',
                fontWeight: 600,
                cursor: 'pointer',
                marginLeft: '0.2rem',
                color: '#334155',
              }}
              title="View and edit user profile"
            >
              Profile
            </button>
          )}
          <button
            onClick={() => navigate('/settings')}
            title="Configure System Settings (Timezone, Station, Company, Logo)"
            style={{
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: 4,
              padding: '0.2rem 0.45rem',
              cursor: 'pointer',
              color: '#334155',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              fontSize: '0.7rem',
              fontWeight: 600,
            }}
          >
            <Settings size={13} color="#0284c7" />
            <span>Settings</span>
          </button>
          <button
            onClick={onLogout}
            title="Sign out of workstation"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#ef4444',
              display: 'flex',
              alignItems: 'center',
              padding: '0.2rem',
            }}
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>

      {/* Admin Authentication Modal */}
      {showLoginModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            backdropFilter: 'blur(2px)',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 10,
              padding: '1.75rem',
              maxWidth: '400px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div style={{ position: 'relative', marginBottom: '1.25rem', textAlign: 'center' }}>
              <button
                onClick={() => setShowLoginModal(false)}
                style={{ position: 'absolute', top: '-0.5rem', right: '-0.5rem', background: 'none', border: 'none', fontSize: '1.35rem', cursor: 'pointer', color: '#64748b' }}
              >
                &times;
              </button>
              <img
                src="/aperture-logo-hd.png"
                alt="Aperture"
                style={{ height: '32px', objectFit: 'contain', margin: '0 auto 0.6rem auto', display: 'block' }}
              />
              <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#0f172a' }}>
                Administrator Authentication
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem' }}>
                Automotive Assembly Tool Monitoring
              </div>
            </div>

            <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '1.25rem' }}>
              Authenticate with administrative privileges (Default: <code>admin</code> / <code>admin123</code>).
            </div>

            <form onSubmit={handleLoginSubmit}>
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>Username</label>
                <input
                  type="text"
                  value={loginUser}
                  onChange={(e) => setLoginUser(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.45rem',
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    marginTop: '0.25rem',
                    fontSize: '0.85rem',
                  }}
                  required
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>Password</label>
                <input
                  type="password"
                  value={loginPass}
                  onChange={(e) => setLoginPass(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.45rem',
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    marginTop: '0.25rem',
                    fontSize: '0.85rem',
                  }}
                  required
                />
              </div>

              {loginError && (
                <div style={{ fontSize: '0.75rem', color: '#ef4444', marginBottom: '0.75rem' }}>
                  {loginError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setShowLoginModal(false)}
                  style={{
                    padding: '0.45rem 0.85rem',
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoggingIn}
                  style={{
                    padding: '0.45rem 1rem',
                    borderRadius: 6,
                    border: 'none',
                    background: '#0284c7',
                    color: '#ffffff',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {isLoggingIn ? 'Authenticating...' : 'Sign In'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </header>
  );
};
