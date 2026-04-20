import { useEffect, useState } from 'react';
import { subscribeToCloudProjects, type CloudProjectSummary } from './cloudProjects';

export interface CloudProjectsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  projects: CloudProjectSummary[];
  error?: string;
}

/** Subscribes for the given uid. Pass null when signed out. */
export function useCloudProjects(uid: string | null): CloudProjectsState {
  const [state, setState] = useState<CloudProjectsState>({
    status: uid ? 'loading' : 'idle',
    projects: [],
  });

  useEffect(() => {
    if (!uid) {
      setState({ status: 'idle', projects: [] });
      return;
    }
    setState({ status: 'loading', projects: [] });
    const unsub = subscribeToCloudProjects(
      uid,
      (projects) => setState({ status: 'ready', projects }),
      (err) => setState({ status: 'error', projects: [], error: err.message }),
    );
    return () => unsub();
  }, [uid]);

  return state;
}
