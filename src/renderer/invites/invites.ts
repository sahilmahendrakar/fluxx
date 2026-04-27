import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getFirebaseFirestore } from '../firebase';
import { acceptInvite } from '../projects/cloudProjects';

export interface PendingInvite {
  projectId: string;
  projectName: string;
  invitedBy: string;
  invitedAt: string;
  email: string;
}

/**
 * Watch for invites addressed to the signed-in user. Uses a collection-group
 * query on `invites` filtered by the lowercased email; rules enforce that the
 * caller's verified token email matches.
 */
export function subscribeToPendingInvites(
  email: string,
  cb: (invites: PendingInvite[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const db = getFirebaseFirestore();
  const q = query(
    collectionGroup(db, 'invites'),
    where('email', '==', email.toLowerCase()),
  );
  return onSnapshot(
    q,
    (snap) => {
      const invites = snap.docs
        .map(toPendingInvite)
        .filter((i): i is PendingInvite => i !== null);
      cb(invites);
    },
    (err) => {
      console.error('[invites] snapshot error', err);
      onError?.(err);
    },
  );
}

function toPendingInvite(
  d: QueryDocumentSnapshot<DocumentData>,
): PendingInvite | null {
  // Path: projects/{pid}/invites/{email}
  const parts = d.ref.path.split('/');
  if (parts.length !== 4 || parts[0] !== 'projects' || parts[2] !== 'invites') return null;
  const projectId = parts[1];
  const data = d.data() ?? {};
  const invitedAt =
    data.invitedAt instanceof Timestamp ? data.invitedAt.toDate().toISOString() : '';
  return {
    projectId,
    projectName: typeof data.projectName === 'string' ? data.projectName : '',
    invitedBy: typeof data.invitedBy === 'string' ? data.invitedBy : '',
    invitedAt,
    email: typeof data.email === 'string' ? data.email : '',
  };
}

export interface SendInviteResult {
  /** Always true if the Firestore write succeeded. */
  wrote: true;
  /** Whether the Resend email was delivered (false if unconfigured or errored). */
  emailed: boolean;
  emailError?: string;
}

export async function sendInvite(
  projectId: string,
  invitedByUid: string,
  email: string,
  options: {
    projectName: string;
    inviterName?: string;
    inviterEmail?: string;
  },
): Promise<SendInviteResult> {
  const lower = email.trim().toLowerCase();
  if (!lower) throw new Error('Email required.');
  if (!lower.includes('@')) throw new Error('Invalid email.');
  const db = getFirebaseFirestore();
  await setDoc(doc(db, 'projects', projectId, 'invites', lower), {
    email: lower,
    invitedBy: invitedByUid,
    invitedAt: serverTimestamp(),
    projectName: options.projectName,
  });
  const result = await window.electronAPI.email.sendInvite({
    to: lower,
    projectName: options.projectName,
    inviterName: options.inviterName,
    inviterEmail: options.inviterEmail,
  });
  if ('error' in result) {
    return { wrote: true, emailed: false, emailError: result.error };
  }
  return { wrote: true, emailed: true };
}

export interface ProjectInvite {
  email: string;
  invitedBy: string;
  invitedAt: string;
}

/**
 * Watch pending invites on a specific project. Owners and members can read
 * (rules). Surfaces the outgoing-invite list for the team-members UI.
 */
export function subscribeToProjectInvites(
  projectId: string,
  cb: (invites: ProjectInvite[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const db = getFirebaseFirestore();
  return onSnapshot(
    collection(db, 'projects', projectId, 'invites'),
    (snap) => {
      const invites = snap.docs.map((d) => {
        const data = d.data() ?? {};
        return {
          email: typeof data.email === 'string' ? data.email : d.id,
          invitedBy: typeof data.invitedBy === 'string' ? data.invitedBy : '',
          invitedAt:
            data.invitedAt instanceof Timestamp
              ? data.invitedAt.toDate().toISOString()
              : '',
        };
      });
      invites.sort((a, b) => a.email.localeCompare(b.email));
      cb(invites);
    },
    (err) => {
      console.error('[projectInvites] snapshot error', err);
      onError?.(err);
    },
  );
}

export async function cancelInvite(
  projectId: string,
  email: string,
): Promise<void> {
  const lower = email.trim().toLowerCase();
  await deleteDoc(doc(getFirebaseFirestore(), 'projects', projectId, 'invites', lower));
}

export { acceptInvite };
