import type { CSSProperties } from 'react';
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { ExampleDetailPage } from './pages/ExampleDetailPage';
import { ExamplesPage } from './pages/ExamplesPage';
import { FreeformPage } from './pages/FreeformPage';

function navLinkStyle({ isActive }: { isActive: boolean }): CSSProperties {
  return {
    padding: '6px 2px',
    textDecoration: 'none',
    color: isActive ? '#1e293b' : '#64748b',
    fontWeight: isActive ? 600 : 400,
    borderBottom: isActive ? '2px solid #2563eb' : '2px solid transparent',
  };
}

export default function App() {
  return (
    <HashRouter>
      <main style={{ maxWidth: 980, margin: '0 auto', padding: '24px 16px', fontFamily: 'ui-sans-serif, system-ui' }}>
        <h1 style={{ marginBottom: 4 }}>Causal Inference Playground</h1>
        <p style={{ color: '#475569', marginTop: 0 }}>
          Sampled data vs. the naive fit vs. the true interventional curve — the one thing you never get with real data.
        </p>

        <nav style={{ display: 'flex', gap: 20, margin: '16px 0 0', borderBottom: '1px solid #e2e8f0' }}>
          <NavLink to="/" end style={navLinkStyle}>
            Freeform
          </NavLink>
          <NavLink to="/examples" style={navLinkStyle}>
            Examples
          </NavLink>
        </nav>

        <Routes>
          <Route path="/" element={<FreeformPage />} />
          <Route path="/examples" element={<ExamplesPage />} />
          <Route path="/examples/:id" element={<ExampleDetailPage />} />
        </Routes>
      </main>
    </HashRouter>
  );
}
