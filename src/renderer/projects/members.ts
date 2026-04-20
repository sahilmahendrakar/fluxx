import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  Timestamp,
  updateDoc,
  arrayRemove,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getFirebaseFirestore } from '../firebase';

export interface ProjectMember {
  uid: string;
  role: 'owner' | 'member';
  displayName: string;
  email: string;
  joinedAt: string;
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
      members.sort((a, b) => {
        if (a.role !== b.role) return a.role === 'owner' ? -1 : 1;
        return (a.displayName || a.email).localeCompare(b.displayName || b.email);
      });
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
  };
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
