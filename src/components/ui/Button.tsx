'use client';

import React from 'react';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  const base = 'rounded px-4 py-2 font-medium focus-visible:outline focus-visible:outline-2';
  const styles =
    variant === 'primary'
      ? 'bg-primary text-white hover:bg-primary-hover'
      : 'bg-surface border border-border text-text-primary hover:bg-surface-alt';
  return <button className={`${base} ${styles} ${className}`} {...props} />;
}
