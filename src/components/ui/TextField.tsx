'use client';

import React from 'react';

type TextFieldProps = {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  required?: boolean;
  autoComplete?: string;
};

export function TextField({
  id,
  label,
  type = 'text',
  value,
  onChange,
  onBlur,
  error,
  required,
  autoComplete,
}: TextFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="block font-medium text-text-primary mb-1">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={`w-full rounded border px-3 py-2 text-text-primary ${
          error ? 'border-error-border' : 'border-border'
        }`}
      />
      {error && (
        <p id={errorId} className="mt-1 text-error-text text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
