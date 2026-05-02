from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List
import xgboost as xgb
import numpy as np
import os

app = FastAPI(title="Smart CMMS Predictive Engine")

# Load Models
ml_dir = os.path.dirname(__file__)
try:
    mtbf_model = xgb.XGBRegressor()
    mtbf_model.load_model(os.path.join(ml_dir, 'mtbf_model.json'))
    
    mttr_model = xgb.XGBRegressor()
    mttr_model.load_model(os.path.join(ml_dir, 'mttr_model.json'))
    
    risk_model = xgb.XGBClassifier()
    risk_model.load_model(os.path.join(ml_dir, 'risk_model.json'))
    models_loaded = True
except Exception as e:
    print(f"Warning: Models not loaded. Please run train_xgboost.py first. Error: {e}")
    models_loaded = False

class LogEntry(BaseModel):
    repair_time: float
    failure_time: float
    created_at: str

class PredictionRequest(BaseModel):
    machine_id: str
    logs: List[LogEntry]

@app.post("/predict")
def predict(request: PredictionRequest):
    if not models_loaded:
        raise HTTPException(status_code=500, detail="Models not trained. Please run train_xgboost.py")
        
    logs = request.logs
    
    # We need at least 10 logs to calculate moving averages
    if len(logs) < 10:
        return {
            "machine_id": request.machine_id,
            "predicted_mtbf": 0,
            "predicted_mttr": 0,
            "failure_probability": 0,
            "risk_level": "UNKNOWN",
            "trend": "STABLE",
            "note": "Insufficient data for XGBoost"
        }
        
    # Get the last 10 logs
    window = logs[-10:]
    
    failure_times = [log.failure_time for log in window]
    repair_times = [log.repair_time for log in window]
    
    avg_mtbf = np.mean(failure_times)
    avg_mttr = np.mean(repair_times)
    
    first_half_mtbf = np.mean(failure_times[:5])
    second_half_mtbf = np.mean(failure_times[5:])
    trend_mtbf = second_half_mtbf - first_half_mtbf
    
    first_half_mttr = np.mean(repair_times[:5])
    second_half_mttr = np.mean(repair_times[5:])
    trend_mttr = second_half_mttr - first_half_mttr
    
    variance_mttr = np.var(repair_times)
    
    # Format for XGBoost prediction
    # XGBoost expects a 2D array: [[feature1, feature2, ...]]
    X = np.array([[avg_mtbf, avg_mttr, trend_mtbf, trend_mttr, variance_mttr]])
    
    pred_mtbf = float(mtbf_model.predict(X)[0])
    pred_mttr = float(mttr_model.predict(X)[0])
    
    # Predict probabilities (gives array of [prob_class_0, prob_class_1])
    prob_risk = float(risk_model.predict_proba(X)[0][1] * 100)
    
    # Calculate Risk Level based on probability
    if prob_risk >= 70:
        risk_level = "HIGH"
    elif prob_risk >= 40:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"
        
    # Trend mapping
    trend_str = "STABLE"
    if trend_mtbf < -10:
        trend_str = "DECREASING"
    elif trend_mtbf > 10:
        trend_str = "INCREASING"
        
    return {
        "machine_id": request.machine_id,
        "predicted_mtbf": max(0, round(pred_mtbf)),
        "predicted_mttr": max(0, round(pred_mttr)),
        "failure_probability": min(99, max(0, round(prob_risk))),
        "risk_level": risk_level,
        "trend": trend_str
    }
