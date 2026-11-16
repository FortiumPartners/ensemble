import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithClient } from '../test/renderWithClient';
import { ProjectList } from './ProjectList';

afterEach(() => vi.unstubAllGlobals());

describe('ProjectList', () => {
  it('lists the projects the API returns', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'p1', name: 'Apollo' }, { id: 'p2', name: 'Gemini' }],
    }));

    renderWithClient(<ProjectList />);

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows an alert when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));

    renderWithClient(<ProjectList />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load projects.');
  });
});
