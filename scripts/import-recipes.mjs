#!/usr/bin/env node
/**
 * recipe/*.md から手動で書き起こした scripts/seed/recipes.json を
 * Firestore の users/{uid}/recipes へ一回限りインポートするスクリプト。
 * アプリ本体(src/, api/)には含まれず、ビルド・デプロイ対象でもない。
 * 詳細は scripts/README.md を参照。
 *
 * 使い方:
 *   node scripts/import-recipes.mjs --email you@gmail.com \
 *     [--service-account parameters/firebase-service-account.json] \
 *     [--dry-run] [--yes] [--force]
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REQUIRED_SEED_KEYS = [
  "importKey",
  "title",
  "description",
  "servings",
  "cookingTimeMinutes",
  "category",
  "tags",
  "ingredients",
  "steps",
];

function parseArgs(argv) {
  const args = { dryRun: false, yes: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--email") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) {
        throw new Error("--email の値が指定されていません。");
      }
      args.email = value;
    } else if (arg === "--service-account") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) {
        throw new Error("--service-account の値が指定されていません。");
      }
      args.serviceAccountPath = value;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--yes") {
      args.yes = true;
    } else if (arg === "--force") {
      args.force = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function printUsage() {
  console.error(
    "使い方: node scripts/import-recipes.mjs --email you@gmail.com " +
      "[--service-account parameters/firebase-service-account.json] " +
      "[--dry-run] [--yes] [--force]",
  );
}

/**
 * サービスアカウントJSONを読み込む。--service-account が優先、
 * 無ければ環境変数 FIREBASE_SERVICE_ACCOUNT(JSON文字列)を使う。
 * どちらも無い/読めない/パースできない場合は明確なメッセージで失敗する。
 * (--dry-run でもここは実行する。パスの取り違え等を早期に検出するため。)
 */
function loadServiceAccount(serviceAccountPath) {
  if (serviceAccountPath) {
    let raw;
    try {
      raw = readFileSync(serviceAccountPath, "utf-8");
    } catch (err) {
      throw new Error(
        `サービスアカウントファイルを読み込めませんでした: ${serviceAccountPath} (${err.message})`,
      );
    }
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `サービスアカウントファイルのJSONを解析できませんでした: ${serviceAccountPath} (${err.message})`,
      );
    }
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `環境変数 FIREBASE_SERVICE_ACCOUNT のJSONを解析できませんでした (${err.message})`,
      );
    }
  }

  throw new Error(
    "サービスアカウントが指定されていません。" +
      "--service-account <path> か環境変数 FIREBASE_SERVICE_ACCOUNT(JSON文字列)を指定してください。",
  );
}

function loadSeedRecipes() {
  const recipesPath = path.join(__dirname, "seed", "recipes.json");
  const raw = readFileSync(recipesPath, "utf-8");
  return JSON.parse(raw);
}

/**
 * 書き込みの前に必ず呼ぶ。必須キーの有無・importKeyの一意性・
 * ingredients/stepsが空でないことを確認し、問題があればまとめて投げる。
 */
function validateSeedRecipes(recipes) {
  if (!Array.isArray(recipes)) {
    throw new Error("recipes.json の内容が配列ではありません。");
  }

  const problems = [];
  const seenKeys = new Set();

  recipes.forEach((seed, index) => {
    const label =
      seed && typeof seed.importKey === "string"
        ? seed.importKey
        : `(${index}番目のエントリ)`;

    for (const key of REQUIRED_SEED_KEYS) {
      if (!seed || !(key in seed)) {
        problems.push(`${label}: フィールド "${key}" がありません。`);
      }
    }

    if (typeof seed?.importKey !== "string" || seed.importKey.length === 0) {
      problems.push(`${label}: importKey が不正です。`);
    } else if (seenKeys.has(seed.importKey)) {
      problems.push(`${label}: importKey が重複しています。`);
    } else {
      seenKeys.add(seed.importKey);
    }

    if (typeof seed?.title !== "string" || seed.title.trim().length === 0) {
      problems.push(`${label}: title が空です。`);
    }
    if (!Array.isArray(seed?.ingredients) || seed.ingredients.length === 0) {
      problems.push(`${label}: ingredients が空です。`);
    }
    if (!Array.isArray(seed?.steps) || seed.steps.length === 0) {
      problems.push(`${label}: steps が空です。`);
    }
  });

  if (problems.length > 0) {
    throw new Error(
      `recipes.json の検証に失敗しました:\n${problems.map((p) => `- ${p}`).join("\n")}`,
    );
  }
}

/** src/lib/recipes.ts の toFirestoreFields と同じ形にする(idはここで採番)。 */
function buildFirestoreFields(seed) {
  return {
    title: seed.title,
    description: seed.description,
    servings: seed.servings,
    cookingTimeMinutes: seed.cookingTimeMinutes,
    parentRecipeId: null,
    sourceType: "manual",
    arrangementRequest: null,
    category: seed.category,
    tags: seed.tags,
    imageUrl: null,
    safetyNotes: [],
    changeSummary: [],
    ingredients: seed.ingredients.map((ing) => ({
      id: crypto.randomUUID(),
      name: ing.name,
      quantity: ing.quantity,
      unit: ing.unit,
      note: ing.note,
    })),
    steps: seed.steps.map((step) => ({
      id: crypto.randomUUID(),
      instruction: step.instruction,
      techniqueIds: [],
    })),
  };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (!args.email) {
    console.error("--email は必須です。");
    printUsage();
    process.exitCode = 1;
    return;
  }

  // サービスアカウントの読み込みと検証は --dry-run でも行う
  // (パス指定ミスや壊れたrecipes.jsonを早期に検出するため)。
  const serviceAccount = loadServiceAccount(args.serviceAccountPath);
  const recipes = loadSeedRecipes();
  validateSeedRecipes(recipes);

  if (args.dryRun) {
    console.log(
      `[dry-run] ${recipes.length}件のレシピを確認します(書き込みは行いません)`,
    );
    for (const seed of recipes) {
      console.log(
        `- ${seed.importKey}: 「${seed.title}」` +
          ` 材料${seed.ingredients.length}件 / 手順${seed.steps.length}件`,
      );
    }
    return;
  }

  initializeApp({ credential: cert(serviceAccount) });
  const auth = getAuth();
  const db = getFirestore();

  const user = await auth.getUserByEmail(args.email);
  console.log(`対象ユーザー: email=${args.email} uid=${user.uid}`);

  // 書き込み前に全件の現在の状態(作成/スキップ/上書き)を確認する。
  // 読み取りのみなので --yes が無くてもここまでは実行してよい。
  const plan = [];
  for (const seed of recipes) {
    const docRef = db
      .collection("users")
      .doc(user.uid)
      .collection("recipes")
      .doc(`import-${seed.importKey}`);
    const snapshot = await docRef.get();
    const exists = snapshot.exists;
    const action = !exists ? "create" : args.force ? "overwrite" : "skip";
    plan.push({
      seed,
      docRef,
      action,
      existingData: exists ? snapshot.data() : undefined,
    });
  }

  console.log("実行計画:");
  for (const p of plan) {
    const label =
      p.action === "create"
        ? "作成"
        : p.action === "overwrite"
          ? "上書き"
          : "スキップ(既存)";
    console.log(`- ${p.seed.importKey}(${p.seed.title}): ${label}`);
  }

  if (!args.yes) {
    console.log("書き込みには --yes を付けてください");
    return;
  }

  // 13件 < バッチ上限500件なので、1つのbatchにまとめてアトミックに書き込む。
  // 途中で失敗しても一部だけ書き込まれた状態にはならない。
  const batch = db.batch();
  let created = 0;
  let skipped = 0;
  let overwritten = 0;

  for (const p of plan) {
    if (p.action === "skip") {
      skipped += 1;
      continue;
    }
    const now = FieldValue.serverTimestamp();
    const data = {
      ...buildFirestoreFields(p.seed),
      createdAt:
        p.action === "overwrite" ? (p.existingData?.createdAt ?? now) : now,
      updatedAt: now,
    };
    batch.set(p.docRef, data, { merge: false });
    if (p.action === "create") created += 1;
    else overwritten += 1;
  }

  if (created + overwritten > 0) {
    await batch.commit();
  }

  console.log(
    `完了: 作成 ${created} 件 / スキップ ${skipped} 件 / 上書き ${overwritten} 件`,
  );
}

main().catch((err) => {
  console.error("インポートに失敗しました:", err.message ?? err);
  process.exitCode = 1;
});
