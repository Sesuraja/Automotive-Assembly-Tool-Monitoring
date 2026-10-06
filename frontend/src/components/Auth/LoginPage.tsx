import React, { useState } from 'react';
import { api } from '../../services/api';
import type { UserRole } from '../../types';
import { Lock, User, AlertCircle, ArrowRight } from 'lucide-react';
import { useAppSettings } from '../../context/AppSettingsContext';

interface LoginPageProps {
  onLoginSuccess: (username: string, role: UserRole) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const { settings } = useAppSettings();
  const [username, setUsername] = useState<string>('admin');
  const [password, setPassword] = useState<string>('admin123');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [rememberMe, setRememberMe] = useState<boolean>(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await api.login(username, password);
      onLoginSuccess(res.username || username, (res.role as UserRole) || 'Admin');
    } catch (err: any) {
      setError(err.message || 'Invalid username or password. Please verify your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f8fafc',
        padding: '1.5rem',
        boxSizing: 'border-box',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '2.5rem 2rem',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
        }}
      >
        {/* Brand Logo & Title */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <img
            src={settings.companyLogo || "/aperture-logo-hd.png"}
            alt={settings.brandName || "Logo"}
            style={{
              height: '42px',
              objectFit: 'contain',
              margin: '0 auto 1.25rem auto',
              display: 'block',
            }}
            onError={(e) => {
              (e.target as any).src = '/aperture-logo-hd.png';
            }}
          />
          <h1
            style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              color: '#0f172a',
              margin: '0 0 0.35rem 0',
              letterSpacing: '-0.01em',
            }}
          >
            {settings.companyName || 'Automotive Assembly Tool Monitoring'}
          </h1>
          <p
            style={{
              fontSize: '0.85rem',
              color: '#64748b',
              margin: 0,
            }}
          >
            {settings.brandName} &bull; Sign in with your enterprise credentials
          </p>
        </div>

        {/* Credentials Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
          <div>
            <label
              style={{
                fontSize: '0.8rem',
                fontWeight: 600,
                color: '#334155',
                marginBottom: '0.35rem',
                display: 'block',
              }}
            >
              Username
            </label>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '0.55rem 0.75rem',
                gap: '0.5rem',
                transition: 'border-color 0.15s ease',
              }}
            >
              <User size={16} color="#94a3b8" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#0f172a',
                  fontSize: '0.88rem',
                  width: '100%',
                }}
                required
              />
            </div>
          </div>

          <div>
            <label
              style={{
                fontSize: '0.8rem',
                fontWeight: 600,
                color: '#334155',
                marginBottom: '0.35rem',
                display: 'block',
              }}
            >
              Password
            </label>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '0.55rem 0.75rem',
                gap: '0.5rem',
                transition: 'border-color 0.15s ease',
              }}
            >
              <Lock size={16} color="#94a3b8" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#0f172a',
                  fontSize: '0.88rem',
                  width: '100%',
                }}
                required
              />
            </div>
          </div>

          {/* Remember me & default hint */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.78rem',
              color: '#64748b',
              marginTop: '-0.2rem',
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{ accentColor: '#0284c7' }}
              />
              <span>Remember me</span>
            </label>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              Default: <code style={{ color: '#0284c7' }}>admin</code> / <code style={{ color: '#0284c7' }}>admin123</code>
            </span>
          </div>

          {error && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '6px',
                padding: '0.6rem 0.75rem',
                color: '#b91c1c',
                fontSize: '0.8rem',
              }}
            >
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: '0.4rem',
              padding: '0.65rem 1.25rem',
              borderRadius: '6px',
              border: 'none',
              background: '#0284c7',
              color: '#ffffff',
              fontSize: '0.88rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.4rem',
              transition: 'background-color 0.15s ease',
            }}
            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#0369a1')}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#0284c7')}
          >
            <span>{loading ? 'Signing in...' : 'Sign In'}</span>
            <ArrowRight size={15} />
          </button>
        </form>
      </div>

      {/* Subtle Corporate Footer */}
      <div
        style={{
          marginTop: '1.75rem',
          fontSize: '0.75rem',
          color: '#94a3b8',
          textAlign: 'center',
        }}
      >
        &copy; {new Date().getFullYear()} Aperture. All rights reserved.
      </div>
    </div>
  );
};
