const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('path');

const dbPath = path.join(__dirname, 'cmms.sqlite');
const db = new DatabaseSync(dbPath);

function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password, storedValue) {
  if (!storedValue) {
    return false;
  }

  if (!storedValue.includes(':')) {
    return storedValue === password;
  }

  const [salt, storedHash] = storedValue.split(':');
  if (!salt || !storedHash) {
    return false;
  }

  const computedHash = crypto.scryptSync(password, salt, 64);
  const originalHash = Buffer.from(storedHash, 'hex');

  if (computedHash.length !== originalHash.length) {
    return false;
  }

  return crypto.timingSafeEqual(computedHash, originalHash);
}

function normalizeExistingPasswords() {
  const users = all('SELECT id, password FROM users');

  users.forEach((user) => {
    if (!user.password.includes(':')) {
      run('UPDATE users SET password = ? WHERE id = ?', [
        hashPassword(user.password),
        user.id
      ]);
    }
  });
}

function ensureMasterData() {
  const masterUsers = [
    ['Admin Kumar', 'admin@jkfenner.com', '123', 'Admin', ['admin@cmms.com', 'admin@cmms.local']],
    ['Manager Priya', 'manager@jkfenner.com', '123', 'Manager', ['manager@cmms.com', 'manager@cmms.local']],
    ['Ravi Kumar', 'ravi@jkfenner.com', '123', 'Technician', ['ravi@cmms.com', 'tech@cmms.local']],
    ['Arun Prakash', 'arun@jkfenner.com', '123', 'Technician', ['arun@cmms.com']],
    ['Suresh Babu', 'suresh@jkfenner.com', '123', 'Technician', ['suresh@cmms.com']]
  ];

  masterUsers.forEach(([name, email, password, role, legacyEmails]) => {
    const existingUser = get(
      'SELECT id FROM users WHERE name = ? OR email = ?',
      [name, email]
    );

    if (existingUser) {
      run(
        'UPDATE users SET name = ?, email = ?, password = ?, role = ? WHERE id = ?',
        [name, email, hashPassword(password), role, existingUser.id]
      );
      return;
    }

    const legacyUser = get(
      `SELECT id FROM users
       WHERE email IN (${legacyEmails.map(() => '?').join(', ')})`,
      legacyEmails
    );

    if (legacyUser) {
      run(
        'UPDATE users SET name = ?, email = ?, password = ?, role = ? WHERE id = ?',
        [name, email, hashPassword(password), role, legacyUser.id]
      );
      return;
    }

    run(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [name, email, hashPassword(password), role]
    );
  });

  run(
    `UPDATE work_orders
     SET assigned_to = NULL
     WHERE assigned_to IN (
       SELECT id FROM users
       WHERE email LIKE '%@cmms.local'
          OR email LIKE '%@cmms.com'
     )`
  );

  run(
    `DELETE FROM users
     WHERE (email LIKE '%@cmms.local'
        OR email LIKE '%@cmms.com')
       AND id NOT IN (
         SELECT assigned_to FROM work_orders WHERE assigned_to IS NOT NULL
       )`
  );

  const machineDefinitions = [
    {
      name: 'Banbury Mixer',
      status: 'Active',
      working_hours: 1200,
      idle_hours: 100,
      last_service_date: '2026-03-20',
      next_service_date: '2026-05-20',
      components: ['Rotor Blades', 'Mixing Chamber', 'Drive Motor']
    },
    {
      name: 'Two Roll Mill',
      status: 'Active',
      working_hours: 980,
      idle_hours: 150,
      last_service_date: '2026-03-10',
      next_service_date: '2026-05-10',
      components: ['Feed Roller', 'Cooling Drum', 'Safety Guard']
    },
    {
      name: 'Rubber Extruder',
      status: 'Breakdown',
      working_hours: 870,
      idle_hours: 200,
      last_service_date: '2026-02-28',
      next_service_date: '2026-04-25',
      components: ['Screw Shaft', 'Barrel Heater', 'Die Head']
    },
    {
      name: 'Vulcanizing Press',
      status: 'Active',
      working_hours: 1500,
      idle_hours: 80,
      last_service_date: '2026-03-22',
      next_service_date: '2026-06-22',
      components: ['Heating Plate', 'Hydraulic Ram', 'Pressure Sensor']
    },
    {
      name: 'Conveyor System',
      status: 'Idle',
      working_hours: 600,
      idle_hours: 400,
      last_service_date: '2026-03-05',
      next_service_date: '2026-05-05',
      components: ['Conveyor Belt', 'Roller Assembly', 'Motor Drive']
    },
    {
      name: 'Hydraulic Press',
      status: 'Breakdown',
      working_hours: 750,
      idle_hours: 250,
      last_service_date: '2026-03-01',
      next_service_date: '2026-04-22',
      components: ['Hydraulic Pump', 'Cylinder Seal', 'Pressure Valve']
    },
    {
      name: 'Cooling System',
      status: 'Active',
      working_hours: 1300,
      idle_hours: 90,
      last_service_date: '2026-04-01',
      next_service_date: '2026-06-01',
      components: ['Coolant Pump', 'Heat Exchanger', 'Flow Sensor']
    }
  ];

  machineDefinitions.forEach((machine) => {
    let machineId;
    const existingMachine = get('SELECT id FROM machines WHERE name = ?', [machine.name]);

    if (!existingMachine) {
      const inserted = run(
        `INSERT INTO machines
         (name, status, working_hours, idle_hours, last_service_date, next_service_date)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          machine.name,
          machine.status,
          machine.working_hours,
          machine.idle_hours,
          machine.last_service_date,
          machine.next_service_date
        ]
      );
      machineId = Number(inserted.lastInsertRowid);
    } else {
      machineId = existingMachine.id;
      run(
        `UPDATE machines
         SET status = ?, working_hours = ?, idle_hours = ?, last_service_date = ?, next_service_date = ?
         WHERE id = ?`,
        [
          machine.status,
          machine.working_hours,
          machine.idle_hours,
          machine.last_service_date,
          machine.next_service_date,
          machineId
        ]
      );
    }

    machine.components.forEach((componentName) => {
      const existingComponent = get(
        'SELECT id FROM machine_components WHERE machine_id = ? AND name = ?',
        [machineId, componentName]
      );
      if (!existingComponent) {
        run(
          'INSERT INTO machine_components (machine_id, name) VALUES (?, ?)',
          [machineId, componentName]
        );
      }
    });
  });

  const materials = [
    ['Natural Rubber', 500, 100],
    ['Synthetic Rubber', 300, 80],
    ['Carbon Black', 200, 50],
    ['Steel Cord', 150, 40],
    ['Lubricant Oil', 50, 20],
    ['Coolant', 30, 15]
  ];

  materials.forEach(([name, quantity, threshold]) => {
    const existingMaterial = get('SELECT id FROM materials WHERE name = ?', [name]);
    if (!existingMaterial) {
      run(
        'INSERT INTO materials (name, quantity, threshold) VALUES (?, ?, ?)',
        [name, quantity, threshold]
      );
    } else {
      run(
        'UPDATE materials SET quantity = ?, threshold = ? WHERE id = ?',
        [quantity, threshold, existingMaterial.id]
      );
    }
  });

  const machineIdMap = new Map(
    all('SELECT id, name FROM machines').map((machine) => [machine.name, machine.id])
  );
  const userIdMap = new Map(
    all('SELECT id, email FROM users').map((user) => [user.email, user.id])
  );

  const workOrders = [
    ['Rubber Extruder', 'ravi@jkfenner.com', 'Extruder barrel overheating', 'Completed', '2026-04-17 08:00', '2026-04-17 09:00', '2026-04-17 11:00'],
    ['Hydraulic Press', 'arun@jkfenner.com', 'Hydraulic pressure drop', 'Completed', '2026-04-16 10:00', '2026-04-16 11:00', '2026-04-16 14:00'],
    ['Two Roll Mill', 'suresh@jkfenner.com', 'Roll gap calibration', 'In Progress', '2026-04-17 12:00', '2026-04-17 13:00', null],
    ['Conveyor System', 'ravi@jkfenner.com', 'Belt tracking adjustment', 'Pending', '2026-04-17 15:00', null, null],
    ['Banbury Mixer', 'arun@jkfenner.com', 'Rotor inspection and cleaning', 'Completed', '2026-04-15 09:00', '2026-04-15 10:00', '2026-04-15 12:00']
  ];

  workOrders.forEach(([machineName, technicianEmail, title, status, failureTime, startTime, endTime]) => {
    const machineId = machineIdMap.get(machineName);
    const technicianId = userIdMap.get(technicianEmail);
    const existingOrder = get(
      `SELECT id FROM work_orders
       WHERE machine_id = ? AND assigned_to = ? AND failure_time = ? AND title = ?`,
      [machineId, technicianId, failureTime, title]
    );

    if (!existingOrder) {
      run(
        `INSERT INTO work_orders
         (machine_id, assigned_to, title, description, status, failure_time, start_time, end_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          machineId,
          technicianId,
          title,
          `${title} maintenance task`,
          status,
          failureTime,
          startTime,
          endTime
        ]
      );
    }
  });

  const safetyReports = [
    ['Ravi Kumar', 'Minor hand injury during machine repair', 'Minor', '2026-04-15'],
    ['Arun Prakash', 'Slip near wet floor in workshop', 'Moderate', '2026-04-16']
  ];

  safetyReports.forEach(([employeeName, description, riskLevel, date]) => {
    const existingReport = get(
      'SELECT id FROM safety_reports WHERE employee_name = ? AND description = ? AND date = ?',
      [employeeName, description, date]
    );
    if (!existingReport) {
      run(
        'INSERT INTO safety_reports (employee_name, description, risk_level, date) VALUES (?, ?, ?, ?)',
        [employeeName, description, riskLevel, date]
      );
    }
  });
}

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS machines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      working_hours REAL NOT NULL DEFAULT 0,
      idle_hours REAL NOT NULL DEFAULT 0,
      last_service_date TEXT,
      next_service_date TEXT
    );

    CREATE TABLE IF NOT EXISTS machine_components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      FOREIGN KEY (machine_id) REFERENCES machines(id)
    );

    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      threshold REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS work_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id INTEGER NOT NULL,
      assigned_to INTEGER,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      failure_time TEXT,
      start_time TEXT,
      end_time TEXT,
      FOREIGN KEY (machine_id) REFERENCES machines(id),
      FOREIGN KEY (assigned_to) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS material_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id INTEGER NOT NULL,
      machine_id INTEGER NOT NULL,
      quantity_used REAL NOT NULL DEFAULT 0,
      used_at TEXT NOT NULL,
      FOREIGN KEY (material_id) REFERENCES materials(id),
      FOREIGN KEY (machine_id) REFERENCES machines(id)
    );

    CREATE TABLE IF NOT EXISTS safety_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_name TEXT NOT NULL,
      description TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS maintenance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id INTEGER NOT NULL,
      repair_time REAL NOT NULL,
      failure_time REAL NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (machine_id) REFERENCES machines(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  try {
    run('ALTER TABLE work_orders ADD COLUMN failure_category TEXT');
  } catch (err) {
    // Ignore if column already exists
  }

  try {
    run('ALTER TABLE safety_reports ADD COLUMN risk_level TEXT');
  } catch (err) {
    // Ignore if column already exists
  }

  const userCount = get('SELECT COUNT(*) AS count FROM users').count;
  if (userCount === 0) {
    seedData();
  }
  
  const maintenanceCount = get('SELECT COUNT(*) AS count FROM maintenance_logs').count;
  if (maintenanceCount === 0) {
    seedMaintenanceLogs();
  }

  normalizeExistingPasswords();
  ensureMasterData();
}

function seedData() {
  const users = [
    ['Admin Kumar', 'admin@jkfenner.com', '123', 'Admin'],
    ['Manager Priya', 'manager@jkfenner.com', '123', 'Manager'],
    ['Ravi Kumar', 'ravi@jkfenner.com', '123', 'Technician'],
    ['Arun Prakash', 'arun@jkfenner.com', '123', 'Technician'],
    ['Suresh Babu', 'suresh@jkfenner.com', '123', 'Technician']
  ];

  users.forEach((user) => {
    run(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [user[0], user[1], hashPassword(user[2]), user[3]]
    );
  });

  const machines = [
    ['CNC Mill 01', 'Active', 620, 42, '2026-03-15', '2026-05-15'],
    ['Hydraulic Press 02', 'Breakdown', 410, 88, '2026-03-01', '2026-04-20'],
    ['Packaging Line 03', 'Idle', 780, 120, '2026-02-25', '2026-05-25'],
    ['Air Compressor 04', 'Active', 530, 35, '2026-04-01', '2026-06-01']
  ];

  machines.forEach((machine) => {
    run(
      `INSERT INTO machines
       (name, status, working_hours, idle_hours, last_service_date, next_service_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      machine
    );
  });

  const components = [
    [1, 'Spindle Motor'],
    [1, 'Coolant Pump'],
    [2, 'Hydraulic Cylinder'],
    [2, 'Pressure Valve'],
    [3, 'Sealing Unit'],
    [3, 'Conveyor Belt'],
    [4, 'Air Filter'],
    [4, 'Pressure Gauge']
  ];

  components.forEach((component) => {
    run(
      'INSERT INTO machine_components (machine_id, name) VALUES (?, ?)',
      component
    );
  });

  const materials = [
    ['Lubricant Oil', 18, 10],
    ['Hydraulic Seal Kit', 4, 5],
    ['Bearings', 14, 8],
    ['Coolant', 6, 8],
    ['Drive Belts', 9, 6]
  ];

  materials.forEach((material) => {
    run(
      'INSERT INTO materials (name, quantity, threshold) VALUES (?, ?, ?)',
      material
    );
  });

  const workOrders = [
    [2, 3, 'Repair Hydraulic Leak', 'Seal replacement and system test', 'Completed', '2026-04-10T08:00', '2026-04-10T09:00', '2026-04-10T12:30'],
    [1, 3, 'Routine Spindle Inspection', 'Inspect vibration and lubrication', 'In Progress', '2026-04-16T10:00', '2026-04-16T11:00', null],
    [3, 3, 'Conveyor Alignment', 'Adjust line alignment after drift', 'Pending', '2026-04-17T07:30', null, null],
    [2, 3, 'Pressure Valve Replacement', 'Replace faulty relief valve', 'Completed', '2026-04-02T06:45', '2026-04-02T07:30', '2026-04-02T10:00']
  ];

  workOrders.forEach((order) => {
    run(
      `INSERT INTO work_orders
       (machine_id, assigned_to, title, description, status, failure_time, start_time, end_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      order
    );
  });

  const materialUsage = [
    [2, 2, 2, '2026-04-10T11:00'],
    [1, 1, 3, '2026-04-16T11:30'],
    [4, 1, 2, '2026-04-16T11:45'],
    [5, 3, 1, '2026-04-01T14:00']
  ];

  materialUsage.forEach((usage) => {
    run(
      `INSERT INTO material_usage (material_id, machine_id, quantity_used, used_at)
       VALUES (?, ?, ?, ?)`,
      usage
    );
  });

  const safetyReports = [
    ['Aman Patel', 'Minor hand injury while replacing a drive belt.', 'Minor', '2026-04-09'],
    ['Riya Shah', 'Slipped near coolant spill; no lost-time injury.', 'Moderate', '2026-04-14']
  ];

  safetyReports.forEach((report) => {
    run(
      'INSERT INTO safety_reports (employee_name, description, risk_level, date) VALUES (?, ?, ?, ?)',
      report
    );
  });
}

function seedMaintenanceLogs() {
  const machines = all('SELECT id FROM machines');
  
  machines.forEach((machine) => {
    let currentDate = new Date('2025-01-01T08:00:00Z');
    
    // Randomize base stats per machine to simulate different machine types
    let mtbfBase = Math.floor(Math.random() * 6000) + 6000; // 100-200 hours in minutes
    let mttrBase = Math.floor(Math.random() * 180) + 120; // 2-5 hours in minutes
    
    // Generate 100 records per machine
    for (let i = 0; i < 100; i++) {
      // Simulate trend: Machine aging causes MTBF to decrease and MTTR to increase slightly over time
      const trendFactor = 1 + (i * 0.005); 
      const currentMtbf = Math.max(mtbfBase / trendFactor, 1000); 
      const currentMttr = mttrBase * trendFactor;
      
      // Add +/- 10% randomness
      const failure_time = Math.floor(currentMtbf + (Math.random() * currentMtbf * 0.2 - currentMtbf * 0.1));
      const repair_time = Math.floor(currentMttr + (Math.random() * currentMttr * 0.2 - currentMttr * 0.1));
      
      // Advance time
      currentDate = new Date(currentDate.getTime() + (failure_time + repair_time) * 60000);
      
      run(
        `INSERT INTO maintenance_logs (machine_id, repair_time, failure_time, created_at)
         VALUES (?, ?, ?, ?)`,
        [machine.id, repair_time, failure_time, currentDate.toISOString()]
      );
    }
  });
}

function generatePreventiveWorkOrders() {
  const machinesDue = all(`
    SELECT id, name, next_service_date 
    FROM machines 
    WHERE next_service_date IS NOT NULL 
    AND (julianday(next_service_date) - julianday('now')) <= 3
  `);

  machinesDue.forEach(machine => {
    const existingPM = get(`
      SELECT id FROM work_orders 
      WHERE machine_id = ? AND title = 'Scheduled Preventive Maintenance' AND status != 'Completed'
    `, [machine.id]);

    if (!existingPM) {
      run(`
        INSERT INTO work_orders (machine_id, title, description, status, start_time)
        VALUES (?, 'Scheduled Preventive Maintenance', 'Automated PM generated by system.', 'Pending', datetime('now'))
      `, [machine.id]);
      
      const managers = all("SELECT id FROM users WHERE role IN ('Admin', 'Manager')");
      managers.forEach(m => {
        run(`INSERT INTO notifications (user_id, message, created_at) VALUES (?, ?, datetime('now'))`, 
          [m.id, `Automated PM scheduled for ${machine.name}`]);
      });
    }
  });
}

module.exports = {
  all,
  get,
  hashPassword,
  initializeDatabase,
  run,
  verifyPassword,
  generatePreventiveWorkOrders
};
