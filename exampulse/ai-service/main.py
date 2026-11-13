"""
FastAPI Microservice for Collusion Detection
Provides:
- GET /health: Liveness and model readiness
- GET /metrics: Model precision, recall, F1, confusion matrix, threshold
- POST /analyze: Pairwise explainable collusion inference
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import pickle
import os
import json

app = FastAPI(title="ExamPulse AI Collusion Detection Service", version="1.0.0")

class AnalyzeRequest(BaseModel):
    targetCandidateId: int
    candidates: List[Dict[str, Any]]

# Global model container
classifier = None

@app.on_event("startup")
def load_model():
    global classifier
    weights_path = "model_weights.pkl"
    if os.path.exists(weights_path):
        with open(weights_path, "rb") as f:
            classifier = pickle.load(f)
        print("[AI Service] Loaded trained model weights.")
    else:
        print("[AI Service] Model weights not found. Training on startup...")
        from train import run_training
        run_training()
        if os.path.exists(weights_path):
            with open(weights_path, "rb") as f:
                classifier = pickle.load(f)

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "modelLoaded": classifier is not None,
        "service": "ai-collusion-detection"
    }

@app.get("/metrics")
def get_metrics():
    metrics_path = "reports/metrics.json"
    if os.path.exists(metrics_path):
        with open(metrics_path, "r") as f:
            return json.load(f)
    return {"error": "Metrics not generated yet"}

@app.post("/analyze")
def analyze_collusion(req: AnalyzeRequest):
    if classifier is None:
        raise HTTPException(status_code=503, detail="Model not initialized")
        
    target_id = req.targetCandidateId
    target_candidate = next((c for c in req.candidates if c.get("candidateId") == target_id), None)
    
    if not target_candidate:
        return {
            "candidateId": target_id,
            "flagged": False,
            "linkedCandidates": [],
            "riskScore": 0.0,
            "reasons": [],
            "evidence": {},
            "method": "AI_MODEL"
        }
        
    highest_risk = 0.0
    linked_candidates = []
    combined_reasons = []
    combined_evidence = {}
    
    for other in req.candidates:
        if other.get("candidateId") == target_id:
            continue
            
        pred = classifier.explain_prediction(target_candidate, other)
        if pred["riskScore"] > highest_risk:
            highest_risk = pred["riskScore"]
            combined_reasons = pred["reasons"]
            combined_evidence = pred["evidence"]
            
        if pred["flagged"]:
            linked_candidates.append(other["candidateId"])
            
    is_flagged = highest_risk >= classifier.threshold
    
    return {
        "candidateId": target_id,
        "flagged": is_flagged,
        "linkedCandidates": linked_candidates,
        "riskScore": highest_risk,
        "reasons": combined_reasons,
        "evidence": combined_evidence,
        "method": "AI_MODEL"
    }
