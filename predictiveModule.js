async function predictMachine(machineId, logs) {
  if (!logs || logs.length === 0) {
    return {
      machine_id: machineId,
      predicted_mtbf: 0,
      predicted_mttr: 0,
      failure_probability: 0,
      risk_level: "UNKNOWN",
      trend: "STABLE"
    };
  }

  // Sort logs by created_at ascending
  logs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  try {
    // Use an Environment Variable for the ML API URL, falling back to localhost for local development
    const mlApiUrl = process.env.ML_API_URL || 'http://127.0.0.1:8000';
    
    // We now use native fetch (available in Node 18+) to call the Python ML Microservice
    const response = await fetch(`${mlApiUrl}/predict`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        machine_id: machineId.toString(),
        logs: logs.map(log => ({
          repair_time: log.repair_time,
          failure_time: log.failure_time,
          created_at: log.created_at
        }))
      })
    });

    if (!response.ok) {
      throw new Error(`ML Service returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to connect to ML Engine:", error.message);
    
    // Graceful fallback if the Python FastAPI server is not running
    return {
      machine_id: machineId,
      predicted_mtbf: 0,
      predicted_mttr: 0,
      failure_probability: 0,
      risk_level: "ML SERVICE OFFLINE",
      trend: "ERROR"
    };
  }
}

module.exports = {
  predictMachine
};
