import pandas as pd
import numpy as np
import random
from datetime import datetime, timedelta

# Config
num_records = 10000
num_machines = 50

data = []

start_date = datetime(2024, 1, 1)

for i in range(num_records):
    machine_id = f"M{random.randint(1, num_machines):03}"

    # Simulate realistic behavior
    base_failure = random.randint(100, 500)
    variation = np.random.normal(0, 30)

    failure_time = max(10, base_failure + variation)

    repair_time = max(5, np.random.normal(60, 20))

    # Simulate degradation (machines getting worse over time)
    degradation_factor = random.uniform(0.8, 1.2)
    failure_time *= degradation_factor
    repair_time *= (2 - degradation_factor)

    date = start_date + timedelta(days=random.randint(0, 365))

    data.append({
        "machine_id": machine_id,
        "repair_time": round(repair_time, 2),
        "failure_time": round(failure_time, 2),
        "created_at": date
    })

df = pd.DataFrame(data)

# Sort by time (important for ML)
df = df.sort_values(by="created_at")

# Save
df.to_csv("cmms_maintenance_10000.csv", index=False)

print("Dataset generated successfully!")
