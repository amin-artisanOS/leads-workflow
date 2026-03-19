"use client";

import { Send, Plus, MoreVertical, Play, Pause, BarChart2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // In a real app, this would be an API call
    // For now, let's mock it since we seeded the DB but haven't built the full list API
    setCampaigns([
      { id: "1", name: "SaaS Outreach Q1", status: "active", sent: 452, openRate: 52, replies: 12 },
      { id: "2", name: "Tech Startup Follow-up", status: "paused", sent: 120, openRate: 48, replies: 5 },
      { id: "3", name: "Real Estate Cold Outreach", status: "draft", sent: 0, openRate: 0, replies: 0 },
    ]);
    setLoading(false);
  }, []);

  return (
    <div className="animate-fade-in">
      <header style={{ marginBottom: '3rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Campaigns</h1>
          <p style={{ color: '#888' }}>Build and manage your cold email sequences.</p>
        </div>
        <button className="btn btn-primary">
          <Plus size={18} />
          Create Campaign
        </button>
      </header>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--card-border)', background: 'rgba(255,255,255,0.02)' }}>
              <th style={{ padding: '1rem 1.5rem', fontSize: '0.85rem', color: '#888', fontWeight: 600 }}>CAMPAIGN NAME</th>
              <th style={{ padding: '1rem 1.5rem', fontSize: '0.85rem', color: '#888', fontWeight: 600 }}>STATUS</th>
              <th style={{ padding: '1rem 1.5rem', fontSize: '0.85rem', color: '#888', fontWeight: 600 }}>SENT</th>
              <th style={{ padding: '1rem 1.5rem', fontSize: '0.85rem', color: '#888', fontWeight: 600 }}>OPEN RATE</th>
              <th style={{ padding: '1rem 1.5rem', fontSize: '0.85rem', color: '#888', fontWeight: 600 }}>REPLIES</th>
              <th style={{ padding: '1rem 1.5rem', fontSize: '0.85rem', color: '#888', fontWeight: 600 }}></th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((camp: any) => (
              <tr key={camp.id} style={{ borderBottom: '1px solid var(--card-border)', transition: 'background 0.2s ease' }}>
                <td style={{ padding: '1.25rem 1.5rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '1rem' }}>{camp.name}</div>
                  <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}>2 steps • Last sent 2h ago</div>
                </td>
                <td style={{ padding: '1.25rem 1.5rem' }}>
                  <div style={{ 
                    display: 'inline-flex', 
                    alignItems: 'center', 
                    gap: '0.5rem',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '20px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    background: camp.status === 'active' ? 'rgba(23, 201, 100, 0.1)' : camp.status === 'paused' ? 'rgba(245, 165, 36, 0.1)' : 'rgba(255,255,255,0.05)',
                    color: camp.status === 'active' ? 'var(--success)' : camp.status === 'paused' ? 'var(--warning)' : '#888'
                  }}>
                    {camp.status === 'active' ? <Play size={12} fill="currentColor" /> : <Pause size={12} fill="currentColor" />}
                    {camp.status.toUpperCase()}
                  </div>
                </td>
                <td style={{ padding: '1.25rem 1.5rem', fontWeight: 500 }}>{camp.sent}</td>
                <td style={{ padding: '1.25rem 1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ height: '6px', background: '#333', borderRadius: '10px', flex: 1 }}>
                      <div style={{ height: '6px', background: 'var(--primary)', borderRadius: '10px', width: `${camp.openRate}%` }}></div>
                    </div>
                    <span style={{ fontSize: '0.85rem', minWidth: '35px' }}>{camp.openRate}%</span>
                  </div>
                </td>
                <td style={{ padding: '1.25rem 1.5rem', fontWeight: 600 }}>{camp.replies}</td>
                <td style={{ padding: '1.25rem 1.5rem', textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button className="btn" style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.05)', color: '#fff' }}>
                      <BarChart2 size={16} />
                    </button>
                    <button className="btn" style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.05)', color: '#fff' }}>
                      <MoreVertical size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
