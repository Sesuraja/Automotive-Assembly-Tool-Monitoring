import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import type { AuditLogItem } from '../../types';
import {
  ShieldAlert,
  UserCheck,
  RefreshCw,
  Search,
  Filter,
  Download,
  AlertTriangle,
  RotateCcw,
  Cpu,
  Sliders,
  FileText,
  Clock,
} from 'lucide-react';
import { exportToProfessionalPdf } from '../../utils/exportPdf';
import { useAppSettings } from '../../context/AppSettingsContext';

export const AuditView: React.FC = () => {
  const { settings, formatDateTime } = useAppSettings();
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [filterAction, setFilterAction] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isLiveStreaming, setIsLiveStreaming] = useState<boolean>(true);
  const [systemTime, setSystemTime] = useState<string>(formatDateTime(new Date()));

  // Real-time live clock ticker in selected timezone
  useEffect(() => {
    const clockInterval = setInterval(() => {
      setSystemTime(formatDateTime(new Date()));
    }, 1000);
    return () => clearInterval(clockInterval);
  }, [formatDateTime]);

  const fetchLogs = async () => {
    try {
      const res = await api.getAuditLogs(150);
      if (Array.isArray(res)) setLogs(res);
    } catch (e) {
      console.error('Failed to query audit trail', e);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchLogs().finally(() => setLoading(false));
  }, []);

  // Live Auto-Stream Poller
  useEffect(() => {
    let interval: any = null;
    if (isLiveStreaming) {
      interval = setInterval(fetchLogs, 2500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isLiveStreaming]);

  // Filtering
  const filteredLogs = logs.filter((l) => {
    const matchesAction = filterAction === 'all' || l.action === filterAction;
    const matchesSearch =
      !searchTerm ||
      l.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.action?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.details?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.resource?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesAction && matchesSearch;
  });

  // Export CSV
  const exportAuditCsv = () => {
    if (filteredLogs.length === 0) return;
    const headers = ['Timestamp', 'Username', 'Action', 'Resource', 'Details'];
    const rows = filteredLogs.map((l) => [
      `"${formatDateTime(l.ts)}"`,
      `"${l.username || 'System'}"`,
      `"${l.action}"`,
      `"${l.resource || `Station:${settings.stationId}`}"`,
      `"${(l.details || '').replace(/"/g, '""')}"`,
    ]);
    const csvContent =
      'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', encodeURI(csvContent));
    const safeBrand = (settings.brandName || 'station').toLowerCase().replace(/[^a-z0-9]/g, '_');
    dlAnchor.setAttribute('download', `${safeBrand}_audit_trail_${Date.now()}.csv`);
    dlAnchor.click();
  };

  // Export PDF with company and brand dynamic styling
  const exportAuditPdf = () => {
    exportToProfessionalPdf({
      title: `${settings.brandName} Security & Operational Audit Ledger`,
      subtitle: `${settings.companyName} • Immutable record of user interventions, safety lockouts, and AI lifecycle changes (Timezone: ${settings.timezone})`,
      systemTime,
      kpis: [
        { label: 'Audit Trail Entries', value: logs.length.toString(), unit: 'EVENTS', accent: 'blue' },
        { label: 'Station Resets', value: resetCount.toString(), unit: 'CLEARS', accent: 'green' },
        { label: 'Emergency Interventions', value: stopCount.toString(), unit: 'STOPS', accent: 'red' },
        { label: 'AI Model Operations', value: modelCount.toString(), unit: 'ACTIONS', accent: 'amber' },
      ],
      columns: ['Timestamp', 'Authenticated User', 'Action Category', 'Target Resource', 'Operational Details'],
      rows: filteredLogs.map((l) => [
        formatDateTime(l.ts),
        l.username || 'Administrator',
        l.action,
        l.resource || `Station:${settings.stationId}`,
        l.details || 'Explicit operation executed.',
      ]),
    });
  };

  // KPI counts computed dynamically from database logs
  const totalCount = logs.length;
  const resetCount = logs.filter((l) => l.action.includes('RESET')).length;
  const stopCount = logs.filter((l) => l.action.includes('STOP')).length;
  const modelCount = logs.filter(
    (l) => l.action.includes('MODEL') || l.action.includes('TRAIN') || l.action.includes('THRESHOLD')
  ).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Top Security KPI Ribbon */}
      <div className="metrics-ribbon">
        <div className="metric-tile blue">
          <div className="metric-label">Audit Trail Entries</div>
          <div className="metric-value-row">
            <span className="metric-value font-mono">{totalCount}</span>
            <span className="metric-unit">EVENTS</span>
          </div>
          <div className="metric-footer">Immutable Database Transaction Ledger</div>
        </div>

        <div className="metric-tile green">
          <div className="metric-label">Station Resets / Cleared Lockouts</div>
          <div className="metric-value-row">
            <span className="metric-value font-mono">{resetCount}</span>
            <span className="metric-unit">RESETS</span>
          </div>
          <div className="metric-footer">Mandatory Explicit Administrator Clears</div>
        </div>

        <div className="metric-tile red">
          <div className="metric-label">Emergency Interventions</div>
          <div className="metric-value-row">
            <span className="metric-value font-mono">{stopCount}</span>
            <span className="metric-unit">STOPS</span>
          </div>
          <div className="metric-footer">Operator E-Stops & Critical Interlocks</div>
        </div>

        <div className="metric-tile amber">
          <div className="metric-label">AI Model & Config Deployments</div>
          <div className="metric-value-row">
            <span className="metric-value font-mono">{modelCount}</span>
            <span className="metric-unit">OPERATIONS</span>
          </div>
          <div className="metric-footer">Model Retraining, Edits & Activations</div>
        </div>
      </div>

      {/* Main Audit Trail Card */}
      <div className="b2b-card">
        {/* Header & Controls */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '1rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShieldAlert size={18} color="#0284c7" />
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                Security & Operational Audit Trail
              </h2>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                fontSize: '0.8rem',
                color: 'var(--text-muted)',
                marginTop: 4,
              }}
            >
              <span>Cryptographically signed record of user interventions, safety lockouts, and AI lifecycle changes</span>
              <span style={{ color: '#cbd5e1' }}>&bull;</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: '#0284c7', fontWeight: 600 }}>
                <Clock size={13} />
                <span>System Clock: {systemTime} ({settings.timezone})</span>
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            {/* Live Streaming Toggle */}
            <button
              onClick={() => setIsLiveStreaming(!isLiveStreaming)}
              className="jog-btn"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                background: isLiveStreaming ? '#ecfdf5' : '#f8fafc',
                borderColor: isLiveStreaming ? '#a7f3d0' : 'var(--border-color)',
                color: isLiveStreaming ? '#065f46' : 'var(--text-muted)',
              }}
              title="Toggle automatic 2.5s real-time streaming"
            >
              <span className={`motor-pulse-dot ${isLiveStreaming ? 'green' : 'amber'}`}></span>
              <span>{isLiveStreaming ? 'LIVE AUDIT (2.5s)' : 'AUDIT PAUSED'}</span>
            </button>

            {/* Refresh */}
            <button
              onClick={fetchLogs}
              disabled={loading}
              className="jog-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}
              title="Sync latest audit ledger entries"
            >
              <RefreshCw size={14} className={loading ? 'spin-smooth' : ''} />
              <span>Refresh</span>
            </button>

            {/* Export CSV */}
            <button
              onClick={exportAuditCsv}
              className="jog-btn"
              style={{
                padding: '0.45rem 0.85rem',
                borderRadius: 6,
                background: '#f8fafc',
                borderColor: '#cbd5e1',
                color: '#334155',
                fontSize: '0.8rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                cursor: 'pointer',
              }}
              title="Export filtered audit logs to CSV"
            >
              <Download size={14} color="#0284c7" />
              <span>Export CSV</span>
            </button>

            {/* Export PDF */}
            <button
              onClick={exportAuditPdf}
              style={{
                padding: '0.45rem 0.95rem',
                borderRadius: 6,
                background: '#0284c7',
                border: 'none',
                color: '#ffffff',
                fontSize: '0.8rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(2, 132, 199, 0.2)',
              }}
              title={`Export official ${settings.brandName} branded Audit Report`}
            >
              <FileText size={14} />
              <span>Export PDF ({settings.brandName})</span>
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
            marginTop: '1rem',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: '0.78rem',
                color: 'var(--text-dim)',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              <Filter size={13} /> Action:
            </span>
            <button
              onClick={() => setFilterAction('all')}
              className={`filter-pill ${filterAction === 'all' ? 'active' : ''}`}
            >
              All Events ({logs.length})
            </button>
            <button
              onClick={() => setFilterAction('RESET_STATION')}
              className={`filter-pill ${filterAction === 'RESET_STATION' ? 'active' : ''}`}
            >
              Station Resets ({resetCount})
            </button>
            <button
              onClick={() => setFilterAction('EMERGENCY_STOP')}
              className={`filter-pill ${filterAction === 'EMERGENCY_STOP' ? 'active' : ''}`}
            >
              Emergency Stops ({stopCount})
            </button>
            <button
              onClick={() => setFilterAction('ACTIVATE_MODEL')}
              className={`filter-pill ${filterAction === 'ACTIVATE_MODEL' ? 'active' : ''}`}
            >
              Model Activations
            </button>
            <button
              onClick={() => setFilterAction('SET_THRESHOLDS')}
              className={`filter-pill ${filterAction === 'SET_THRESHOLDS' ? 'active' : ''}`}
            >
              Threshold Updates
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: '#f8fafc',
              border: '1px solid var(--border-color)',
              borderRadius: 6,
              padding: '0.35rem 0.65rem',
              width: '240px',
            }}
          >
            <Search size={14} color="#94a3b8" />
            <input
              type="text"
              placeholder="Search user, action, details..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                border: 'none',
                background: 'transparent',
                outline: 'none',
                fontSize: '0.8rem',
                width: '100%',
                color: 'var(--text-main)',
              }}
            />
          </div>
        </div>

        {/* Audit Table */}
        <table className="b2b-table" style={{ marginTop: '0.75rem' }}>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Authenticated User</th>
              <th>Action Category</th>
              <th>Target Resource</th>
              <th>Operational Details & Notes</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '2.5rem', color: '#94a3b8' }}>
                  No audit log entries found matching "{searchTerm}".
                </td>
              </tr>
            ) : (
              filteredLogs.map((l) => {
                const isReset = l.action.includes('RESET');
                const isStop = l.action.includes('STOP');
                const isModel = l.action.includes('MODEL') || l.action.includes('TRAIN');
                const isThreshold = l.action.includes('THRESHOLD') || l.action.includes('EDIT');

                return (
                  <tr key={l.id}>
                    <td className="font-mono" style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {formatDateTime(l.ts)}
                    </td>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600 }}>
                        <UserCheck size={14} color="#0284c7" />
                        <span>{l.username || 'Administrator'}</span>
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          padding: '0.2rem 0.55rem',
                          borderRadius: 4,
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          background: isReset
                            ? '#ecfdf5'
                            : isStop
                            ? '#fef2f2'
                            : isModel
                            ? '#eff6ff'
                            : isThreshold
                            ? '#fffbeb'
                            : '#f1f5f9',
                          color: isReset
                            ? '#065f46'
                            : isStop
                            ? '#991b1b'
                            : isModel
                            ? '#1e40af'
                            : isThreshold
                            ? '#92400e'
                            : '#334155',
                          border: `1px solid ${
                            isReset
                              ? '#a7f3d0'
                              : isStop
                              ? '#fecaca'
                              : isModel
                              ? '#bfdbfe'
                              : isThreshold
                              ? '#fde68a'
                              : '#e2e8f0'
                          }`,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                        }}
                      >
                        {isReset && <RotateCcw size={12} />}
                        {isStop && <AlertTriangle size={12} />}
                        {isModel && <Cpu size={12} />}
                        {isThreshold && <Sliders size={12} />}
                        {l.action}
                      </span>
                    </td>
                    <td className="font-mono" style={{ fontSize: '0.78rem', color: '#0284c7' }}>
                      {l.resource || `Station:${settings.stationId}`}
                    </td>
                    <td style={{ fontSize: '0.8rem', color: '#334155' }}>
                      {l.details || 'Explicit operation executed.'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
