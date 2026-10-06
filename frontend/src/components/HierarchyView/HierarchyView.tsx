import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import type { HierarchyNode } from '../../types';
import { Network, Building2, Factory, GitCommit, Monitor, Radio } from 'lucide-react';

export const HierarchyView: React.FC = () => {
  const [hierarchy, setHierarchy] = useState<HierarchyNode[]>([]);

  useEffect(() => {
    api.getHierarchy().then((data) => setHierarchy(data)).catch(console.error);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="b2b-card">
        <div className="b2b-card-title">
          <Network size={18} color="#0284c7" />
          <span>Plant Infrastructure Hierarchy & Device Registry</span>
        </div>
        <div className="b2b-card-subtitle">
          RBAC asset topology: Enterprise &gt; Manufacturing Plant &gt; Assembly Line &gt; Station &gt; Edge BLE Sensors
        </div>

        <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {hierarchy.map((org) => (
            <div key={org.id} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '1rem', background: '#ffffff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '0.95rem' }}>
                <Building2 size={18} color="#0284c7" />
                <span>{org.name}</span>
                <span className="font-mono" style={{ fontSize: '0.75rem', color: '#94a3b8' }}>({org.id})</span>
              </div>

              <div style={{ marginLeft: '1.5rem', marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {org.plants?.map((plant) => (
                  <div key={plant.id} style={{ borderLeft: '2px solid #e2e8f0', paddingLeft: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, fontSize: '0.875rem' }}>
                      <Factory size={16} color="#475569" />
                      <span>{plant.name}</span>
                      <span style={{ fontSize: '0.75rem', color: '#64748b' }}>&bull; {plant.location}</span>
                    </div>

                    <div style={{ marginLeft: '1.5rem', marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {plant.lines?.map((line) => (
                        <div key={line.id} style={{ borderLeft: '2px solid #e2e8f0', paddingLeft: '1rem' }}>
                          <div style={{ display: 'center', alignItems: 'center', gap: '0.4rem', fontWeight: 600, fontSize: '0.825rem' }}>
                            <GitCommit size={14} color="#64748b" />
                            <span>{line.name}</span>
                          </div>

                          <div style={{ marginLeft: '1.5rem', marginTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            {line.stations?.map((st) => (
                              <div key={st.id} style={{ background: '#f8fafc', padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, fontSize: '0.8rem' }}>
                                    <Monitor size={14} color="#0284c7" />
                                    <span>{st.name}</span>
                                  </div>
                                  <span className={`state-badge ${st.state}`} style={{ fontSize: '0.65rem', padding: '0.15rem 0.4rem' }}>
                                    {st.state}
                                  </span>
                                </div>

                                <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                  {st.devices?.map((dev) => (
                                    <div
                                      key={dev.id}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.3rem',
                                        fontSize: '0.7rem',
                                        background: '#ffffff',
                                        border: '1px solid #cbd5e1',
                                        padding: '0.2rem 0.5rem',
                                        borderRadius: 4,
                                      }}
                                    >
                                      <Radio size={12} color="#10b981" />
                                      <span className="font-mono">{dev.id}:</span>
                                      <span>{dev.name}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
