import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import type { UserRole } from '../../types';
import {
  User,
  Mail,
  Shield,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  LogOut,
  X,
  Save,
} from 'lucide-react';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUsername: string;
  currentUserRole: UserRole;
  onProfileUpdated: (newUsername: string, email?: string) => void;
  onLogout: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  currentUsername,
  currentUserRole,
  onProfileUpdated,
  onLogout,
}) => {
  const [usernameInput, setUsernameInput] = useState<string>(currentUsername);
  const [emailInput, setEmailInput] = useState<string>('admin@aperture.auto');
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [isEditing, setIsEditing] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      setUsernameInput(currentUsername);
      setError('');
      setSuccess('');
      api
        .getMe(currentUsername)
        .then((res) => {
          if (res) {
            if (res.username) setUsernameInput(res.username);
            if (res.email) setEmailInput(res.email);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, currentUsername]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const res = await api.updateProfile({
        current_username: currentUsername,
        new_username: usernameInput.trim() !== currentUsername ? usernameInput.trim() : undefined,
        email: emailInput.trim(),
        password: passwordInput.trim() ? passwordInput.trim() : undefined,
      });

      setSuccess('Profile successfully updated.');
      setPasswordInput('');
      setIsEditing(false);
      onProfileUpdated(res.username, res.email);
    } catch (err: any) {
      setError(err.message || 'Failed to update user profile');
    } finally {
      setLoading(false);
    }
  };

  const getInitials = (name: string) => {
    return name ? name.slice(0, 2).toUpperCase() : 'AP';
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '460px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          overflow: 'hidden',
          border: '1px solid #e2e8f0',
        }}
      >
        {/* Modal Top Header - Clean White Theme */}
        <div
          style={{
            background: '#ffffff',
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid #f1f5f9',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                background: '#eff6ff',
                color: '#0284c7',
                fontWeight: 700,
                fontSize: '1.05rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px solid #bfdbfe',
              }}
            >
              {getInitials(usernameInput || currentUsername)}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#0f172a', letterSpacing: '-0.01em' }}>
                {usernameInput || currentUsername}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.78rem',
                  color: '#0284c7',
                  fontWeight: 600,
                }}
              >
                <Shield size={13} />
                <span>{currentUserRole} &bull; Aperture</span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              color: '#64748b',
              cursor: 'pointer',
              padding: '0.35rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '1.5rem', background: '#ffffff' }}>
          {error && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '6px',
                padding: '0.65rem 0.85rem',
                color: '#991b1b',
                fontSize: '0.8rem',
                marginBottom: '1rem',
              }}
            >
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: '#ecfdf5',
                border: '1px solid #a7f3d0',
                borderRadius: '6px',
                padding: '0.65rem 0.85rem',
                color: '#065f46',
                fontSize: '0.8rem',
                marginBottom: '1rem',
              }}
            >
              <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
              <span>{success}</span>
            </div>
          )}

          {!isEditing ? (
            /* Profile View Mode */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>Username</span>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a' }}>
                    {usernameInput || currentUsername}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>Email Address</span>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0f172a' }}>
                    {emailInput || 'admin@aperture.auto'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>Authorization Tier</span>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      background: '#eff6ff',
                      color: '#0284c7',
                      padding: '0.2rem 0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #bfdbfe',
                    }}
                  >
                    {currentUserRole}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>Security Status</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: '#10b981', fontWeight: 600 }}>
                    <CheckCircle2 size={13} />
                    <span>Active Session</span>
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '0.65rem', marginTop: '0.25rem' }}>
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  style={{
                    flex: 1,
                    padding: '0.65rem 1rem',
                    borderRadius: '6px',
                    border: '1px solid #0284c7',
                    background: '#0284c7',
                    color: '#ffffff',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <User size={15} />
                  <span>Edit Profile</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onLogout();
                  }}
                  style={{
                    padding: '0.65rem 1rem',
                    borderRadius: '6px',
                    border: '1px solid #fecaca',
                    background: '#fef2f2',
                    color: '#dc2626',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                  title="Sign out of current workstation"
                >
                  <LogOut size={15} />
                  <span>Log Out</span>
                </button>
              </div>
            </div>
          ) : (
            /* Profile Edit Form */
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#334155', marginBottom: '0.25rem', display: 'block' }}>
                  Display Name / Username
                </label>
                <div style={{ display: 'flex', alignItems: 'center', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '0.5rem 0.65rem', gap: '0.5rem' }}>
                  <User size={15} color="#64748b" />
                  <input
                    type="text"
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value)}
                    style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '0.85rem', width: '100%', color: '#0f172a' }}
                    required
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#334155', marginBottom: '0.25rem', display: 'block' }}>
                  Email Address
                </label>
                <div style={{ display: 'flex', alignItems: 'center', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '0.5rem 0.65rem', gap: '0.5rem' }}>
                  <Mail size={15} color="#64748b" />
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '0.85rem', width: '100%', color: '#0f172a' }}
                    required
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#334155', marginBottom: '0.25rem', display: 'block' }}>
                  New Password (leave blank to keep current)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '0.5rem 0.65rem', gap: '0.5rem' }}>
                  <KeyRound size={15} color="#64748b" />
                  <input
                    type="password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder="Enter new password..."
                    style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '0.85rem', width: '100%', color: '#0f172a' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  style={{
                    padding: '0.5rem 0.85rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#475569',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    padding: '0.5rem 1.1rem',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#0284c7',
                    color: '#ffffff',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}
                >
                  <Save size={14} />
                  <span>{loading ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
