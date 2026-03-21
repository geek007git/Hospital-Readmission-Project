import json
d = json.load(open('ml_output/benchmarks.json'))
print("Dataset:", d["dataset"])
print("Rows:", d["rows"], "| Features:", d["features"])
print("Train:", d["train_size"], "| Test:", d["test_size"], "| Split:", d["split"])
print("Best Model:", d["best_model"], " F1=", d["best_f1"])
print()
header = "{:<30} {:>7} {:>7} {:>7} {:>7} {:>7} {:>9}".format("Model","Acc","Prec","Recall","F1","AUC","CV-F1")
print(header)
print("-"*80)
for name, m in d["models"].items():
    row = "{:<30} {:>7.4f} {:>7.4f} {:>7.4f} {:>7.4f} {:>7.4f} {:>7.4f}+/-{:.4f}".format(
        name, m["Accuracy"], m["Precision"], m["Recall"], m["F1"], m["AUC-ROC"], m["CV_F1_mean"], m["CV_F1_std"]
    )
    print(row)
print()
for name, m in d["models"].items():
    cm = m["Confusion"]
    print(name, "Confusion Matrix:")
    print("  TN:", cm[0][0], "| FP:", cm[0][1])
    print("  FN:", cm[1][0], "| TP:", cm[1][1])
    print()
