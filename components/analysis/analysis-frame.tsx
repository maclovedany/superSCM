import type { ReactNode } from 'react';

export default function AnalysisFrame({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="analysis-page">
      <div className="analysis-heading">
        <div><span className="eyebrow">ANALYSIS</span><h2>{title}</h2><p>{description}</p></div>
        <span className="local-badge">SUPABASE LIVE</span>
      </div>
      {children}
    </section>
  );
}
