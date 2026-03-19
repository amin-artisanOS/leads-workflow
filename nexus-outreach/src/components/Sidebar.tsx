"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutDashboard, 
  Send, 
  Users, 
  Mail, 
  BarChart3, 
  Settings, 
  Zap,
  Layers
} from "lucide-react";

const navItems = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Campaigns", href: "/campaigns", icon: Send },
  { name: "Accounts", href: "/accounts", icon: Mail },
  { name: "Leads", href: "/leads", icon: Users },
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="sidebar">
      <div className="logo-container" style={{ padding: '0 1rem 3rem 1rem' }}>
        <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ 
            width: '40px', 
            height: '40px', 
            borderRadius: '10px', 
            background: 'linear-gradient(135deg, #0072f5, #7928ca)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Zap size={24} color="white" />
          </div>
          <h1 className="gradient-text" style={{ fontSize: '1.5rem', margin: 0 }}>NEXUS</h1>
        </Link>
      </div>

      <nav style={{ flex: 1 }}>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <li key={item.name} style={{ marginBottom: '0.5rem' }}>
                <Link 
                  href={item.href}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    textDecoration: 'none',
                    color: isActive ? '#fff' : '#888',
                    background: isActive ? 'rgba(255,255,255,0.05)' : 'transparent',
                    transition: 'all 0.2s ease',
                    borderLeft: isActive ? '3px solid #0072f5' : '3px solid transparent'
                  }}
                >
                  <item.icon size={20} />
                  <span style={{ fontWeight: isActive ? 600 : 400 }}>{item.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="sidebar-footer" style={{ borderTop: '1px solid var(--card-border)', paddingTop: '1.5rem' }}>
        <Link 
          href="/settings"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            padding: '0.75rem 1rem',
            textDecoration: 'none',
            color: '#888',
            transition: 'all 0.2s ease'
          }}
        >
          <Settings size={20} />
          <span>Settings</span>
        </Link>
      </div>
    </div>
  );
}
