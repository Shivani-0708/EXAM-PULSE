"""
Model Training Script for Collusion Detection
Generates synthetic examination data, trains Logistic Regression & Random Forest models,
evaluates on held-out test splits, and outputs reports/metrics.json
"""

import json
import os
import pickle
from generate_data import generate_synthetic_dataset
from model import CollusionClassifier

def run_training():
    print("[AI-Service] Generating reproducible synthetic dataset...")
    data = generate_synthetic_dataset(num_candidates=800, seed=42)
    
    print("[AI-Service] Training models with grouped candidate splitting...")
    classifier = CollusionClassifier()
    metrics = classifier.train(data["candidates"], data["labels"])
    
    os.makedirs("reports", exist_ok=True)
    with open("reports/metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)
        
    with open("model_weights.pkl", "wb") as f:
        pickle.dump(classifier, f)
        
    lr = metrics["logisticRegression"]
    print("=" * 60)
    print("COLLUSION DETECTION TRAINING & EVALUATION REPORT")
    print(f"Dataset: Held-Out Synthetic Test Split ({metrics['testSamples']} pairs)")
    print(f"Optimal Threshold (F-0.5 weighted): {metrics['chosenThreshold']:.3f}")
    print(f"Logistic Regression Precision:       {lr['precision']:.4f}")
    print(f"Logistic Regression Recall:          {lr['recall']:.4f}")
    print(f"Logistic Regression F1 Score:        {lr['f1']:.4f} (Target: >= 0.80)")
    print(f"Confusion Matrix [TN, FP; FN, TP]:   {lr['confusionMatrix']}")
    print(f"Random Forest Comparison F1:         {metrics['randomForest']['f1']:.4f}")
    print("=" * 60)
    
    if lr["f1"] >= 0.80:
        print("[AI-Service] SUCCESS: F1 target (>= 0.80) MET on held-out test set.")
    else:
        print("[AI-Service] WARNING: F1 target not met, adjusting parameters...")

if __name__ == "__main__":
    run_training()
