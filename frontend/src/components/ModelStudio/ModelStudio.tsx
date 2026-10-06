import React, { useState, useEffect } from 'react';
import type { MLModel, RecordingItem, UserRole } from '../../types';
import { api } from '../../services/api';
import {
  Cpu,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Download,
  Zap,
  Play,
  ShieldCheck,
  Sliders,
  Pencil,
  Trash2,
  X,
  Check,
  Info,
} from 'lucide-react';
import { useAppSettings } from '../../context/AppSettingsContext';

interface ModelStudioProps {
  models: MLModel[];
  recordings: RecordingItem[];
  currentUserRole: UserRole;
  onRefresh: () => void;
}

export const ModelStudio: React.FC<ModelStudioProps> = ({
  models,
  recordings,
  currentUserRole,
  onRefresh,
}) => {
  const { settings, updateSettings } = useAppSettings();
  const activeModel = models.find((m) => m.active_flag) || models[0];
  const [selectedVersion, setSelectedVersion] = useState<string>(activeModel?.version || '');

  // Keep selectedVersion synced if list updates and nothing is selected
  useEffect(() => {
    if (!selectedVersion && activeModel?.version) {
      setSelectedVersion(activeModel.version);
    }
  }, [activeModel, selectedVersion]);

  // Model currently inspected for metrics & evaluation
  const inspectedModel = models.find((m) => m.version === selectedVersion) || activeModel;

  const [newVersion, setNewVersion] = useState<string>(`v1.${models.length + 1}.0-tuned`);
  const [modelType, setModelType] = useState<string>('IsolationForest');
  const [warnThreshold, setWarnThreshold] = useState<number>(
    inspectedModel?.thresholds?.warn_threshold ?? settings.warnThreshold ?? 0.45
  );
  const [critThreshold, setCritThreshold] = useState<number>(
    inspectedModel?.thresholds?.critical_threshold ?? settings.criticalThreshold ?? 0.70
  );
  const [persistenceWindows, setPersistenceWindows] = useState<number>(
    settings.persistenceWindows ?? 3
  );
  const [selectedNormal, setSelectedNormal] = useState<string[]>([]);
  const [selectedDisturbed, setSelectedDisturbed] = useState<string[]>([]);
  const [isTraining, setIsTraining] = useState<boolean>(false);
  const [isUpdatingThresholds, setIsUpdatingThresholds] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Edit Modal State
  const [editingModel, setEditingModel] = useState<MLModel | null>(null);
  const [editVersion, setEditVersion] = useState<string>('');
  const [editWarn, setEditWarn] = useState<number>(0.45);
  const [editCrit, setEditCrit] = useState<number>(0.70);
  const [isSavingEdit, setIsSavingEdit] = useState<boolean>(false);

  // Live inference benchmark state
  const [isTestingInference, setIsTestingInference] = useState<boolean>(false);
  const [inferenceResult, setInferenceResult] = useState<{
    model_version: string;
    model_type: string;
    raw_score: number;
    smoothed_score: number;
    classification: string;
    recommended_action: string;
    latency_ms: number;
    warn_threshold: number;
    critical_threshold: number;
    features: {
      rms: number;
      peak: number;
      crest_factor: number;
      kurtosis: number;
      dominant_freq: number;
    };
  } | null>(null);

  // Sync thresholds when user changes selected model or settings update
  useEffect(() => {
    if (inspectedModel?.thresholds) {
      setWarnThreshold(inspectedModel.thresholds.warn_threshold ?? settings.warnThreshold ?? 0.45);
      setCritThreshold(inspectedModel.thresholds.critical_threshold ?? settings.criticalThreshold ?? 0.70);
    } else if (settings.warnThreshold !== undefined) {
      setWarnThreshold(settings.warnThreshold);
      setCritThreshold(settings.criticalThreshold ?? 0.70);
    }
  }, [inspectedModel, settings.warnThreshold, settings.criticalThreshold]);

  useEffect(() => {
    if (settings.persistenceWindows !== undefined) {
      setPersistenceWindows(settings.persistenceWindows);
    }
  }, [settings.persistenceWindows]);

  // Update default version suggestion when models list changes
  useEffect(() => {
    setNewVersion(`v1.${models.length + 1}.0-tuned`);
  }, [models.length]);

  // Background sync
  useEffect(() => {
    const interval = setInterval(() => {
      onRefresh();
    }, 5000);
    return () => clearInterval(interval);
  }, [onRefresh]);

  const canManage = currentUserRole === 'Admin' || (currentUserRole as string) === 'Engineer';

  const handleTrain = async () => {
    if (!canManage) return;
    setIsTraining(true);
    setFeedbackMsg(null);

    try {
      const normIds =
        selectedNormal.length > 0
          ? selectedNormal
          : recordings.filter((r) => r.label === 'normal').map((r) => r.id);
      const distIds =
        selectedDisturbed.length > 0
          ? selectedDisturbed
          : recordings.filter((r) => r.label === 'disturbed').map((r) => r.id);

      await api.trainModel({
        model_version: newVersion,
        model_type: modelType,
        normal_recording_ids: normIds,
        disturbed_recording_ids: distIds,
        warn_threshold: warnThreshold,
        critical_threshold: critThreshold,
        contamination: 0.05,
      });

      setFeedbackMsg({
        type: 'success',
        text: `Model ${newVersion} trained and validated successfully. Available in catalog.`,
      });
      setSelectedVersion(newVersion);
      onRefresh();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message || 'Training execution failed' });
    } finally {
      setIsTraining(false);
    }
  };

  const handleActivate = async (version: string) => {
    if (!canManage) return;
    try {
      await api.activateModel(version);
      setFeedbackMsg({
        type: 'success',
        text: `Model ${version} activated for real-time monitoring with zero downtime.`,
      });
      setSelectedVersion(version);
      onRefresh();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    }
  };

  const handleDownload = async (version: string) => {
    setIsDownloading(version);
    setFeedbackMsg(null);
    try {
      await api.downloadModel(version);
      setFeedbackMsg({
        type: 'success',
        text: `Artifact ${version}.joblib downloaded successfully.`,
      });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message || 'Failed to download model artifact' });
    } finally {
      setIsDownloading(null);
    }
  };

  const handleOpenEdit = (m: MLModel) => {
    setEditingModel(m);
    setEditVersion(m.version);
    setEditWarn(m.thresholds?.warn_threshold ?? 0.45);
    setEditCrit(m.thresholds?.critical_threshold ?? 0.70);
  };

  const handleSaveEdit = async () => {
    if (!editingModel) return;
    setIsSavingEdit(true);
    setFeedbackMsg(null);
    try {
      await api.editModel(editingModel.version, {
        version: editVersion,
        warn_threshold: editWarn,
        critical_threshold: editCrit,
      });
      setFeedbackMsg({
        type: 'success',
        text: `Model "${editVersion}" updated successfully.`,
      });
      setSelectedVersion(editVersion);
      setEditingModel(null);
      onRefresh();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message || 'Failed to update model' });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteModel = async (version: string, isActive: boolean) => {
    if (isActive) {
      alert(`Cannot delete active production model "${version}". Please activate another model version before deleting.`);
      return;
    }
    if (!window.confirm(`Are you sure you want to delete model "${version}"? This will permanently delete the model from database and remove its .joblib artifact.`)) {
      return;
    }
    setIsDeleting(version);
    setFeedbackMsg(null);
    try {
      await api.deleteModel(version);
      setFeedbackMsg({
        type: 'success',
        text: `Model "${version}" deleted successfully from catalog.`,
      });
      if (selectedVersion === version) {
        setSelectedVersion(activeModel?.version || '');
      }
      onRefresh();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message || 'Failed to delete model' });
    } finally {
      setIsDeleting(null);
    }
  };

  const handleRunInferenceBenchmark = async () => {
    setIsTestingInference(true);
    setFeedbackMsg(null);
    try {
      const res = await api.testModelInference(inspectedModel?.version);
      setInferenceResult(res);
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message || 'Live inference benchmark failed' });
    } finally {
      setIsTestingInference(false);
    }
  };

  const handleSaveThresholds = async () => {
    if (!canManage) return;
    setIsUpdatingThresholds(true);
    setFeedbackMsg(null);
    try {
      // 1. Update station runtime decision engine
      await api.updateStationThresholds(settings.stationId || 'station-A', {
        warn_threshold: warnThreshold,
        critical_threshold: critThreshold,
        persistence_windows: persistenceWindows,
      });
      // 2. Update global frontend settings context
      await updateSettings({
        warnThreshold,
        criticalThreshold: critThreshold,
        persistenceWindows,
      });
      // 3. Update the active model's threshold record in backend SQLite DB if present
      if (activeModel?.version) {
        try {
          await api.editModel(activeModel.version, {
            warn_threshold: warnThreshold,
            critical_threshold: critThreshold,
          });
        } catch (mErr) {
          console.warn('[ModelStudio] editModel sync error:', mErr);
        }
      }
      setFeedbackMsg({
        type: 'success',
        text: `Thresholds synchronized across Rig Engine, Model Catalog (${activeModel?.version || 'Active'}), and Global Settings: Warn = ${warnThreshold.toFixed(2)}, Crit = ${critThreshold.toFixed(2)}, Persistence = ${persistenceWindows}`,
      });
      onRefresh();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message || 'Failed to update thresholds' });
    } finally {
      setIsUpdatingThresholds(false);
    }
  };

  // Dynamic holdout metrics: uses inspectedModel's metrics directly from database / API
  const metrics = inspectedModel?.metrics;
  const cm = metrics?.confusion_matrix;
  const hist = metrics?.histogram;

  const fpRate =
    cm && cm[0] && cm[0][0] + cm[0][1] > 0
      ? ((cm[0][1] / (cm[0][0] + cm[0][1])) * 100).toFixed(1)
      : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Model Overview Banner */}
      <div className="b2b-card" style={{ borderLeft: '4px solid #0284c7' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Cpu size={20} color="#0284c7" />
              <div className="b2b-card-title" style={{ fontSize: '1.1rem' }}>
                Machine Learning Anomaly Detection Studio
              </div>
              <button
                onClick={onRefresh}
                className="jog-btn"
                style={{
                  padding: '0.2rem 0.6rem',
                  fontSize: '0.75rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
                title="Sync and refresh active models"
              >
                <RefreshCw size={12} />
                <span>Sync</span>
              </button>
            </div>
            <div className="b2b-card-subtitle" style={{ marginTop: '0.3rem' }}>
              Inspect, benchmark, train, and hot-activate edge models with real sensor-window feature extraction
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.4rem', fontSize: '0.8rem', flexWrap: 'wrap' }}>
              <span>
                <strong>Inspecting:</strong>{' '}
                <span className="font-mono" style={{ color: '#0284c7', fontWeight: 700 }}>
                  {inspectedModel?.version || 'N/A'}
                </span>
                {inspectedModel?.active_flag ? (
                  <span style={{ marginLeft: '0.4rem', color: '#059669', fontWeight: 600 }}>[ACTIVE ON RIG]</span>
                ) : (
                  <span style={{ marginLeft: '0.4rem', color: '#64748b' }}>[Archived Catalog]</span>
                )}
              </span>
              <span>&bull;</span>
              <span>
                <strong>Type:</strong> {inspectedModel?.model_type || 'N/A'}
              </span>
              {inspectedModel && (
                <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                  <button
                    onClick={() => handleDownload(inspectedModel.version)}
                    disabled={isDownloading === inspectedModel.version}
                    className="jog-btn"
                    style={{
                      padding: '0.15rem 0.5rem',
                      fontSize: '0.72rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      color: '#0284c7',
                    }}
                    title="Download .joblib model artifact file"
                  >
                    <Download size={12} />
                    <span>{isDownloading === inspectedModel.version ? 'Downloading...' : 'Export .joblib'}</span>
                  </button>
                  <button
                    onClick={() => handleOpenEdit(inspectedModel)}
                    className="jog-btn"
                    style={{
                      padding: '0.15rem 0.5rem',
                      fontSize: '0.72rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      color: '#0284c7',
                    }}
                    title="Edit model version name or thresholds"
                  >
                    <Pencil size={12} />
                    <span>Edit</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '2rem', textAlign: 'right' }}>
            <div>
              <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>ROC-AUC</div>
              <div className="font-mono" style={{ fontSize: '1.35rem', fontWeight: 700, color: '#0284c7' }}>
                {metrics?.roc_auc !== undefined ? Number(metrics.roc_auc).toFixed(3) : '—'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>ACCURACY</div>
              <div className="font-mono" style={{ fontSize: '1.35rem', fontWeight: 700, color: '#10b981' }}>
                {metrics?.accuracy !== undefined ? `${(Number(metrics.accuracy) * 100).toFixed(1)}%` : '—'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>STATION THRESHOLDS</div>
              <div className="font-mono" style={{ fontSize: '1.2rem', fontWeight: 600, color: '#1e293b' }}>
                <span style={{ color: '#d97706' }}>{inspectedModel?.thresholds?.warn_threshold ?? 0.45}</span> /{' '}
                <span style={{ color: '#dc2626' }}>{inspectedModel?.thresholds?.critical_threshold ?? 0.70}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {feedbackMsg && (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderRadius: 6,
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: feedbackMsg.type === 'success' ? '#ecfdf5' : '#fef2f2',
            color: feedbackMsg.type === 'success' ? '#065f46' : '#991b1b',
            border: `1px solid ${feedbackMsg.type === 'success' ? '#a7f3d0' : '#fecaca'}`,
          }}
        >
          {feedbackMsg.type === 'success' ? <ShieldCheck size={16} /> : <AlertCircle size={16} />}
          <span>{feedbackMsg.text}</span>
        </div>
      )}

      {/* Main Grid: Validation Metrics & Retraining */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: '1.25rem' }}>
        {/* Model Validation & Performance Section */}
        <div className="b2b-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="b2b-card-title">Holdout Validation Metrics ({inspectedModel?.version})</div>
              <div className="b2b-card-subtitle">
                Evaluated against recorded test partitions without data leakage
              </div>
            </div>
            {inspectedModel?.active_flag ? (
              <span
                style={{
                  background: '#dcfce7',
                  color: '#15803d',
                  padding: '0.2rem 0.5rem',
                  borderRadius: 4,
                  fontSize: '0.7rem',
                  fontWeight: 700,
                }}
              >
                LIVE ACTIVE
              </span>
            ) : (
              <span
                style={{
                  background: '#f1f5f9',
                  color: '#475569',
                  padding: '0.2rem 0.5rem',
                  borderRadius: 4,
                  fontSize: '0.7rem',
                  fontWeight: 600,
                }}
              >
                SELECTED VERSION
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', marginTop: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', marginBottom: '0.35rem' }}>
                Empirical Confusion Matrix
              </div>
              <div className="cm-grid">
                <div></div>
                <div className="cm-cell label">Pred Normal</div>
                <div className="cm-cell label">Pred Anomaly</div>

                <div className="cm-cell label">True Normal</div>
                <div className="cm-cell tn" title="True Negative">
                  {cm ? cm[0]?.[0] : '—'}
                </div>
                <div className="cm-cell fp" title="False Positive (False Alarm)">
                  {cm ? cm[0]?.[1] : '—'}
                </div>

                <div className="cm-cell label">True Disturbed</div>
                <div className="cm-cell fn" title="False Negative (Missed Anomaly)">
                  {cm ? cm[1]?.[0] : '—'}
                </div>
                <div className="cm-cell tp" title="True Positive">
                  {cm ? cm[1]?.[1] : '—'}
                </div>
              </div>
            </div>

            <div style={{ flex: 1, minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.3rem' }}>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Precision:</span>
                <span className="font-mono" style={{ fontWeight: 600 }}>
                  {metrics?.precision !== undefined ? `${(Number(metrics.precision) * 100).toFixed(1)}%` : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.3rem' }}>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Recall (Sensitivity):</span>
                <span className="font-mono" style={{ fontWeight: 600 }}>
                  {metrics?.recall !== undefined ? `${(Number(metrics.recall) * 100).toFixed(1)}%` : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.3rem' }}>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>False Alarm Rate:</span>
                <span className="font-mono" style={{ fontWeight: 600, color: '#059669' }}>
                  {fpRate !== null ? `${fpRate}%` : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.3rem' }}>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Validation Samples:</span>
                <span className="font-mono" style={{ fontSize: '0.8rem' }}>
                  {metrics?.normal_samples !== undefined ? `${metrics.normal_samples} normal • ${metrics.disturbed_samples} disturbed` : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Score Distribution Histogram */}
          {hist && hist.normal_counts && (
            <div style={{ marginTop: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>
                  Score Distribution (Green = Normal, Red = Disturbed)
                </span>
                <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Dynamic Model Evaluation</span>
              </div>
              <div style={{ display: 'flex', height: '90px', alignItems: 'flex-end', gap: '3px', background: '#f8fafc', padding: '0.5rem', borderRadius: 6, border: '1px solid #f1f5f9' }}>
                {hist.normal_counts.map((normCount, idx) => {
                  const distCount = hist.disturbed_counts[idx] || 0;
                  const maxCount = Math.max(1, ...hist.normal_counts, ...hist.disturbed_counts);
                  const hNorm = (normCount / maxCount) * 75;
                  const hDist = (distCount / maxCount) * 75;

                  return (
                    <div key={idx} style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: '1px', height: '100%' }}>
                      <div
                        style={{ flex: 1, height: `${hNorm}%`, background: '#10b981', opacity: 0.85, borderRadius: '2px 2px 0 0' }}
                        title={`Bin ${hist.bins[idx]}–${hist.bins[idx + 1]}: Normal=${normCount}`}
                      />
                      <div
                        style={{ flex: 1, height: `${hDist}%`, background: '#ef4444', opacity: 0.85, borderRadius: '2px 2px 0 0' }}
                        title={`Bin ${hist.bins[idx]}–${hist.bins[idx + 1]}: Disturbed=${distCount}`}
                      />
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#94a3b8', marginTop: 4 }}>
                <span>0.00 (Normal Peak)</span>
                <span style={{ color: '#d97706', fontWeight: 600 }}>Warn: {inspectedModel?.thresholds?.warn_threshold ?? 0.45}</span>
                <span style={{ color: '#dc2626', fontWeight: 600 }}>Crit: {inspectedModel?.thresholds?.critical_threshold ?? 0.70}</span>
                <span>1.00 (Disturbed Peak)</span>
              </div>
            </div>
          )}
        </div>

        {/* Retraining & Threshold Configuration */}
        <div className="b2b-card">
          <div className="b2b-card-title">Threshold Tuning & Model Training</div>
          <div className="b2b-card-subtitle">
            Configure safety thresholds and train new model weights from sensor recordings
          </div>

          <div style={{ marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {/* Threshold Tuning Box with Synchronized Sliders, Numeric Inputs & Presets */}
            <div style={{ background: '#f8fafc', padding: '0.85rem', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Sliders size={14} color="#0284c7" />
                  <span>Station Runtime Decision Engine &amp; Model Guardian</span>
                </span>
                <button
                  onClick={handleSaveThresholds}
                  disabled={!canManage || isUpdatingThresholds}
                  style={{
                    padding: '0.3rem 0.75rem',
                    background: '#0284c7',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: canManage ? 'pointer' : 'not-allowed',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    boxShadow: '0 1px 3px rgba(2,132,199,0.25)',
                  }}
                  title="Synchronize thresholds with Active Model, Rig Decision Engine, and Settings"
                >
                  <ShieldCheck size={13} />
                  <span>{isUpdatingThresholds ? 'Deploying & Syncing...' : 'Deploy to Rig & Sync'}</span>
                </button>
              </div>

              {/* Visual Dual-Range Spectrum Indicator */}
              <div style={{ background: '#0f172a', padding: '0.75rem', borderRadius: 6, marginBottom: '0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700, marginBottom: '0.35rem' }}>
                  <span>0.00 (NOMINAL)</span>
                  <span style={{ color: '#f59e0b' }}>WARN: {warnThreshold.toFixed(2)}</span>
                  <span style={{ color: '#ef4444' }}>CRIT: {critThreshold.toFixed(2)}</span>
                  <span>1.00</span>
                </div>

                {/* Tri-Color Stack Bar */}
                <div style={{ height: '10px', width: '100%', borderRadius: 5, overflow: 'hidden', display: 'flex', background: '#1e293b' }}>
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(0, warnThreshold * 100))}%`,
                      background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)',
                      transition: 'width 0.15s ease',
                    }}
                    title={`Nominal Normal Band (0.00 - ${warnThreshold.toFixed(2)})`}
                  />
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(0, (critThreshold - warnThreshold) * 100))}%`,
                      background: 'linear-gradient(90deg, #fbbf24 0%, #f59e0b 100%)',
                      transition: 'width 0.15s ease',
                    }}
                    title={`Warning Disturbance Band (${warnThreshold.toFixed(2)} - ${critThreshold.toFixed(2)})`}
                  />
                  <div
                    style={{
                      flex: 1,
                      background: 'linear-gradient(90deg, #f87171 0%, #dc2626 100%)',
                    }}
                    title={`Critical Fault & Trip Band (${critThreshold.toFixed(2)} - 1.00)`}
                  />
                </div>
              </div>

              {/* Threshold Sliders & Number Input Boxes */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: '0.75rem' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569' }}>
                      WARN THRESHOLD
                    </span>
                    <input
                      type="number"
                      min="0.01"
                      max="0.99"
                      step="0.01"
                      value={warnThreshold}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val)) {
                          setWarnThreshold(val);
                          if (val >= critThreshold) {
                            setCritThreshold(Math.min(1.0, val + 0.1));
                          }
                        }
                      }}
                      style={{
                        width: '56px',
                        padding: '0.15rem 0.25rem',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        fontFamily: 'monospace',
                        color: '#f59e0b',
                        border: '1px solid #cbd5e1',
                        borderRadius: 4,
                        textAlign: 'right',
                        background: '#ffffff',
                      }}
                    />
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="0.85"
                    step="0.01"
                    value={warnThreshold}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setWarnThreshold(val);
                      if (val >= critThreshold) {
                        setCritThreshold(Math.min(1.0, val + 0.1));
                      }
                    }}
                    style={{ width: '100%', accentColor: '#f59e0b', cursor: 'pointer' }}
                  />
                  <div style={{ fontSize: '0.62rem', color: '#64748b', marginTop: '0.15rem' }}>
                    Triggers 50% Speed Slowdown
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569' }}>
                      CRITICAL TRIP
                    </span>
                    <input
                      type="number"
                      min="0.05"
                      max="1.00"
                      step="0.01"
                      value={critThreshold}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val)) {
                          setCritThreshold(val);
                          if (val <= warnThreshold) {
                            setWarnThreshold(Math.max(0.05, val - 0.1));
                          }
                        }
                      }}
                      style={{
                        width: '56px',
                        padding: '0.15rem 0.25rem',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        fontFamily: 'monospace',
                        color: '#ef4444',
                        border: '1px solid #cbd5e1',
                        borderRadius: 4,
                        textAlign: 'right',
                        background: '#ffffff',
                      }}
                    />
                  </div>
                  <input
                    type="range"
                    min="0.10"
                    max="1.00"
                    step="0.01"
                    value={critThreshold}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setCritThreshold(val);
                      if (val <= warnThreshold) {
                        setWarnThreshold(Math.max(0.05, val - 0.1));
                      }
                    }}
                    style={{ width: '100%', accentColor: '#ef4444', cursor: 'pointer' }}
                  />
                  <div style={{ fontSize: '0.62rem', color: '#64748b', marginTop: '0.15rem' }}>
                    Triggers Mandatory E-Stop
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569' }}>
                      PERSISTENCE
                    </span>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      step="1"
                      value={persistenceWindows}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val)) setPersistenceWindows(val);
                      }}
                      style={{
                        width: '50px',
                        padding: '0.15rem 0.25rem',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        fontFamily: 'monospace',
                        color: '#0284c7',
                        border: '1px solid #cbd5e1',
                        borderRadius: 4,
                        textAlign: 'right',
                        background: '#ffffff',
                      }}
                    />
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    step="1"
                    value={persistenceWindows}
                    onChange={(e) => setPersistenceWindows(parseInt(e.target.value, 10))}
                    style={{ width: '100%', accentColor: '#0284c7', cursor: 'pointer' }}
                  />
                  <div style={{ fontSize: '0.62rem', color: '#64748b', marginTop: '0.15rem' }}>
                    Consecutive ({persistenceWindows} windows)
                  </div>
                </div>
              </div>

              {/* Tuning Presets */}
              <div style={{ marginTop: '0.75rem', borderTop: '1px solid #e2e8f0', paddingTop: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>
                  QUICK TUNING PRESETS:
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                  {[
                    { label: 'Conservative (Safe)', warn: 0.30, crit: 0.55, win: 2 },
                    { label: 'Standard Industrial (Default)', warn: 0.45, crit: 0.70, win: 3 },
                    { label: 'Permissive', warn: 0.60, crit: 0.82, win: 4 },
                    { label: 'Extreme High-Vibration', warn: 0.70, crit: 0.90, win: 5 },
                  ].map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setWarnThreshold(p.warn);
                        setCritThreshold(p.crit);
                        setPersistenceWindows(p.win);
                      }}
                      className="filter-pill"
                      style={{ fontSize: '0.68rem', padding: '0.2rem 0.5rem' }}
                    >
                      {p.label} (Warn: {p.warn}, Crit: {p.crit})
                    </button>
                  ))}
                </div>
              </div>

              {/* Informative Guidance on Probability Scale */}
              <div style={{ marginTop: '0.65rem', fontSize: '0.72rem', color: '#475569', background: '#e0f2fe', border: '1px solid #bae6fd', padding: '0.45rem 0.65rem', borderRadius: 6, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <Info size={14} color="#0284c7" style={{ flexShrink: 0 }} />
                <span>
                  <strong>Probability Index [0.00 – 1.00]:</strong> AI Anomaly score is a probability index between 0.00 (0% anomaly) and 1.00 (100% anomaly). Setting values like 1 or 2 is clamped to 0.95/0.99. To adjust physical vibration g-force limits, tune <em>Hard Vibration Limit (g)</em> above.
                </span>
              </div>
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>New Model Version Tag</label>
              <input
                type="text"
                value={newVersion}
                onChange={(e) => setNewVersion(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.45rem',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  marginTop: '0.2rem',
                  fontSize: '0.85rem',
                  fontFamily: 'JetBrains Mono',
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>Algorithm Architecture</label>
              <select
                value={modelType}
                onChange={(e) => setModelType(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.45rem',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  marginTop: '0.2rem',
                  fontSize: '0.85rem',
                }}
              >
                <option value="IsolationForest">Isolation Forest (Unsupervised Baseline)</option>
                <option value="RandomForest">Random Forest (Supervised Normal vs Disturbed)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>
                Select Datasets from Recordings ({recordings.length} available)
              </label>
              <div
                style={{
                  maxHeight: '90px',
                  overflowY: 'auto',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  padding: '0.4rem',
                  marginTop: '0.2rem',
                  fontSize: '0.75rem',
                }}
              >
                {recordings.length === 0 ? (
                  <div style={{ color: '#94a3b8', padding: '0.4rem' }}>
                    No recorded datasets available. Capture live sensor streams in Recordings Catalog to train.
                  </div>
                ) : (
                  recordings.map((r) => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.15rem 0' }}>
                      <input
                        type="checkbox"
                        defaultChecked
                        id={`rec_${r.id}`}
                        onChange={(e) => {
                          if (r.label === 'normal') {
                            setSelectedNormal((prev) =>
                              e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id)
                            );
                          } else {
                            setSelectedDisturbed((prev) =>
                              e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id)
                            );
                          }
                        }}
                      />
                      <label htmlFor={`rec_${r.id}`} style={{ cursor: 'pointer' }}>
                        <strong style={{ color: r.label === 'normal' ? '#059669' : '#dc2626' }}>[{r.label}]</strong>{' '}
                        {r.name} ({r.sample_count} windows)
                      </label>
                    </div>
                  ))
                )}
              </div>
            </div>

            <button
              onClick={handleTrain}
              disabled={isTraining || !canManage}
              style={{
                marginTop: '0.2rem',
                padding: '0.55rem',
                borderRadius: 6,
                border: 'none',
                background: canManage ? '#0284c7' : '#94a3b8',
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: canManage ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
              }}
            >
              <Cpu size={16} />
              <span>{isTraining ? 'Training & Evaluating Holdout Metrics...' : 'Train Model Version'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Live Inference Benchmark & Test Sandbox */}
      <div className="b2b-card" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div className="b2b-card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Zap size={18} color="#d97706" />
              <span>Live Inference Benchmark & Test Sandbox</span>
            </div>
            <div className="b2b-card-subtitle">
              Execute single-window sensor inference against model{' '}
              <span className="font-mono" style={{ fontWeight: 600, color: '#0284c7' }}>
                {inspectedModel?.version}
              </span>{' '}
              to measure edge latency, real-time feature extraction, and decision classification
            </div>
          </div>

          <button
            onClick={handleRunInferenceBenchmark}
            disabled={isTestingInference}
            style={{
              padding: '0.55rem 1.1rem',
              background: '#0284c7',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontWeight: 700,
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              cursor: isTestingInference ? 'wait' : 'pointer',
              boxShadow: '0 2px 4px rgba(2,132,199,0.25)',
            }}
          >
            {isTestingInference ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
            <span>{isTestingInference ? 'Evaluating Live Window...' : 'Run Live Rig Inference Test'}</span>
          </button>
        </div>

        {inferenceResult && (
          <div
            style={{
              marginTop: '1rem',
              background: '#ffffff',
              padding: '1rem',
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '1rem',
            }}
          >
            <div style={{ borderRight: '1px solid #f1f5f9', paddingRight: '0.5rem' }}>
              <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>CLASSIFICATION</div>
              <div
                style={{
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  marginTop: '0.2rem',
                  color:
                    inferenceResult.classification === 'NOMINAL_HEALTHY'
                      ? '#059669'
                      : inferenceResult.classification === 'ELEVATED_VIBRATION'
                      ? '#d97706'
                      : '#dc2626',
                }}
              >
                {inferenceResult.classification}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.15rem' }}>
                Action: <span className="font-mono">{inferenceResult.recommended_action}</span>
              </div>
            </div>

            <div style={{ borderRight: '1px solid #f1f5f9', paddingRight: '0.5rem' }}>
              <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>ANOMALY SCORE</div>
              <div className="font-mono" style={{ fontSize: '1.2rem', fontWeight: 700, marginTop: '0.2rem', color: '#1e293b' }}>
                {inferenceResult.smoothed_score.toFixed(4)}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                Raw: {inferenceResult.raw_score.toFixed(4)}
              </div>
            </div>

            <div style={{ borderRight: '1px solid #f1f5f9', paddingRight: '0.5rem' }}>
              <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>EDGE LATENCY</div>
              <div className="font-mono" style={{ fontSize: '1.2rem', fontWeight: 700, marginTop: '0.2rem', color: '#0284c7' }}>
                {inferenceResult.latency_ms} ms
              </div>
              <div style={{ fontSize: '0.72rem', color: '#059669', fontWeight: 600 }}>
                &lt; 50 ms PLC Fast Loop
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>EXTRACTED FEATURES</div>
              <div className="font-mono" style={{ fontSize: '0.75rem', marginTop: '0.2rem', color: '#334155', lineHeight: '1.4' }}>
                <div>RMS: {inferenceResult.features.rms.toFixed(4)} g</div>
                <div>Kurtosis: {inferenceResult.features.kurtosis.toFixed(2)}</div>
                <div>Crest Factor: {inferenceResult.features.crest_factor.toFixed(2)}</div>
                <div>Peak Freq: {inferenceResult.features.dominant_freq.toFixed(1)} Hz</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Model Versions Catalog Table */}
      <div className="b2b-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="b2b-card-title">Model Versions Catalog & Deployment History</div>
            <div className="b2b-card-subtitle">
              Click any version row to inspect holdout validation metrics or test inference. Hot-activate without assembly line shutdown.
            </div>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
            Total Models: <strong style={{ color: '#0f172a' }}>{models.length}</strong>
          </div>
        </div>

        <table className="b2b-table" style={{ marginTop: '0.75rem' }}>
          <thead>
            <tr>
              <th>Version Tag</th>
              <th>Architecture</th>
              <th>Thresholds (Warn/Crit)</th>
              <th>ROC-AUC</th>
              <th>Accuracy</th>
              <th>Status</th>
              <th>Created Date</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => {
              const isSelected = m.version === selectedVersion;
              return (
                <tr
                  key={m.id}
                  onClick={() => setSelectedVersion(m.version)}
                  style={{
                    cursor: 'pointer',
                    background: isSelected ? '#f0f9ff' : undefined,
                    transition: 'background 0.15s ease',
                  }}
                  title="Click to inspect validation metrics and benchmark this model"
                >
                  <td className="font-mono" style={{ fontWeight: 700, color: isSelected ? '#0284c7' : '#0f172a' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {isSelected && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#0284c7' }} />}
                      <span>{m.version}</span>
                    </div>
                  </td>
                  <td>{m.model_type}</td>
                  <td className="font-mono">
                    {m.thresholds?.warn_threshold ?? 0.45} / {m.thresholds?.critical_threshold ?? 0.70}
                  </td>
                  <td className="font-mono" style={{ color: '#0284c7', fontWeight: 600 }}>
                    {m.metrics?.roc_auc !== undefined ? Number(m.metrics.roc_auc).toFixed(3) : '—'}
                  </td>
                  <td className="font-mono" style={{ color: '#10b981', fontWeight: 600 }}>
                    {m.metrics?.accuracy !== undefined ? `${(Number(m.metrics.accuracy) * 100).toFixed(1)}%` : '—'}
                  </td>
                  <td>
                    {m.active_flag ? (
                      <span style={{ color: '#059669', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                        <CheckCircle2 size={14} /> ACTIVE RIG
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Archived</span>
                    )}
                  </td>
                  <td style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {new Date(m.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} onClick={(e) => e.stopPropagation()}>
                      {!m.active_flag && (
                        <button
                          onClick={() => handleActivate(m.version)}
                          disabled={!canManage}
                          style={{
                            padding: '0.25rem 0.55rem',
                            fontSize: '0.72rem',
                            background: '#0284c7',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 4,
                            cursor: canManage ? 'pointer' : 'not-allowed',
                            fontWeight: 600,
                          }}
                          title="Deploy this model to real-time live monitoring"
                        >
                          Activate
                        </button>
                      )}
                      <button
                        onClick={() => handleDownload(m.version)}
                        disabled={isDownloading === m.version}
                        className="jog-btn"
                        style={{
                          padding: '0.25rem 0.45rem',
                          fontSize: '0.72rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          color: '#475569',
                        }}
                        title="Download .joblib model weights"
                      >
                        <Download size={12} />
                        <span>{isDownloading === m.version ? '...' : '.joblib'}</span>
                      </button>
                      <button
                        onClick={() => handleOpenEdit(m)}
                        disabled={!canManage}
                        className="jog-btn"
                        style={{
                          padding: '0.25rem 0.45rem',
                          fontSize: '0.72rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          color: '#0284c7',
                        }}
                        title="Edit model version name or thresholds"
                      >
                        <Pencil size={12} />
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={() => handleDeleteModel(m.version, m.active_flag)}
                        disabled={!canManage || m.active_flag || isDeleting === m.version}
                        className="jog-btn"
                        style={{
                          padding: '0.25rem 0.45rem',
                          fontSize: '0.72rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          color: m.active_flag ? '#cbd5e1' : '#ef4444',
                          cursor: m.active_flag ? 'not-allowed' : 'pointer',
                        }}
                        title={m.active_flag ? 'Cannot delete active model' : 'Delete model version'}
                      >
                        <Trash2 size={12} />
                        <span>{isDeleting === m.version ? '...' : 'Del'}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Edit Model Modal */}
      {editingModel && (
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
              maxWidth: '480px',
              width: '100%',
              padding: '1.5rem',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Pencil size={18} color="#0284c7" />
                <span style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a' }}>
                  Edit Model Configuration
                </span>
              </div>
              <button
                onClick={() => setEditingModel(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>Model Version Tag</label>
                <input
                  type="text"
                  value={editVersion}
                  onChange={(e) => setEditVersion(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    marginTop: '0.2rem',
                    fontFamily: 'JetBrains Mono',
                    fontSize: '0.85rem',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#d97706' }}>
                  Warn Threshold: {editWarn.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0.20"
                  max="0.60"
                  step="0.05"
                  value={editWarn}
                  onChange={(e) => setEditWarn(parseFloat(e.target.value))}
                  style={{ width: '100%', marginTop: '0.2rem' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#dc2626' }}>
                  Critical Threshold: {editCrit.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0.50"
                  max="0.95"
                  step="0.05"
                  value={editCrit}
                  onChange={(e) => setEditCrit(parseFloat(e.target.value))}
                  style={{ width: '100%', marginTop: '0.2rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.75rem' }}>
                <button
                  onClick={() => setEditingModel(null)}
                  className="jog-btn"
                  style={{ padding: '0.45rem 1rem' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={isSavingEdit}
                  style={{
                    padding: '0.45rem 1.25rem',
                    background: '#0284c7',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    fontWeight: 700,
                    cursor: isSavingEdit ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  {isSavingEdit ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                  <span>{isSavingEdit ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
