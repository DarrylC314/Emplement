'use client';

import React from 'react';

type Option = { value: string; label: string };

type CheckboxGroupProps = {
  legend: string;
  name: string;
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  error?: string;
};

export function CheckboxGroup({ legend, name, options, value, onChange, error }: CheckboxGroupProps) {
  const errorId = `${name}-error`;

  function toggle(optionValue: string) {
    if (value.includes(optionValue)) {
      onChange(value.filter((v) => v !== optionValue));
    } else {
      onChange([...value, optionValue]);
    }
  }

  return (
    <fieldset className="mb-4" aria-describedby={error ? errorId : undefined}>
      <legend className="font-medium text-text-primary mb-2">{legend}</legend>
      {options.map((opt) => {
        const id = `${name}-${opt.value}`;
        return (
          <div key={opt.value} className="flex items-center gap-2 mb-1">
            <input
              type="checkbox"
              id={id}
              name={name}
              value={opt.value}
              checked={value.includes(opt.value)}
              onChange={() => toggle(opt.value)}
              className="h-4 w-4"
            />
            <label htmlFor={id}>{opt.label}</label>
          </div>
        );
      })}
      {error && (
        <p id={errorId} className="mt-1 text-error-text text-sm" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
