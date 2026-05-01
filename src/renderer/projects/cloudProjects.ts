import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
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

/**
 * A cloud project as seen in the renderer projects list (before activation).
 * Activation fetches the per-machine `rootPath` from LocalBindingStore.
 */
export interface CloudProjectSummary {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  createdAt: string;
}

export function subscribeToCloudProjects(
  uid: string,
  cb: (projects: CloudProjectSummary[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const db = getFirebaseFirestore();
  const q = query(
    collection(db, 'projects'),
    where('memberIds', 'array-contains', uid),
  );
  return onSnapshot(
    q,
    (snap) => {
      const projects = snap.docs.map(toCloudProjectSummary);
      projects.sort((a, b) => a.name.localeCompare(b.name));
      cb(projects);
    },
    (err) => {
      console.error('[cloudProjects] snapshot error', err);
      onError?.(err);
    },
  );
}

function toCloudProjectSummary(
  d: QueryDocumentSnapshot<DocumentData>,
): CloudProjectSummary {
  const data = d.data();
  return {
    id: d.id,
    name: typeof data.name === 'string' ? data.name : '(unnamed)',
    ownerId: typeof data.ownerId === 'string' ? data.ownerId : '',
    memberIds: Array.isArray(data.memberIds) ? (data.memberIds as string[]) : [],
    createdAt: tsToIso(data.createdAt),
  };
}

function tsToIso(ts: unknown): string {
  if (ts instanceof Timestamp) return ts.toDate().toISOString();
  if (ts && typeof ts === 'object' && 'seconds' in ts) {
    try {
      return new Date((ts as { seconds: number }).seconds * 1000).toISOString();
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Merge current Auth photo URL into the caller's member doc for each project.
 * Runs after sign-in / when the project list loads so Google CDN URLs stay fresh.
 */
export async function mergeMemberPhotoURL(
  uid: string,
  photoURL: string | null,
  projectIds: string[],
): Promise<void> {
  if (projectIds.length === 0) return;
  const db = getFirebaseFirestore();
  const value = photoURL ?? null;
  await Promise.all(
    projectIds.map((pid) =>
      setDoc(doc(db, 'projects', pid, 'members', uid), { photoURL: value }, { merge: true }),
    ),
  );
}

export async function createCloudProject(
  uid: string,
  name: string,
  displayName?: string,
  email?: string,
  photoURL?: string | null,
): Promise<CloudProjectSummary> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Project name required.');
  const db = getFirebaseFirestore();
  const projectsCol = collection(db, 'projects');
  const ref = await addDoc(projectsCol, {
    schemaVersion: 1,
    name: trimmed,
    ownerId: uid,
    memberIds: [uid],
    createdAt: serverTimestamp(),
  });
  // Also write a members/{uid} doc with display metadata.
  const ownerPhoto =
    photoURL != null && String(photoURL).trim() !== '' ? String(photoURL).trim() : null;
  await setDoc(doc(db, 'projects', ref.id, 'members', uid), {
    role: 'owner',
    joinedAt: serverTimestamp(),
    displayName: displayName ?? '',
    email: email ?? '',
    photoURL: ownerPhoto,
  });
  return {
    id: ref.id,
    name: trimmed,
    ownerId: uid,
    memberIds: [uid],
    createdAt: new Date().toISOString(),
  };
}

/** Owner-only delete. Rules enforce this. */
export async function deleteCloudProject(projectId: string): Promise<void> {
  const db = getFirebaseFirestore();
  // Note: this only deletes the project doc. Subcollections (tasks, members,
  // runners, invites) require separate cleanup — either a Cloud Function or
  // a client sweep. For V1 we accept orphan subcollection docs; they are
  // unreachable once the parent is gone and rules block access.
  await deleteDoc(doc(db, 'projects', projectId));
}

/**
 * Accept an invite transactionally: add uid to memberIds, create members/{uid},
 * delete the invite doc. Used by the Phase 4 invitations UI.
 */
export async function acceptInvite(
  projectId: string,
  uid: string,
  email: string,
  displayName?: string,
  photoURL?: string | null,
): Promise<void> {
  const db = getFirebaseFirestore();
  const projectRef = doc(db, 'projects', projectId);

  // Skip membership writes if the user is already in memberIds — avoids
  // clobbering an existing members/{uid} doc (e.g. demoting an owner to
  // "member"). getDoc succeeds only if rules let us read, which requires
  // membership — so a failure here implies not-a-member.
  let alreadyMember = false;
  try {
    const snap = await getDoc(projectRef);
    if (snap.exists()) {
      const data = snap.data() as { memberIds?: unknown };
      alreadyMember =
        Array.isArray(data.memberIds) && data.memberIds.includes(uid);
    }
  } catch {
    alreadyMember = false;
  }

  const memberRef = doc(db, 'projects', projectId, 'members', uid);
  const photo =
    photoURL != null && String(photoURL).trim() !== '' ? String(photoURL).trim() : null;

  if (!alreadyMember) {
    await setDoc(projectRef, { memberIds: arrayUnion(uid) }, { merge: true });
    await setDoc(memberRef, {
      role: 'member',
      joinedAt: serverTimestamp(),
      displayName: displayName ?? '',
      email,
      photoURL: photo,
    });
  } else {
    await setDoc(memberRef, { photoURL: photo }, { merge: true });
  }
  await deleteDoc(doc(db, 'projects', projectId, 'invites', email.toLowerCase()));
}
