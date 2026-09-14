import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentSnapshot,
} from "firebase/firestore";
import { db } from "./firebase";
import { newId } from "./id";
import { extractTechniqueIds } from "./techniqueMarkup";
import type {
  Ingredient,
  IngredientInput,
  Recipe,
  RecipeInput,
  Step,
  StepInput,
} from "./types";

function recipesCol(uid: string) {
  return collection(db, "users", uid, "recipes");
}

function recipeDoc(uid: string, id: string) {
  return doc(db, "users", uid, "recipes", id);
}

const EPOCH_ISO = new Date(0).toISOString();

/**
 * createdAt/updatedAt の Timestamp を ISO 文字列にする。
 * serverTimestamp() がまだサーバーで解決されていない(またはドキュメントが壊れている)場合、
 * "今" ではなく安定した値にフォールバックする(一覧の updatedAt desc 順が揺れないように)。
 * updatedAt が無ければ createdAt を、createdAt も無ければ epoch を使う。
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

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

function normalizeIngredient(raw: unknown): Ingredient {
  const r = (raw ?? {}) as Partial<Record<keyof Ingredient, unknown>>;
  return {
    id: typeof r.id === "string" && r.id.length > 0 ? r.id : newId(),
    name: typeof r.name === "string" ? r.name : "",
    quantity: normalizeNullableString(r.quantity),
    unit: normalizeNullableString(r.unit),
    note: normalizeNullableString(r.note),
  };
}

function normalizeStep(raw: unknown): Step {
  const r = (raw ?? {}) as Partial<Record<keyof Step, unknown>>;
  const instruction = typeof r.instruction === "string" ? r.instruction : "";
  const techniqueIds =
    Array.isArray(r.techniqueIds) &&
    r.techniqueIds.every((x) => typeof x === "string")
      ? (r.techniqueIds as string[])
      : extractTechniqueIds(instruction);
  return {
    id: typeof r.id === "string" && r.id.length > 0 ? r.id : newId(),
    instruction,
    techniqueIds,
  };
}

function buildIngredients(ingredients: IngredientInput[]): Ingredient[] {
  return ingredients.map((ingredient) => ({
    id: ingredient.id,
    name: ingredient.name,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    note: ingredient.note,
  }));
}

function buildSteps(steps: StepInput[]): Step[] {
  return steps.map((step) => ({
    id: step.id,
    instruction: step.instruction,
    techniqueIds: extractTechniqueIds(step.instruction),
  }));
}

function fromSnapshot(snap: DocumentSnapshot<DocumentData>): Recipe {
  const data = snap.data();
  if (!data) {
    throw new Error(`recipe document ${snap.id} has no data`);
  }
  const { createdAt, updatedAt } = resolveTimestamps(data);
  return {
    id: snap.id,
    title: data.title ?? "",
    description: data.description ?? null,
    servings: data.servings ?? null,
    cookingTimeMinutes: data.cookingTimeMinutes ?? null,
    parentRecipeId: data.parentRecipeId ?? null,
    sourceType: data.sourceType ?? "manual",
    arrangementRequest: data.arrangementRequest ?? null,
    category: data.category ?? null,
    tags: normalizeStringArray(data.tags),
    imageUrl: data.imageUrl ?? null,
    safetyNotes: normalizeStringArray(data.safetyNotes),
    changeSummary: normalizeStringArray(data.changeSummary),
    ingredients: Array.isArray(data.ingredients)
      ? data.ingredients.map(normalizeIngredient)
      : [],
    steps: Array.isArray(data.steps) ? data.steps.map(normalizeStep) : [],
    createdAt,
    updatedAt,
  };
}

function toFirestoreFields(input: RecipeInput) {
  return {
    title: input.title,
    description: input.description,
    servings: input.servings,
    cookingTimeMinutes: input.cookingTimeMinutes,
    parentRecipeId: input.parentRecipeId,
    sourceType: input.sourceType,
    arrangementRequest: input.arrangementRequest,
    category: input.category,
    tags: input.tags,
    imageUrl: input.imageUrl,
    safetyNotes: input.safetyNotes,
    changeSummary: input.changeSummary,
    ingredients: buildIngredients(input.ingredients),
    steps: buildSteps(input.steps),
  };
}

export async function listRecipes(uid: string): Promise<Recipe[]> {
  const snap = await getDocs(
    query(recipesCol(uid), orderBy("updatedAt", "desc")),
  );
  return snap.docs.map((d) => fromSnapshot(d));
}

export async function getRecipe(
  uid: string,
  id: string,
): Promise<Recipe | null> {
  const snap = await getDoc(recipeDoc(uid, id));
  if (!snap.exists()) return null;
  return fromSnapshot(snap);
}

export async function createRecipe(
  uid: string,
  input: RecipeInput,
): Promise<Recipe> {
  const ref = await addDoc(recipesCol(uid), {
    ...toFirestoreFields(input),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const created = await getRecipe(uid, ref.id);
  if (!created) throw new Error("failed to load created recipe");
  return created;
}

export async function updateRecipe(
  uid: string,
  id: string,
  input: RecipeInput,
): Promise<Recipe> {
  await updateDoc(recipeDoc(uid, id), {
    ...toFirestoreFields(input),
    updatedAt: serverTimestamp(),
  });
  const updated = await getRecipe(uid, id);
  if (!updated) throw new Error("failed to load updated recipe");
  return updated;
}

/**
 * 親レシピを削除する場合、`parentRecipeId === id` の子レシピをすべて
 * `parentRecipeId = null` に更新してから削除する(バッチ書き込み、子は独立化)。
 */
export async function deleteRecipe(uid: string, id: string): Promise<void> {
  const childrenSnap = await getDocs(
    query(recipesCol(uid), where("parentRecipeId", "==", id)),
  );

  const batch = writeBatch(db);
  childrenSnap.docs.forEach((childDoc) => {
    batch.update(childDoc.ref, {
      parentRecipeId: null,
      updatedAt: serverTimestamp(),
    });
  });
  batch.delete(recipeDoc(uid, id));
  await batch.commit();
}
