import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  type DocumentData,
  type DocumentSnapshot,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Technique, TechniqueInput } from "./types";

function techniquesCol(uid: string) {
  return collection(db, "users", uid, "techniques");
}

function techniqueDoc(uid: string, id: string) {
  return doc(db, "users", uid, "techniques", id);
}

const EPOCH_ISO = new Date(0).toISOString();

/**
 * createdAt/updatedAt の Timestamp を ISO 文字列にする。recipes.ts と同じ方針:
 * "今" ではなく安定した値にフォールバックする。updatedAt が無ければ createdAt を、
 * createdAt も無ければ epoch を使う。
 */
function resolveTimestamps(data: {
  createdAt?: unknown;
  updatedAt?: unknown;
}): { createdAt: string; updatedAt: string } {
  const createdAt =
    data.createdAt instanceof Timestamp
      ? data.createdAt.toDate().toISOString()
      : EPOCH_ISO;
  const updatedAt =
    data.updatedAt instanceof Timestamp
      ? data.updatedAt.toDate().toISOString()
      : createdAt;
  return { createdAt, updatedAt };
}

function normalizeInstructions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

function fromSnapshot(snap: DocumentSnapshot<DocumentData>): Technique {
  const data = snap.data();
  if (!data) {
    throw new Error(`technique document ${snap.id} has no data`);
  }
  const { createdAt, updatedAt } = resolveTimestamps(data);
  return {
    id: snap.id,
    name: data.name ?? "",
    summary: data.summary ?? null,
    instructions: normalizeInstructions(data.instructions),
    cautions: data.cautions ?? null,
    media: null,
    createdAt,
    updatedAt,
  };
}

function toFirestoreFields(input: TechniqueInput) {
  return {
    name: input.name,
    summary: input.summary,
    instructions: input.instructions,
    cautions: input.cautions,
    media: null,
  };
}

export async function listTechniques(uid: string): Promise<Technique[]> {
  const snap = await getDocs(query(techniquesCol(uid), orderBy("name")));
  return snap.docs.map((d) => fromSnapshot(d));
}

export async function getTechnique(
  uid: string,
  id: string,
): Promise<Technique | null> {
  const snap = await getDoc(techniqueDoc(uid, id));
  if (!snap.exists()) return null;
  return fromSnapshot(snap);
}

export async function createTechnique(
  uid: string,
  input: TechniqueInput,
): Promise<Technique> {
  const ref = await addDoc(techniquesCol(uid), {
    ...toFirestoreFields(input),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const created = await getTechnique(uid, ref.id);
  if (!created) throw new Error("failed to load created technique");
  return created;
}

export async function updateTechnique(
  uid: string,
  id: string,
  input: TechniqueInput,
): Promise<Technique> {
  await updateDoc(techniqueDoc(uid, id), {
    ...toFirestoreFields(input),
    updatedAt: serverTimestamp(),
  });
  const updated = await getTechnique(uid, id);
  if (!updated) throw new Error("failed to load updated technique");
  return updated;
}

export async function deleteTechnique(uid: string, id: string): Promise<void> {
  await deleteDoc(techniqueDoc(uid, id));
}
