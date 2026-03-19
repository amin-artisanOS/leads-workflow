"use client";

import { 
  Users, 
  Send, 
  MailOpen, 
  MessageSquare, 
  TrendingUp,
  ArrowUpRight,
  Loader2,
  X
} from "lucide-react";
import { useState, useEffect } from "react";

interface Opportunity {
  id: string;
  from: string;
  name: string;
  subject: string;
  snippet: string;
  timestamp: string;
  campaignId: string;
  isOpportunity: boolean;
}

export default function Home() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<Opportunity | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  const stats = [
    { name: "Total Leads", value: "12,482", icon: Users, change: "+12%", color: "var(--primary)" },
    { name: "Sent Today", value: "842", icon: Send, change: "+5%", color: "var(--secondary)" },
    { name: "Open Rate", value: "68.2%", icon: MailOpen, change: "+2.4%", color: "var(--success)" },
    { name: "Reply Rate", value: "8.4%", icon: MessageSquare, change: "+1.1%", color: "var(--accent)" },
  ];

  useEffect(() => {
    fetch("/api/opportunities")
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setOpportunities(data);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const openReplyModal = (lead: Opportunity) => {
    setSelectedLead(lead);
    // Draft a tailored message
    const isLynn = lead.from.includes('massagecandles');
    const defaultMsg = isLynn 
      ? `Hi Lynn,\n\nThanks for your reply! Here is that 60-second demo video I mentioned: trycommerium.com\n\nI'd love to hear your thoughts on how this could work for your catalog.\n\nBest,\nAmin B.`
      : `Hi,\n\nThanks for your interest! To test it out, you can simply visit trycommerium.com and see the demo. From there, we can set up your BYO API key to start generating listings.\n\nWould you like to hop on a quick call to walk through it?\n\nBest,\nAmin B.`;
    setReplyText(defaultMsg);
  };

  const handleSendReply = async () => {
    if (!selectedLead || !replyText) return;
    setSending(true);
    try {
      const res = await fetch("/api/opportunities/reply", {
        method: "POST",
        body: JSON.stringify({
          replyToUuid: selectedLead.id,
          body: replyText.replace(/\n/g, '<br>')
        })
      });
      if (res.ok) {
        alert("Reply sent successfully!");
        setSelectedLead(null);
      } else {
        const err = await res.json();
        alert("Error sending reply: " + (err.details?.message || err.error));
      }
    } catch (err) {
      alert("Failed to send reply");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <header style={{ marginBottom: '3rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Welcome back, <span className="gradient-text">Amin</span></h1>
          <p style={{ color: '#888' }}>Here's what's happening with your campaigns today.</p>
        </div>
        <button className="btn btn-primary">
          <Send size={18} />
          New Campaign
        </button>
      </header>

      <section style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', 
        gap: '1.5rem',
        marginBottom: '3rem'
      }}>
        {stats.map((stat) => (
          <div key={stat.name} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <div style={{ 
                padding: '0.5rem', 
                borderRadius: '10px', 
                background: `rgba(${stat.color === 'var(--primary)' ? '0, 114, 245' : stat.color === 'var(--secondary)' ? '121, 40, 202' : '23, 201, 100'}, 0.1)`,
                color: stat.color
              }}>
                <stat.icon size={24} />
              </div>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.25rem', 
                color: 'var(--success)', 
                fontSize: '0.85rem',
                fontWeight: 600
              }}>
                <TrendingUp size={14} />
                {stat.change}
              </div>
            </div>
            <h3 style={{ fontSize: '1rem', color: '#888', marginBottom: '0.5rem' }}>{stat.name}</h3>
            <p style={{ fontSize: '2rem', fontWeight: 700 }}>{stat.value}</p>
          </div>
        ))}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem' }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
            <h2>Active Campaigns</h2>
            <button style={{ background: 'transparent', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontWeight: 600 }}>View All</button>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ 
                padding: '1rem', 
                borderRadius: '12px', 
                border: '1px solid var(--card-border)',
                background: 'rgba(255,255,255,0.02)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--success)' }}></div>
                  <div>
                    <h4 style={{ marginBottom: '0.25rem' }}>SaaS Outreach Q1 - {i === 1 ? 'Design Agencies' : i === 2 ? 'Tech Startups' : 'Real Estate'}</h4>
                    <p style={{ fontSize: '0.85rem', color: '#888' }}>Sent 452 / 1,200 leads</p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '2rem', textAlign: 'right' }}>
                  <div>
                    <p style={{ fontSize: '0.75rem', color: '#888' }}>Open Rate</p>
                    <p style={{ fontWeight: 600 }}>52%</p>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.75rem', color: '#888' }}>Replies</p>
                    <p style={{ fontWeight: 600 }}>12</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginBottom: '2rem' }}>Recent Opportunities</h2>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
              <Loader2 className="animate-spin" />
            </div>
          ) : opportunities.length === 0 ? (
            <p style={{ color: '#888' }}>No new opportunities found.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {opportunities.map((opt) => (
                <div key={opt.id} style={{ display: 'flex', gap: '1rem', padding: '0.5rem', borderRadius: '12px', cursor: 'pointer', transition: 'background 0.2s' }} onClick={() => openReplyModal(opt)}>
                  <div style={{
                    minWidth: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    background: 'var(--primary)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.85rem',
                    fontWeight: 600
                  }}>
                    {opt.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div style={{ overflow: 'hidden', flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h4 style={{ fontSize: '0.9rem', marginBottom: '0.25rem' }}>{opt.from}</h4>
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--primary)', marginBottom: '0.25rem' }}>{opt.subject}</p>
                    <p style={{ fontSize: '0.85rem', color: '#888', maxHeight: '3em', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {opt.snippet}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedLead && (
        <div style={{ 
          position: 'fixed', 
          inset: 0, 
          background: 'rgba(0,0,0,0.8)', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div className="card glass" style={{ width: '100%', maxWidth: '600px', padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2>Reply to {selectedLead.from}</h2>
              <button 
                onClick={() => setSelectedLead(null)}
                style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer' }}
              >
                <X size={24} />
              </button>
            </div>
            
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', borderLeft: '3px solid var(--primary)' }}>
              <p style={{ fontSize: '0.85rem', color: '#aaa', fontStyle: 'italic' }}>"{selectedLead.snippet}"</p>
            </div>

            <textarea 
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              style={{ 
                width: '100%', 
                height: '200px', 
                background: '#111', 
                border: '1px solid #333', 
                borderRadius: '8px', 
                color: '#fff', 
                padding: '1rem',
                fontSize: '1rem',
                fontFamily: 'inherit',
                marginBottom: '1.5rem',
                resize: 'none'
              }}
              placeholder="Type your reply here..."
            />

            <div style={{ display: 'flex', gap: '1rem' }}>
              <button 
                className="btn" 
                style={{ flex: 1, background: '#333', color: '#fff' }}
                onClick={() => setSelectedLead(null)}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary" 
                style={{ flex: 2 }}
                onClick={handleSendReply}
                disabled={sending}
              >
                {sending ? <Loader2 className="animate-spin" size={18} /> : "Send Reply"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
