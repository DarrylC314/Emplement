'use client';

import { useRef, useState } from 'react';
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
  const [searchError, setSearchError] = useState<string | null>(null);
  // Tracks the most recently issued query so a slow response to an older,
  // shorter query can't overwrite the results of a newer one that resolved
  // first (out-of-order responses are possible since we fire on every
  // keystroke without debouncing).
  const latestQuery = useRef('');

  async function handleQueryChange(value: string) {
    setQuery(value);
    latestQuery.current = value;
    if (value.trim().length < 2) {
      setResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/organizations?q=${encodeURIComponent(value)}`);
      if (latestQuery.current !== value) return;
      if (res.ok) {
        setResults(await res.json());
      } else {
        setResults([]);
        setSearchError('Something went wrong searching for organizations. Please try again.');
      }
    } catch {
      if (latestQuery.current !== value) return;
      setResults([]);
      setSearchError('Something went wrong searching for organizations. Please try again.');
    } finally {
      if (latestQuery.current === value) setSearching(false);
    }
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
      {!searching && searchError && (
        <p role="alert" className="text-sm text-error-text">
          {searchError}
        </p>
      )}
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
