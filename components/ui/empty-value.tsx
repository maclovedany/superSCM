export default function EmptyValue({ reasonCode = 'CALCULATION_UNAVAILABLE' }: { reasonCode?: string }) {
  return <span className="empty-value" title={reasonCode}>— + {reasonCode}</span>;
}

