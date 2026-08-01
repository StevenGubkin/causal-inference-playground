import { Link, useParams } from 'react-router-dom';
import { PlaygroundView } from '../PlaygroundView';
import { PRESETS } from '../presets';

export function ExampleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const preset = PRESETS.find((p) => p.id === id);

  if (!preset) {
    return (
      <p>
        Unknown example.{' '}
        <Link to="/examples" style={{ color: '#2563eb' }}>
          Back to examples
        </Link>
      </p>
    );
  }

  return (
    <div>
      <Link to="/examples" style={{ color: '#2563eb' }}>
        ← Back to examples
      </Link>
      {/* key forces a remount when navigating between examples, so each
          one gets fresh editor/treatment/outcome/adjustment state instead
          of carrying over the previous example's edits. */}
      <PlaygroundView key={preset.id} initialSource={preset.source} initialTreatment={preset.treatment} initialOutcome={preset.outcome} caption={preset.caption} />
    </div>
  );
}
