import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  Timestamp,
  updateDoc,
  arrayRemove,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { McpBridgeMember } from '../../mcpBridge';
import { getFirebaseFirestore } from '../firebase';

export interface ProjectMember {
  uid: string;
  role: 'owner' | 'member';
  displayName: string;
  email: string;
  joinedAt: string;
  /** Profile image URL from Firebase Auth (e.g. Google); optional on legacy docs. Cloud member docs only. */
  photoURL?: string;
}

export function subscribeToProjectMembers(
  projectId: string,
  cb: (members: ProjectMember[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const db = getFirebaseFirestore();
  return onSnapshot(
    collection(db, 'projects', projectId, 'members'),
    (snap) => {
      const members = snap.docs.map(toMember);
      sortMembersByRoleThenName(members);
      cb(members);
    },
    (err) => {
      console.error('[members] snapshot error', err);
      onError?.(err);
    },
  );
}

function toMember(d: QueryDocumentSnapshot<DocumentData>): ProjectMember {
  const data = d.data() ?? {};
  return {
    uid: d.id,
    role: data.role === 'owner' ? 'owner' : 'member',
    displayName: typeof data.displayName === 'string' ? data.displayName : '',
    email: typeof data.email === 'string' ? data.email : '',
    joinedAt:
      data.joinedAt instanceof Timestamp ? data.joinedAt.toDate().toISOString() : '',
    photoURL:
      typeof data.photoURL === 'string' && data.photoURL.trim() !== ''
        ? data.photoURL.trim()
        : undefined,
  };
}

function toBridgeMember(d: QueryDocumentSnapshot<DocumentData>): McpBridgeMember {
  const data = d.data() ?? {};
  const row: McpBridgeMember = {
    uid: d.id,
    role: data.role === 'owner' ? 'owner' : 'member',
    displayName: typeof data.displayName === 'string' ? data.displayName : '',
    email: typeof data.email === 'string' ? data.email : '',
  };
  if (typeof data.photoURL === 'string' && data.photoURL.trim() !== '') {
    row.photoURL = data.photoURL.trim();
  }
  return row;
}

function sortMembersByRoleThenName<T extends { role: 'owner' | 'member'; displayName: string; email: string }>(
  members: T[],
): void {
  members.sort((a, b) => {
    if (a.role !== b.role) return a.role === 'owner' ? -1 : 1;
    return (a.displayName || a.email).localeCompare(b.displayName || b.email);
  });
}

/**
 * One-shot read of `projects/{projectId}/members` for MCP bridge (same collection as
 * {@link subscribeToProjectMembers}). Sorted owner-first, then display name.
 */
export async function fetchProjectMembersForBridge(projectId: string): Promise<McpBridgeMember[]> {
  const db = getFirebaseFirestore();
  const snap = await getDocs(collection(db, 'projects', projectId, 'members'));
  const members = snap.docs.map(toBridgeMember);
  sortMembersByRoleThenName(members);
  return members;
}

/**
 * Owner-only: remove a member from the project. Pulls the uid from memberIds
 * on the project doc and deletes their members/{uid} record.
 */
export async function removeMember(projectId: string, uid: string): Promise<void> {
  const db = getFirebaseFirestore();
  await updateDoc(doc(db, 'projects', projectId), {
    memberIds: arrayRemove(uid),
  });
  await deleteDoc(doc(db, 'projects', projectId, 'members', uid));
}
