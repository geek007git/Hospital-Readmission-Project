"""
==========================================================
  CareSync - Hospital Readmission Risk ML Training Pipeline
  Target: Predict Readmitted_Within_30Days (binary)
  Dataset: hospital_readmission_fhir.csv  (3000 rows, 41 cols)
==========================================================
"""

import pandas as pd
import numpy as np
import warnings
import json
import os
warnings.filterwarnings("ignore")

from sklearn.model_selection import train_test_split, cross_val_score, StratifiedKFold
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.tree import DecisionTreeClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    roc_auc_score, confusion_matrix, classification_report
)
import pickle

# ─────────────────────────────────────────
# 1. LOAD DATA
# ─────────────────────────────────────────
print("=" * 60)
print("  CareSync ML Training Pipeline")
print("=" * 60)

df = pd.read_csv("hospital_readmission_fhir.csv")
print(f"\n[DATA]  Shape: {df.shape}")
print(f"[DATA]  Target distribution:\n{df['Readmitted_Within_30Days'].value_counts()}\n")

# ─────────────────────────────────────────
# 2. FEATURE ENGINEERING
# ─────────────────────────────────────────
# Drop non-informative / leakage columns
DROP_COLS = [
    "FHIR_Patient_ID", "Patient_ID", "Hospital_Name",
    "Primary_Diagnosis", "Secondary_Diagnoses",
    "Primary_ICD_Code", "Admission_Date", "Discharge_Date",
    "Readmission_Date",
    "Readmission_Risk_Score",   # This is the model output, would be leakage
    "Risk_Level"                 # Derived from risk score – leakage
]

df_ml = df.drop(columns=[c for c in DROP_COLS if c in df.columns])

TARGET = "Readmitted_Within_30Days"
X = df_ml.drop(columns=[TARGET])
y = df_ml[TARGET]

# Encode categorical features
cat_cols = X.select_dtypes(include=["object"]).columns.tolist()
print(f"[PREP]  Categorical columns encoded: {cat_cols}")

le_dict = {}
for col in cat_cols:
    le = LabelEncoder()
    X[col] = le.fit_transform(X[col].astype(str))
    le_dict[col] = le

# Scale numeric features
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)
X_scaled = pd.DataFrame(X_scaled, columns=X.columns)

# ─────────────────────────────────────────
# 3. TRAIN / TEST SPLIT  (80 / 20)
# ─────────────────────────────────────────
X_train, X_test, y_train, y_test = train_test_split(
    X_scaled, y, test_size=0.20, random_state=42, stratify=y
)

print(f"\n[SPLIT] Train size : {len(X_train)} rows  ({len(X_train)/len(df)*100:.0f}%)")
print(f"[SPLIT] Test  size : {len(X_test)}  rows  ({len(X_test)/len(df)*100:.0f}%)")
print(f"[SPLIT] Features   : {X_train.shape[1]}\n")

# ─────────────────────────────────────────
# 4. MODEL ZOO
# ─────────────────────────────────────────
models = {
    "Logistic Regression":      LogisticRegression(max_iter=500, random_state=42),
    "Decision Tree":            DecisionTreeClassifier(max_depth=6, random_state=42),
    "Random Forest":            RandomForestClassifier(n_estimators=200, max_depth=10, random_state=42, n_jobs=-1),
    "Gradient Boosting (GBM)":  GradientBoostingClassifier(n_estimators=150, learning_rate=0.1, max_depth=5, random_state=42),
    "K-Nearest Neighbours":     KNeighborsClassifier(n_neighbors=7),
}

cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

results = {}
print("─" * 60)
print(f"{'Model':<28} {'Acc':>6} {'Prec':>6} {'Rec':>6} {'F1':>6} {'AUC':>6}  CV-F1±σ")
print("─" * 60)

best_model_name = None
best_f1 = 0
best_model_obj = None

for name, model in models.items():
    model.fit(X_train, y_train)
    y_pred  = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1] if hasattr(model, "predict_proba") else None

    acc   = accuracy_score(y_test,  y_pred)
    prec  = precision_score(y_test, y_pred, zero_division=0)
    rec   = recall_score(y_test,   y_pred, zero_division=0)
    f1    = f1_score(y_test,       y_pred, zero_division=0)
    auc   = roc_auc_score(y_test,  y_proba) if y_proba is not None else 0.0

    cv_f1 = cross_val_score(model, X_scaled, y, cv=cv, scoring="f1", n_jobs=-1)

    results[name] = {
        "Accuracy":  round(acc, 4),
        "Precision": round(prec, 4),
        "Recall":    round(rec, 4),
        "F1":        round(f1, 4),
        "AUC-ROC":   round(auc, 4),
        "CV_F1_mean": round(cv_f1.mean(), 4),
        "CV_F1_std":  round(cv_f1.std(), 4),
        "Confusion":  confusion_matrix(y_test, y_pred).tolist()
    }

    print(f"{name:<28} {acc:>6.4f} {prec:>6.4f} {rec:>6.4f} {f1:>6.4f} {auc:>6.4f}  {cv_f1.mean():.4f}±{cv_f1.std():.4f}")

    if f1 > best_f1:
        best_f1 = f1
        best_model_name = name
        best_model_obj  = model

print("─" * 60)
print(f"\n🏆  Best Model: {best_model_name}  (F1 = {best_f1:.4f})\n")

# ─────────────────────────────────────────
# 5. FULL CLASSIFICATION REPORT (BEST MODEL)
# ─────────────────────────────────────────
print(f"\n{'='*60}")
print(f"  Detailed Report — {best_model_name}")
print(f"{'='*60}")
y_pred_best = best_model_obj.predict(X_test)
print(classification_report(y_test, y_pred_best, target_names=["Not Readmitted", "Readmitted"]))

cm = confusion_matrix(y_test, y_pred_best)
print("Confusion Matrix:")
print(f"  True Neg : {cm[0][0]} | False Pos: {cm[0][1]}")
print(f"  False Neg: {cm[1][0]} | True Pos : {cm[1][1]}")

# ─────────────────────────────────────────
# 6. FEATURE IMPORTANCE (if tree-based)
# ─────────────────────────────────────────
if hasattr(best_model_obj, "feature_importances_"):
    fi = pd.Series(best_model_obj.feature_importances_, index=X.columns)
    top10 = fi.nlargest(10)
    print(f"\n📊  Top 10 Feature Importances — {best_model_name}:")
    for feat, imp in top10.items():
        bar = "█" * int(imp * 100)
        print(f"   {feat:<28} {imp:.4f}  {bar}")

# ─────────────────────────────────────────
# 7. SAVE ARTIFACTS
# ─────────────────────────────────────────
os.makedirs("ml_output", exist_ok=True)

# Save best model
with open("ml_output/best_model.pkl", "wb") as f:
    pickle.dump(best_model_obj, f)

# Save scaler
with open("ml_output/scaler.pkl", "wb") as f:
    pickle.dump(scaler, f)

# Save label encoders
with open("ml_output/label_encoders.pkl", "wb") as f:
    pickle.dump(le_dict, f)

# Save column list
with open("ml_output/feature_columns.json", "w") as f:
    json.dump(list(X.columns), f)

# Save benchmarks
benchmark_data = {
    "dataset": "hospital_readmission_fhir.csv",
    "rows": int(len(df)),
    "features": int(X.shape[1]),
    "train_size": int(len(X_train)),
    "test_size": int(len(X_test)),
    "split": "80/20 stratified",
    "best_model": best_model_name,
    "best_f1": best_f1,
    "models": results
}

with open("ml_output/benchmarks.json", "w") as f:
    json.dump(benchmark_data, f, indent=2)

print(f"\n✅  Artifacts saved to ./ml_output/")
print(f"   └── best_model.pkl")
print(f"   └── scaler.pkl")
print(f"   └── label_encoders.pkl")
print(f"   └── feature_columns.json")
print(f"   └── benchmarks.json")
print("\n" + "=" * 60)
print("  Training Complete!")
print("=" * 60)
