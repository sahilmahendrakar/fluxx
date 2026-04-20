import { useEffect, useState } from 'react';
import {
  subscribeToPendingInvites,
  type PendingInvite,
} from './invites';

export interface InvitesState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  invites: PendingInvite[];
  error?: string;
}

export function useInvites(email: string | null): InvitesState {
  const [state, setState] = useState<InvitesState>({
    status: email ? 'loading' : 'idle',
    invites: [],
  });

  useEffect(() => {
    if (!email) {
      setState({ status: 'idle', invites: [] });
      return;
    }
    setState({ status: 'loading', invites: [] });
    const unsub = subscribeToPendingInvites(
      email,
      (invites) => setState({ status: 'ready', invites }),
      (err) => setState({ status: 'error', invites: [], error: err.message }),
    );
    return () => unsub();
  }, [email]);

  return state;
}
