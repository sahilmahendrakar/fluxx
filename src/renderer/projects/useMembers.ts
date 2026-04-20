import { useEffect, useState } from 'react';
import { subscribeToProjectMembers, type ProjectMember } from './members';

export interface MembersState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  members: ProjectMember[];
  error?: string;
}

export function useMembers(projectId: string | null): MembersState {
  const [state, setState] = useState<MembersState>({
    status: projectId ? 'loading' : 'idle',
    members: [],
  });

  useEffect(() => {
    if (!projectId) {
      setState({ status: 'idle', members: [] });
      return;
    }
    setState({ status: 'loading', members: [] });
    const unsub = subscribeToProjectMembers(
      projectId,
      (members) => setState({ status: 'ready', members }),
      (err) => setState({ status: 'error', members: [], error: err.message }),
    );
    return () => unsub();
  }, [projectId]);

  return state;
}
