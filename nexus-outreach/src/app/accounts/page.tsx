"use client";

import { useState, useEffect } from "react";
import { Mail, Plus, Check, Loader2, AlertCircle } from "lucide-react";

export default function AccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newAccount, setNewAccount] = useState({
    email: "",
    smtpHost: "smtp.gmail.com",
    smtpPort: "587",
    smtpUser: "",
    smtpPass: "",
  });

  useEffect(() => {
    fetch("/api/accounts")
      .then((res) => res.json())
      .then((data) => {
        setAccounts(data);
        setLoading(false);
      });
  }, []);

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/accounts", {
      method: "POST",
      body: JSON.stringify({
        ...newAccount,
        smtpUser: newAccount.email // default to email
      }),
    });
    if (res.ok) {
      const added = await res.json();
      setAccounts([...accounts, added]);
      setShowModal(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <header style={{ marginBottom: '3rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Email Accounts</h1>
          <p style={{ color: '#888' }}>Manage your sending accounts and track their reputation.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={18} />
          Add Account
        </button>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1.5rem' }}>
        {loading ? (
          <p>Loading accounts...</p>
        ) : accounts.length === 0 ? (
          <div className="card" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '4rem' }}>
            <Mail size={48} style={{ marginBottom: '1rem', color: '#444' }} />
            <h3>No accounts connected</h3>
            <p style={{ color: '#888', marginBottom: '2rem' }}>Connect your first SMTP account to start sending.</p>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>Add Account</button>
          </div>
        ) : (
          accounts.map((acc: any) => (
            <div key={acc.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ 
                    width: '48px', 
                    height: '48px', 
                    borderRadius: '12px', 
                    background: 'rgba(255,255,255,0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <Mail size={24} color="var(--primary)" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.1rem' }}>{acc.email}</h3>
                    <p style={{ fontSize: '0.85rem', color: '#666' }}>{acc.service} • SMTP connected</p>
                  </div>
                </div>
                <div style={{ padding: '0.25rem 0.75rem', borderRadius: '20px', background: 'rgba(23, 201, 100, 0.1)', color: 'var(--success)', fontSize: '0.75rem', fontWeight: 600 }}>
                  Active
                </div>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px' }}>
                <div>
                  <p style={{ fontSize: '0.75rem', color: '#888' }}>Sent Today</p>
                  <p style={{ fontWeight: 600 }}>42 / 100</p>
                </div>
                <div>
                  <p style={{ fontSize: '0.75rem', color: '#888' }}>Success Rate</p>
                  <p style={{ fontWeight: 600, color: 'var(--success)' }}>98.2%</p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {showModal && (
        <div style={{ 
          position: 'fixed', 
          inset: 0, 
          background: 'rgba(0,0,0,0.8)', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="card glass" style={{ width: '100%', maxWidth: '450px', padding: '2rem' }}>
            <h2 style={{ marginBottom: '1.5rem' }}>Add SMTP Account</h2>
            <form onSubmit={handleAddAccount} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#888', marginBottom: '0.5rem' }}>Email Address</label>
                <input 
                  type="email" 
                  value={newAccount.email}
                  onChange={e => setNewAccount({...newAccount, email: e.target.value})}
                  required 
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: '#111', border: '1px solid #333', color: '#fff' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#888', marginBottom: '0.5rem' }}>SMTP Host</label>
                <input 
                  type="text" 
                  value={newAccount.smtpHost}
                  onChange={e => setNewAccount({...newAccount, smtpHost: e.target.value})}
                  required 
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: '#111', border: '1px solid #333', color: '#fff' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: '#888', marginBottom: '0.5rem' }}>Port</label>
                  <input 
                    type="number" 
                    value={newAccount.smtpPort}
                    onChange={e => setNewAccount({...newAccount, smtpPort: e.target.value})}
                    required 
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: '#111', border: '1px solid #333', color: '#fff' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: '#888', marginBottom: '0.5rem' }}>Password</label>
                  <input 
                    type="password" 
                    value={newAccount.smtpPass}
                    onChange={e => setNewAccount({...newAccount, smtpPass: e.target.value})}
                    required 
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: '#111', border: '1px solid #333', color: '#fff' }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" className="btn" style={{ background: '#333', color: '#fff', flex: 1 }} onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Save Account</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
