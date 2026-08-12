'use client';

import React from 'react';

type ErrorSummaryProps = {
  errors: { id: string; message: string }[];
};

export function ErrorSummary({ errors }: ErrorSummaryProps) {
  if (errors.length === 0) return null;
  return (
    <div
      role="alert"
      tabIndex={-1}
      className="mb-4 rounded border border-error-border bg-error-bg p-4"
    >
      <h2 className="font-bold text-error-text mb-2">
        There {errors.length === 1 ? 'is' : 'are'} {errors.length} problem
        {errors.length === 1 ? '' : 's'} with your submission
      </h2>
      <ul className="list-disc list-inside">
        {errors.map((e) => (
          <li key={e.id}>
            <a href={`#${e.id}`} className="text-link underline">
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
