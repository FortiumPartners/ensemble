import { useQuery } from '@tanstack/react-query';

export interface Project {
  id: string;
  name: string;
}

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch('/api/projects');
  if (!res.ok) throw new Error(`projects request failed: ${res.status}`);
  return (await res.json()) as Project[];
}

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: fetchProjects });
}
