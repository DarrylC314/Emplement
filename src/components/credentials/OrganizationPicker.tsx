'use client';

import { useState } from 'react';
import { TextField } from '@/components/ui/TextField';

export type Organization = { id: string; companyName: string };

type OrganizationPickerProps = {
  selectedOrganization: Organization | null;
  onSelect: (org: Organization | null) => void;
  error?: string;
};

// A minimal search-select: no existing autocomplete/combobox component in
// this codebase to build on (confirmed — every existing <select> here is
// populated from an already-fetched, small, fixed list). Fires a search on
// every keystroke past 2 characters rather than debouncing — acceptable at
// this app's scale (an EmployerProfile.findMany with take: 25), not worth
// the added complexity of a real debounce timer for a pilot.
export function OrganizationPicker({ selectedOrganization, onSelect, error }: OrganizationPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Organization[]>([]);
  const [searching, setSearching] = useState(false);

  async function handleQueryChange(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const res = await fetch(`/api/organizations?q=${encodeURIComponent(value)}`);
    setSearching(false);
    if (res.ok) setResults(await res.json());
  }

  if (selectedOrganization) {
    return (
      <div className="mb-4">
        <p className="font-medium">Organization: {selectedOrganization.companyName}</p>
        <button
          type="button"
          onClick={() => {
            onSelect(null);
            setQuery('');
            setResults([]);
          }}
          className="text-link underline text-sm"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <TextField
        id="organization-search"
        label="Search for the organization"
        value={query}
        onChange={handleQueryChange}
        error={error}
        required
      />
      {searching && <p className="text-sm text-text-secondary">Searching…</p>}
      {results.length > 0 && (
        <ul className="border border-border rounded mt-1">
          {results.map((org) => (
            <li key={org.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(org);
                  setResults([]);
                }}
                className="w-full text-left px-3 py-2 hover:bg-surface-alt"
              >
                {org.companyName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
