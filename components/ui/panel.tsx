import type { ReactNode } from 'react';

export default function Panel({ title, description, action, children }: { title?: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return <section className="panel card">{title ? <div className="card-title"><div><h3>{title}</h3>{description ? <span>{description}</span> : null}</div>{action}</div> : null}{children}</section>;
}

