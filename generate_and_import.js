const { run, all } = require('./db');

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Box-Muller transform for normal distribution
function randomNormal(mean, stdDev) {
  let u = 0, v = 0;
  while(u === 0) u = Math.random();
  while(v === 0) v = Math.random();
  let num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return num * stdDev + mean;
}

const num_records = 10000;
const num_machines = 50;

console.log("Clearing existing maintenance logs...");
run('DELETE FROM maintenance_logs');

// Create the 50 machines if they don't exist
const machineMap = new Map();
const currentMachines = all('SELECT id, name FROM machines');
currentMachines.forEach(m => machineMap.set(m.name, m.id));

for (let i = 1; i <= num_machines; i++) {
  const mName = `M${String(i).padStart(3, '0')}`;
  if (!machineMap.has(mName)) {
    const res = run(
      `INSERT INTO machines (name, status, working_hours, idle_hours, last_service_date, next_service_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [mName, 'Active', 0, 0, null, null]
    );
    machineMap.set(mName, res.lastInsertRowid);
  }
}

console.log("Generating and importing 10,000 dataset records directly to DB... This will be instant!");

const startDateMs = new Date('2024-01-01T00:00:00Z').getTime();

// Transaction vastly speeds up inserts
run('BEGIN TRANSACTION');

try {
  for (let i = 0; i < num_records; i++) {
    const mName = `M${String(randomInt(1, num_machines)).padStart(3, '0')}`;
    const mId = machineMap.get(mName);

    const base_failure = randomInt(100, 500);
    const variation = randomNormal(0, 30);
    let failure_time = Math.max(10, base_failure + variation);
    let repair_time = Math.max(5, randomNormal(60, 20));

    const degradation_factor = 0.8 + (Math.random() * 0.4); // uniform(0.8, 1.2)
    failure_time *= degradation_factor;
    repair_time *= (2 - degradation_factor);

    const dateOffset = randomInt(0, 365) * 24 * 60 * 60 * 1000;
    const date = new Date(startDateMs + dateOffset);

    run(
      `INSERT INTO maintenance_logs (machine_id, repair_time, failure_time, created_at)
       VALUES (?, ?, ?, ?)`,
      [mId, repair_time, failure_time, date.toISOString()]
    );
  }
  
  run('COMMIT');
  console.log(`Dataset generated and seamlessly imported successfully! Loaded ${num_records} records for ${num_machines} machines.`);
} catch (error) {
  run('ROLLBACK');
  console.error("An error occurred during import:", error);
}
