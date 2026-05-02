import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, accuracy_score
import os

def engineer_features(df):
    # Sort by machine and time
    df = df.sort_values(by=['machine_id', 'created_at'])
    
    features = []
    
    # We will use a rolling window of 10 for each machine
    for machine_id, group in df.groupby('machine_id'):
        logs = group.to_dict('records')
        
        if len(logs) < 11:
            continue
            
        for i in range(10, len(logs)):
            window = logs[i-10:i]
            target = logs[i]
            
            failure_times = [float(log['failure_time']) for log in window]
            repair_times = [float(log['repair_time']) for log in window]
            
            avg_mtbf = np.mean(failure_times)
            avg_mttr = np.mean(repair_times)
            
            first_half_mtbf = np.mean(failure_times[:5])
            second_half_mtbf = np.mean(failure_times[5:])
            trend_mtbf = second_half_mtbf - first_half_mtbf
            
            first_half_mttr = np.mean(repair_times[:5])
            second_half_mttr = np.mean(repair_times[5:])
            trend_mttr = second_half_mttr - first_half_mttr
            
            variance_mttr = np.var(repair_times)
            
            # Synthetic proxy for "Failure Risk" - is the target MTBF severely dropping?
            is_high_risk = 1 if target['failure_time'] < (avg_mtbf * 0.7) else 0
            
            features.append({
                'avg_mtbf': avg_mtbf,
                'avg_mttr': avg_mttr,
                'trend_mtbf': trend_mtbf,
                'trend_mttr': trend_mttr,
                'variance_mttr': variance_mttr,
                'target_mtbf': target['failure_time'],
                'target_mttr': target['repair_time'],
                'target_risk': is_high_risk
            })
            
    return pd.DataFrame(features)

def train_models():
    csv_path = os.path.join(os.path.dirname(__file__), '..', 'cmms_maintenance_10000.csv')
    print(f"Loading dataset from {csv_path}...")
    df = pd.read_csv(csv_path)
    
    print("Engineering features...")
    feature_df = engineer_features(df)
    
    X = feature_df[['avg_mtbf', 'avg_mttr', 'trend_mtbf', 'trend_mttr', 'variance_mttr']]
    y_mtbf = feature_df['target_mtbf']
    y_mttr = feature_df['target_mttr']
    y_risk = feature_df['target_risk']
    
    X_train, X_test, y_mtbf_train, y_mtbf_test, y_mttr_train, y_mttr_test, y_risk_train, y_risk_test = train_test_split(
        X, y_mtbf, y_mttr, y_risk, test_size=0.2, random_state=42
    )
    
    print("Training MTBF Model...")
    mtbf_model = xgb.XGBRegressor(n_estimators=100, learning_rate=0.1, max_depth=5)
    mtbf_model.fit(X_train, y_mtbf_train)
    mtbf_preds = mtbf_model.predict(X_test)
    print(f"MTBF RMSE: {np.sqrt(mean_squared_error(y_mtbf_test, mtbf_preds)):.2f}")
    mtbf_model.save_model(os.path.join(os.path.dirname(__file__), 'mtbf_model.json'))
    
    print("Training MTTR Model...")
    mttr_model = xgb.XGBRegressor(n_estimators=100, learning_rate=0.1, max_depth=5)
    mttr_model.fit(X_train, y_mttr_train)
    mttr_preds = mttr_model.predict(X_test)
    print(f"MTTR RMSE: {np.sqrt(mean_squared_error(y_mttr_test, mttr_preds)):.2f}")
    mttr_model.save_model(os.path.join(os.path.dirname(__file__), 'mttr_model.json'))
    
    print("Training Risk Classifier...")
    risk_model = xgb.XGBClassifier(n_estimators=100, learning_rate=0.1, max_depth=5, use_label_encoder=False, eval_metric='logloss')
    risk_model.fit(X_train, y_risk_train)
    risk_preds = risk_model.predict(X_test)
    print(f"Risk Accuracy: {accuracy_score(y_risk_test, risk_preds) * 100:.2f}%")
    risk_model.save_model(os.path.join(os.path.dirname(__file__), 'risk_model.json'))
    
    print("All models trained and saved successfully!")

if __name__ == "__main__":
    train_models()
