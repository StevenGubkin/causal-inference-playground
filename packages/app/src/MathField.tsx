import { useEffect, useRef } from 'react';
import type { DetailedHTMLProps, HTMLAttributes } from 'react';
import { MathfieldElement } from 'mathlive';

// MathLive's default fontsDirectory is relative to wherever its own JS
// module ends up served from, which Vite's dev-dependency pre-bundling
// relocates -- breaking the relative path (404s, silently falls back to
// system fonts). Fonts are copied into public/mathlive-fonts (see that
// directory for provenance) and served from the app's own base path
// instead, which is stable in both dev and the built/deployed site.
MathfieldElement.fontsDirectory = `${import.meta.env.BASE_URL}mathlive-fonts`;

// MathLive's <math-field> is a raw custom element (framework-agnostic), so
// TypeScript/JSX needs to be told it exists. Importing from 'mathlive'
// above registers it with customElements.define as a side effect; this
// just types the tag.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'math-field': DetailedHTMLProps<HTMLAttributes<MathfieldElement>, MathfieldElement>;
    }
  }
}

interface MathFieldProps {
  latex: string;
}

/**
 * Read-only display of a LaTeX string via MathLive. Deliberately
 * one-directional (source text -> rendered math, never the reverse): a
 * round-trip probe (typed LaTeX -> ascii-math/plain-text export) showed
 * MathLive's text-export formats collapse implicit multiplication ("A*B")
 * and letter-spacing inside multi-char names ("Normal") to the same bare
 * whitespace, which is genuinely ambiguous to parse back into DSL syntax
 * without guessing. Rather than ship an "editable" field that sometimes
 * silently mangles input, this only ever renders -- the code editor
 * remains the single editable source of truth.
 */
export function MathField({ latex }: MathFieldProps) {
  const ref = useRef<MathfieldElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.readOnly = true;
    el.setValue(latex);
  }, [latex]);

  return <math-field ref={ref} tabIndex={-1} style={{ display: 'block', width: '100%', border: 'none', fontSize: 16 }} />;
}
