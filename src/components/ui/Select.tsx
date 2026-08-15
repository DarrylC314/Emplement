'use client';

import React from 'react';

type SelectOption = { value: string; label: string };

type SelectProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  error?: string;
  required?: boolean;
};

export function Select({ id, label, value, onChange, options, error, required }: SelectProps) {
  const errorId = `${id}-error`;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="block font-medium text-text-primary mb-1">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <select
        id={id}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={`w-full rounded border px-3 py-2 text-text-primary ${
          error ? 'border-error-border' : 'border-border'
        }`}
      >
        <option value="">None</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} className="mt-1 text-error-text text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
