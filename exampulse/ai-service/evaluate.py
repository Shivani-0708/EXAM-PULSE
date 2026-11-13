"""
Evaluation Script for AI Collusion Model
Reads reports/metrics.json, verifies that F1 >= 0.80 target is met, and prints formatted summary.
"""

import json
import os
import sys

def verify_metrics():
    metrics_path = "reports/metrics.json"
    if not os.path.exists(metrics_path):
        print(f"Error: {metrics_path} not found. Run train.py first.")
        sys.exit(1)
        
    with open(metrics_path, "r") as f:
        metrics = json.load(f)
        
    lr = metrics["logisticRegression"]
    f1 = lr["f1"]
    precision = lr["precision"]
    recall = lr["recall"]
    threshold = metrics["chosenThreshold"]
    
    print("\n[AI Evaluation Verification]")
    print(f"  Precision: {precision:.4f}")
    print(f"  Recall:    {recall:.4f}")
    print(f"  F1 Score:  {f1:.4f}")
    print(f"  Threshold: {threshold:.3f}")
    
    passed = f1 >= 0.80
    print(f"  Status:    {'PASS (>= 0.80)' if passed else 'FAIL (< 0.80)'}\n")
    return passed

if __name__ == "__main__":
    success = verify_metrics()
    sys.exit(0 if success else 1)
