import { Link } from 'react-router-dom';
import { PRESETS } from '../presets';

export function ExamplesPage() {
  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', marginTop: 16 }}>
      {PRESETS.map((p) => (
        <Link
          key={p.id}
          to={`/examples/${p.id}`}
          style={{
            display: 'block',
            padding: 16,
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <h3 style={{ margin: '0 0 8px' }}>{p.label}</h3>
          <p style={{ margin: 0, color: '#475569', fontSize: 14 }}>{p.caption}</p>
        </Link>
      ))}
    </div>
  );
}
