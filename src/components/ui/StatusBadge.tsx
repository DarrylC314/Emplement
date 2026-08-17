import React from 'react';

type Status = 'ACTIVE' | 'RESTRICTED' | 'REEVALUATION_REQUIRED' | 'DENIED' | 'CLOSED';

const STATUS_CONFIG: Record<Status, { label: string; bg: string; text: string; icon: string }> = {
  ACTIVE: { label: 'Active', bg: 'bg-status-active-bg', text: 'text-status-active-text', icon: '✓' },
  RESTRICTED: {
    label: 'Restricted',
    bg: 'bg-status-restricted-bg',
    text: 'text-status-restricted-text',
    icon: '!',
  },
  REEVALUATION_REQUIRED: {
    label: 'Reevaluation required',
    bg: 'bg-status-reevaluation-bg',
    text: 'text-status-reevaluation-text',
    icon: '?',
  },
  DENIED: { label: 'Denied', bg: 'bg-status-denied-bg', text: 'text-status-denied-text', icon: '✕' },
  CLOSED: { label: 'Closed', bg: 'bg-surface-alt', text: 'text-text-secondary', icon: '—' },
};

export function StatusBadge({ status }: { status: Status }) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-sm font-medium ${config.bg} ${config.text}`}
    >
      <span aria-hidden="true" data-testid="status-badge-icon">
        {config.icon}
      </span>
      {config.label}
    </span>
  );
}
