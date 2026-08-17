import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TextField } from '@/components/ui/TextField';
import { Fieldset } from '@/components/ui/Fieldset';
import { StatusBadge } from '@/components/ui/StatusBadge';

describe('TextField', () => {
  it('associates the label with the input via htmlFor/id', () => {
    render(
      <TextField id="email" label="Email" value="" onChange={() => {}} />
    );
    const input = screen.getByLabelText('Email');
    expect(input).toBeInTheDocument();
  });

  it('associates an error message via aria-describedby', () => {
    render(
      <TextField id="email" label="Email" value="" onChange={() => {}} error="Required" />
    );
    const input = screen.getByLabelText('Email');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toBe('Required');
  });

  it('calls onChange with the new value', () => {
    const onChange = vi.fn();
    render(<TextField id="email" label="Email" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    expect(onChange).toHaveBeenCalledWith('a@b.com');
  });
});

describe('Fieldset', () => {
  it('renders a legend and radio options with a shared name', () => {
    render(
      <Fieldset
        legend="Were you able and available to work?"
        name="ableAndAvailable"
        options={[
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ]}
        value="yes"
        onChange={() => {}}
      />
    );
    expect(screen.getByText('Were you able and available to work?')).toBeInTheDocument();
    const yes = screen.getByLabelText('Yes') as HTMLInputElement;
    expect(yes.checked).toBe(true);
  });
});

describe('StatusBadge', () => {
  it('renders text and an icon, not color alone, for ACTIVE', () => {
    render(<StatusBadge status="ACTIVE" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByTestId('status-badge-icon')).toBeInTheDocument();
  });

  it('renders text for DENIED', () => {
    render(<StatusBadge status="DENIED" />);
    expect(screen.getByText('Denied')).toBeInTheDocument();
  });

  it('renders text for REEVALUATION_REQUIRED', () => {
    render(<StatusBadge status="REEVALUATION_REQUIRED" />);
    expect(screen.getByText('Reevaluation required')).toBeInTheDocument();
  });
});
